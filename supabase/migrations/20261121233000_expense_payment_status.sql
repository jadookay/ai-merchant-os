alter table public.expenses
  add column if not exists payment_status text not null default 'paid';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.expenses'::regclass
      and conname='expenses_payment_status_check'
  ) then
    alter table public.expenses
      add constraint expenses_payment_status_check
      check (payment_status in ('paid','unpaid','partial'));
  end if;
end
$$;
