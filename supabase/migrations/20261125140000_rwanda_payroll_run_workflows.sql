-- Audited Rwanda payroll run, approval, posting and payment workflow.
-- Payroll posting is deliberately separate from sales/inventory/sync paths.

alter table public.payroll_employees
  add column if not exists casual_days_in_tax_period integer,
  add column if not exists casual_criteria_confirmed boolean not null default false;

alter table public.payroll_pay_items
  add column if not exists other_taxable_earnings numeric(18,2) not null default 0,
  add column if not exists casual_days_worked integer,
  add column if not exists calculation_period date,
  add column if not exists maternity_employee numeric(18,2) not null default 0,
  add column if not exists maternity_employer numeric(18,2) not null default 0,
  add column if not exists cbhi_employee numeric(18,2) not null default 0;

alter table public.payroll_pay_runs
  add column if not exists amount_paid_total numeric(18,2) not null default 0;
alter table public.payroll_employees
  add constraint payroll_employees_casual_days_range
  check (casual_days_in_tax_period is null or casual_days_in_tax_period between 1 and 30);
alter table public.payroll_pay_items
  add constraint payroll_pay_items_rwanda_contributions_nonnegative
  check (maternity_employee>=0 and maternity_employer>=0 and cbhi_employee>=0);
alter table public.payroll_pay_runs
  add constraint payroll_runs_amount_paid_range
  check (amount_paid_total>=0 and amount_paid_total<=net_pay_total);

alter table public.payroll_payments
  add column if not exists journal_entry_id uuid references public.journal_entries(id),
  add column if not exists idempotency_key text;

create unique index if not exists payroll_payments_idempotency_unique
  on public.payroll_payments(merchant_id,idempotency_key)
  where idempotency_key is not null;
create unique index if not exists payroll_runs_one_active_period
  on public.payroll_pay_runs(merchant_id,period_start,period_end)
  where status<>'void';

-- Add dedicated payroll ledger accounts without changing existing account mappings.
insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,active,balance_sheet_class)
select m.id,a.code,a.name,a.type,a.normal_balance,true,a.balance_sheet_class
from public.merchants m
cross join (values
 ('6300','Salaries and wages expense','expense','debit',null::text),
 ('6310','Employer payroll contributions expense','expense','debit',null::text),
 ('2210','Net salaries payable','liability','credit','current'),
 ('2220','PAYE payable','liability','credit','current'),
 ('2230','RSSB pension payable','liability','credit','current'),
 ('2240','RSSB occupational hazards payable','liability','credit','current'),
 ('2250','RSSB maternity benefits payable','liability','credit','current'),
 ('2260','CBHI contributions payable','liability','credit','current')
) a(code,name,type,normal_balance,balance_sheet_class)
on conflict (merchant_id,code) do nothing;

insert into public.payroll_rule_sets(jurisdiction,rule_code,display_name,effective_from,configuration,source_url,verification_status)
values
 ('RW','MATERNITY_LEAVE','Maternity leave benefits contribution','2026-01-01',
  '{"employee_rate":0.003,"employer_rate":0.003,"total_rate":0.006,"base":"gross_salary_excluding_transport_allowance","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rssb.rw/fileadmin/Occupational_Hazards/final_2019_english_rssb_booklet_9_0.pdf','verified'),
 ('RW','CBHI','Community-based health insurance contribution','2026-02-23',
  '{"employee_rate":0.005,"employer_rate":0,"base":"net_salary_after_paye_pension_and_maternity","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rra.gov.rw/en/domestic-tax-services/rssb-contributions/cbhi-contribution','verified')
on conflict (jurisdiction,rule_code,effective_from) do nothing;

alter table public.payroll_reminders drop constraint if exists payroll_reminders_reminder_type_check;
alter table public.payroll_reminders add constraint payroll_reminders_reminder_type_check
  check (reminder_type in ('prepare_payroll','approve_payroll','pay_salaries','paye_due','pension_due','occupational_hazards_due','maternity_due','cbhi_due','other_statutory_due'));

create table if not exists public.payroll_employer_settings (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  paye_frequency text not null default 'monthly' check (paye_frequency in ('monthly','quarterly')),
  annual_turnover numeric(18,2) check (annual_turnover is null or annual_turnover>=0),
  quarterly_election_confirmed boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (paye_frequency<>'quarterly' or
    (annual_turnover is not null and annual_turnover<200000000 and quarterly_election_confirmed))
);
alter table public.payroll_employer_settings enable row level security;
grant select,insert,update on public.payroll_employer_settings to authenticated;
create policy payroll_employer_settings_select on public.payroll_employer_settings
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_employer_settings_insert on public.payroll_employer_settings
  for insert to authenticated with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_employer_settings_update on public.payroll_employer_settings
  for update to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'))
  with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));



create or replace function public.shericeri_create_payroll_run(
  p_merchant_id uuid,
  p_run_number text,
  p_period_start date,
  p_period_end date,
  p_pay_date date
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_run_id uuid;
  v_employee record;
  v_gross numeric(18,2);
  v_paye numeric(18,2);
  v_pension_rate numeric(8,6);
  v_pension_employee numeric(18,2);
  v_pension_employer numeric(18,2);
  v_hazards numeric(18,2);
  v_maternity_employee numeric(18,2);
  v_maternity_employer numeric(18,2);
  v_cbhi numeric(18,2);
  v_maternity_rate numeric(8,6);
  v_cbhi_rate numeric(8,6);
  v_maternity_base numeric(18,2);
  v_net numeric(18,2);
  v_cost numeric(18,2);
  v_other numeric(18,2);
  v_days integer;
  v_count integer := 0;
  v_gross_total numeric(18,2) := 0;
  v_deductions_total numeric(18,2) := 0;
  v_employer_total numeric(18,2) := 0;
  v_net_total numeric(18,2) := 0;
begin
  if v_uid is null or not private.user_can_access_merchant(p_merchant_id,'manage_payroll') then
    raise exception 'Not authorized to prepare payroll for this merchant';
  end if;
  if coalesce(trim(p_run_number),'')='' or length(trim(p_run_number))>80 then
    raise exception 'A payroll run number is required';
  end if;
  if p_period_start is null or p_period_end is null or p_pay_date is null or p_period_end<p_period_start or p_pay_date<p_period_end then
    raise exception 'Payroll period and pay date are invalid; pay date cannot precede period end';
  end if;
  if exists(select 1 from public.payroll_pay_runs where merchant_id=p_merchant_id and run_number=trim(p_run_number)) then
    select id into v_run_id from public.payroll_pay_runs
    where merchant_id=p_merchant_id and run_number=trim(p_run_number)
      and period_start=p_period_start and period_end=p_period_end and pay_date=p_pay_date;
    if v_run_id is null then raise exception 'Payroll run number already exists with different dates'; end if;
    return v_run_id;
  end if;

  insert into public.payroll_pay_runs(merchant_id,run_number,period_start,period_end,pay_date,status,created_by)
  values(p_merchant_id,trim(p_run_number),p_period_start,p_period_end,p_pay_date,'draft',v_uid)
  returning id into v_run_id;

  for v_employee in
    select e.*
    from public.payroll_employees e
    where e.merchant_id=p_merchant_id
      and e.status='active'
      and e.hire_date<=p_period_end
      and (e.termination_date is null or e.termination_date>=p_period_start)
    order by e.legal_name,e.id
  loop
    if v_employee.pay_frequency<>'monthly' then
      raise exception 'Initial payroll run supports monthly employees only. Employee % uses % frequency',v_employee.employee_number,v_employee.pay_frequency;
    end if;

    select coalesce(sum(greatest(0,coalesce((x->>'amount')::numeric,0))),0)
    into v_other
    from jsonb_array_elements(v_employee.other_recurring_earnings) x
    where coalesce((x->>'taxable')::boolean,true);

    v_gross:=round(v_employee.base_salary+v_employee.transport_allowance+v_other,2);
    if v_gross<0 then raise exception 'Invalid gross pay for employee %',v_employee.employee_number; end if;

    if v_employee.employment_type='casual' then
      if not v_employee.casual_criteria_confirmed
        or v_employee.casual_days_in_tax_period is null
        or v_employee.casual_days_in_tax_period<1
        or v_employee.casual_days_in_tax_period>30 then
        raise exception 'Casual employee % must have confirmed RRA eligibility and 1-30 engagement days for this tax period',v_employee.employee_number;
      end if;
      v_paye:=round(v_gross*0.15,2);
    elsif v_employee.employment_type='secondary_employer' then
      v_paye:=round(v_gross*0.30,2);
    else
      v_paye:=round(
        greatest(0,least(v_gross,100000)-60000)*0.10
        + greatest(0,least(v_gross,200000)-100000)*0.20
        + greatest(0,v_gross-200000)*0.30,2);
    end if;

    select coalesce((r.configuration->>'employee_rate')::numeric,0.06)
    into v_pension_rate
    from public.payroll_rule_sets r
    where r.jurisdiction='RW' and r.rule_code='RSSB_PENSION'
      and r.effective_from<=p_period_end
      and (r.effective_to is null or r.effective_to>=p_period_end)
    order by r.effective_from desc limit 1;
    v_pension_rate:=coalesce(v_pension_rate,case
      when p_period_end>=date '2030-01-01' then 0.10
      when p_period_end>=date '2029-01-01' then 0.09
      when p_period_end>=date '2028-01-01' then 0.08
      when p_period_end>=date '2027-01-01' then 0.07
      else 0.06 end);
    v_pension_employee:=round(v_gross*v_pension_rate,2);
    v_pension_employer:=v_pension_employee;
    -- Current RSSB Occupational Hazards basis is kept separate from pension;
    -- this initial rule uses basic salary, excluding transport allowance.
    v_hazards:=round((v_employee.base_salary+v_other)*0.02,2);
    select coalesce((r.configuration->>'employee_rate')::numeric,0.003),
           coalesce((r.configuration->>'employer_rate')::numeric,0.003)
    into v_maternity_rate,v_maternity_employer
    from public.payroll_rule_sets r
    where r.jurisdiction='RW' and r.rule_code='MATERNITY_LEAVE'
      and r.effective_from<=p_period_end
      and (r.effective_to is null or r.effective_to>=p_period_end)
    order by r.effective_from desc limit 1;
    v_maternity_rate:=coalesce(v_maternity_rate,0.003);
    v_maternity_base:=v_employee.base_salary+v_other;
    v_maternity_employee:=round(v_maternity_base*v_maternity_rate,2);
    v_maternity_employer:=round(v_maternity_base*coalesce(v_maternity_employer,0.003),2);
    select coalesce((r.configuration->>'employee_rate')::numeric,0.005)
    into v_cbhi_rate
    from public.payroll_rule_sets r
    where r.jurisdiction='RW' and r.rule_code='CBHI'
      and r.effective_from<=p_period_end
      and (r.effective_to is null or r.effective_to>=p_period_end)
    order by r.effective_from desc limit 1;
    v_cbhi_rate:=coalesce(v_cbhi_rate,0.005);
    v_cbhi:=round(greatest(0,v_gross-v_paye-v_pension_employee-v_maternity_employee)*v_cbhi_rate,2);
    v_net:=round(v_gross-v_paye-v_pension_employee-v_maternity_employee-v_cbhi,2);
    v_cost:=round(v_gross+v_pension_employer+v_hazards+v_maternity_employer,2);
    if v_net<0 then raise exception 'Deductions exceed gross pay for employee %',v_employee.employee_number; end if;

    insert into public.payroll_pay_items(
      merchant_id,pay_run_id,employee_id,earnings,deductions,gross_pay,taxable_income,paye,
      pension_employee,pension_employer,occupational_hazards_employer,other_employee_deductions,
      net_pay,employer_cost,calculation_snapshot,other_taxable_earnings,casual_days_worked,calculation_period,payslip_number,
      maternity_employee,maternity_employer,cbhi_employee
    ) values (
      p_merchant_id,v_run_id,v_employee.id,
      jsonb_build_array(
        jsonb_build_object('type','basic_salary','amount',v_employee.base_salary),
        jsonb_build_object('type','transport_allowance','amount',v_employee.transport_allowance),
        jsonb_build_object('type','other_taxable_earnings','amount',v_other)
      ),
      jsonb_build_array(
        jsonb_build_object('type','PAYE','amount',v_paye),
        jsonb_build_object('type','employee_pension','amount',v_pension_employee),
        jsonb_build_object('type','maternity_employee','amount',v_maternity_employee),
        jsonb_build_object('type','cbhi_employee','amount',v_cbhi)
      ),
      v_gross,v_gross,v_paye,v_pension_employee,v_pension_employer,v_hazards,0,
      v_net,v_cost,
      jsonb_build_object('jurisdiction','RW','period_end',p_period_end,'employment_type',v_employee.employment_type,
        'paye_method',case when v_employee.employment_type='casual' then '15_percent_casual' when v_employee.employment_type='secondary_employer' then '30_percent_secondary' else 'progressive_monthly' end,
        'pension_employee_rate',v_pension_rate,'pension_employer_rate',v_pension_rate,
        'occupational_hazards_rate',0.02,'occupational_hazards_base','gross_remuneration_excluding_transport',
        'maternity_employee_rate',v_maternity_rate,'maternity_employer_rate',0.003,'maternity_base','gross_salary_excluding_transport',
        'cbhi_employee_rate',v_cbhi_rate,'cbhi_base','net_salary_after_paye_pension_and_maternity',
        'taxable_income_includes_transport',true),
      v_other,
      case when v_employee.employment_type='casual' then v_employee.casual_days_in_tax_period else null end,
      p_period_end,
      'PS-'||trim(p_run_number)||'-'||v_employee.employee_number,
      v_maternity_employee,v_maternity_employer,v_cbhi
    );
    v_count:=v_count+1;
    v_gross_total:=v_gross_total+v_gross;
    v_deductions_total:=v_deductions_total+v_paye+v_pension_employee+v_maternity_employee+v_cbhi;
    v_employer_total:=v_employer_total+v_pension_employer+v_hazards+v_maternity_employer;
    v_net_total:=v_net_total+v_net;
  end loop;

  if v_count=0 or v_gross_total<=0 then raise exception 'No eligible active employees with positive payroll were found for this period'; end if;

  update public.payroll_pay_runs
  set employee_count=v_count,gross_total=v_gross_total,
      employee_deductions_total=v_deductions_total,
      employer_contributions_total=v_employer_total,net_pay_total=v_net_total,
      statutory_due_date=(date_trunc('month',p_period_end)::date+interval '1 month 14 days')::date,
      updated_at=now()
  where id=v_run_id and merchant_id=p_merchant_id;
  return v_run_id;
end;
$$;

create or replace function public.shericeri_submit_payroll_run(p_merchant_id uuid,p_run_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_status text; v_count integer;
begin
 if not private.user_can_access_merchant(p_merchant_id,'manage_payroll') then raise exception 'Not authorized to submit payroll'; end if;
 select status,employee_count into v_status,v_count from public.payroll_pay_runs
 where id=p_run_id and merchant_id=p_merchant_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if v_status='submitted' then return p_run_id; end if;
 if v_status<>'draft' or v_count=0 then raise exception 'Only a non-empty draft payroll run can be submitted'; end if;
 update public.payroll_pay_runs set status='submitted',submitted_at=now(),submitted_by=auth.uid(),updated_at=now()
 where id=p_run_id and merchant_id=p_merchant_id;
 return p_run_id;
end;
$$;

create or replace function public.shericeri_approve_payroll_run(p_merchant_id uuid,p_run_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_status text;
begin
 if not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance approval permission is required'; end if;
 select status into v_status from public.payroll_pay_runs where id=p_run_id and merchant_id=p_merchant_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if v_status='approved' then return p_run_id; end if;
 if v_status<>'submitted' then raise exception 'Only submitted payroll can be approved'; end if;
 update public.payroll_pay_runs set status='approved',approved_at=now(),approved_by=auth.uid(),updated_at=now()
 where id=p_run_id and merchant_id=p_merchant_id;
 return p_run_id;
end;
$$;

create or replace function public.shericeri_post_payroll_run(p_merchant_id uuid,p_run_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_run public.payroll_pay_runs%rowtype;
 v_journal uuid;
 v_salary uuid; v_employer_exp uuid; v_net_payable uuid; v_paye_payable uuid; v_pension_payable uuid; v_oh_payable uuid; v_maternity_payable uuid; v_cbhi_payable uuid;
 v_pension_emp numeric(18,2); v_pension_er numeric(18,2); v_oh numeric(18,2);
 v_maternity_emp numeric(18,2); v_maternity_er numeric(18,2); v_cbhi numeric(18,2);
 v_lines jsonb;
begin
 if not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance posting permission is required'; end if;
 select * into v_run from public.payroll_pay_runs where id=p_run_id and merchant_id=p_merchant_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if v_run.status='posted' and v_run.journal_entry_id is not null then return v_run.journal_entry_id; end if;
 if v_run.status<>'approved' then raise exception 'Payroll must be approved before posting'; end if;
 if exists(select 1 from public.accounting_settings where merchant_id=p_merchant_id and locked_through>=v_run.period_end) then
   raise exception 'Accounting period is locked through or beyond payroll period end';
 end if;
 select id into v_salary from public.chart_of_accounts where merchant_id=p_merchant_id and code='6300' and active and type='expense' and normal_balance='debit';
 select id into v_employer_exp from public.chart_of_accounts where merchant_id=p_merchant_id and code='6310' and active and type='expense' and normal_balance='debit';
 select id into v_net_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2210' and active and type='liability' and normal_balance='credit';
 select id into v_paye_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2220' and active and type='liability' and normal_balance='credit';
 select id into v_pension_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2230' and active and type='liability' and normal_balance='credit';
 select id into v_oh_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2240' and active and type='liability' and normal_balance='credit';
 select id into v_maternity_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2250' and active and type='liability' and normal_balance='credit';
 select id into v_cbhi_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2260' and active and type='liability' and normal_balance='credit';
 if v_salary is null or v_employer_exp is null or v_net_payable is null or v_paye_payable is null or v_pension_payable is null or v_oh_payable is null or v_maternity_payable is null or v_cbhi_payable is null then
   raise exception 'Payroll chart-of-account mapping is incomplete; no journal was posted';
 end if;
 select coalesce(sum(pension_employee),0),coalesce(sum(pension_employer),0),coalesce(sum(occupational_hazards_employer),0),
        coalesce(sum(maternity_employee),0),coalesce(sum(maternity_employer),0),coalesce(sum(cbhi_employee),0)
 into v_pension_emp,v_pension_er,v_oh,v_maternity_emp,v_maternity_er,v_cbhi
 from public.payroll_pay_items where pay_run_id=p_run_id and merchant_id=p_merchant_id;
 v_journal:=gen_random_uuid();
 v_lines:='[]'::jsonb;
 if v_run.gross_total>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_salary,'debit',v_run.gross_total,'credit',0,'memo','Gross salaries and wages')); end if;
 if v_pension_er+v_oh+v_maternity_er>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_employer_exp,'debit',v_pension_er+v_oh+v_maternity_er,'credit',0,'memo','Employer pension, maternity and occupational hazards')); end if;
 if v_run.net_pay_total>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_net_payable,'debit',0,'credit',v_run.net_pay_total,'memo','Net salaries payable')); end if;
 if exists(select 1 from public.payroll_pay_items where pay_run_id=p_run_id and paye>0) then
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_paye_payable,'debit',0,'credit',(select sum(paye) from public.payroll_pay_items where pay_run_id=p_run_id),'memo','PAYE payable'));
 end if;
 if v_pension_emp+v_pension_er>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_pension_payable,'debit',0,'credit',v_pension_emp+v_pension_er,'memo','RSSB pension payable')); end if;
 if v_oh>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_oh_payable,'debit',0,'credit',v_oh,'memo','RSSB occupational hazards payable')); end if;
 if v_maternity_emp+v_maternity_er>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_maternity_payable,'debit',0,'credit',v_maternity_emp+v_maternity_er,'memo','RSSB maternity benefits payable')); end if;
 if v_cbhi>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_cbhi_payable,'debit',0,'credit',v_cbhi,'memo','CBHI employee contribution payable')); end if;
 insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id,created_by)
 values(v_journal,p_merchant_id,v_run.period_end,'Payroll accrual - '||v_run.run_number,'payroll_run',p_run_id,auth.uid());
 insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
 select p_merchant_id,v_journal,(x->>'account_id')::uuid,coalesce((x->>'debit')::numeric,0),coalesce((x->>'credit')::numeric,0),x->>'memo'
 from jsonb_array_elements(v_lines) x;
 update public.payroll_pay_runs set status='posted',posted_at=now(),journal_entry_id=v_journal,updated_at=now()
 where id=p_run_id and merchant_id=p_merchant_id;
 return v_journal;
exception when unique_violation then
 select id into v_journal from public.journal_entries where merchant_id=p_merchant_id and source_type='payroll_run' and source_id=p_run_id and voided=false;
 if v_journal is null then raise; end if;
 update public.payroll_pay_runs set status='posted',posted_at=coalesce(posted_at,now()),journal_entry_id=v_journal,updated_at=now()
 where id=p_run_id and merchant_id=p_merchant_id;
 return v_journal;
end;
$$;

create or replace function public.shericeri_record_payroll_payment(
 p_merchant_id uuid,p_run_id uuid,p_payment_date date,p_amount numeric,
 p_payment_method text,p_reference text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_run public.payroll_pay_runs%rowtype;
 v_payment uuid;
 v_cash uuid;
 v_payable uuid;
 v_journal uuid;
 v_outstanding numeric(18,2);
begin
 if not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance payment permission is required'; end if;
 if p_amount is null or p_amount<=0 or p_payment_date is null or coalesce(trim(p_idempotency_key),'')='' then raise exception 'Payment amount, date and idempotency key are required'; end if;
 if p_payment_method not in ('bank','mobile_money','cash') then raise exception 'Unsupported salary payment method'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_merchant_id::text||':payroll-payment:'||p_idempotency_key,0));
 select id into v_payment from public.payroll_payments where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key;
 if v_payment is not null then return v_payment; end if;
 select * into v_run from public.payroll_pay_runs where id=p_run_id and merchant_id=p_merchant_id for update;
 if not found or v_run.status not in ('posted','partially_paid','paid') then raise exception 'Only posted payroll can be paid'; end if;
 v_outstanding:=round(v_run.net_pay_total-v_run.amount_paid_total,2);
 if p_amount>v_outstanding then raise exception 'Payment exceeds outstanding net salaries payable'; end if;
 if exists(select 1 from public.accounting_settings where merchant_id=p_merchant_id and locked_through>=p_payment_date) then raise exception 'Payment date is in a locked accounting period'; end if;
 select id into v_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2210' and active;
 select id into v_cash from public.chart_of_accounts where merchant_id=p_merchant_id and code=case p_payment_method when 'bank' then '1010' when 'mobile_money' then '1020' else '1000' end and active and type='asset' and normal_balance='debit';
 if v_payable is null or v_cash is null then raise exception 'Salary payable or payment account mapping is missing'; end if;
 insert into public.payroll_payments(merchant_id,pay_run_id,payment_date,amount,payment_method,reference,status,recorded_by,idempotency_key)
 values(p_merchant_id,p_run_id,p_payment_date,p_amount,p_payment_method,nullif(trim(p_reference),''),'recorded',auth.uid(),p_idempotency_key)
 returning id into v_payment;
 v_journal:=gen_random_uuid();
 insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id,created_by)
 values(v_journal,p_merchant_id,p_payment_date,'Payroll salary payment - '||v_run.run_number,'payroll_payment',v_payment,auth.uid());
 insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
 values
 (p_merchant_id,v_journal,v_payable,p_amount,0,'Clear net salaries payable'),
 (p_merchant_id,v_journal,v_cash,0,p_amount,'Salary payment via '||p_payment_method);
 update public.payroll_payments set journal_entry_id=v_journal where id=v_payment;
 update public.payroll_pay_runs
 set amount_paid_total=amount_paid_total+p_amount,
     status=case when amount_paid_total+p_amount>=net_pay_total then 'paid' else 'partially_paid' end,
     updated_at=now()
 where id=p_run_id and merchant_id=p_merchant_id;
 return v_payment;
end;
$$;

revoke all on function public.shericeri_create_payroll_run(uuid,text,date,date,date) from public,anon;
revoke all on function public.shericeri_submit_payroll_run(uuid,uuid) from public,anon;
revoke all on function public.shericeri_approve_payroll_run(uuid,uuid) from public,anon;
revoke all on function public.shericeri_post_payroll_run(uuid,uuid) from public,anon;
revoke all on function public.shericeri_record_payroll_payment(uuid,uuid,date,numeric,text,text,text) from public,anon;
grant execute on function public.shericeri_create_payroll_run(uuid,text,date,date,date) to authenticated;
grant execute on function public.shericeri_submit_payroll_run(uuid,uuid) to authenticated;
grant execute on function public.shericeri_approve_payroll_run(uuid,uuid) to authenticated;
grant execute on function public.shericeri_post_payroll_run(uuid,uuid) to authenticated;
grant execute on function public.shericeri_record_payroll_payment(uuid,uuid,date,numeric,text,text,text) to authenticated;

comment on function public.shericeri_create_payroll_run(uuid,text,date,date,date) is 'Creates an idempotent draft payroll run and employee calculation snapshots; no journal or payment.';
comment on function public.shericeri_approve_payroll_run(uuid,uuid) is 'Finance-authorized approval of a submitted payroll run.';
comment on function public.shericeri_post_payroll_run(uuid,uuid) is 'Posts a balanced payroll accrual journal after approval; isolated from POS/inventory.';
comment on function public.shericeri_record_payroll_payment(uuid,uuid,date,numeric,text,text,text) is 'Records and journals a real salary payment; idempotent and limited to posted payroll.';
