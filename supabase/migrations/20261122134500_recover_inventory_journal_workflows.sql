-- Recovered from the verified preview schema after the 2026-11-21 production-schema restore.

-- Adds date-aware stock adjustment, idempotent ordered-purchase receipt handling,

-- and deferred inventory movement journal integrity checks.

CREATE OR REPLACE FUNCTION private.aibos_inventory_movement_journal_constraint_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source_type text;
  v_source_id uuid;
  v_voided boolean;
begin
  if tg_table_name='inventory_movements' then
    if tg_op<>'INSERT' then
      if old.movement_type='adjustment' and old.quantity_delta>0 then v_source_type:='stock_gain';
      elsif (old.movement_type='adjustment' and old.quantity_delta<0) or old.movement_type='writeoff' then v_source_type:='stock_writeoff';
      elsif old.movement_type='customer_return' then v_source_type:='sales_return_stock';
      elsif old.movement_type='supplier_return' then v_source_type:='supplier_return';
      else v_source_type:=null; end if;
      if v_source_type is not null then perform private.assert_aibos_inventory_movement_journal_source(old.merchant_id,old.source_id,v_source_type); end if;
    end if;
    if tg_op<>'DELETE' then
      if new.movement_type='adjustment' and new.quantity_delta>0 then v_source_type:='stock_gain';
      elsif (new.movement_type='adjustment' and new.quantity_delta<0) or new.movement_type='writeoff' then v_source_type:='stock_writeoff';
      elsif new.movement_type='customer_return' then v_source_type:='sales_return_stock';
      elsif new.movement_type='supplier_return' then v_source_type:='supplier_return';
      else v_source_type:=null; end if;
      if v_source_type is not null then perform private.assert_aibos_inventory_movement_journal_source(new.merchant_id,new.source_id,v_source_type); end if;
    end if;
  elsif tg_table_name='journal_entries' then
    if tg_op<>'INSERT' and old.source_type in ('stock_gain','stock_writeoff','sales_return_stock','supplier_return') and old.source_id is not null then
      perform private.assert_aibos_inventory_movement_journal_source(old.merchant_id,old.source_id,old.source_type);
    end if;
    if tg_op<>'DELETE' and new.source_type in ('stock_gain','stock_writeoff','sales_return_stock','supplier_return') and new.source_id is not null then
      perform private.assert_aibos_inventory_movement_journal_source(new.merchant_id,new.source_id,new.source_type);
    end if;
  elsif tg_table_name='journal_lines' then
    if tg_op<>'INSERT' then
      select je.source_type,je.source_id,je.voided into v_source_type,v_source_id,v_voided
      from public.journal_entries je where je.id=old.journal_entry_id and je.merchant_id=old.merchant_id;
      if v_source_type in ('stock_gain','stock_writeoff','sales_return_stock','supplier_return') and v_source_id is not null then
        perform private.assert_aibos_inventory_movement_journal_source(old.merchant_id,v_source_id,v_source_type);
      end if;
    end if;
    if tg_op<>'DELETE' then
      select je.source_type,je.source_id,je.voided into v_source_type,v_source_id,v_voided
      from public.journal_entries je where je.id=new.journal_entry_id and je.merchant_id=new.merchant_id;
      if v_source_type in ('stock_gain','stock_writeoff','sales_return_stock','supplier_return') and v_source_id is not null then
        perform private.assert_aibos_inventory_movement_journal_source(new.merchant_id,v_source_id,v_source_type);
      end if;
    end if;
  end if;
  return null;
end;
$function$


CREATE OR REPLACE FUNCTION private.assert_aibos_inventory_movement_journal_source(p_merchant_id uuid, p_source_id uuid, p_source_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_movement_count integer;
  v_movement_type text;
  v_quantity_delta integer;
  v_unit_cost numeric;
  v_amount numeric;
  v_debit_code text;
  v_credit_code text;
  v_debit_account uuid;
  v_credit_account uuid;
  v_entry_id uuid;
  v_entry_count integer;
  v_line_count integer;
  v_debit numeric;
  v_credit numeric;
begin
  if p_source_type='stock_gain' then
    v_movement_type:='adjustment'; v_debit_code:='1200'; v_credit_code:='3000';
  elsif p_source_type='stock_writeoff' then
    v_debit_code:='6000'; v_credit_code:='1200';
  elsif p_source_type='sales_return_stock' then
    v_movement_type:='customer_return'; v_debit_code:='1200'; v_credit_code:='5000';
  elsif p_source_type='supplier_return' then
    v_movement_type:='supplier_return'; v_debit_code:='2000'; v_credit_code:='1200';
  else
    return;
  end if;

  select count(*)::integer into v_entry_count
  from public.journal_entries
  where merchant_id=p_merchant_id and source_type=p_source_type
    and source_id=p_source_id and voided=false;

  if p_source_type='stock_writeoff' then
    select count(*)::integer,min(m.movement_type),sum(m.quantity_delta),sum(m.unit_cost*abs(m.quantity_delta))
      into v_movement_count,v_movement_type,v_quantity_delta,v_amount
    from public.inventory_movements m
    where m.merchant_id=p_merchant_id and m.source_id=p_source_id
      and (m.movement_type='writeoff' or (m.movement_type='adjustment' and m.quantity_delta<0));
  else
    select count(*)::integer,min(m.movement_type),sum(m.quantity_delta),sum(m.unit_cost*abs(m.quantity_delta))
      into v_movement_count,v_movement_type,v_quantity_delta,v_amount
    from public.inventory_movements m
    where m.merchant_id=p_merchant_id and m.source_id=p_source_id
      and m.movement_type=(case when p_source_type='stock_gain' then 'adjustment' else v_movement_type end);
  end if;

  if v_movement_count=0 then
    if v_entry_count>0 then
      raise exception 'AIBOS integrity: inventory movement journal % has no matching stock movement',p_source_id;
    end if;
    return;
  end if;
  if v_movement_count<>1 then
    raise exception 'AIBOS integrity: inventory movement source % must have exactly one matching movement',p_source_id;
  end if;

  if p_source_type='stock_gain' and v_quantity_delta<=0 then
    raise exception 'AIBOS integrity: stock gain must increase inventory';
  elsif p_source_type='stock_writeoff' and v_quantity_delta>=0 then
    raise exception 'AIBOS integrity: stock write-off must decrease inventory';
  elsif p_source_type='sales_return_stock' and v_quantity_delta<=0 then
    raise exception 'AIBOS integrity: customer return must increase inventory';
  elsif p_source_type='supplier_return' and v_quantity_delta>=0 then
    raise exception 'AIBOS integrity: supplier return must decrease inventory';
  end if;

  if coalesce(v_amount,0)<=0 then
    if v_entry_count>0 then raise exception 'AIBOS integrity: zero-value inventory movement must not have a value journal'; end if;
    return;
  end if;
  if v_entry_count<>1 then
    raise exception 'AIBOS integrity: inventory movement % requires exactly one active accounting journal; found %',p_source_id,v_entry_count;
  end if;

  select id into v_debit_account from public.chart_of_accounts
  where merchant_id=p_merchant_id and code=v_debit_code and active=true;
  select id into v_credit_account from public.chart_of_accounts
  where merchant_id=p_merchant_id and code=v_credit_code and active=true;
  select id into v_entry_id from public.journal_entries
  where merchant_id=p_merchant_id and source_type=p_source_type
    and source_id=p_source_id and voided=false limit 1;

  select count(*)::integer,
    coalesce(sum(jl.debit) filter(where jl.account_id=v_debit_account),0),
    coalesce(sum(jl.credit) filter(where jl.account_id=v_credit_account),0)
    into v_line_count,v_debit,v_credit
  from public.journal_lines jl
  where jl.merchant_id=p_merchant_id and jl.journal_entry_id=v_entry_id;

  if v_debit_account is null or v_credit_account is null or v_line_count<>2
     or abs(v_debit-v_amount)>0.005 or abs(v_credit-v_amount)>0.005 then
    raise exception 'AIBOS integrity: inventory movement journal % must post exactly Dr % / Cr % for RWF value %',p_source_id,v_debit_code,v_credit_code,v_amount;
  end if;
end;
$function$


CREATE OR REPLACE FUNCTION private.assert_aibos_opening_journal_source(p_merchant_id uuid, p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry_id uuid;
  v_entry_count integer;
  v_opening_qty numeric;
  v_opening_value numeric;
  v_inventory uuid;
  v_equity uuid;
  v_line_count integer;
  v_inventory_debit numeric;
  v_equity_credit numeric;
begin
  select count(*)::integer into v_entry_count
  from public.journal_entries
  where merchant_id=p_merchant_id and source_type='product_opening_stock'
    and source_id=p_product_id and voided=false;

  select coalesce(sum(m.quantity_delta),0),coalesce(sum(m.quantity_delta*m.unit_cost),0)
    into v_opening_qty,v_opening_value
  from public.inventory_movements m
  where m.merchant_id=p_merchant_id and m.product_id=p_product_id
    and m.movement_type='opening_balance';

  if v_opening_qty<=0 then
    if v_entry_count>0 then
      raise exception 'AIBOS integrity: opening inventory journal exists without an opening-stock movement for product %',p_product_id;
    end if;
    return;
  end if;

  if v_opening_value<=0 then
    raise exception 'AIBOS integrity: opening stock for product % has no positive inventory value',p_product_id;
  end if;
  if v_entry_count<>1 then
    raise exception 'AIBOS integrity: product % opening stock requires exactly one active opening inventory journal; found %',p_product_id,v_entry_count;
  end if;

  select id into v_entry_id
  from public.journal_entries
  where merchant_id=p_merchant_id and source_type='product_opening_stock'
    and source_id=p_product_id and voided=false
  limit 1;

  select id into v_inventory from public.chart_of_accounts
  where merchant_id=p_merchant_id and code='1200' and active=true;
  select id into v_equity from public.chart_of_accounts
  where merchant_id=p_merchant_id and code='3000' and active=true;

  select count(*)::integer,
    coalesce(sum(jl.debit) filter(where jl.account_id=v_inventory),0),
    coalesce(sum(jl.credit) filter(where jl.account_id=v_equity),0)
    into v_line_count,v_inventory_debit,v_equity_credit
  from public.journal_lines jl
  where jl.merchant_id=p_merchant_id and jl.journal_entry_id=v_entry_id;

  if v_inventory is null or v_equity is null or v_line_count<>2
     or abs(v_inventory_debit-v_opening_value)>0.005
     or abs(v_equity_credit-v_opening_value)>0.005 then
    raise exception 'AIBOS integrity: opening inventory journal for product % must equal its opening movement value (%) and post Dr Inventory / Cr Owner Equity',p_product_id,v_opening_value;
  end if;
end;
$function$


CREATE OR REPLACE FUNCTION private.ensure_aibos_inventory_movement_journal(p_merchant_id uuid, p_source_id uuid, p_movement_type text, p_quantity_delta integer, p_unit_cost numeric, p_reason text, p_entry_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source_type text;
  v_debit_code text;
  v_credit_code text;
  v_amount numeric;
  v_debit_account uuid;
  v_credit_account uuid;
  v_entry_id uuid;
  v_entry_count integer;
begin
  if p_movement_type='adjustment' and p_quantity_delta>0 then
    v_source_type:='stock_gain'; v_debit_code:='1200'; v_credit_code:='3000';
  elsif (p_movement_type='adjustment' and p_quantity_delta<0) or p_movement_type='writeoff' then
    v_source_type:='stock_writeoff'; v_debit_code:='6000'; v_credit_code:='1200';
  elsif p_movement_type='customer_return' and p_quantity_delta>0 then
    v_source_type:='sales_return_stock'; v_debit_code:='1200'; v_credit_code:='5000';
  elsif p_movement_type='supplier_return' and p_quantity_delta<0 then
    v_source_type:='supplier_return'; v_debit_code:='2000'; v_credit_code:='1200';
  else
    raise exception 'Inventory movement type and quantity direction do not have a valid accounting mapping';
  end if;

  v_amount:=abs(p_quantity_delta)*coalesce(p_unit_cost,0);
  if v_amount<=0 then return null; end if;

  insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,balance_sheet_class)
  values
    (p_merchant_id,'1200','Inventory','asset','debit','current'),
    (p_merchant_id,'3000','Owner equity','equity','credit',null),
    (p_merchant_id,'5000','Cost of goods sold','cogs','debit',null),
    (p_merchant_id,'6000','Inventory loss and write-off','expense','debit',null),
    (p_merchant_id,'2000','Accounts payable','liability','credit','current')
  on conflict (merchant_id,code) do nothing;

  select id into v_debit_account from public.chart_of_accounts
  where merchant_id=p_merchant_id and code=v_debit_code and active=true;
  select id into v_credit_account from public.chart_of_accounts
  where merchant_id=p_merchant_id and code=v_credit_code and active=true;
  if v_debit_account is null or v_credit_account is null then
    raise exception 'Required active accounts % and % are missing for inventory movement journal',v_debit_code,v_credit_code;
  end if;

  select count(*)::integer into v_entry_count
  from public.journal_entries
  where merchant_id=p_merchant_id and source_type=v_source_type
    and source_id=p_source_id and voided=false;

  if v_entry_count>1 then
    raise exception 'Multiple active inventory movement journals exist for source %',p_source_id;
  elsif v_entry_count=1 then
    select id into v_entry_id from public.journal_entries
    where merchant_id=p_merchant_id and source_type=v_source_type
      and source_id=p_source_id and voided=false limit 1;
    perform private.assert_aibos_inventory_movement_journal_source(p_merchant_id,p_source_id,v_source_type);
    return v_entry_id;
  end if;

  insert into public.journal_entries(
    merchant_id,entry_date,description,source_type,source_id,created_by
  ) values (
    p_merchant_id,coalesce(p_entry_date,current_date),
    coalesce(nullif(trim(p_reason),''),'Inventory movement'),
    v_source_type,p_source_id,auth.uid()
  ) returning id into v_entry_id;

  insert into public.journal_lines(
    merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by
  ) values
    (p_merchant_id,v_entry_id,v_debit_account,v_amount,0,coalesce(nullif(trim(p_reason),''),'Inventory movement'),auth.uid()),
    (p_merchant_id,v_entry_id,v_credit_account,0,v_amount,coalesce(nullif(trim(p_reason),''),'Inventory movement'),auth.uid());

  return v_entry_id;
end;
$function$


CREATE OR REPLACE FUNCTION private.ensure_aibos_opening_stock_journal(p_merchant_id uuid, p_product_id uuid, p_entry_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opening_qty numeric;
  v_opening_value numeric;
  v_inventory uuid;
  v_equity uuid;
  v_entry_id uuid;
  v_entry_count integer;
  v_line_count integer;
  v_inventory_debit numeric;
  v_equity_credit numeric;
  v_product_name text;
begin
  select p.name into v_product_name
  from public.products p
  where p.id=p_product_id and p.merchant_id=p_merchant_id;

  if not found then
    raise exception 'Opening stock product was not found';
  end if;

  select coalesce(sum(m.quantity_delta),0),coalesce(sum(m.quantity_delta*m.unit_cost),0)
    into v_opening_qty,v_opening_value
  from public.inventory_movements m
  where m.merchant_id=p_merchant_id and m.product_id=p_product_id
    and m.movement_type='opening_balance';

  if v_opening_qty<=0 or v_opening_value<=0 then
    raise exception 'Opening stock must have a positive quantity and inventory value before it can be journalled';
  end if;

  insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,balance_sheet_class)
  values
    (p_merchant_id,'1200','Inventory','asset','debit','current'),
    (p_merchant_id,'3000','Owner equity','equity','credit',null)
  on conflict (merchant_id,code) do nothing;

  select id into v_inventory from public.chart_of_accounts
  where merchant_id=p_merchant_id and code='1200' and active=true;
  select id into v_equity from public.chart_of_accounts
  where merchant_id=p_merchant_id and code='3000' and active=true;

  if v_inventory is null or v_equity is null then
    raise exception 'Active Inventory (1200) and Owner Equity (3000) accounts are required for opening stock';
  end if;

  select count(*)::integer into v_entry_count
  from public.journal_entries
  where merchant_id=p_merchant_id and source_type='product_opening_stock'
    and source_id=p_product_id and voided=false;

  if v_entry_count>1 then
    raise exception 'More than one active opening-stock journal exists for this product; manual review is required';
  end if;

  if v_entry_count=1 then
    select id into v_entry_id
    from public.journal_entries
    where merchant_id=p_merchant_id and source_type='product_opening_stock'
      and source_id=p_product_id and voided=false
    limit 1;

    select count(*)::integer,
      coalesce(sum(jl.debit) filter(where jl.account_id=v_inventory),0),
      coalesce(sum(jl.credit) filter(where jl.account_id=v_equity),0)
      into v_line_count,v_inventory_debit,v_equity_credit
    from public.journal_lines jl
    where jl.merchant_id=p_merchant_id and jl.journal_entry_id=v_entry_id;

    if v_line_count<>2 or abs(v_inventory_debit-v_opening_value)>0.005
       or abs(v_equity_credit-v_opening_value)>0.005 then
      raise exception 'Existing opening-stock journal does not match the opening inventory value (%)',v_opening_value;
    end if;
    return v_entry_id;
  end if;

  insert into public.journal_entries(
    merchant_id,entry_date,description,source_type,source_id,created_by
  ) values (
    p_merchant_id,coalesce(p_entry_date,current_date),'Opening inventory - '||v_product_name,
    'product_opening_stock',p_product_id,auth.uid()
  ) returning id into v_entry_id;

  insert into public.journal_lines(
    merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by
  ) values
    (p_merchant_id,v_entry_id,v_inventory,v_opening_value,0,'Opening inventory received',auth.uid()),
    (p_merchant_id,v_entry_id,v_equity,0,v_opening_value,'Opening stock contributed to the business',auth.uid());

  return v_entry_id;
end;
$function$


CREATE OR REPLACE FUNCTION private.sheri_adjust_product_stock_internal(p_merchant_id uuid, p_product_id uuid, p_expected_stock integer, p_quantity_delta integer, p_reason text, p_movement_type text, p_source_id uuid, p_entry_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.products%rowtype;
  v_next integer;
  v_existing_delta integer;
  v_existing_cost numeric;
  v_existing_reason text;
  v_existing_date date;
begin
  if not private.user_can_access_merchant(p_merchant_id,'manage_inventory') then
    raise exception 'Not authorized to adjust inventory';
  end if;
  if p_product_id is null or p_expected_stock is null or p_quantity_delta is null
     or p_quantity_delta=0 or coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A product, non-zero quantity and clear reason are required';
  end if;
  if p_movement_type not in ('adjustment','customer_return','supplier_return','writeoff','opening_balance') then
    raise exception 'Invalid inventory movement type';
  end if;
  if p_movement_type='opening_balance' and not private.user_can_access_merchant(p_merchant_id,'manage_finance') then
    raise exception 'Opening stock requires finance permission because it creates an opening equity journal';
  end if;
  if p_movement_type='opening_balance' and (p_expected_stock<>0 or p_quantity_delta<0) then
    raise exception 'Opening balance must add stock to a product with zero current stock';
  end if;
  if p_movement_type='customer_return' and p_quantity_delta<0 then
    raise exception 'Customer returns must increase stock';
  end if;
  if p_movement_type in ('supplier_return','writeoff') and p_quantity_delta>0 then
    raise exception 'Supplier returns and write-offs must reduce stock';
  end if;

  select * into v_product from public.products
  where id=p_product_id and merchant_id=p_merchant_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_source_id is null then raise exception 'A stable movement reference is required'; end if;
  if p_movement_type='opening_balance' and coalesce(v_product.cost,0)<=0 then
    raise exception 'Opening stock requires a positive unit cost';
  end if;

  select quantity_delta,unit_cost,reason,created_at::date
    into v_existing_delta,v_existing_cost,v_existing_reason,v_existing_date
  from public.inventory_movements
  where merchant_id=p_merchant_id and product_id=p_product_id
    and movement_type=p_movement_type and source_id=p_source_id
  limit 1;

  if found then
    if p_movement_type='opening_balance' then
      perform private.ensure_aibos_opening_stock_journal(p_merchant_id,p_product_id,coalesce(p_entry_date,v_existing_date,current_date));
    else
      perform private.ensure_aibos_inventory_movement_journal(
        p_merchant_id,p_source_id,p_movement_type,v_existing_delta,v_existing_cost,
        coalesce(v_existing_reason,p_reason),coalesce(p_entry_date,v_existing_date,current_date)
      );
    end if;
    return jsonb_build_object('ok',true,'already_recorded',true,'stock',v_product.stock,'movement_type',p_movement_type);
  end if;

  if coalesce(v_product.stock,0)<>p_expected_stock then
    return jsonb_build_object('ok',false,'stock_conflict',true,'server_stock',v_product.stock,'expected_stock',p_expected_stock);
  end if;
  v_next:=coalesce(v_product.stock,0)+p_quantity_delta;
  if v_next<0 then raise exception 'Stock cannot become negative'; end if;

  perform set_config('aibos.stock_movement_type',p_movement_type,true);
  perform set_config('aibos.stock_movement_source_id',p_source_id::text,true);
  perform set_config('aibos.stock_movement_reason',trim(p_reason),true);
  perform set_config('aibos.stock_movement_unit_cost',coalesce(v_product.cost,0)::text,true);
  update public.products set stock=v_next where id=p_product_id and merchant_id=p_merchant_id;

  if p_movement_type='opening_balance' then
    perform private.ensure_aibos_opening_stock_journal(p_merchant_id,p_product_id,coalesce(p_entry_date,current_date));
  else
    perform private.ensure_aibos_inventory_movement_journal(
      p_merchant_id,p_source_id,p_movement_type,p_quantity_delta,coalesce(v_product.cost,0),
      p_reason,coalesce(p_entry_date,current_date)
    );
  end if;

  return jsonb_build_object('ok',true,'stock',v_next,'movement_type',p_movement_type);
end;
$function$


CREATE OR REPLACE FUNCTION public.shericeri_adjust_product_stock(p_merchant_id uuid, p_product_id uuid, p_expected_stock integer, p_quantity_delta integer, p_reason text, p_movement_type text DEFAULT 'adjustment'::text, p_source_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.sheri_adjust_product_stock_internal(
    p_merchant_id,p_product_id,p_expected_stock,p_quantity_delta,p_reason,
    p_movement_type,p_source_id,current_date
  );
$function$


CREATE OR REPLACE FUNCTION public.shericeri_adjust_product_stock_v2(p_merchant_id uuid, p_product_id uuid, p_expected_stock integer, p_quantity_delta integer, p_reason text, p_movement_type text, p_source_id uuid, p_entry_date date)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.sheri_adjust_product_stock_internal(
    p_merchant_id,p_product_id,p_expected_stock,p_quantity_delta,p_reason,
    p_movement_type,p_source_id,p_entry_date
  );
$function$


CREATE OR REPLACE FUNCTION public.shericeri_sync_purchase_stock(p_purchase jsonb, p_product_id uuid, p_expected_server_stock integer, p_expected_server_cost numeric, p_local_stock integer, p_local_cost numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_merchant_id uuid;
  v_purchase_id uuid;
  v_qty integer;
  v_unit_cost numeric;
  v_total numeric;
  v_current_stock integer;
  v_current_cost numeric;
  v_stock_applied boolean;
  v_expected_cost numeric;
  v_status text;
  v_supplier_id uuid;
  v_product_inactive boolean;
  v_existing_status text;
  v_existing_supplier_id uuid;
  v_existing_product_id uuid;
  v_existing_qty numeric;
  v_existing_unit_cost numeric;
  v_existing_total numeric;
  v_purchase_exists boolean := false;
begin
  v_merchant_id := nullif(p_purchase->>'merchant_id','')::uuid;
  v_purchase_id := nullif(p_purchase->>'id','')::uuid;
  v_qty := nullif(p_purchase->>'qty','')::integer;
  v_unit_cost := nullif(p_purchase->>'unit_cost','')::numeric;
  v_total := nullif(p_purchase->>'total','')::numeric;
  v_status := coalesce(p_purchase->>'status','received');
  v_supplier_id := nullif(p_purchase->>'supplier_id','')::uuid;

  if v_merchant_id is null or v_purchase_id is null or v_qty is null or v_qty < 1
     or v_unit_cost is null or v_unit_cost < 0 or v_total is null or v_total < 0
     or abs(v_total-(v_qty*v_unit_cost))>0.005 then
    raise exception 'Purchase identity, quantity, unit cost or total is invalid';
  end if;
  if not private.user_can_access_merchant(v_merchant_id,'manage_inventory') then
    raise exception 'Not authorized to record inventory purchases';
  end if;
  if nullif(p_purchase->>'product_id','')::uuid is distinct from p_product_id then
    raise exception 'Purchase product does not match the stock operation';
  end if;
  if v_supplier_id is not null and not exists (
    select 1 from public.suppliers where id=v_supplier_id and merchant_id=v_merchant_id
  ) then
    raise exception 'Supplier does not belong to this business';
  end if;
  if v_status not in ('ordered','received') then
    raise exception 'Purchase status is invalid';
  end if;

  select coalesce(stock,0),coalesce(cost,0),coalesce(deleted,false)
    into v_current_stock,v_current_cost,v_product_inactive
  from public.products
  where id=p_product_id and merchant_id=v_merchant_id
  for update;
  if not found then raise exception 'Product was not found for this business'; end if;

  select status,stock_applied,supplier_id,product_id,qty,unit_cost,total
    into v_existing_status,v_stock_applied,v_existing_supplier_id,v_existing_product_id,
         v_existing_qty,v_existing_unit_cost,v_existing_total
  from public.purchases
  where id=v_purchase_id and merchant_id=v_merchant_id
  for update;
  v_purchase_exists := found;

  if v_purchase_exists then
    if v_existing_supplier_id is distinct from v_supplier_id
       or v_existing_product_id is distinct from p_product_id
       or v_existing_qty is distinct from v_qty
       or v_existing_unit_cost is distinct from v_unit_cost
       or abs(coalesce(v_existing_total,0)-v_total)>0.005 then
      raise exception 'A purchase retry cannot change its supplier, product, quantity or unit cost';
    end if;

    if v_existing_status='received' then
      if not coalesce(v_stock_applied,false) or not exists (
        select 1 from public.inventory_movements im
        where im.merchant_id=v_merchant_id and im.product_id=p_product_id
          and im.source_id=v_purchase_id and im.movement_type='purchase_receipt'
      ) then
        return jsonb_build_object('ok',false,'already_recorded',true,'stock_conflict',true,
          'conflict_reason','existing_purchase_missing_receipt','server_stock',v_current_stock,'server_cost',v_current_cost);
      end if;
      return jsonb_build_object('ok',true,'already_recorded',true,'stock_conflict',false,
        'server_stock',v_current_stock,'server_cost',v_current_cost);
    elsif v_existing_status='ordered' and v_status='ordered' then
      return jsonb_build_object('ok',true,'already_recorded',true,'stock_conflict',false,'ordered',true);
    elsif v_existing_status<>'ordered' or v_status<>'received' then
      raise exception 'Only an ordered purchase can transition to received';
    end if;
  end if;

  if v_product_inactive then
    raise exception 'An inactive product cannot receive a purchase. Reactivate it before recording a purchase.';
  end if;

  if v_status='ordered' then
    if v_purchase_exists then raise exception 'The existing purchase is already recorded'; end if;
    insert into public.purchases
    select (jsonb_populate_record(null::public.purchases,p_purchase||jsonb_build_object('stock_applied',false))).*
    ;
    return jsonb_build_object('ok',true,'stock_conflict',false,'ordered',true);
  end if;

  if p_expected_server_stock is null or p_expected_server_cost is null
     or p_local_stock is null or p_local_cost is null
     or p_local_stock<>p_expected_server_stock+v_qty then
    raise exception 'Purchase stock values are invalid';
  end if;

  if v_current_stock+v_qty>0 then
    v_expected_cost:=round(((v_current_stock*v_current_cost)+(v_qty*v_unit_cost))::numeric/(v_current_stock+v_qty),4);
  else
    v_expected_cost:=v_unit_cost;
  end if;

  if v_current_stock<>p_expected_server_stock or v_current_cost<>p_expected_server_cost then
    return jsonb_build_object('ok',false,'stock_conflict',true,'server_stock',v_current_stock,'server_cost',v_current_cost);
  end if;
  if p_local_cost<>v_expected_cost then
    raise exception 'Weighted average purchase cost does not match the server calculation';
  end if;

  if v_purchase_exists then
    update public.purchases
    set status='received',stock_applied=true,
        purchased_at=coalesce(nullif(p_purchase->>'purchased_at','')::timestamptz,now()),
        updated_at=now()
    where id=v_purchase_id and merchant_id=v_merchant_id;
  else
    insert into public.purchases
    select (jsonb_populate_record(null::public.purchases,p_purchase||jsonb_build_object('stock_applied',true))).*
    ;
  end if;

  perform set_config('aibos.stock_movement_type','purchase_receipt',true);
  perform set_config('aibos.stock_movement_source_id',v_purchase_id::text,true);
  perform set_config('aibos.stock_movement_reason','Purchase received',true);
  perform set_config('aibos.stock_movement_unit_cost',v_unit_cost::text,true);

  update public.products set stock=p_local_stock,cost=p_local_cost
  where id=p_product_id and merchant_id=v_merchant_id;

  if not exists (
    select 1 from public.inventory_movements im
    where im.merchant_id=v_merchant_id and im.product_id=p_product_id
      and im.source_id=v_purchase_id and im.movement_type='purchase_receipt'
  ) then
    raise exception 'Purchase stock update did not create its inventory receipt movement';
  end if;

  return jsonb_build_object('ok',true,'stock_conflict',false,'server_stock',p_local_stock,
    'server_cost',p_local_cost,'received_from_order',v_purchase_exists);
end;
$function$


drop trigger if exists aibos_inventory_movement_journal_deferred on public.inventory_movements;
CREATE CONSTRAINT TRIGGER aibos_inventory_movement_journal_deferred AFTER INSERT OR DELETE OR UPDATE ON inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.aibos_inventory_movement_journal_constraint_trigger();

drop trigger if exists aibos_inventory_movement_journal_header_deferred on public.journal_entries;
CREATE CONSTRAINT TRIGGER aibos_inventory_movement_journal_header_deferred AFTER INSERT OR DELETE OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.aibos_inventory_movement_journal_constraint_trigger();

drop trigger if exists aibos_inventory_movement_journal_lines_deferred on public.journal_lines;
CREATE CONSTRAINT TRIGGER aibos_inventory_movement_journal_lines_deferred AFTER INSERT OR DELETE OR UPDATE ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.aibos_inventory_movement_journal_constraint_trigger();

revoke all on function public.shericeri_adjust_product_stock_v2(uuid,uuid,integer,integer,text,text,uuid,date) from public;

grant execute on function public.shericeri_adjust_product_stock_v2(uuid,uuid,integer,integer,text,text,uuid,date) to authenticated, service_role;
