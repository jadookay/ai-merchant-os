-- Keep POS sale voids from silently bypassing separate accounting invoices or receipts.
-- Any linked invoice must first be voided/credited and associated receipts refunded
-- through the accounting workflow. The sale void RPC then reverses the POS sale/COGS journals.
CREATE OR REPLACE FUNCTION public.shericeri_void_sale(p_merchant_id uuid, p_sale_id uuid, p_transaction_id uuid, p_reason text, p_audit_id uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_merchant_id uuid;
  v_transaction_id uuid;
  v_invoice_number text;
  v_amount numeric;
  v_line_count integer;
  v_sale_ids jsonb;
  v_sale_date date;
  v_lock date;
  v_original record;
  v_reversal_id uuid;
  v_linked_invoice_id uuid;
  v_linked_invoice_status text;
  v_linked_payment_count integer := 0;
begin
  if p_sale_id is null or coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A clear void reason is required';
  end if;

  v_merchant_id:=coalesce(p_merchant_id,(select merchant_id from public.sales where id=p_sale_id));
  if v_merchant_id is null then
    return jsonb_build_object('ok',true,'already_voided',true);
  end if;

  if not private.user_can_access_merchant(v_merchant_id,'manage_sales') then
    raise exception 'Not authorized to void sales';
  end if;

  perform 1 from public.sales
   where merchant_id=v_merchant_id
     and (id=p_sale_id or (p_transaction_id is not null and transaction_id=p_transaction_id))
   for update;

  select coalesce(transaction_id,p_transaction_id),invoice_number,created_at::date
    into v_transaction_id,v_invoice_number,v_sale_date
  from public.sales
  where merchant_id=v_merchant_id
    and (id=p_sale_id or (p_transaction_id is not null and transaction_id=p_transaction_id))
  order by case when id=p_sale_id then 0 else 1 end
  limit 1;

  if not found then
    return jsonb_build_object('ok',true,'already_voided',true);
  end if;

  if not exists(
    select 1 from public.sales
    where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and coalesce(voided,false)=false
  ) then
    return jsonb_build_object('ok',true,'already_voided',true);
  end if;

  -- A POS receipt number can also be used by the accounting invoice module.
  -- Never silently void a sale while a separate customer invoice or receipt
  -- is still active; that invoice must first be voided/credited and any receipt
  -- refunded through the payment workflow so the receivable and cash ledgers agree.
  if v_invoice_number is not null then
    select i.id,i.status
      into v_linked_invoice_id,v_linked_invoice_status
    from public.invoices i
    where i.merchant_id=v_merchant_id
      and i.invoice_number=v_invoice_number
    for update;

    if v_linked_invoice_id is not null then
      select count(*) into v_linked_payment_count
      from public.payments pay
      where pay.merchant_id=v_merchant_id
        and pay.source_type='invoice'
        and pay.source_id=v_linked_invoice_id;

      if v_linked_invoice_status <> 'void' or v_linked_payment_count > 0 then
        raise exception 'This sale is linked to an accounting invoice. Void or credit the invoice and process any payment refund first.';
      end if;
    end if;
  end if;

  select locked_through into v_lock
  from public.accounting_settings where merchant_id=v_merchant_id;

  if v_lock is not null and (v_sale_date<=v_lock or current_date<=v_lock) then
    raise exception 'The sale or current accounting period is locked';
  end if;

  select coalesce(sum(qty*price),0),count(*),coalesce(jsonb_agg(id),'[]'::jsonb)
    into v_amount,v_line_count,v_sale_ids
  from public.sales
  where merchant_id=v_merchant_id
    and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
    and coalesce(voided,false)=false;

  perform set_config('aibos.stock_movement_type','sale_void',true);
  perform set_config('aibos.stock_movement_source_id',p_sale_id::text,true);
  perform set_config('aibos.stock_movement_reason',trim(p_reason),true);

  update public.products p set stock=p.stock+x.qty
  from (
    select product_id,sum(qty)::integer as qty
    from public.sales
    where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and product_id is not null and stock_applied=true and coalesce(voided,false)=false
    group by product_id
  ) x
  where p.id=x.product_id and p.merchant_id=v_merchant_id;

  for v_original in
    select je.id,je.entry_date,je.description
    from public.journal_entries je
    where je.merchant_id=v_merchant_id
      and je.source_type in ('sale','sale_cogs')
      and je.source_id in (
        select s.id from public.sales s
        where s.merchant_id=v_merchant_id
          and (s.id=p_sale_id or (v_transaction_id is not null and s.transaction_id=v_transaction_id))
      )
      and coalesce(je.voided,false)=false
    for update
  loop
    if not exists(
      select 1 from public.journal_entries
      where merchant_id=v_merchant_id
        and source_type='sale_void'
        and source_id=v_original.id
    ) then
      v_reversal_id:=gen_random_uuid();
      insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id)
      values(v_reversal_id,v_merchant_id,current_date,'Reversal: '||v_original.description,'sale_void',v_original.id);

      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      select gen_random_uuid(),jl.merchant_id,v_reversal_id,jl.account_id,jl.credit,jl.debit,
             coalesce(jl.memo,'')||' (void reversal)'
      from public.journal_lines jl
      where jl.merchant_id=v_merchant_id and jl.journal_entry_id=v_original.id;
    end if;

    update public.journal_entries
      set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid()
      where id=v_original.id and merchant_id=v_merchant_id;
  end loop;

  update public.sales
    set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid(),stock_applied=false
    where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and coalesce(voided,false)=false;

  insert into public.audit_log(id,merchant_id,actor_user_id,action,entity_type,entity_id,reason,details,created_at)
  values(p_audit_id,v_merchant_id,auth.uid(),'void','sale',p_sale_id,trim(p_reason),
    jsonb_build_object(
      'reason',trim(p_reason),
      'invoice_number',v_invoice_number,
      'transaction_id',v_transaction_id,
      'amount',v_amount,
      'line_count',v_line_count,
      'sale_ids',v_sale_ids,
      'actor_name',case
        when exists(select 1 from public.merchants where id=v_merchant_id and user_id=auth.uid())
          then 'Owner'
        else coalesce(
          (select full_name from public.merchant_members
           where merchant_id=v_merchant_id and user_id=auth.uid() and status='active' limit 1),
          'Staff'
        )
      end
    ),now())
  on conflict(id) do nothing;

  return jsonb_build_object(
    'ok',true,'invoice_number',v_invoice_number,'transaction_id',v_transaction_id,
    'amount',v_amount,'line_count',v_line_count,'sale_ids',v_sale_ids
  );
end;
$function$
