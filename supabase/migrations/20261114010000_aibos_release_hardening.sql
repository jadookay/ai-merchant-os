-- AIBOS release hardening: atomic multi-line sale sync, resilient PIN throttling,
-- and explicit least-privilege grants for privileged accounting RPCs.

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
     or coalesce(p_pin,'') !~ '^[0-9]{6,8}
    return jsonb_build_object('ok',false);
  end if;

  -- Independent identity and network keys prevent attackers rotating either
  -- usernames or source addresses to evade the 15-minute lockout.
  v_identity_key := 'identity:' || encode(extensions.digest(p_merchant_id::text||':'||v_identifier,'sha256'),'hex');
  if coalesce(p_ip_hash,'') ~ '^[0-9a-f]{64}$' then
    v_ip_key := 'ip:' || encode(extensions.digest(p_merchant_id::text||':'||p_ip_hash,'sha256'),'hex');
  end if;

  -- Materialize and lock both throttle buckets before checking them. Concurrent
  -- attempts for the same identity or IP therefore serialize on the same rows.
  insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at)
  select k,0,now()
  from unnest(array_remove(array[v_identity_key,v_ip_key],null)) as k
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
          when public.team_login_attempts.window_started_at < now()-interval '15 minutes' then now()
          else public.team_login_attempts.window_started_at
        end,
        blocked_until=case
          when (case
            when public.team_login_attempts.window_started_at < now()-interval '15 minutes' then 1
            else public.team_login_attempts.attempt_count+1
          end) >= 5 then now()+interval '15 minutes'
          else null
        end;
    end loop;
    return jsonb_build_object('ok',false);
  end if;

  delete from public.team_login_attempts
  where attempt_key = any(array_remove(array[v_identity_key,v_ip_key],null));
  update public.merchant_members set last_login_at=now() where id=v_member.id;
  return jsonb_build_object(
    'ok',true,'user_id',v_member.user_id,'merchant_id',v_member.merchant_id,
    'email',v_member.email,'phone',v_member.phone,'role',v_member.role
  );
end;
$$;
revoke all on function public.verify_merchant_member_pin(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.verify_merchant_member_pin(uuid,text,text,text) to service_role;

-- A whole invoice/cart is validated and committed in one database transaction.
-- Stock rows are locked in UUID order to avoid deadlocks when carts overlap.
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

-- Close the anonymous execution path for existing SECURITY DEFINER accounting RPCs.
revoke all on function public.shericeri_get_accounting_snapshot(uuid) from public,anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;
revoke all on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) from public,anon;
grant execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) to authenticated;
 then
    return jsonb_build_object('ok',false);
  end if;

  -- Independent identity and network keys prevent attackers rotating either
  -- usernames or source addresses to evade the 15-minute lockout.
  v_identity_key := 'identity:' || encode(extensions.digest(p_merchant_id::text||':'||v_identifier,'sha256'),'hex');
  if coalesce(p_ip_hash,'') ~ '^[0-9a-f]{64}$' then
    v_ip_key := 'ip:' || encode(extensions.digest(p_merchant_id::text||':'||p_ip_hash,'sha256'),'hex');
  end if;

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
          when public.team_login_attempts.window_started_at < now()-interval '15 minutes' then now()
          else public.team_login_attempts.window_started_at
        end,
        blocked_until=case
          when (case
            when public.team_login_attempts.window_started_at < now()-interval '15 minutes' then 1
            else public.team_login_attempts.attempt_count+1
          end) >= 5 then now()+interval '15 minutes'
          else null
        end;
    end loop;
    return jsonb_build_object('ok',false);
  end if;

  delete from public.team_login_attempts
  where attempt_key = any(array_remove(array[v_identity_key,v_ip_key],null));
  update public.merchant_members set last_login_at=now() where id=v_member.id;
  return jsonb_build_object(
    'ok',true,'user_id',v_member.user_id,'merchant_id',v_member.merchant_id,
    'email',v_member.email,'phone',v_member.phone,'role',v_member.role
  );
end;
$$;
revoke all on function public.verify_merchant_member_pin(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.verify_merchant_member_pin(uuid,text,text,text) to service_role;

-- A whole invoice/cart is validated and committed in one database transaction.
-- Stock rows are locked in UUID order to avoid deadlocks when carts overlap.
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
  if p_merchant_id is null or p_transaction_id is null
     or jsonb_typeof(p_sales)<>'array' or jsonb_array_length(p_sales)<1
     or jsonb_typeof(p_stock_changes)<>'array' or jsonb_array_length(p_stock_changes)<1 then
    raise exception 'Sale cart identity or lines are invalid';
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

-- Close the anonymous execution path for existing SECURITY DEFINER accounting RPCs.
revoke all on function public.shericeri_get_accounting_snapshot(uuid) from public,anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;
revoke all on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) from public,anon;
grant execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) to authenticated;


-- Pin trigger function search paths to the catalog schema rather than caller state.
alter function public.set_merchants_updated_at() set search_path = '';
alter function public.set_accounting_settings_updated_at() set search_path = '';
alter function public.prevent_locked_journal_entry() set search_path = '';
alter function public.prevent_locked_journal_line() set search_path = '';
