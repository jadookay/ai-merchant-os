-- Record external RRA/RSSB payments against payroll liabilities with balanced journals.
create table if not exists public.payroll_statutory_payments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  contribution_type text not null check (contribution_type in ('paye','pension','occupational_hazards','maternity','cbhi')),
  period_start date not null,
  period_end date not null,
  payment_date date not null,
  amount numeric(18,2) not null check (amount>0),
  payment_method text not null check (payment_method in ('bank','mobile_money','cash')),
  reference text,
  status text not null default 'recorded' check (status='recorded'),
  journal_entry_id uuid references public.journal_entries(id),
  idempotency_key text not null,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (period_end>=period_start)
);
create unique index if not exists payroll_statutory_payments_idempotency_unique
  on public.payroll_statutory_payments(merchant_id,idempotency_key);
create index if not exists payroll_statutory_payments_period_idx
  on public.payroll_statutory_payments(merchant_id,contribution_type,period_start,period_end);
alter table public.payroll_statutory_payments enable row level security;
grant select on public.payroll_statutory_payments to authenticated;
create policy payroll_statutory_payments_select on public.payroll_statutory_payments
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

create or replace function public.shericeri_get_payroll_statutory_balance(
 p_merchant_id uuid,p_period_start date,p_period_end date,p_contribution_type text
) returns table(expected_amount numeric,paid_amount numeric,outstanding_amount numeric)
language plpgsql security definer set search_path=''
as $$
declare
 v_expected numeric(18,2);
 v_paid numeric(18,2);
 v_month_span integer;
 v_frequency text;
begin
 if not private.user_can_access_merchant(p_merchant_id,'manage_payroll') then raise exception 'Not authorized to view statutory payroll balances'; end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start
   or p_period_start<>date_trunc('month',p_period_start)::date
   or p_period_end<>(date_trunc('month',p_period_end)+interval '1 month - 1 day')::date then
   raise exception 'Select complete calendar month or quarter dates';
 end if;
 if p_contribution_type is null or p_contribution_type not in ('paye','pension','occupational_hazards','maternity','cbhi') then raise exception 'Unsupported statutory contribution type'; end if;
 v_month_span:=(extract(year from p_period_end)::integer*12+extract(month from p_period_end)::integer)
   -(extract(year from p_period_start)::integer*12+extract(month from p_period_start)::integer);
 select coalesce(paye_frequency,'monthly') into v_frequency from public.payroll_employer_settings where merchant_id=p_merchant_id;
 v_frequency:=coalesce(v_frequency,'monthly');
 if p_contribution_type='paye' then
   if v_frequency='quarterly' then
     if v_month_span<>2 or not (
       (extract(month from p_period_start)=3 and extract(month from p_period_end)=5 and extract(year from p_period_start)=extract(year from p_period_end))
       or (extract(month from p_period_start)=6 and extract(month from p_period_end)=8 and extract(year from p_period_start)=extract(year from p_period_end))
       or (extract(month from p_period_start)=9 and extract(month from p_period_end)=11 and extract(year from p_period_start)=extract(year from p_period_end))
       or (extract(month from p_period_start)=12 and extract(month from p_period_end)=2 and extract(year from p_period_end)=extract(year from p_period_start)+1)
     ) then raise exception 'PAYE quarter does not match an RRA quarterly tax period'; end if;
   elsif v_month_span<>0 then raise exception 'This merchant is configured for monthly PAYE'; end if;
 elsif v_month_span<>0 then
   raise exception 'RSSB contributions remain monthly even when PAYE is quarterly';
 end if;
 select coalesce(sum(case p_contribution_type
   when 'paye' then i.paye
   when 'pension' then i.pension_employee+i.pension_employer
   when 'occupational_hazards' then i.occupational_hazards_employer
   when 'maternity' then i.maternity_employee+i.maternity_employer
   when 'cbhi' then i.cbhi_employee
   else 0 end),0)
 into v_expected
 from public.payroll_pay_items i
 join public.payroll_pay_runs r on r.id=i.pay_run_id and r.merchant_id=i.merchant_id
 where r.merchant_id=p_merchant_id
   and r.status in ('posted','partially_paid','paid')
   and r.period_start>=p_period_start and r.period_end<=p_period_end;
 select coalesce(sum(amount),0) into v_paid
 from public.payroll_statutory_payments
 where merchant_id=p_merchant_id and contribution_type=p_contribution_type
   and period_start=p_period_start and period_end=p_period_end and status='recorded';
 return query select v_expected,v_paid,greatest(0,v_expected-v_paid);
end;
$$;

create or replace function public.shericeri_record_payroll_statutory_payment(
 p_merchant_id uuid,p_period_start date,p_period_end date,p_contribution_type text,
 p_payment_date date,p_amount numeric,p_payment_method text,p_reference text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_payment uuid;
 v_journal uuid;
 v_liability uuid;
 v_cash uuid;
 v_liability_code text;
 v_cash_code text;
 v_expected numeric(18,2);
 v_paid numeric(18,2);
 v_outstanding numeric(18,2);
 v_balance numeric(18,2);
 v_month_span integer;
 v_frequency text;
 v_period_key text;
 v_reminder_key text;
begin
 if not private.user_can_access_merchant(p_merchant_id,'manage_finance') or not private.user_can_access_merchant(p_merchant_id,'manage_payroll') then raise exception 'Payroll and finance permissions are required to record statutory payments'; end if;
 if p_contribution_type is null or p_period_start is null or p_period_end is null or p_payment_date is null or p_amount is null or p_amount<=0
   or p_payment_method is null or p_payment_method not in ('bank','mobile_money','cash')
   or coalesce(trim(p_idempotency_key),'')='' then
   raise exception 'Payment date, positive amount, payment method and idempotency key are required';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
   p_merchant_id::text||':statutory-payroll:'||p_idempotency_key,0));
 select id into v_payment from public.payroll_statutory_payments
 where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key;
 if v_payment is not null then return v_payment; end if;

 if exists(select 1 from public.accounting_settings where merchant_id=p_merchant_id and locked_through>=p_payment_date) then
   raise exception 'Payment date is in a locked accounting period';
 end if;
 v_month_span:=(extract(year from p_period_end)::integer*12+extract(month from p_period_end)::integer)
   -(extract(year from p_period_start)::integer*12+extract(month from p_period_start)::integer);
 select coalesce(paye_frequency,'monthly') into v_frequency from public.payroll_employer_settings where merchant_id=p_merchant_id;
 v_frequency:=coalesce(v_frequency,'monthly');
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start
   or p_period_start<>date_trunc('month',p_period_start)::date
   or p_period_end<>(date_trunc('month',p_period_end)+interval '1 month - 1 day')::date then
   raise exception 'Select complete calendar month or quarter dates';
 end if;
 if p_contribution_type='paye' then
   if v_frequency='quarterly' then
     if v_month_span<>2 or not (
       (extract(month from p_period_start)=3 and extract(month from p_period_end)=5 and extract(year from p_period_start)=extract(year from p_period_end))
       or (extract(month from p_period_start)=6 and extract(month from p_period_end)=8 and extract(year from p_period_start)=extract(year from p_period_end))
       or (extract(month from p_period_start)=9 and extract(month from p_period_end)=11 and extract(year from p_period_start)=extract(year from p_period_end))
       or (extract(month from p_period_start)=12 and extract(month from p_period_end)=2 and extract(year from p_period_end)=extract(year from p_period_start)+1)
     ) then raise exception 'PAYE quarter does not match an RRA quarterly tax period'; end if;
   elsif v_month_span<>0 then raise exception 'This merchant is configured for monthly PAYE'; end if;
 elsif v_month_span<>0 then raise exception 'RSSB contributions remain monthly even when PAYE is quarterly'; end if;

 select coalesce(sum(case p_contribution_type
   when 'paye' then i.paye
   when 'pension' then i.pension_employee+i.pension_employer
   when 'occupational_hazards' then i.occupational_hazards_employer
   when 'maternity' then i.maternity_employee+i.maternity_employer
   when 'cbhi' then i.cbhi_employee
   else 0 end),0)
 into v_expected
 from public.payroll_pay_items i
 join public.payroll_pay_runs r on r.id=i.pay_run_id and r.merchant_id=i.merchant_id
 where r.merchant_id=p_merchant_id
   and r.status in ('posted','partially_paid','paid')
   and r.period_start>=p_period_start and r.period_end<=p_period_end;
 select coalesce(sum(amount),0) into v_paid
 from public.payroll_statutory_payments
 where merchant_id=p_merchant_id and contribution_type=p_contribution_type
   and period_start=p_period_start and period_end=p_period_end and status='recorded';
 v_outstanding:=greatest(0,v_expected-v_paid);
 if v_expected<=0 then raise exception 'No posted payroll liability exists for the selected statutory period'; end if;
 if p_amount>v_outstanding then raise exception 'Payment exceeds outstanding statutory liability of % RWF',v_outstanding; end if;

 v_liability_code:=case p_contribution_type
   when 'paye' then '2220' when 'pension' then '2230'
   when 'occupational_hazards' then '2240' when 'maternity' then '2250'
   when 'cbhi' then '2260' end;
 v_cash_code:=case p_payment_method when 'bank' then '1010' when 'mobile_money' then '1020' else '1000' end;
 select id into v_liability from public.chart_of_accounts
 where merchant_id=p_merchant_id and code=v_liability_code and active and type='liability' and normal_balance='credit';
 select id into v_cash from public.chart_of_accounts
 where merchant_id=p_merchant_id and code=v_cash_code and active and type='asset' and normal_balance='debit';
 if v_liability is null or v_cash is null then raise exception 'Statutory liability or payment account mapping is missing'; end if;
 select coalesce(sum(l.credit-l.debit),0) into v_balance
 from public.journal_lines l
 join public.journal_entries j on j.id=l.journal_entry_id and j.merchant_id=l.merchant_id
 where l.merchant_id=p_merchant_id and l.account_id=v_liability and j.voided=false;
 if v_balance<p_amount then raise exception 'General ledger liability balance is below the requested statutory payment'; end if;

 insert into public.payroll_statutory_payments(
   merchant_id,contribution_type,period_start,period_end,payment_date,amount,payment_method,reference,status,recorded_by,idempotency_key
 ) values (
   p_merchant_id,p_contribution_type,p_period_start,p_period_end,p_payment_date,p_amount,p_payment_method,
   nullif(trim(p_reference),''),'recorded',auth.uid(),p_idempotency_key
 ) returning id into v_payment;
 v_journal:=gen_random_uuid();
 insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id,created_by)
 values(v_journal,p_merchant_id,p_payment_date,
   'Statutory payroll payment - '||upper(p_contribution_type)||' - '||to_char(p_period_start,'YYYY-MM')||' to '||to_char(p_period_end,'YYYY-MM'),
   'payroll_statutory_payment',v_payment,auth.uid());
 insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
 values
 (p_merchant_id,v_journal,v_liability,p_amount,0,'Clear '||upper(p_contribution_type)||' payable'),
 (p_merchant_id,v_journal,v_cash,0,p_amount,'External statutory payment via '||p_payment_method);
 update public.payroll_statutory_payments set journal_entry_id=v_journal where id=v_payment;

 v_period_key:=to_char(p_period_start,'YYYY-MM');
 if v_month_span=2 then v_period_key:=v_period_key||' to '||to_char(p_period_end,'YYYY-MM'); end if;
 v_reminder_key:=case p_contribution_type
   when 'paye' then case when v_month_span=2 then 'paye-quarterly-'||v_period_key else 'paye-monthly-'||v_period_key end
   when 'pension' then 'pension-'||v_period_key
   when 'occupational_hazards' then 'occupational-hazards-'||v_period_key
   when 'maternity' then 'maternity-'||v_period_key
   when 'cbhi' then 'cbhi-'||v_period_key
 end;
 if v_paid+p_amount>=v_expected then
   update public.payroll_reminders set status='completed',completed_at=now()
   where merchant_id=p_merchant_id and idempotency_key=v_reminder_key and status='open';
 end if;
 return v_payment;
end;
$$;

revoke all on function public.shericeri_get_payroll_statutory_balance(uuid,date,date,text) from public,anon;
revoke all on function public.shericeri_record_payroll_statutory_payment(uuid,date,date,text,date,numeric,text,text,text) from public,anon;
grant execute on function public.shericeri_get_payroll_statutory_balance(uuid,date,date,text) to authenticated;
grant execute on function public.shericeri_record_payroll_statutory_payment(uuid,date,date,text,date,numeric,text,text,text) to authenticated;

comment on table public.payroll_statutory_payments is 'Audited records of external RRA/RSSB statutory payments, reconciled to payroll liabilities.';
