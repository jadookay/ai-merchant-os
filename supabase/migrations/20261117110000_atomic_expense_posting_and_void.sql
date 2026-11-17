-- AIBOS MVP: atomic expense posting and audited reversal.
-- Existing account mapping is preserved: Dr 6000 Operating expenses / Cr 1000 Cash on hand.
alter table public.expenses
  add column if not exists voided boolean not null default false,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null;

create or replace function private.expenses_post_ledger_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash uuid;
  v_expense uuid;
  v_entry_id uuid;
  v_count integer;
  v_debit numeric;
  v_credit numeric;
  v_actor_name text;
  v_lock date;
begin
  if new.amount <= 0 then
    raise exception 'Expense amount must be positive';
  end if;
  if auth.uid() is not null
     and not private.user_can_access_merchant(new.merchant_id,'manage_expenses') then
    raise exception 'Not authorized to record expenses';
  end if;

  select locked_through into v_lock
  from public.accounting_settings where merchant_id=new.merchant_id;
  if v_lock is not null and new.created_at::date <= v_lock then
    raise exception 'Expense date is inside a locked accounting period';
  end if;

  insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,active)
  values
    (new.merchant_id,'1000','Cash on hand','asset','debit',true),
    (new.merchant_id,'6000','Operating expenses','expense','debit',true)
  on conflict (merchant_id,code) do nothing;

  select id into v_cash from public.chart_of_accounts
   where merchant_id=new.merchant_id and code='1000' and active=true;
  select id into v_expense from public.chart_of_accounts
   where merchant_id=new.merchant_id and code='6000' and active=true;
  if v_cash is null or v_expense is null then
    raise exception 'Required expense ledger accounts 1000 or 6000 are missing or inactive';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.merchant_id::text||':expense:'||new.id::text,0)
  );

  select id into v_entry_id
  from public.journal_entries
  where merchant_id=new.merchant_id and source_type='expense' and source_id=new.id
  limit 1;

  if v_entry_id is null then
    insert into public.journal_entries(merchant_id,entry_date,description,source_type,source_id)
    values(new.merchant_id,new.created_at::date,'Expense '||new.description,'expense',new.id)
    returning id into v_entry_id;

    insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
    values
      (new.merchant_id,v_entry_id,v_expense,new.amount,0,'Operating expense'),
      (new.merchant_id,v_entry_id,v_cash,0,new.amount,'Cash paid');
  else
    select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
      into v_count,v_debit,v_credit
    from public.journal_lines
    where merchant_id=new.merchant_id and journal_entry_id=v_entry_id;

    if v_count<>2 or abs(v_debit-new.amount)>0.005 or abs(v_credit-new.amount)>0.005
       or not exists(select 1 from public.journal_lines where merchant_id=new.merchant_id and journal_entry_id=v_entry_id and account_id=v_expense and debit=new.amount and credit=0)
       or not exists(select 1 from public.journal_lines where merchant_id=new.merchant_id and journal_entry_id=v_entry_id and account_id=v_cash and debit=0 and credit=new.amount) then
      raise exception 'Existing expense journal does not match the source expense; manual reconciliation is required';
    end if;
  end if;

  select case when m.user_id=auth.uid() then 'Owner'
    else coalesce(mm.full_name,'Staff') end
    into v_actor_name
  from public.merchants m
  left join public.merchant_members mm
    on mm.merchant_id=m.id and mm.user_id=auth.uid() and mm.status='active'
  where m.id=new.merchant_id;

  if not exists(select 1 from public.audit_log a
    where a.merchant_id=new.merchant_id and a.entity_type='expense'
      and a.entity_id=new.id and a.action='create') then
    insert into public.audit_log(id,merchant_id,actor_user_id,action,entity_type,entity_id,reason,details,created_at)
    values(gen_random_uuid(),new.merchant_id,auth.uid(),'create','expense',new.id,null,
      jsonb_build_object('description',new.description,'amount',new.amount,'category',new.cat,
        'journal_entry_id',v_entry_id,'actor_name',coalesce(v_actor_name,'Staff')),
      coalesce(new.created_at,now()));
  end if;

  return new;
end;
$$;

revoke all on function private.expenses_post_ledger_after_insert() from public,anon,authenticated;
drop trigger if exists expenses_post_ledger_after_insert on public.expenses;
create trigger expenses_post_ledger_after_insert
after insert on public.expenses
for each row execute function private.expenses_post_ledger_after_insert();

create or replace function private.prevent_expense_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Expenses are retained for accounting history. Use the audited void workflow instead.';
end;
$$;
revoke all on function private.prevent_expense_hard_delete() from public,anon,authenticated;
drop trigger if exists expenses_prevent_hard_delete on public.expenses;
create trigger expenses_prevent_hard_delete
before delete on public.expenses
for each row execute function private.prevent_expense_hard_delete();

create or replace function public.shericeri_void_expense(
  p_merchant_id uuid,
  p_expense_id uuid,
  p_reason text,
  p_audit_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_original public.journal_entries%rowtype;
  v_reversal_id uuid;
  v_count integer;
  v_debit numeric;
  v_credit numeric;
  v_lock date;
  v_actor_name text;
begin
  if p_merchant_id is null or p_expense_id is null or coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A clear expense void reason is required';
  end if;
  if not private.user_can_access_merchant(p_merchant_id,'manage_team')
     or not private.user_can_access_merchant(p_merchant_id,'manage_expenses') then
    raise exception 'Not authorized to void expenses';
  end if;

  select * into v_expense
  from public.expenses
  where id=p_expense_id and merchant_id=p_merchant_id
  for update;
  if not found then
    return jsonb_build_object('ok',false,'reason','expense_not_found');
  end if;
  if v_expense.voided then
    return jsonb_build_object('ok',true,'already_voided',true);
  end if;

  select locked_through into v_lock
  from public.accounting_settings where merchant_id=p_merchant_id;
  if v_lock is not null and (v_expense.created_at::date<=v_lock or current_date<=v_lock) then
    raise exception 'The expense or current accounting period is locked';
  end if;

  select * into v_original
  from public.journal_entries
  where merchant_id=p_merchant_id and source_type='expense' and source_id=p_expense_id
  for update;
  if not found then
    raise exception 'The expense has no source journal. Reconcile it before attempting a void.';
  end if;

  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_count,v_debit,v_credit
  from public.journal_lines
  where merchant_id=p_merchant_id and journal_entry_id=v_original.id;
  if v_count<2 or v_debit<=0 or abs(v_debit-v_credit)>0.005 then
    raise exception 'The original expense journal is incomplete or unbalanced. No void was applied.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_merchant_id::text||':expense_void:'||v_original.id::text,0)
  );
  if exists(select 1 from public.journal_entries
    where merchant_id=p_merchant_id and source_type='expense_void' and source_id=v_original.id) then
    raise exception 'An expense reversal already exists. Refresh the expense history before retrying.';
  end if;

  v_reversal_id:=gen_random_uuid();
  insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id)
  values(v_reversal_id,p_merchant_id,current_date,'Reversal: '||v_original.description,'expense_void',v_original.id);

  insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
  select gen_random_uuid(),jl.merchant_id,v_reversal_id,jl.account_id,jl.credit,jl.debit,
    coalesce(jl.memo,'')||' (expense void reversal)'
  from public.journal_lines jl
  where jl.merchant_id=p_merchant_id and jl.journal_entry_id=v_original.id;

  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_count,v_debit,v_credit
  from public.journal_lines
  where merchant_id=p_merchant_id and journal_entry_id=v_reversal_id;
  if v_count<2 or v_debit<=0 or abs(v_debit-v_credit)>0.005 then
    raise exception 'Expense reversal failed its debit-credit validation';
  end if;

  update public.journal_entries
  set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid()
  where id=v_original.id and merchant_id=p_merchant_id;

  update public.expenses
  set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid()
  where id=p_expense_id and merchant_id=p_merchant_id;

  select case when m.user_id=auth.uid() then 'Owner'
    else coalesce(mm.full_name,'Staff') end
    into v_actor_name
  from public.merchants m
  left join public.merchant_members mm
    on mm.merchant_id=m.id and mm.user_id=auth.uid() and mm.status='active'
  where m.id=p_merchant_id;

  insert into public.audit_log(id,merchant_id,actor_user_id,action,entity_type,entity_id,reason,details,created_at)
  values(p_audit_id,p_merchant_id,auth.uid(),'void','expense',p_expense_id,trim(p_reason),
    jsonb_build_object('reason',trim(p_reason),'amount',v_expense.amount,
      'description',v_expense.description,'original_journal_id',v_original.id,
      'reversal_journal_id',v_reversal_id,'actor_name',coalesce(v_actor_name,'Staff')),now())
  on conflict(id) do nothing;

  return jsonb_build_object('ok',true,'expense_id',p_expense_id,
    'original_journal_id',v_original.id,'reversal_journal_id',v_reversal_id);
end;
$$;

revoke all on function public.shericeri_void_expense(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.shericeri_void_expense(uuid,uuid,text,uuid) to authenticated,service_role;
