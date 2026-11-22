-- Keep the product update compatible with the existing products schema (which has no updated_at column).
create or replace function public.void_received_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_purchase public.purchases%rowtype;
  v_product public.products%rowtype;
  v_purchase_journal_id uuid;
  v_opening_journal_id uuid;
  v_reconciliation_journal_id uuid;
  v_purchase_void_journal_id uuid;
  v_supplier_return_journal_id uuid;
  v_opening_restore_journal_id uuid;
  v_stock_movement_id uuid;
  v_inventory uuid;
  v_payable uuid;
  v_equity uuid;
  v_purchase_journal_count integer;
  v_purchase_line_count integer;
  v_purchase_inventory_debit numeric;
  v_purchase_ap_credit numeric;
  v_opening_journal_count integer;
  v_opening_line_count integer;
  v_opening_inventory_debit numeric;
  v_opening_equity_credit numeric;
  v_reconciliation_count integer;
  v_reconciliation_line_count integer;
  v_reconciliation_equity_debit numeric;
  v_reconciliation_inventory_credit numeric;
  v_opening_qty numeric;
  v_opening_value numeric;
  v_receipt_count integer;
  v_receipt_qty numeric;
  v_receipt_value numeric;
  v_nonreceipt_value numeric;
  v_stock_after numeric;
  v_locked_through date;
  v_audit_id uuid := gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'Authentication is required to void a purchase';
  end if;
  if coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A clear reason of at least 3 characters is required';
  end if;

  select * into v_purchase
  from public.purchases
  where id=p_purchase_id
  for update;

  if not found then raise exception 'Purchase not found'; end if;
  if not private.user_can_access_merchant(v_purchase.merchant_id,'manage_inventory')
     or not private.user_can_access_merchant(v_purchase.merchant_id,'manage_team') then
    raise exception 'Not authorized to void this purchase';
  end if;
  if v_purchase.status<>'received' then
    raise exception 'Only received purchases can be voided here; cancel ordered purchases through the order workflow';
  end if;
  if v_purchase.voided_at is not null then
    raise exception 'This purchase has already been voided';
  end if;
  if abs(coalesce(v_purchase.total,0)-(v_purchase.qty*v_purchase.unit_cost))>0.005 then
    raise exception 'Purchase total does not equal quantity multiplied by unit cost; manual review is required';
  end if;

  select s.locked_through into v_locked_through
  from public.accounting_settings s
  where s.merchant_id=v_purchase.merchant_id;
  if v_locked_through is not null
     and (now() at time zone 'Africa/Kigali')::date<=v_locked_through then
    raise exception 'Accounting period is locked through %',v_locked_through;
  end if;

  select * into v_product
  from public.products
  where id=v_purchase.product_id and merchant_id=v_purchase.merchant_id
  for update;
  if not found then raise exception 'Purchase product is missing; manual review is required'; end if;

  select id into v_inventory from public.chart_of_accounts
  where merchant_id=v_purchase.merchant_id and code='1200' and active=true;
  select id into v_payable from public.chart_of_accounts
  where merchant_id=v_purchase.merchant_id and code='2000' and active=true;
  select id into v_equity from public.chart_of_accounts
  where merchant_id=v_purchase.merchant_id and code='3000' and active=true;
  if v_inventory is null or v_payable is null or v_equity is null then
    raise exception 'Active Inventory (1200), Accounts Payable (2000), and Owner Equity (3000) accounts are required';
  end if;

  select count(*)::integer,(array_agg(je.id order by je.created_at))[1]
    into v_purchase_journal_count,v_purchase_journal_id
  from public.journal_entries je
  where je.merchant_id=v_purchase.merchant_id
    and je.source_type='purchase' and je.source_id=v_purchase.id and je.voided=false;
  if v_purchase_journal_count<>1 then
    raise exception 'Expected exactly one active purchase journal; found %. Manual review is required',v_purchase_journal_count;
  end if;

  select count(*)::integer,
    coalesce(sum(jl.debit) filter(where jl.account_id=v_inventory),0),
    coalesce(sum(jl.credit) filter(where jl.account_id=v_payable),0)
    into v_purchase_line_count,v_purchase_inventory_debit,v_purchase_ap_credit
  from public.journal_lines jl
  where jl.merchant_id=v_purchase.merchant_id and jl.journal_entry_id=v_purchase_journal_id;
  if v_purchase_line_count<>2
     or abs(v_purchase_inventory_debit-v_purchase.total)>0.005
     or abs(v_purchase_ap_credit-v_purchase.total)>0.005 then
    raise exception 'Purchase journal does not match Dr Inventory / Cr Accounts Payable for the full purchase total';
  end if;

  select count(*)::integer,(array_agg(je.id order by je.created_at))[1]
    into v_opening_journal_count,v_opening_journal_id
  from public.journal_entries je
  where je.merchant_id=v_purchase.merchant_id
    and je.source_type='product_opening_stock'
    and je.source_id=v_purchase.product_id
    and je.voided=false;
  if v_opening_journal_count<>1 then
    raise exception 'Expected exactly one active product opening-stock journal; found %. No records changed',v_opening_journal_count;
  end if;

  select coalesce(sum(m.quantity_delta),0),coalesce(sum(m.quantity_delta*m.unit_cost),0)
    into v_opening_qty,v_opening_value
  from public.inventory_movements m
  where m.merchant_id=v_purchase.merchant_id
    and m.product_id=v_purchase.product_id
    and m.movement_type='opening_balance';
  if v_opening_qty<=0 or v_opening_value<=0 then
    raise exception 'A positive, traceable opening-stock movement is required; manual review is required';
  end if;

  select count(*)::integer,
    coalesce(sum(jl.debit) filter(where jl.account_id=v_inventory),0),
    coalesce(sum(jl.credit) filter(where jl.account_id=v_equity),0)
    into v_opening_line_count,v_opening_inventory_debit,v_opening_equity_credit
  from public.journal_lines jl
  where jl.merchant_id=v_purchase.merchant_id and jl.journal_entry_id=v_opening_journal_id;
  if v_opening_line_count<>2
     or abs(v_opening_inventory_debit-v_opening_value)>0.005
     or abs(v_opening_equity_credit-v_opening_value)>0.005 then
    raise exception 'Opening-stock journal does not reconcile to the product opening movement; manual review is required';
  end if;

  select count(*)::integer,(array_agg(je.id order by je.created_at))[1]
    into v_reconciliation_count,v_reconciliation_journal_id
  from public.journal_entries je
  where je.merchant_id=v_purchase.merchant_id
    and je.source_type='inventory_reconciliation'
    and je.source_id=v_opening_journal_id
    and je.voided=false;
  if v_reconciliation_count<>1 then
    raise exception 'Expected exactly one active linked opening-stock reconciliation journal; found %. No records changed',v_reconciliation_count;
  end if;

  select count(*)::integer,
    coalesce(sum(jl.debit) filter(where jl.account_id=v_equity),0),
    coalesce(sum(jl.credit) filter(where jl.account_id=v_inventory),0)
    into v_reconciliation_line_count,v_reconciliation_equity_debit,v_reconciliation_inventory_credit
  from public.journal_lines jl
  where jl.merchant_id=v_purchase.merchant_id and jl.journal_entry_id=v_reconciliation_journal_id;
  if v_reconciliation_line_count<>2
     or abs(v_reconciliation_equity_debit-v_opening_value)>0.005
     or abs(v_reconciliation_inventory_credit-v_opening_value)>0.005 then
    raise exception 'Linked opening-stock reconciliation does not exactly offset opening inventory; manual review is required';
  end if;

  select count(*)::integer,
    coalesce(sum(m.quantity_delta),0),
    coalesce(sum(m.quantity_delta*m.unit_cost),0)
    into v_receipt_count,v_receipt_qty,v_receipt_value
  from public.inventory_movements m
  where m.merchant_id=v_purchase.merchant_id
    and m.source_id=v_purchase.id and m.movement_type='purchase_receipt';

  if v_purchase.stock_applied then
    if v_purchase.status<>'received' or v_receipt_count<>1 then
      raise exception 'Stock-applied purchase must have exactly one retained receipt movement';
    end if;
    if abs(v_receipt_value-(v_receipt_qty*v_purchase.unit_cost))>0.005 then
      raise exception 'Purchase receipt valuation is inconsistent; manual review is required';
    end if;
  elsif v_receipt_count<>0 then
    raise exception 'Purchase is marked not stock-applied but has a receipt movement; manual review is required';
  end if;

  -- These two legacy test purchases used the opening-stock movement to account
  -- for the portion not represented by a separate receipt movement.
  if abs((v_opening_qty+v_receipt_qty)-v_purchase.qty)>0.0001
     or abs((v_opening_value+v_receipt_value)-v_purchase.total)>0.005 then
    raise exception 'Opening stock plus the retained purchase receipt does not exactly explain this purchase. No records changed';
  end if;

  if v_receipt_qty>0 and v_product.stock<v_receipt_qty then
    raise exception 'Insufficient remaining stock to return the received purchase quantity; manual review is required';
  end if;
  if exists (
    select 1 from public.inventory_movements m
    where m.merchant_id=v_purchase.merchant_id
      and m.source_id=v_purchase.id and m.movement_type='supplier_return'
  ) then
    raise exception 'A supplier-return movement already exists for this purchase; manual review is required';
  end if;

  v_nonreceipt_value:=v_purchase.total-v_receipt_value;
  v_stock_after:=v_product.stock-v_receipt_qty;

  select case when m.user_id=v_actor then 'Owner'
    else coalesce(mm.full_name,'Staff') end
    into v_actor_name
  from public.merchants m
  left join public.merchant_members mm
    on mm.merchant_id=m.id and mm.user_id=v_actor and mm.status='active'
  where m.id=v_purchase.merchant_id;

  -- Reverse the non-received portion of the purchase journal.
  if v_nonreceipt_value>0.005 then
    insert into public.journal_entries(merchant_id,entry_date,description,source_type,source_id,voided,created_by,created_by_name)
    values(v_purchase.merchant_id,(now() at time zone 'Africa/Kigali')::date,
      'Purchase void — non-received portion: '||coalesce(v_purchase.product_name_snapshot,'Product'),
      'purchase_void',v_purchase.id,false,v_actor,v_actor_name)
    returning id into v_purchase_void_journal_id;
    insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by,created_by_name)
    values
      (v_purchase.merchant_id,v_purchase_void_journal_id,v_payable,v_nonreceipt_value,0,'Reverse non-received purchase payable',v_actor,v_actor_name),
      (v_purchase.merchant_id,v_purchase_void_journal_id,v_inventory,0,v_nonreceipt_value,'Reverse non-received purchase inventory debit',v_actor,v_actor_name);
  end if;

  -- The received portion is reversed by a supplier-return journal tied to the
  -- exact negative stock movement created below.
  if v_receipt_value>0.005 then
    insert into public.journal_entries(merchant_id,entry_date,description,source_type,source_id,voided,created_by,created_by_name)
    values(v_purchase.merchant_id,(now() at time zone 'Africa/Kigali')::date,
      'Supplier return — void purchase: '||coalesce(v_purchase.product_name_snapshot,'Product'),
      'supplier_return',v_purchase.id,false,v_actor,v_actor_name)
    returning id into v_supplier_return_journal_id;
    insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by,created_by_name)
    values
      (v_purchase.merchant_id,v_supplier_return_journal_id,v_payable,v_receipt_value,0,'Reverse payable for returned purchase stock',v_actor,v_actor_name),
      (v_purchase.merchant_id,v_supplier_return_journal_id,v_inventory,0,v_receipt_value,'Remove returned purchase stock from inventory',v_actor,v_actor_name);
  end if;

  -- Reinstate the original product opening-stock recognition that the linked
  -- reconciliation had offset when this purchase was recorded.
  insert into public.journal_entries(merchant_id,entry_date,description,source_type,source_id,voided,created_by,created_by_name)
  values(v_purchase.merchant_id,(now() at time zone 'Africa/Kigali')::date,
    'Restore opening inventory after voiding purchase: '||coalesce(v_purchase.product_name_snapshot,'Product'),
    'purchase_void_opening_restore',v_purchase.id,false,v_actor,v_actor_name)
  returning id into v_opening_restore_journal_id;
  insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by,created_by_name)
  values
    (v_purchase.merchant_id,v_opening_restore_journal_id,v_inventory,v_opening_value,0,'Restore original product opening inventory',v_actor,v_actor_name),
    (v_purchase.merchant_id,v_opening_restore_journal_id,v_equity,0,v_opening_value,'Restore original opening-stock equity recognition',v_actor,v_actor_name);

  update public.journal_entries
  set voided=true,void_reason='Purchase void: '||trim(p_reason),voided_at=now(),voided_by=v_actor
  where id=v_purchase_journal_id and merchant_id=v_purchase.merchant_id and voided=false;

  if v_receipt_qty>0 then
    perform set_config('aibos.stock_movement_type','supplier_return',true);
    perform set_config('aibos.stock_movement_reason','Purchase void: '||trim(p_reason),true);
    perform set_config('aibos.stock_movement_source_id',v_purchase.id::text,true);
    perform set_config('aibos.stock_movement_unit_cost',v_purchase.unit_cost::text,true);
    update public.products
    set stock=v_stock_after
    where id=v_purchase.product_id and merchant_id=v_purchase.merchant_id;
    select m.id into v_stock_movement_id
    from public.inventory_movements m
    where m.merchant_id=v_purchase.merchant_id and m.source_id=v_purchase.id
      and m.movement_type='supplier_return'
    order by m.created_at desc limit 1;
  end if;

  update public.purchases
  set voided_at=now(),void_reason=trim(p_reason),voided_by=v_actor,
      void_journal_entry_id=coalesce(v_purchase_void_journal_id,v_supplier_return_journal_id),
      void_supplier_return_journal_entry_id=v_supplier_return_journal_id,
      void_opening_restore_journal_entry_id=v_opening_restore_journal_id,
      void_inventory_movement_id=v_stock_movement_id,
      updated_at=now()
  where id=v_purchase.id and merchant_id=v_purchase.merchant_id;

  perform public.shericeri_write_audit(
    v_purchase.merchant_id,v_audit_id,'void','purchase',v_purchase.id,trim(p_reason),
    jsonb_build_object(
      'purchase_total',v_purchase.total,
      'receipt_quantity_reversed',v_receipt_qty,
      'receipt_value_reversed',v_receipt_value,
      'nonreceipt_value_reversed',v_nonreceipt_value,
      'opening_stock_value_restored',v_opening_value,
      'stock_before',v_product.stock,
      'stock_after',v_stock_after,
      'original_purchase_journal_id',v_purchase_journal_id,
      'purchase_void_journal_id',v_purchase_void_journal_id,
      'supplier_return_journal_id',v_supplier_return_journal_id,
      'opening_restore_journal_id',v_opening_restore_journal_id,
      'inventory_movement_id',v_stock_movement_id,
      'opening_journal_id',v_opening_journal_id,
      'original_reconciliation_journal_id',v_reconciliation_journal_id
    )
  );

  return jsonb_build_object(
    'ok',true,
    'purchase_id',v_purchase.id,
    'product_id',v_purchase.product_id,
    'purchase_total',v_purchase.total,
    'receipt_quantity_reversed',v_receipt_qty,
    'receipt_value_reversed',v_receipt_value,
    'nonreceipt_value_reversed',v_nonreceipt_value,
    'opening_stock_value_restored',v_opening_value,
    'stock_before',v_product.stock,
    'stock_after',v_stock_after,
    'purchase_void_journal_id',v_purchase_void_journal_id,
    'supplier_return_journal_id',v_supplier_return_journal_id,
    'opening_restore_journal_id',v_opening_restore_journal_id,
    'inventory_movement_id',v_stock_movement_id,
    'audit_id',v_audit_id
  );
end;
$function$;

