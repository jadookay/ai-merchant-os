create or replace function public.shericeri_register_device_session(
  p_merchant_id uuid,
  p_device_id text,
  p_device_name text,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  v_rows integer;
  v_is_owner boolean := false;
begin
  if v_user_id is null or v_session_id is null then
    raise exception 'A valid authenticated session is required';
  end if;
  if not exists(
    select 1 from auth.sessions a
    where a.id=v_session_id and a.user_id=v_user_id
  ) then
    return jsonb_build_object('ok',false,'revoked',true);
  end if;
  if p_merchant_id is null or coalesce(length(p_device_id),0)<16
     or coalesce(length(trim(p_device_name)),0)<2 then
    raise exception 'Device identity is incomplete';
  end if;

  select exists(
    select 1 from public.merchants m
    where m.id=p_merchant_id and m.user_id=v_user_id
  ) into v_is_owner;

  if not v_is_owner and not exists(
    select 1 from public.merchant_members mm
    where mm.merchant_id=p_merchant_id
      and mm.user_id=v_user_id
      and mm.status='active'
  ) then
    return jsonb_build_object('ok',false,'revoked',true);
  end if;

  insert into public.merchant_device_sessions(
    merchant_id,user_id,session_id,device_id,device_name,platform,created_at,last_seen_at
  ) values(
    p_merchant_id,v_user_id,v_session_id,p_device_id,left(trim(p_device_name),100),
    left(coalesce(p_platform,''),40),now(),now()
  )
  on conflict(merchant_id,session_id) do update
    set last_seen_at=now(),device_name=excluded.device_name,platform=excluded.platform
    where public.merchant_device_sessions.revoked_at is null
      and public.merchant_device_sessions.device_id=excluded.device_id;

  get diagnostics v_rows=row_count;
  if v_rows=0 then
    if exists(
      select 1 from public.merchant_device_sessions ds
      where ds.merchant_id=p_merchant_id
        and ds.session_id=v_session_id
        and ds.revoked_at is not null
    ) then
      return jsonb_build_object('ok',false,'revoked',true);
    end if;
    return jsonb_build_object('ok',false,'device_mismatch',true);
  end if;

  return jsonb_build_object('ok',true,'owner',v_is_owner,'session_id',v_session_id);
end;
$function$;

do $publication$
declare
  v_table text;
begin
  if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  foreach v_table in array array[
    'products','sales','expenses','purchases','inventory_movements',
    'journal_entries','journal_lines','chart_of_accounts','invoices','bills',
    'payments','bank_accounts','tax_rates','recurring_transactions',
    'accounting_settings','audit_log','customers','suppliers','budgets',
    'shericeri_memory','cash_entries','merchant_members','merchant_device_sessions'
  ] loop
    if not exists(
      select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I',v_table);
    end if;
  end loop;
end;
$publication$;