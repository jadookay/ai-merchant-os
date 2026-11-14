-- AIBOS release hardening: atomic cart sync, resilient PIN throttling and least-privilege accounting RPCs.
-- Preserve immutable opening-stock values so later sales or adjustments do not
-- change the value used by the original inventory opening journal.
alter table public.products add column if not exists opening_stock_qty integer;
alter table public.products add column if not exists opening_stock_cost integer;
alter table public.products add column if not exists opening_stock_value numeric;


create or replace function public.verify_merchant_member_pin(
  p_merchant_id uuid,
  p_identifier text,
  p_pin text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_identifier text := lower(trim(coalesce(p_identifier,'')));
  v_identity_key text;
  v_ip_key text;
  v_key text;
  v_blocked_until timestamptz;
  v_member public.merchant_members%rowtype;
  v_count integer := 0;
  v_ok boolean := false;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_merchant_id is null or length(v_identifier) < 2 or length(v_identifier) > 160
     or coalesce(p_pin,'') !~ '^[0-9]+'
     or length(coalesce(p_pin,'')) not between 6 and 8 then
    return jsonb_build_object('ok',false);
  end if;

  -- Independent identity and network keys prevent attackers rotating either
  -- usernames or source addresses to evade the 15-minute lockout.
  v_identity_key := 'identity:' || encode(extensions.digest(p_merchant_id::text||':'||v_identifier,'sha256'),'hex');
  if coalesce(p_ip_hash,'') ~ '^[0-9a-f]{64}$' then
    v_ip_key := 'ip:' || encode(extensions.digest(p_ip_hash,'sha256'),'hex');
  end if;

  -- Materialize and lock both throttle buckets before checking them. Concurrent
  -- attempts for the same identity or IP therefore serialize on the same rows.
  insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at)
  select k,0,now()
  from unnest(array_remove(array[v_identity_key,v_ip_key],null)) as keys(attempt_key)
  on conflict(attempt_key) do nothing;
  perform 1
  from public.team_login_attempts
  where attempt_key = any(array_remove(array[v_identity_key,v_ip_key],null))
  order by attempt_key
  for update;
  select max(blocked_until) into v_blocked_until
  from public.team_login_attempts
  where attempt_key = any(array_remove(array[v_identity_key,v_ip_key],null))
    and blocked_until > now();
  if v_blocked_until is not null then
    return jsonb_build_object('ok',false,'rate_limited',true);
  end if;

  select count(*) into v_count
  from public.merchant_members mm
  where mm.merchant_id=p_merchant_id and mm.status='active'
    and (
      lower(coalesce(mm.email,''))=v_identifier
      or lower(coalesce(mm.username,''))=v_identifier
      or lower(mm.full_name)=v_identifier
      or (coalesce(mm.phone,'')<>'' and regexp_replace(mm.phone,'[^0-9+]','','g')=regexp_replace(v_identifier,'[^0-9+]','','g'))
    );

  if v_count=1 then
    select * into v_member
    from public.merchant_members mm
    where mm.merchant_id=p_merchant_id and mm.status='active'
      and (
        lower(coalesce(mm.email,''))=v_identifier
        or lower(coalesce(mm.username,''))=v_identifier
        or lower(mm.full_name)=v_identifier
        or (coalesce(mm.phone,'')<>'' and regexp_replace(mm.phone,'[^0-9+]','','g')=regexp_replace(v_identifier,'[^0-9+]','','g'))
      )
    limit 1;
    v_ok := v_member.pin_hash is not null
      and extensions.crypt(p_pin,v_member.pin_hash)=v_member.pin_hash;
  end if;

  if not v_ok then
    foreach v_key in array array_remove(array[v_identity_key,v_ip_key],null) loop
      insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at,blocked_until)
      values(v_key,1,now(),null)
      on conflict(attempt_key) do update set
        attempt_count=case
          when public.team_login_attempts.window_started_at < now()-interval '15 minutes' then 1
          else public.team_login_attempts.attempt_count+1
        end,
        window_started_at=case
          when public.team_login_attempts.window_started_at < now()-interval '15 minutes'
            or public.team_login_attempts.attempt_count+1 >= case when v_key=v_ip_key then 20 else 5 end
          then now()
          else public.team_login_attempts.window_started_at
        end,
        blocked_until=case
          when (case
            when public.team_login_attempts.window_started_at < now()-interval '15 minutes' then 1
            else public.team_login_attempts.attempt_count+1
          end) >= case when v_key=v_ip_key then 20 else 5 end
          then now()+interval '15 minutes'
          else null
        end;
    end loop;
    return jsonb_build_object('ok',false);
  end if;

  delete from public.team_login_attempts
  where attempt_key = v_identity_key;
  update public.merchant_members set last_login_at=now() where id=v_member.id;
  return jsonb_build_object(
    'ok',true,'user_id',v_member.user_id,'merchant_id',v_member.merchant_id,
    'email',v_member.email,'phone',v_member.phone,'role',v_member.role
  );
end;
$$;
revoke all on function public.verify_merchant_member_pin(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.verify_merchant_member_pin(uuid,text,text,text) to service_role;

create or replace function public.shericeri_sync_sale_cart(
  p_merchant_id uuid,
  p_transaction_id uuid,
  p_sales jsonb,
  p_stock_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_change jsonb;
  v_sale jsonb;
  v_product_id uuid;
  v_qty integer;
  v_expected integer;
  v_local integer;
  v_current integer;
  v_customer_id uuid;
  v_conflicts jsonb := '[]'::jsonb;
  v_existing_count integer;
  v_sale_count integer;
begin
  if p_merchant_id is null or p_transaction_id is null then
    raise exception 'Sale cart identity is invalid';
  end if;
  if coalesce(jsonb_typeof(p_sales),'')<>'array'
     or coalesce(jsonb_typeof(p_stock_changes),'')<>'array' then
    raise exception 'Sale cart lines and stock changes must be arrays';
  end if;
  if jsonb_array_length(p_sales)<1 or jsonb_array_length(p_stock_changes)<1 then
    raise exception 'Sale cart must contain at least one sale line and one stock change';
  end if;
  if not private.user_can_access_merchant(p_merchant_id,'create_sale') then
    raise exception 'Not authorized to record sales';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_sales) x
    group by x.value->>'id' having count(*)>1
  ) then raise exception 'Duplicate sale line identity'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_stock_changes) x
    group by x.value->>'product_id' having count(*)>1
  ) then raise exception 'Duplicate product stock change'; end if;

  -- Serialize duplicate submissions of the same invoice even when their
  -- line items do not share a product row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_merchant_id::text||':'||p_transaction_id::text,0)
  );
  v_sale_count := jsonb_array_length(p_sales);
  select count(*) into v_existing_count
  from public.sales
  where merchant_id=p_merchant_id and transaction_id=p_transaction_id;
  if v_existing_count>0 then
    if v_existing_count=v_sale_count and not exists (
      select 1
      from jsonb_array_elements(p_sales) x
      where not exists (
        select 1 from public.sales s
        where s.id=(x.value->>'id')::uuid
          and s.merchant_id=p_merchant_id
          and s.transaction_id=p_transaction_id
      )
    ) then
      return jsonb_build_object('ok',true,'already_recorded',true,'stock_conflict',false);
    end if;
    raise exception 'A partial sale cart with this transaction ID already exists; manual reconciliation is required';
  end if;

  -- Validate every sale row and the relationship to its stock change.
  for v_sale in select value from jsonb_array_elements(p_sales) loop
    if nullif(v_sale->>'id','') is null
       or (v_sale->>'merchant_id')::uuid is distinct from p_merchant_id
       or (v_sale->>'transaction_id')::uuid is distinct from p_transaction_id
       or nullif(v_sale->>'product_id','') is null
       or coalesce((v_sale->>'qty')::integer,0)<1
       or coalesce((v_sale->>'price')::numeric,-1)<0
       or coalesce((v_sale->>'cost')::numeric,-1)<0 then
      raise exception 'A sale line contains invalid identity, quantity, price or cost';
    end if;
    v_customer_id := nullif(v_sale->>'customer_id','')::uuid;
    if v_customer_id is not null and not exists (
      select 1 from public.customers c
      where c.id=v_customer_id and c.merchant_id=p_merchant_id
    ) then raise exception 'Customer does not belong to this business'; end if;
    if not exists (
      select 1 from jsonb_array_elements(p_stock_changes) c
      where (c.value->>'product_id')::uuid=(v_sale->>'product_id')::uuid
    ) then raise exception 'A sale line has no matching stock reservation'; end if;
  end loop;

  -- Verify the aggregate quantity for every product equals the stock reservation.
  for v_change in select value from jsonb_array_elements(p_stock_changes) loop
    v_product_id := nullif(v_change->>'product_id','')::uuid;
    v_qty := nullif(v_change->>'quantity','')::integer;
    v_expected := nullif(v_change->>'expected_server_stock','')::integer;
    v_local := nullif(v_change->>'local_stock','')::integer;
    if v_product_id is null or v_qty is null or v_qty<1 or v_expected is null
       or v_local is null or v_local<0 or v_local<>v_expected-v_qty then
      raise exception 'Stock reservation values are invalid';
    end if;
    if v_qty <> (
      select coalesce(sum((x.value->>'qty')::integer),0)
      from jsonb_array_elements(p_sales) x
      where (x.value->>'product_id')::uuid=v_product_id
    ) then raise exception 'Stock reservation quantity does not match the sale lines'; end if;
  end loop;

  for v_change in
    select value from jsonb_array_elements(p_stock_changes)
    order by (value->>'product_id')::uuid
  loop
    v_product_id := (v_change->>'product_id')::uuid;
    v_expected := (v_change->>'expected_server_stock')::integer;
    v_local := (v_change->>'local_stock')::integer;
    select coalesce(stock,0) into v_current
    from public.products
    where id=v_product_id and merchant_id=p_merchant_id
    for update;
    if not found or v_current<>v_expected then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'product_id',v_product_id,'expected_server_stock',v_expected,
        'server_stock',case when found then v_current else null end,
        'local_stock',v_local
      ));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts)>0 then
    return jsonb_build_object('ok',false,'stock_conflict',true,'conflicts',v_conflicts);
  end if;

  -- No writes occur until all product locks and preconditions have passed.
  for v_change in select value from jsonb_array_elements(p_stock_changes) loop
    update public.products
    set stock=(v_change->>'local_stock')::integer
    where id=(v_change->>'product_id')::uuid and merchant_id=p_merchant_id;
  end loop;

  insert into public.sales
  select (jsonb_populate_record(
    null::public.sales,
    x.value || jsonb_build_object(
      'merchant_id',p_merchant_id,
      'transaction_id',p_transaction_id,
      'stock_applied',true,
      'voided',false
    )
  )).*
  from jsonb_array_elements(p_sales) as x(value);

  return jsonb_build_object('ok',true,'stock_conflict',false,'line_count',v_sale_count);
end;
$$;
revoke all on function public.shericeri_sync_sale_cart(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.shericeri_sync_sale_cart(uuid,uuid,jsonb,jsonb) to authenticated;

-- Close anonymous execution paths for privileged accounting RPCs.
revoke all on function public.shericeri_get_accounting_snapshot(uuid) from public,anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;
revoke all on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) from public,anon;
grant execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) to authenticated;

-- Pin trigger function search paths to the catalog schema rather than caller state.
alter function public.set_merchants_updated_at() set search_path = '';
alter function public.set_accounting_settings_updated_at() set search_path = '';
alter function public.prevent_locked_journal_entry() set search_path = '';
alter function public.prevent_locked_journal_line() set search_path = '';


-- Disable refresh-token sessions when a staff member is suspended.
-- Their current access JWT is also denied by membership-aware RLS immediately.
create or replace function public.revoke_merchant_member_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deleted integer := 0;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then
    raise exception 'user ID is required';
  end if;
  delete from auth.sessions where user_id=p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_merchant_member_sessions(uuid) from public,anon,authenticated;
grant execute on function public.revoke_merchant_member_sessions(uuid) to service_role;


-- Cover the ten foreign keys identified by the live performance advisor.
create index if not exists bank_accounts_account_merchant_fk_idx on public.bank_accounts(account_id,merchant_id);
create index if not exists bills_supplier_fk_idx on public.bills(supplier_id);
create index if not exists invoices_customer_fk_idx on public.invoices(customer_id);
create index if not exists journal_lines_account_merchant_fk_idx on public.journal_lines(account_id,merchant_id);
create index if not exists journal_lines_entry_merchant_fk_idx on public.journal_lines(journal_entry_id,merchant_id);
create index if not exists payments_account_merchant_fk_idx on public.payments(account_id,merchant_id);
create index if not exists recurring_transactions_merchant_fk_idx on public.recurring_transactions(merchant_id);
create index if not exists sales_customer_fk_idx on public.sales(customer_id);
create index if not exists sales_product_fk_idx on public.sales(product_id);
create index if not exists tax_rates_merchant_fk_idx on public.tax_rates(merchant_id);

-- Hoist auth.uid() out of per-row RLS evaluation without changing policy logic.
-- Policies already using a scalar subquery are left untouched.
do $$
declare
  p record;
  v_using text;
  v_check text;
  v_stmt text;
begin
  for p in
    select schemaname,tablename,policyname,qual,with_check
    from pg_policies
    where schemaname='public'
      and (
        (coalesce(qual,'') like '%auth.uid()%' and lower(coalesce(qual,'')) not like '%( select auth.uid()%')
        or
        (coalesce(with_check,'') like '%auth.uid()%' and lower(coalesce(with_check,'')) not like '%( select auth.uid()%')
      )
  loop
    v_using := case when p.qual is null then null else replace(p.qual,'auth.uid()','(select auth.uid())') end;
    v_check := case when p.with_check is null then null else replace(p.with_check,'auth.uid()','(select auth.uid())') end;
    v_stmt := format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
    if v_using is not null then v_stmt := v_stmt || format(' using (%s)',v_using); end if;
    if v_check is not null then v_stmt := v_stmt || format(' with check (%s)',v_check); end if;
    execute v_stmt;
  end loop;
end;
$$;


-- Permit only the operational journal sources that the caller is authorized to
-- create. Manual journals remain restricted to finance permission.
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
  v_permission text;
  v_expected numeric;
  v_expected_date date;
  v_debit_code text;
  v_credit_code text;
  v_lock date;
  v_existing_merchant uuid;
  v_existing_source_type text;
  v_existing_source_id uuid;
  v_entry_exists boolean := false;
  v_line jsonb;
  v_line_id uuid;
  v_account uuid;
  v_account_code text;
  v_d numeric;
  v_c numeric;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_debit_match integer := 0;
  v_credit_match integer := 0;
  v_operational boolean := false;
begin
  if p_merchant_id is null or p_entry_id is null or p_entry_date is null
     or coalesce(trim(p_description),'')='' then
    raise exception 'Journal entry identity is incomplete';
  end if;
  if coalesce(jsonb_typeof(p_lines),'')<>'array' or jsonb_array_length(p_lines)<2 then
    raise exception 'Journal batch requires at least two lines';
  end if;

  v_permission := case p_source_type
    when 'sale' then 'create_sale'
    when 'sale_cogs' then 'create_sale'
    when 'purchase' then 'manage_inventory'
    when 'product_opening_stock' then 'manage_inventory'
    when 'expense' then 'manage_expenses'
    else 'manage_finance'
  end;
  if not private.user_can_access_merchant(p_merchant_id,v_permission) then
    raise exception 'Not authorized to post this accounting source';
  end if;

  -- Operational journal types must match their real source record and exact
  -- debit/credit accounts and amounts; they cannot be used to inject journals.
  if p_source_type in ('sale','sale_cogs','purchase','expense','product_opening_stock') then
    v_operational := true;
    case p_source_type
      when 'sale' then
        select (s.qty::numeric*s.price::numeric),s.created_at::date into v_expected,v_expected_date
        from public.sales s
        where s.id=p_source_id and s.merchant_id=p_merchant_id and coalesce(s.voided,false)=false;
        v_debit_code := '1000'; v_credit_code := '4000';
      when 'sale_cogs' then
        select (s.qty::numeric*s.cost::numeric),s.created_at::date into v_expected,v_expected_date
        from public.sales s
        where s.id=p_source_id and s.merchant_id=p_merchant_id and coalesce(s.voided,false)=false;
        v_debit_code := '5000'; v_credit_code := '1200';
      when 'purchase' then
        select coalesce(p.total,p.qty*p.unit_cost),coalesce(p.purchased_at,p.created_at)::date into v_expected,v_expected_date
        from public.purchases p
        where p.id=p_source_id and p.merchant_id=p_merchant_id and p.status<>'ordered';
        v_debit_code := '1200'; v_credit_code := '2000';
      when 'expense' then
        select e.amount::numeric,e.created_at::date into v_expected,v_expected_date
        from public.expenses e
        where e.id=p_source_id and e.merchant_id=p_merchant_id;
        v_debit_code := '6000'; v_credit_code := '1000';
      when 'product_opening_stock' then
        select coalesce(p.opening_stock_value,p.opening_stock_qty::numeric*p.opening_stock_cost::numeric),p.created_at::date into v_expected,v_expected_date
        from public.products p
        where p.id=p_source_id and p.merchant_id=p_merchant_id
          and p.opening_stock_qty is not null and p.opening_stock_cost is not null;
        v_debit_code := '1200'; v_credit_code := '3000';
    end case;
    if not found or coalesce(v_expected,0)<=0 then
      raise exception 'The accounting source record is missing or has no positive value';
    end if;
    if p_entry_date is distinct from v_expected_date then
      raise exception 'Journal date does not match the source transaction date';
    end if;
    if jsonb_array_length(p_lines)<>2 then
      raise exception 'Operational journal entries must contain exactly two lines';
    end if;
  end if;

  select s.locked_through into v_lock
  from public.accounting_settings s where s.merchant_id=p_merchant_id;
  if v_lock is not null and p_entry_date<=v_lock then
    raise exception 'Accounting period is locked through %',v_lock;
  end if;

  select je.merchant_id,je.source_type,je.source_id
    into v_existing_merchant,v_existing_source_type,v_existing_source_id
  from public.journal_entries je where je.id=p_entry_id for update;
  v_entry_exists := found;
  if v_entry_exists and (
    v_existing_merchant is distinct from p_merchant_id
    or v_existing_source_type is distinct from p_source_type
    or v_existing_source_id is distinct from p_source_id
  ) then raise exception 'Journal entry ID belongs to another record'; end if;

  if p_source_type is not null and p_source_id is not null and exists (
    select 1 from public.journal_entries je
    where je.merchant_id=p_merchant_id and je.source_type=p_source_type
      and je.source_id=p_source_id and je.id<>p_entry_id
  ) then raise exception 'This source already has a journal entry'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'id','')::uuid;
    v_account := nullif(v_line->>'account_id','')::uuid;
    v_d := coalesce((v_line->>'debit')::numeric,0);
    v_c := coalesce((v_line->>'credit')::numeric,0);
    if v_line_id is null or v_account is null then
      raise exception 'Journal line identity is incomplete';
    end if;
    if v_d<0 or v_c<0 or ((v_d=0)=(v_c=0)) then
      raise exception 'Invalid journal line';
    end if;
    select a.code into v_account_code
    from public.chart_of_accounts a
    where a.id=v_account and a.merchant_id=p_merchant_id and a.active;
    if not found then raise exception 'Invalid ledger account'; end if;

    if v_operational then
      if v_d>0 and v_account_code=v_debit_code and v_d=v_expected and v_c=0 then
        v_debit_match:=v_debit_match+1;
      elsif v_c>0 and v_account_code=v_credit_code and v_c=v_expected and v_d=0 then
        v_credit_match:=v_credit_match+1;
      else
        raise exception 'Operational journal lines do not match the source transaction';
      end if;
    end if;
    v_debit:=v_debit+v_d;
    v_credit:=v_credit+v_c;
  end loop;

  if v_debit<=0 or abs(v_debit-v_credit)>0.005 then
    raise exception 'Journal entry is not balanced';
  end if;
  if v_operational and (v_debit_match<>1 or v_credit_match<>1) then
    raise exception 'Operational journal entry must match the approved debit and credit accounts';
  end if;

  if not v_entry_exists then
    insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id)
    values(p_entry_id,p_merchant_id,p_entry_date,p_description,p_source_type,p_source_id);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := (v_line->>'id')::uuid;
    v_account := (v_line->>'account_id')::uuid;
    v_d := coalesce((v_line->>'debit')::numeric,0);
    v_c := coalesce((v_line->>'credit')::numeric,0);
    if not exists(select 1 from public.journal_lines jl where jl.id=v_line_id) then
      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      values(v_line_id,p_merchant_id,p_entry_id,v_account,v_d,v_c,v_line->>'memo');
    elsif not exists(
      select 1 from public.journal_lines jl
      where jl.id=v_line_id and jl.merchant_id=p_merchant_id
        and jl.journal_entry_id=p_entry_id and jl.account_id=v_account
        and jl.debit=v_d and jl.credit=v_c
    ) then
      raise exception 'Journal line UUID belongs to another or different record';
    end if;
  end loop;
  return p_entry_id;
end;
$$;
revoke all on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) from public,anon;
grant execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) to authenticated;

-- One source record can create only one journal entry of each source type.
create unique index if not exists journal_entries_merchant_source_unique_idx
  on public.journal_entries(merchant_id,source_type,source_id)
  where source_type is not null and source_id is not null;


-- Expose accounting snapshots only to members explicitly assigned financial
-- report access; audit history remains a separate permission.
create or replace function public.shericeri_get_accounting_snapshot(p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.user_can_access_merchant(p_merchant_id,'view_financial_reports') then
    raise exception 'Not authorized to view financial reports';
  end if;
  return jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(x order by x.code) from (select * from public.chart_of_accounts where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'journalEntries',coalesce((select jsonb_agg(x order by x.entry_date desc) from (select * from public.journal_entries where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'journalLines',coalesce((select jsonb_agg(x) from (select * from public.journal_lines where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(x order by x.issue_date desc) from (select * from public.invoices where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'bills',coalesce((select jsonb_agg(x order by x.issue_date desc) from (select * from public.bills where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(x order by x.payment_date desc) from (select * from public.payments where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'bankAccounts',coalesce((select jsonb_agg(x order by x.name) from (select * from public.bank_accounts where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'taxRates',coalesce((select jsonb_agg(x order by x.name) from (select * from public.tax_rates where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'recurringTransactions',coalesce((select jsonb_agg(x order by x.next_run) from (select * from public.recurring_transactions where merchant_id=p_merchant_id) x),'[]'::jsonb),
    'accountingSettings',(select to_jsonb(x) from (select * from public.accounting_settings where merchant_id=p_merchant_id limit 1) x),
    'auditLog',case when private.user_can_access_merchant(p_merchant_id,'view_audit_log')
      then coalesce((select jsonb_agg(x order by x.created_at desc) from (select * from public.audit_log where merchant_id=p_merchant_id order by created_at desc limit 100) x),'[]'::jsonb)
      else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.shericeri_get_accounting_snapshot(uuid) from public,anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;
