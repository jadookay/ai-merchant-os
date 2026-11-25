-- Rwanda-first payroll foundation for AIBOS Command Center.
-- Sensitive payroll data is tenant-isolated and only accessible to members
-- explicitly granted payroll permissions. No payroll journals or payments are
-- posted by this foundation migration.

create table if not exists public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  employee_number text not null,
  legal_name text not null,
  email text,
  phone text,
  tax_identifier text,
  rssb_member_number text,
  job_title text,
  department text,
  employment_type text not null default 'permanent'
    check (employment_type in ('permanent','casual','secondary_employer')),
  pay_frequency text not null default 'monthly'
    check (pay_frequency in ('monthly','weekly','biweekly')),
  hire_date date not null,
  termination_date date,
  base_salary numeric(18,2) not null default 0 check (base_salary >= 0),
  transport_allowance numeric(18,2) not null default 0 check (transport_allowance >= 0),
  other_recurring_earnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(other_recurring_earnings)='array'),
  status text not null default 'active' check (status in ('active','on_leave','terminated')),
  notes text,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, employee_number),
  check (termination_date is null or termination_date >= hire_date)
);

create table if not exists public.payroll_rule_sets (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'RW',
  rule_code text not null,
  display_name text not null,
  effective_from date not null,
  effective_to date,
  configuration jsonb not null,
  source_url text,
  verification_status text not null default 'verified'
    check (verification_status in ('verified','needs_verification','superseded')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (jurisdiction, rule_code, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

insert into public.payroll_rule_sets
  (jurisdiction,rule_code,display_name,effective_from,configuration,source_url,verification_status)
values
 ('RW','PAYE_PERMANENT','Rwanda PAYE - permanent employee progressive monthly bands','2023-11-01',
  '{"period":"monthly","currency":"RWF","bands":[{"from":0,"to":60000,"rate":0},{"from":60000,"to":100000,"rate":0.10},{"from":100000,"to":200000,"rate":0.20},{"from":200000,"to":null,"rate":0.30}],"rounding":"RRA calculator method"}'::jsonb,
  'https://www.rra.gov.rw/en/domestic-tax-services/employment-tax-paye/calculate-paye','verified'),
 ('RW','PAYE_CASUAL','Rwanda PAYE - casual labour','2023-11-01',
  '{"period":"monthly","currency":"RWF","flat_rate":0.15,"base":"taxable_employment_income","eligibility_note":"Apply 15% to taxable employment income only where the employee meets the RRA casual labourer definition and is engaged for no longer than 30 days in the tax period"}'::jsonb,
  'https://www.rra.gov.rw/fileadmin/user_upload/Brochure_PAYE_2024-Eng.pdf','verified'),
 ('RW','PAYE_SECONDARY','Rwanda PAYE - additional/secondary employer','2023-11-01',
  '{"period":"monthly","currency":"RWF","flat_rate":0.30,"eligibility_note":"Apply only where this employer is not the employee primary employer"}'::jsonb,
  'https://www.rra.gov.rw/fileadmin/user_upload/Brochure_PAYE_2024-Eng.pdf','verified'),
 ('RW','RSSB_PENSION','Mandatory pension contribution','2025-01-01',
  '{"employee_rate":0.06,"employer_rate":0.06,"total_rate":0.12,"base":"gross_remuneration_including_transport_allowance","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rssb.rw/uploads/merged_1_adba12649b.pdf','verified'),
 ('RW','RSSB_OCCUPATIONAL_HAZARDS','Occupational hazards contribution','2025-01-01',
  '{"employee_rate":0,"employer_rate":0.02,"total_rate":0.02,"declaration_frequency":"monthly","separate_declaration_required_from":"2026-11-01"}'::jsonb,
  'https://rssb.rw/publications?286f9848_page=1','verified')
on conflict (jurisdiction,rule_code,effective_from) do nothing;

create table if not exists public.payroll_pay_runs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  run_number text not null,
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  currency text not null default 'RWF',
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','posted','partially_paid','paid','void')),
  employee_count integer not null default 0 check (employee_count >= 0),
  gross_total numeric(18,2) not null default 0,
  employee_deductions_total numeric(18,2) not null default 0,
  employer_contributions_total numeric(18,2) not null default 0,
  net_pay_total numeric(18,2) not null default 0,
  statutory_due_date date,
  submitted_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  posted_at timestamptz,
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id,run_number),
  check (period_end >= period_start)
);

create table if not exists public.payroll_pay_items (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  pay_run_id uuid not null references public.payroll_pay_runs(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id),
  earnings jsonb not null default '[]'::jsonb check (jsonb_typeof(earnings)='array'),
  deductions jsonb not null default '[]'::jsonb check (jsonb_typeof(deductions)='array'),
  gross_pay numeric(18,2) not null default 0,
  taxable_income numeric(18,2) not null default 0,
  paye numeric(18,2) not null default 0,
  pension_employee numeric(18,2) not null default 0,
  pension_employer numeric(18,2) not null default 0,
  occupational_hazards_employer numeric(18,2) not null default 0,
  other_employee_deductions numeric(18,2) not null default 0,
  net_pay numeric(18,2) not null default 0,
  employer_cost numeric(18,2) not null default 0,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  payslip_number text,
  created_at timestamptz not null default now(),
  unique (pay_run_id,employee_id),
  check (gross_pay >= 0 and taxable_income >= 0 and paye >= 0
    and pension_employee >= 0 and pension_employer >= 0
    and occupational_hazards_employer >= 0 and other_employee_deductions >= 0
    and net_pay >= 0 and employer_cost >= 0)
);

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  pay_run_id uuid not null references public.payroll_pay_runs(id),
  payment_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('bank','mobile_money','cash','other')),
  reference text,
  status text not null default 'recorded' check (status in ('recorded','reversed')),
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_reminders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  pay_run_id uuid references public.payroll_pay_runs(id) on delete cascade,
  reminder_type text not null check (reminder_type in (
    'prepare_payroll','approve_payroll','pay_salaries','paye_due',
    'pension_due','occupational_hazards_due','maternity_due','other_statutory_due'
  )),
  title text not null,
  message text not null,
  due_on date not null,
  remind_on date not null,
  status text not null default 'open' check (status in ('open','dismissed','completed')),
  idempotency_key text not null,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  unique (merchant_id,idempotency_key)
);

create index if not exists payroll_employees_merchant_status_idx
  on public.payroll_employees(merchant_id,status);
create index if not exists payroll_runs_merchant_date_idx
  on public.payroll_pay_runs(merchant_id,pay_date desc);
create index if not exists payroll_items_merchant_run_idx
  on public.payroll_pay_items(merchant_id,pay_run_id);
create index if not exists payroll_payments_merchant_run_idx
  on public.payroll_payments(merchant_id,pay_run_id);
create index if not exists payroll_reminders_dashboard_idx
  on public.payroll_reminders(merchant_id,status,remind_on,due_on);

alter table public.payroll_employees enable row level security;
alter table public.payroll_rule_sets enable row level security;
alter table public.payroll_pay_runs enable row level security;
alter table public.payroll_pay_items enable row level security;
alter table public.payroll_payments enable row level security;
alter table public.payroll_reminders enable row level security;

grant select,insert,update,delete on public.payroll_employees to authenticated;
grant select on public.payroll_rule_sets to authenticated;
grant select,insert,update,delete on public.payroll_pay_runs to authenticated;
grant select,insert,update,delete on public.payroll_pay_items to authenticated;
grant select,insert,update,delete on public.payroll_payments to authenticated;
grant select,insert,update,delete on public.payroll_reminders to authenticated;

create policy payroll_employees_select on public.payroll_employees
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_employees_insert on public.payroll_employees
  for insert to authenticated with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_employees_update on public.payroll_employees
  for update to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'))
  with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_employees_delete on public.payroll_employees
  for delete to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

create policy payroll_rules_read on public.payroll_rule_sets
  for select to authenticated using (true);

create policy payroll_runs_select on public.payroll_pay_runs
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_runs_insert on public.payroll_pay_runs
  for insert to authenticated with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_runs_update on public.payroll_pay_runs
  for update to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'))
  with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_runs_delete on public.payroll_pay_runs
  for delete to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

create policy payroll_items_select on public.payroll_pay_items
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_items_insert on public.payroll_pay_items
  for insert to authenticated with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_items_update on public.payroll_pay_items
  for update to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'))
  with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_items_delete on public.payroll_pay_items
  for delete to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

create policy payroll_payments_select on public.payroll_payments
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_payments_insert on public.payroll_payments
  for insert to authenticated with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_payments_update on public.payroll_payments
  for update to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'))
  with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_payments_delete on public.payroll_payments
  for delete to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

create policy payroll_reminders_select on public.payroll_reminders
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_reminders_insert on public.payroll_reminders
  for insert to authenticated with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_reminders_update on public.payroll_reminders
  for update to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'))
  with check (private.user_can_access_merchant(merchant_id,'manage_payroll'));
create policy payroll_reminders_delete on public.payroll_reminders
  for delete to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

comment on table public.payroll_employees is 'Confidential employee and compensation records; restrict access with manage_payroll.';
comment on table public.payroll_rule_sets is 'Effective-dated payroll and statutory rules. Verify source and jurisdiction before calculation.';
comment on table public.payroll_pay_runs is 'Payroll runs; journals and external payments are not automatically posted by this foundation.';
comment on table public.payroll_pay_items is 'Confidential employee payroll calculations and payslip snapshots.';
comment on table public.payroll_reminders is 'Deduplicated owner dashboard payroll and statutory deadline reminders.';
