-- Customer credit sales, POS receipt settings, and atomic customer repayments.
alter table public.merchants
  add column if not exists phone text,
  add column if not exists receipt_paper_width text not null default '58mm'
    check (receipt_paper_width in ('58mm','80mm'));

alter table public.sales
  add column if not exists payment_method text not null default 'cash',
  add column if not exists credit_due_date date,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists receipt_note text;

alter table public.sales
  drop constraint if exists sales_payment_method_check;
alter table public.sales
  add constraint sales_payment_method_check
  check (payment_method in ('cash','momo','credit'));

create index if not exists sales_credit_due_idx
  on public.sales (merchant_id, credit_due_date)
  where payment_method='credit' and coalesce(voided,false)=false;

create or replace function private.aibos_sales_payment_reclass()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_debit uuid;
  v_cash uuid;
  v_amount numeric;
  v_entry uuid;
  v_code text;
begin
  if coalesce(new.voided,false) or not coalesce(new.stock_applied,false) then
    return new;
  end if;
  if coalesce(new.payment_method,'cash')='cash' then
    return new;
  end if;
  if new.payment_method not in ('momo','credit') then
    raise exception 'Unsupported POS payment method';
  end if;
  if new.payment_method='credit' and (
    new.credit_due_date is null
    or nullif(btrim(new.customer_name_snapshot),'') is null
    or nullif(btrim(new.customer_phone_snapshot),'') is null
  ) then
    raise exception 'Credit sale requires customer name, phone and due date';
  end if;

  v_code:=case when new.payment_method='momo' then '1020' else '1100' end;
  select id into v_debit from public.chart_of_accounts
   where merchant_id=new.merchant_id and code=v_code and active=true;
  select id into v_cash from public.chart_of_accounts
   where merchant_id=new.merchant_id and code='1000' and active=true;
  if v_debit is null or v_cash is null then
    raise exception 'POS payment accounts are missing or inactive';
  end if;
  v_amount:=coalesce(new.qty,0)::numeric*coalesce(new.price,0)::numeric;
  if v_amount<=0 then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.merchant_id::text||':sale_payment_reclass:'||new.id::text,0)
  );
  select id into v_entry from public.journal_entries
   where merchant_id=new.merchant_id and source_type='sale_payment_reclass'
     and source_id=new.id and voided=false
   limit 1 for update;
  if v_entry is not null then
    if not exists(
      select 1 from public.journal_lines
       where merchant_id=new.merchant_id and journal_entry_id=v_entry
         and account_id=v_debit and debit=v_amount and credit=0
    ) or not exists(
      select 1 from public.journal_lines
       where merchant_id=new.merchant_id and journal_entry_id=v_entry
         and account_id=v_cash and debit=0 and credit=v_amount
    ) then
      raise exception 'Existing POS payment reclassification conflicts with this sale';
    end if;
    return new;
  end if;

  insert into public.journal_entries
    (merchant_id,entry_date,description,source_type,source_id,created_by,created_by_name)
  values
    (new.merchant_id,new.created_at::date,
     case when new.payment_method='momo' then 'POS MoMo payment reclassification'
          else 'POS customer credit reclassification' end,
     'sale_payment_reclass',new.id,new.created_by,new.created_by_name)
  returning id into v_entry;

  insert into public.journal_lines
    (merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by,created_by_name)
  values
    (new.merchant_id,v_entry,v_debit,v_amount,0,
     case when new.payment_method='momo' then 'MoMo received' else 'Customer amount receivable' end,
     new.created_by,new.created_by_name),
    (new.merchant_id,v_entry,v_cash,0,v_amount,
     'Reclassify POS default cash posting',new.created_by,new.created_by_name);
  return new;
end;
$function$;

drop trigger if exists zz_sales_payment_reclass_after_insert on public.sales;
create trigger zz_sales_payment_reclass_after_insert
after insert on public.sales
for each row execute function private.aibos_sales_payment_reclass();

create or replace function private.aibos_void_sales_payment_reclass()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(new.voided,false) and not coalesce(old.voided,false) then
    update public.journal_entries
       set voided=true,void_reason=coalesce(nullif(new.void_reason,''),'Related sale voided'),
           voided_at=coalesce(new.voided_at,now()),voided_by=new.voided_by
     where merchant_id=new.merchant_id
       and source_type='sale_payment_reclass'
       and source_id=new.id and voided=false;
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_sales_payment_reclass_void_after_update on public.sales;
create trigger zz_sales_payment_reclass_void_after_update
after update of voided on public.sales
for each row execute function private.aibos_void_sales_payment_reclass();

create or replace function public.shericeri_record_customer_receipt(
  p_payment_id uuid,
  p_merchant_id uuid,
  p_transaction_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_date date,
  p_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_total numeric;
  v_paid numeric;
  v_cash_account uuid;
  v_receivable uuid;
  v_entry uuid;
  v_existing public.payments%rowtype;
  v_actor text;
begin
  if p_payment_id is null or p_merchant_id is null or p_transaction_id is null
     or p_amount is null or p_amount<=0 or p_payment_date is null
     or p_method not in ('cash','momo') then
    raise exception 'Customer receipt details are invalid';
  end if;
  if not (
    private.user_can_access_merchant(p_merchant_id,'create_sale')
    or private.user_can_access_merchant(p_merchant_id,'manage_finance')
  ) then
    raise exception 'Not authorized to record customer receipts';
  end if;

  select coalesce(nullif(btrim(mm.full_name),''),case when m.user_id=auth.uid() then 'Owner' else 'Staff' end)
    into v_actor
    from public.merchants m
    left join public.merchant_members mm on mm.merchant_id=m.id and mm.user_id=auth.uid() and mm.status='active'
   where m.id=p_merchant_id;
  v_actor:=coalesce(v_actor,'Staff');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_merchant_id::text||':sale_invoice_receipt:'||p_transaction_id::text,0)
  );

  select * into v_existing from public.payments where id=p_payment_id;
  if found then
    if v_existing.merchant_id=p_merchant_id
       and v_existing.source_type='sale_invoice'
       and v_existing.source_id=p_transaction_id
       and abs(v_existing.amount-p_amount)<=0.005 then
      return jsonb_build_object('ok',true,'already_recorded',true,'payment_id',p_payment_id);
    end if;
    raise exception 'Payment identifier is already used by another record';
  end if;

  select coalesce(sum(s.qty::numeric*s.price),0)
    into v_total
    from public.sales s
   where s.merchant_id=p_merchant_id
     and s.transaction_id=p_transaction_id
     and s.payment_method='credit'
     and coalesce(s.voided,false)=false
     and s.voided_at is null;
  if v_total<=0 then raise exception 'No active credit sale was found for this invoice'; end if;

  select coalesce(sum(p.amount),0)
    into v_paid
    from public.payments p
   where p.merchant_id=p_merchant_id
     and p.source_type='sale_invoice'
     and p.source_id=p_transaction_id
     and p.direction='receipt';

  if p_amount>v_total-v_paid+0.005 then
    raise exception 'Receipt exceeds the outstanding customer balance';
  end if;

  select id into v_cash_account
    from public.chart_of_accounts
   where merchant_id=p_merchant_id and code=case when p_method='momo' then '1020' else '1000' end
     and active=true;
  select id into v_receivable
    from public.chart_of_accounts
   where merchant_id=p_merchant_id and code='1100' and active=true;
  if v_cash_account is null or v_receivable is null then
    raise exception 'Cash, MoMo or Accounts Receivable account is missing';
  end if;

  insert into public.payments
    (id,merchant_id,direction,source_type,source_id,account_id,amount,payment_date,reference,notes,created_by,created_by_name)
  values
    (p_payment_id,p_merchant_id,'receipt','sale_invoice',p_transaction_id,v_cash_account,
     p_amount,p_payment_date,nullif(btrim(p_reference),''),coalesce(p_notes,'Customer credit repayment'),
     auth.uid(),v_actor);

  insert into public.journal_entries
    (merchant_id,entry_date,description,source_type,source_id,created_by,created_by_name)
  values
    (p_merchant_id,p_payment_date,'Customer credit repayment','sale_receipt',p_payment_id,
     auth.uid(),coalesce(private.current_actor_name(p_merchant_id),'Staff'))
  returning id into v_entry;

  insert into public.journal_lines
    (merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by,created_by_name)
  values
    (p_merchant_id,v_entry,v_cash_account,p_amount,0,
     case when p_method='momo' then 'Customer repayment received by MoMo' else 'Customer repayment received in cash' end,
     auth.uid(),coalesce(private.current_actor_name(p_merchant_id),'Staff')),
    (p_merchant_id,v_entry,v_receivable,0,p_amount,'Reduce customer accounts receivable',
     auth.uid(),coalesce(private.current_actor_name(p_merchant_id),'Staff'));

  return jsonb_build_object('ok',true,'already_recorded',false,'payment_id',p_payment_id,'outstanding',v_total-v_paid-p_amount);
end;
$function$;

revoke all on function public.shericeri_record_customer_receipt(uuid,uuid,uuid,numeric,text,date,text,text) from public,anon;
grant execute on function public.shericeri_record_customer_receipt(uuid,uuid,uuid,numeric,text,date,text,text) to authenticated;
