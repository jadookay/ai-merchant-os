-- AIBOS tenant team access: each staff identity is a real Supabase Auth user.
-- PINs are bcrypt-hashed and verified only by the service-role Edge Function.
create table if not exists public.merchant_members (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  username text,
  email text,
  phone text,
  role text not null default 'cashier'
    check (role in ('admin','manager','cashier','inventory','accountant','custom')),
  permissions jsonb not null default '{}'::jsonb,
  pin_hash text,
  status text not null default 'active' check (status in ('active','suspended','invited')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (merchant_id,user_id)
);
create unique index if not exists merchant_members_username_unique
  on public.merchant_members (merchant_id, lower(username)) where username is not null;
create unique index if not exists merchant_members_email_unique
  on public.merchant_members (merchant_id, lower(email)) where email is not null;
create unique index if not exists merchant_members_phone_unique
  on public.merchant_members (merchant_id, phone) where phone is not null;

create table if not exists public.team_login_attempts (
  attempt_key text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.merchant_members enable row level security;
alter table public.team_login_attempts enable row level security;
revoke all on public.merchant_members from anon, authenticated;
grant select (id,merchant_id,user_id,full_name,username,email,phone,role,permissions,status,created_by,created_at,updated_at,last_login_at)
  on public.merchant_members to authenticated;
revoke all on public.team_login_attempts from anon, authenticated;
grant all on public.team_login_attempts to service_role;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.user_can_access_merchant(p_merchant_id uuid,p_permission text default 'view_dashboard')
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.merchants m
      where m.id = p_merchant_id and m.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.merchant_members mm
      where mm.merchant_id = p_merchant_id
        and mm.user_id = (select auth.uid())
        and mm.status = 'active'
        and (
          (mm.role = 'admin' and p_permission <> 'manage_owner')
          or coalesce((mm.permissions ->> p_permission)::boolean,false)
        )
    );
$$;
revoke all on function private.user_can_access_merchant(uuid,text) from public, anon;
grant execute on function private.user_can_access_merchant(uuid,text) to authenticated;

create or replace function public.set_merchant_member_pin(p_member_id uuid,p_pin text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_pin !~ '^[0-9]{6,8}$' then raise exception 'PIN must contain 6 to 8 digits'; end if;
  update public.merchant_members
    set pin_hash = extensions.crypt(p_pin,extensions.gen_salt('bf',12)),updated_at=now()
    where id=p_member_id;
  if not found then raise exception 'member not found'; end if;
end;
$$;
revoke all on function public.set_merchant_member_pin(uuid,text) from public, anon, authenticated;
grant execute on function public.set_merchant_member_pin(uuid,text) to service_role;

create or replace function public.verify_merchant_member_pin(p_identifier text,p_pin text,p_ip_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identifier text := lower(trim(coalesce(p_identifier,'')));
  v_key text;
  v_attempt public.team_login_attempts%rowtype;
  v_member public.merchant_members%rowtype;
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;
  if length(v_identifier)<2 or p_pin !~ '^[0-9]{6,8}$' then return jsonb_build_object('ok',false); end if;
  v_key := encode(extensions.digest(v_identifier||':'||coalesce(p_ip_hash,''),'sha256'),'hex');
  select * into v_attempt from public.team_login_attempts where attempt_key=v_key for update;
  if found and v_attempt.blocked_until is not null and v_attempt.blocked_until>now() then
    return jsonb_build_object('ok',false,'rate_limited',true);
  end if;
  select count(*) into v_count
    from public.merchant_members mm
    where mm.status='active'
      and (lower(coalesce(mm.email,''))=v_identifier
        or lower(coalesce(mm.username,''))=v_identifier
        or lower(mm.full_name)=v_identifier
        or regexp_replace(coalesce(mm.phone,''),'[^0-9+]','','g')=regexp_replace(v_identifier,'[^0-9+]','','g'));
  if v_count<>1 then
    insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at,blocked_until)
      values(v_key,1,now(),null)
      on conflict(attempt_key) do update set
        attempt_count=case when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then 1 else public.team_login_attempts.attempt_count+1 end,
        window_started_at=case when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then now() else public.team_login_attempts.window_started_at end,
        blocked_until=case when public.team_login_attempts.attempt_count>=4 then now()+interval '15 minutes' else null end;
    return jsonb_build_object('ok',false);
  end if;
  select * into v_member from public.merchant_members mm
    where mm.status='active'
      and (lower(coalesce(mm.email,''))=v_identifier
        or lower(coalesce(mm.username,''))=v_identifier
        or lower(mm.full_name)=v_identifier
        or regexp_replace(coalesce(mm.phone,''),'[^0-9+]','','g')=regexp_replace(v_identifier,'[^0-9+]','','g'))
    limit 1;
  if v_member.pin_hash is null or extensions.crypt(p_pin,v_member.pin_hash)<>v_member.pin_hash then
    insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at,blocked_until)
      values(v_key,1,now(),null)
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
revoke all on function public.verify_merchant_member_pin(text,text,text) from public, anon, authenticated;
grant execute on function public.verify_merchant_member_pin(text,text,text) to service_role;

-- Membership management is only available to the merchant owner or an admin.
drop policy if exists merchant_members_select on public.merchant_members;
drop policy if exists merchant_members_manage on public.merchant_members;
create policy merchant_members_select on public.merchant_members for select to authenticated
  using (user_id=(select auth.uid()) or private.user_can_access_merchant(merchant_id,'manage_team'));
create policy merchant_members_manage on public.merchant_members for all to authenticated
  using (private.user_can_access_merchant(merchant_id,'manage_team'))
  with check (private.user_can_access_merchant(merchant_id,'manage_team'));

-- Replace owner-only row policies with permission-aware tenant policies.
do $$
declare
  t record;
  pol record;
  read_perm text;
  write_perm text;
  insert_perm text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema='public' and column_name='merchant_id'
      and table_name not in ('merchant_members','account_recovery_requests','barcode_cache')
  loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t.table_name
    loop execute format('drop policy %I on public.%I',pol.policyname,t.table_name); end loop;

    read_perm := case t.table_name
      when 'products' then 'view_inventory'
      when 'sales' then 'view_sales'
      when 'expenses' then 'view_expenses'
      when 'customers' then 'view_customers'
      when 'suppliers' then 'view_suppliers'
      when 'purchases' then 'view_inventory'
      when 'audit_log' then 'view_audit_log'
      when 'merchants' then 'view_dashboard'
      else 'view_financial_reports' end;

    write_perm := case t.table_name
      when 'products' then 'manage_inventory'
      when 'sales' then 'manage_sales'
      when 'expenses' then 'manage_expenses'
      when 'customers' then 'manage_customers'
      when 'suppliers' then 'manage_suppliers'
      when 'purchases' then 'manage_inventory'
      when 'merchants' then 'manage_settings'
      else 'manage_finance' end;

    insert_perm := case t.table_name
      when 'sales' then 'create_sale'
      when 'audit_log' then 'view_dashboard'
      else write_perm end;

    execute format('create policy %I on public.%I for select to authenticated using (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_select',t.table_name,read_perm);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_insert',t.table_name,insert_perm);

    if t.table_name <> 'audit_log' then
      execute format('create policy %I on public.%I for update to authenticated using (private.user_can_access_merchant(merchant_id,%L)) with check (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_update',t.table_name,write_perm,write_perm);
      execute format('create policy %I on public.%I for delete to authenticated using (private.user_can_access_merchant(merchant_id,%L))',t.table_name||'_team_delete',t.table_name,write_perm);
    end if;
  end loop;
end $$;

-- Merchant records may be read by active team members; only the owner edits core ownership.
drop policy if exists merchants_team_select on public.merchants;
drop policy if exists merchants_team_insert on public.merchants;
drop policy if exists merchants_team_update on public.merchants;
drop policy if exists merchants_team_delete on public.merchants;
create policy merchants_team_select on public.merchants for select to authenticated
  using (private.user_can_access_merchant(id,'view_dashboard'));
create policy merchants_team_update on public.merchants for update to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

