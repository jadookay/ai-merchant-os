-- AIBOS tenant team access and secure PIN authentication.
create table if not exists public.merchant_members (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  username text,
  email text,
  phone text,
  role text not null default 'cashier' check (role in ('admin','manager','cashier','inventory','accountant','custom')),
  permissions jsonb not null default '{}'::jsonb,
  responsibility text,
  pin_hash text,
  status text not null default 'active' check (status in ('active','suspended','invited')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (merchant_id,user_id)
);
create unique index if not exists merchant_members_username_unique on public.merchant_members(merchant_id,lower(username)) where username is not null;
create unique index if not exists merchant_members_email_unique on public.merchant_members(merchant_id,lower(email)) where email is not null;
create unique index if not exists merchant_members_phone_unique on public.merchant_members(merchant_id,phone) where phone is not null;

create table if not exists public.team_login_attempts (
  attempt_key text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.merchant_members enable row level security;
alter table public.team_login_attempts enable row level security;
revoke all on public.merchant_members from anon,authenticated;
grant select (id,merchant_id,user_id,full_name,username,email,phone,role,permissions,responsibility,status,created_by,created_at,updated_at,last_login_at) on public.merchant_members to authenticated;
revoke all on public.team_login_attempts from anon,authenticated;
grant all on public.team_login_attempts to service_role;

create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create or replace function private.user_can_access_merchant(p_merchant_id uuid,p_permission text default 'view_dashboard')
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.merchants m where m.id=p_merchant_id and m.user_id=(select auth.uid()))
  or exists(
    select 1 from public.merchant_members mm
    where mm.merchant_id=p_merchant_id and mm.user_id=(select auth.uid()) and mm.status='active'
    and (
      (mm.role='admin' and p_permission<>'manage_owner')
      or coalesce((mm.permissions->>p_permission)::boolean,false)
      or p_permission in ('view_dashboard','member_active')
      or (p_permission='view_inventory' and coalesce((mm.permissions->>'create_sale')::boolean,false))
    )
  );
$$;
revoke all on function private.user_can_access_merchant(uuid,text) from public,anon;
grant execute on function private.user_can_access_merchant(uuid,text) to authenticated;

create or replace function public.set_merchant_member_pin(p_member_id uuid,p_pin text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'not authorized'; end if;
  if p_pin !~ '^[0-9]{6,8}$' then raise exception 'PIN must contain 6 to 8 digits'; end if;
  update public.merchant_members set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',12)),updated_at=now() where id=p_member_id;
  if not found then raise exception 'member not found'; end if;
end;
$$;
revoke all on function public.set_merchant_member_pin(uuid,text) from public,anon,authenticated;
grant execute on function public.set_merchant_member_pin(uuid,text) to service_role;

create or replace function public.verify_merchant_member_pin(p_merchant_id uuid,p_identifier text,p_pin text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_identifier text:=lower(trim(coalesce(p_identifier,'')));
  v_key text;
  v_attempt public.team_login_attempts%rowtype;
  v_member public.merchant_members%rowtype;
  v_count integer;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'not authorized'; end if;
  if p_merchant_id is null or length(v_identifier)<2 or p_pin !~ '^[0-9]{6,8}$' then return jsonb_build_object('ok',false); end if;
  v_key:=encode(extensions.digest(p_merchant_id::text||':'||v_identifier||':'||coalesce(p_ip_hash,''),'sha256'),'hex');
  select * into v_attempt from public.team_login_attempts where attempt_key=v_key for update;
  if found and v_attempt.blocked_until is not null and v_attempt.blocked_until>now() then
    return jsonb_build_object('ok',false,'rate_limited',true);
  end if;
  select count(*) into v_count from public.merchant_members mm
  where mm.merchant_id=p_merchant_id and mm.status='active'
    and (lower(coalesce(mm.email,''))=v_identifier or lower(coalesce(mm.username,''))=v_identifier or lower(mm.full_name)=v_identifier
      or (coalesce(mm.phone,'')<>'' and regexp_replace(mm.phone,'[^0-9+]','','g')=regexp_replace(v_identifier,'[^0-9+]','','g')));
  if v_count<>1 then
    insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at,blocked_until) values(v_key,1,now(),null)
    on conflict(attempt_key) do update set
      attempt_count=case when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then 1 else public.team_login_attempts.attempt_count+1 end,
      window_started_at=case when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then now() else public.team_login_attempts.window_started_at end,
      blocked_until=case when public.team_login_attempts.attempt_count>=4 then now()+interval '15 minutes' else null end;
    return jsonb_build_object('ok',false);
  end if;
  select * into v_member from public.merchant_members mm
  where mm.merchant_id=p_merchant_id and mm.status='active'
    and (lower(coalesce(mm.email,''))=v_identifier or lower(coalesce(mm.username,''))=v_identifier or lower(mm.full_name)=v_identifier
      or (coalesce(mm.phone,'')<>'' and regexp_replace(mm.phone,'[^0-9+]','','g')=regexp_replace(v_identifier,'[^0-9+]','','g')))
  limit 1;
  if v_member.pin_hash is null or extensions.crypt(p_pin,v_member.pin_hash)<>v_member.pin_hash then
    insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at,blocked_until) values(v_key,1,now(),null)
    on conflict(attempt_key) do update set
      attempt_count=case when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then 1 else public.team_login_attempts.attempt_count+1 end,
      window_started_at=case when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then now() else public.team_login_attempts.window_started_at end,
      blocked_until=case when public.team_login_attempts.attempt_count>=4 then now()+interval '15 minutes' else null end;
    return jsonb_build_object('ok',false);
  end if;
  delete from public.team_login_attempts where attempt_key=v_key;
  update public.merchant_members set last_login_at=now() where id=v_member.id;
  return jsonb_build_object('ok',true,'user_id',v_member.user_id,'merchant_id',v_member.merchant_id,'email',v_member.email,'phone',v_member.phone,'role',v_member.role);
end;
$$;
revoke all on function public.verify_merchant_member_pin(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.verify_merchant_member_pin(uuid,text,text,text) to service_role;

drop policy if exists merchant_members_select on public.merchant_members;
drop policy if exists merchant_members_manage on public.merchant_members;
create policy merchant_members_select on public.merchant_members for select to authenticated
  using (user_id=(select auth.uid()) or private.user_can_access_merchant(merchant_id,'manage_team'));
create policy merchant_members_manage on public.merchant_members for all to authenticated
  using (private.user_can_access_merchant(merchant_id,'manage_team'))
  with check (private.user_can_access_merchant(merchant_id,'manage_team'));

-- Replace merchant-scoped owner-only policies with permission-aware tenant policies.
do $$
declare t record; pol record; read_perm text; write_perm text; insert_perm text;
begin
  for t in select table_name from information_schema.columns
    where table_schema='public' and column_name='merchant_id'
      and table_name in (
        'products','sales','expenses','customers','suppliers','purchases','cash_entries',
        'budgets','chart_of_accounts','journal_entries','journal_lines','invoices','bills',
        'payments','bank_accounts','tax_rates','recurring_transactions','accounting_settings',
        'audit_log','shericeri_memory'
      )
  loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t.table_name
    loop execute format('drop policy %I on public.%I',pol.policyname,t.table_name); end loop;
    read_perm:=case t.table_name
      when 'products' then 'view_inventory' when 'sales' then 'view_sales'
      when 'expenses' then 'view_expenses' when 'customers' then 'view_customers'
      when 'suppliers' then 'view_suppliers' when 'purchases' then 'view_inventory'
      when 'audit_log' then 'view_audit_log' else 'view_financial_reports' end;
    write_perm:=case t.table_name
      when 'products' then 'manage_inventory' when 'sales' then 'manage_sales'
      when 'expenses' then 'manage_expenses' when 'customers' then 'manage_customers'
      when 'suppliers' then 'manage_suppliers' when 'purchases' then 'manage_inventory'
      else 'manage_finance' end;
    insert_perm:=case when t.table_name='sales' then 'create_sale' when t.table_name='audit_log' then 'view_dashboard' else write_perm end;
    execute format('create policy %I on public.%I for select to authenticated using (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_select',t.table_name,read_perm);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_insert',t.table_name,insert_perm);
    if t.table_name<>'audit_log' then
      execute format('create policy %I on public.%I for update to authenticated using (private.user_can_access_merchant(merchant_id,%L)) with check (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_update',t.table_name,write_perm,write_perm);
      execute format('create policy %I on public.%I for delete to authenticated using (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_delete',t.table_name,write_perm);
    end if;
  end loop;
end $$;

drop policy if exists merchants_team_select on public.merchants;
drop policy if exists merchants_team_update on public.merchants;
create policy merchants_team_select on public.merchants for select to authenticated using (private.user_can_access_merchant(id,'view_dashboard'));
create policy merchants_team_update on public.merchants for update to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));


-- Accounting journal void metadata. Keep original journal lines for auditability.
alter table public.journal_entries
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null;

-- Staff who can perform operational work need only the chart-of-accounts identifiers
-- required to post that work. Full journal and financial records remain report-gated.
create or replace function public.shericeri_get_accounting_snapshot(p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_can_view_reports boolean := private.user_can_access_merchant(p_merchant_id,'view_financial_reports');
  v_can_post boolean :=
    private.user_can_access_merchant(p_merchant_id,'create_sale')
    or private.user_can_access_merchant(p_merchant_id,'manage_expenses')
    or private.user_can_access_merchant(p_merchant_id,'manage_inventory')
    or private.user_can_access_merchant(p_merchant_id,'manage_finance');
begin
  if not v_can_post and not v_can_view_reports then
    raise exception 'Not authorized for merchant accounting data';
  end if;
  return jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(x order by x.code) from (select * from public.chart_of_accounts where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'journalEntries',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.entry_date desc) from (select * from public.journal_entries where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'journalLines',case when v_can_view_reports then coalesce((select jsonb_agg(x) from (select * from public.journal_lines where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'invoices',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.issue_date desc) from (select * from public.invoices where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'bills',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.issue_date desc) from (select * from public.bills where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'payments',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.payment_date desc) from (select * from public.payments where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'bankAccounts',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.name) from (select * from public.bank_accounts where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'taxRates',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.name) from (select * from public.tax_rates where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'recurringTransactions',case when v_can_view_reports then coalesce((select jsonb_agg(x order by x.next_run) from (select * from public.recurring_transactions where merchant_id=p_merchant_id) x),'[]'::jsonb) else '[]'::jsonb end,
    'accountingSettings',case when v_can_view_reports or private.user_can_access_merchant(p_merchant_id,'manage_finance') then (select to_jsonb(x) from (select * from public.accounting_settings where merchant_id=p_merchant_id limit 1) x) else null end,
    'auditLog',case when private.user_can_access_merchant(p_merchant_id,'view_audit_log') then coalesce((select jsonb_agg(x order by x.created_at desc) from (select * from public.audit_log where merchant_id=p_merchant_id order by created_at desc limit 100) x),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.shericeri_get_accounting_snapshot(uuid) from public,anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;

-- Keep the existing atomic journal RPC, but authorize by the business operation
-- that generated the entry rather than requiring every operator to see reports.
create or replace function public.shericeri_sync_journal_batch(
  p_merchant_id uuid,
  p_entry_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_line jsonb;
  v_line_id uuid;
  v_account uuid;
  v_d numeric;
  v_c numeric;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_existing_merchant uuid;
  v_lock date;
  v_authorized boolean:=false;
begin
  if p_source_type in ('sale','sale_cogs') then
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'create_sale')
      or private.user_can_access_merchant(p_merchant_id,'manage_finance');
  elsif p_source_type='expense' then
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'manage_expenses')
      or private.user_can_access_merchant(p_merchant_id,'manage_finance');
  elsif p_source_type in ('purchase','product_opening_stock','stock_gain','stock_writeoff') then
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'manage_inventory')
      or private.user_can_access_merchant(p_merchant_id,'manage_finance');
  else
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'manage_finance');
  end if;
  if not v_authorized then raise exception 'Not authorized to post this accounting entry'; end if;
  if p_entry_id is null or p_entry_date is null or coalesce(trim(p_description),'')='' then raise exception 'Journal entry identity is incomplete'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'Journal batch requires at least two lines'; end if;
  select locked_through into v_lock from public.accounting_settings where merchant_id=p_merchant_id;
  if v_lock is not null and p_entry_date<=v_lock then raise exception 'Accounting period is locked through %',v_lock; end if;
  select merchant_id into v_existing_merchant from public.journal_entries where id=p_entry_id;
  if v_existing_merchant is not null and v_existing_merchant<>p_merchant_id then raise exception 'Journal entry belongs to another merchant'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id:=nullif(v_line->>'id','')::uuid;
    v_account:=nullif(v_line->>'account_id','')::uuid;
    v_d:=coalesce((v_line->>'debit')::numeric,0);
    v_c:=coalesce((v_line->>'credit')::numeric,0);
    if v_line_id is null or v_account is null then raise exception 'Journal line identity is incomplete'; end if;
    if v_d<0 or v_c<0 or ((v_d=0)=(v_c=0)) then raise exception 'Invalid journal line'; end if;
    if not exists(select 1 from public.chart_of_accounts where id=v_account and merchant_id=p_merchant_id and active) then raise exception 'Invalid ledger account'; end if;
    v_debit:=v_debit+v_d;
    v_credit:=v_credit+v_c;
  end loop;
  if v_debit<=0 or abs(v_debit-v_credit)>0.005 then raise exception 'Journal entry is not balanced'; end if;
  if v_existing_merchant is null then
    insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id)
    values(p_entry_id,p_merchant_id,p_entry_date,p_description,p_source_type,p_source_id);
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id:=(v_line->>'id')::uuid;
    if not exists(select 1 from public.journal_lines where id=v_line_id) then
      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      values(v_line_id,p_merchant_id,p_entry_id,(v_line->>'account_id')::uuid,
        coalesce((v_line->>'debit')::numeric,0),coalesce((v_line->>'credit')::numeric,0),v_line->>'memo');
    elsif not exists(select 1 from public.journal_lines where id=v_line_id and merchant_id=p_merchant_id and journal_entry_id=p_entry_id) then
      raise exception 'Journal line UUID belongs to another record';
    end if;
  end loop;
  return p_entry_id;
end;
$$;
revoke all on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) from public,anon;
grant execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) to authenticated;

-- Cashier/operational sale synchronization is atomic and does not require direct
-- UPDATE rights on product records. A stock mismatch is returned as a conflict.
create or replace function public.shericeri_sync_sale_stock(
  p_sale jsonb,
  p_product_id uuid,
  p_local_stock integer,
  p_expected_server_stock integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_merchant_id uuid;
  v_sale_id uuid;
  v_qty integer;
  v_current_stock integer;
  v_inserted integer;
begin
  v_merchant_id:=nullif(p_sale->>'merchant_id','')::uuid;
  v_sale_id:=nullif(p_sale->>'id','')::uuid;
  v_qty:=nullif(p_sale->>'qty','')::integer;
  if v_merchant_id is null or v_sale_id is null or v_qty is null or v_qty<1 then raise exception 'Sale identity or quantity is invalid'; end if;
  if not private.user_can_access_merchant(v_merchant_id,'create_sale') then raise exception 'Not authorized to record sales'; end if;
  if nullif(p_sale->>'product_id','')::uuid is distinct from p_product_id then raise exception 'Sale product does not match the stock operation'; end if;
  if p_product_id is null or p_local_stock is null or p_expected_server_stock is null or p_local_stock<0 or p_local_stock<>p_expected_server_stock-v_qty then
    raise exception 'Sale stock values are invalid';
  end if;
  select stock into v_current_stock from public.products where id=p_product_id and merchant_id=v_merchant_id for update;
  if not found then raise exception 'Product was not found for this business'; end if;
  insert into public.sales
  select (jsonb_populate_record(null::public.sales,p_sale)).*
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then return jsonb_build_object('ok',true,'already_recorded',true,'stock_conflict',false); end if;
  if v_current_stock<>p_expected_server_stock then
    return jsonb_build_object('ok',true,'stock_conflict',true,'server_stock',v_current_stock,'local_stock',p_local_stock);
  end if;
  update public.products set stock=p_local_stock where id=p_product_id and merchant_id=v_merchant_id;
  return jsonb_build_object('ok',true,'stock_conflict',false,'server_stock',p_local_stock);
end;
$$;
revoke all on function public.shericeri_sync_sale_stock(jsonb,uuid,integer,integer) from public,anon;
grant execute on function public.shericeri_sync_sale_stock(jsonb,uuid,integer,integer) to authenticated;

-- Voiding a cart invoice restores stock, reverses its journal entries, preserves
-- the reason and actor in the audit log, and removes the sale rows atomically.
create or replace function public.shericeri_void_sale(
  p_sale_id uuid,
  p_reason text,
  p_audit_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_merchant_id uuid;
  v_transaction_id uuid;
  v_invoice_number text;
  v_amount numeric;
  v_line_count integer;
  v_sale_ids jsonb;
  v_sale_date date;
  v_lock date;
begin
  if p_sale_id is null or coalesce(length(trim(p_reason)),0)<3 then raise exception 'A clear void reason is required'; end if;
  select merchant_id,transaction_id,invoice_number,created_at::date
    into v_merchant_id,v_transaction_id,v_invoice_number,v_sale_date
  from public.sales where id=p_sale_id;
  if v_merchant_id is null then return jsonb_build_object('ok',true,'already_voided',true); end if;
  if not private.user_can_access_merchant(v_merchant_id,'manage_sales')
     and not private.user_can_access_merchant(v_merchant_id,'manage_finance') then
    raise exception 'Not authorized to void sales';
  end if;
  select locked_through into v_lock from public.accounting_settings where merchant_id=v_merchant_id;
  if v_lock is not null and v_sale_date<=v_lock then raise exception 'The sale is in a locked accounting period'; end if;
  select coalesce(sum(qty*price),0),count(*),coalesce(jsonb_agg(id),'[]'::jsonb)
    into v_amount,v_line_count,v_sale_ids
  from public.sales
  where merchant_id=v_merchant_id
    and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id));
  update public.products p set stock=p.stock+x.qty
  from (
    select product_id,sum(qty)::integer as qty
    from public.sales
    where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and product_id is not null
    group by product_id
  ) x
  where p.id=x.product_id and p.merchant_id=v_merchant_id;
  update public.journal_entries
  set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid()
  where merchant_id=v_merchant_id and source_type in ('sale','sale_cogs')
    and source_id in (
      select id from public.sales where merchant_id=v_merchant_id
        and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
    );
  insert into public.audit_log(id,merchant_id,actor_user_id,action,entity_type,entity_id,reason,details,created_at)
  values(p_audit_id,v_merchant_id,auth.uid(),'void','sale',p_sale_id,trim(p_reason),
    jsonb_build_object('reason',trim(p_reason),'invoice_number',v_invoice_number,'transaction_id',v_transaction_id,
      'amount',v_amount,'line_count',v_line_count,'sale_ids',v_sale_ids),now())
  on conflict(id) do nothing;
  delete from public.sales
  where merchant_id=v_merchant_id
    and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id));
  return jsonb_build_object('ok',true,'invoice_number',v_invoice_number,'transaction_id',v_transaction_id,
    'amount',v_amount,'line_count',v_line_count,'sale_ids',v_sale_ids);
end;
$$;
revoke all on function public.shericeri_void_sale(uuid,text,uuid) from public,anon;
grant execute on function public.shericeri_void_sale(uuid,text,uuid) to authenticated;


-- Seed only the standard chart identifiers needed by operational staff posting.
-- This does not expose journal balances or financial reports to those roles.
create or replace function public.shericeri_ensure_operational_accounts(p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not (
    private.user_can_access_merchant(p_merchant_id,'create_sale')
    or private.user_can_access_merchant(p_merchant_id,'manage_expenses')
    or private.user_can_access_merchant(p_merchant_id,'manage_inventory')
    or private.user_can_access_merchant(p_merchant_id,'manage_finance')
    or private.user_can_access_merchant(p_merchant_id,'view_financial_reports')
  ) then
    raise exception 'Not authorized to initialize operational accounting accounts';
  end if;
  insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,active)
  values
    (p_merchant_id,'1000','Cash on hand','asset','debit',true),
    (p_merchant_id,'1010','Bank accounts','asset','debit',true),
    (p_merchant_id,'1020','Mobile money','asset','debit',true),
    (p_merchant_id,'1100','Accounts receivable','asset','debit',true),
    (p_merchant_id,'1200','Inventory','asset','debit',true),
    (p_merchant_id,'2000','Accounts payable','liability','credit',true),
    (p_merchant_id,'2100','Tax payable','liability','credit',true),
    (p_merchant_id,'2110','Input tax receivable','asset','debit',true),
    (p_merchant_id,'2200','Other liabilities','liability','credit',true),
    (p_merchant_id,'3000','Owner equity','equity','credit',true),
    (p_merchant_id,'3100','Owner drawings','equity','debit',true),
    (p_merchant_id,'4000','Sales revenue','income','credit',true),
    (p_merchant_id,'4050','Sales returns & discounts','income','debit',true),
    (p_merchant_id,'4100','Other income','income','credit',true),
    (p_merchant_id,'5000','Cost of goods sold','cogs','debit',true),
    (p_merchant_id,'6000','Operating expenses','expense','debit',true),
    (p_merchant_id,'6100','Tax expense','expense','debit',true)
  on conflict (merchant_id,code) do nothing;
  return jsonb_build_object(
    'accounts',
    coalesce((select jsonb_agg(x order by x.code) from (select id,merchant_id,code,name,type,normal_balance,active,created_at from public.chart_of_accounts where merchant_id=p_merchant_id) x),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.shericeri_ensure_operational_accounts(uuid) from public,anon;
grant execute on function public.shericeri_ensure_operational_accounts(uuid) to authenticated;
