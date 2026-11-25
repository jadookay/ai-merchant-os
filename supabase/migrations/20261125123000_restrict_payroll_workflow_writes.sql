-- Keep payroll run, payment and reminder workflows server-controlled.
-- Employee records may be managed directly by users with manage_payroll; final
-- payroll states, pay-item amounts, payments and statutory reminders are not
-- writable directly until their audited RPC/scheduler workflows are deployed.

revoke insert, update, delete on public.payroll_pay_runs from authenticated;
revoke insert, update, delete on public.payroll_pay_items from authenticated;
revoke insert, update, delete on public.payroll_payments from authenticated;
revoke delete on public.payroll_employees from authenticated;

drop policy if exists payroll_runs_insert on public.payroll_pay_runs;
drop policy if exists payroll_runs_update on public.payroll_pay_runs;
drop policy if exists payroll_runs_delete on public.payroll_pay_runs;
drop policy if exists payroll_items_insert on public.payroll_pay_items;
drop policy if exists payroll_items_update on public.payroll_pay_items;
drop policy if exists payroll_items_delete on public.payroll_pay_items;
drop policy if exists payroll_payments_insert on public.payroll_payments;
drop policy if exists payroll_payments_update on public.payroll_payments;
drop policy if exists payroll_payments_delete on public.payroll_payments;
drop policy if exists payroll_employees_delete on public.payroll_employees;
