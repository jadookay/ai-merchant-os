-- Payroll compensation history is append-only and tenant-scoped.
alter table public.payroll_employees
  add column if not exists compensation_effective_from date not null default current_date,
  add column if not exists compensation_change_reason text;

create table if not exists public.payroll_employee_compensation_history (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete cascade,
  effective_from date not null,
  base_salary numeric(18,2) not null check (base_salary>=0),
  transport_allowance numeric(18,2) not null check (transport_allowance>=0),
  other_recurring_earnings jsonb not null default '[]'::jsonb check (jsonb_typeof(other_recurring_earnings)='array'),
  change_reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists payroll_comp_history_employee_idx
  on public.payroll_employee_compensation_history(merchant_id,employee_id,effective_from desc);
alter table public.payroll_employee_compensation_history enable row level security;
grant select on public.payroll_employee_compensation_history to authenticated;
create policy payroll_comp_history_select on public.payroll_employee_compensation_history
  for select to authenticated using (private.user_can_access_merchant(merchant_id,'manage_payroll'));

create or replace function private.log_payroll_compensation_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='INSERT'
     or old.base_salary is distinct from new.base_salary
     or old.transport_allowance is distinct from new.transport_allowance
     or old.other_recurring_earnings is distinct from new.other_recurring_earnings then
    insert into public.payroll_employee_compensation_history(
      merchant_id,employee_id,effective_from,base_salary,transport_allowance,
      other_recurring_earnings,change_reason,changed_by
    ) values (
      new.merchant_id,new.id,coalesce(new.compensation_effective_from,new.hire_date),
      new.base_salary,new.transport_allowance,new.other_recurring_earnings,
      coalesce(nullif(trim(new.compensation_change_reason),''),case when tg_op='INSERT' then 'Initial compensation record' else 'Compensation update' end),
      auth.uid()
    );
  end if;
  return new;
end;
$$;
revoke all on function private.log_payroll_compensation_change() from public,anon,authenticated;
drop trigger if exists payroll_employee_compensation_audit on public.payroll_employees;
create trigger payroll_employee_compensation_audit
after insert or update of base_salary,transport_allowance,other_recurring_earnings
on public.payroll_employees
for each row execute function private.log_payroll_compensation_change();
comment on table public.payroll_employee_compensation_history is 'Append-only history of employee compensation changes; accessible only to members with manage_payroll.';
