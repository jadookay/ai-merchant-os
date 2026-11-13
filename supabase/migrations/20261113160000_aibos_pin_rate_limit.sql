-- PIN login throttling is keyed by both the normalized staff identity and
-- the identity/IP pair. Rotating IP addresses must not bypass account throttling.
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
  v_identifier text:=lower(trim(coalesce(p_identifier,'')));
  v_identity text;
  v_key text;
  v_ip_key text;
  v_attempt_key text;
  v_attempt_keys text[];
  v_member public.merchant_members%rowtype;
  v_count integer;
begin
  if p_merchant_id is null or length(v_identifier)<2
     or coalesce(p_pin,'') !~ '^[0-9]{6,8}$' then
    return jsonb_build_object('ok',false);
  end if;
  if v_identifier ~ '^[+0-9(). -]+$' then
    v_identifier:=regexp_replace(v_identifier,'[^0-9+]','','g');
  end if;

  select count(*) into v_count
  from public.merchant_members mm
  where mm.merchant_id=p_merchant_id and mm.status='active'
    and (
      lower(coalesce(mm.email,''))=v_identifier
      or lower(coalesce(mm.username,''))=v_identifier
      or lower(mm.full_name)=v_identifier
      or (coalesce(mm.phone,'')<>'' and
          regexp_replace(mm.phone,'[^0-9+]','','g')=v_identifier)
    );

  if v_count=1 then
    select * into v_member
    from public.merchant_members mm
    where mm.merchant_id=p_merchant_id and mm.status='active'
      and (
        lower(coalesce(mm.email,''))=v_identifier
        or lower(coalesce(mm.username,''))=v_identifier
        or lower(mm.full_name)=v_identifier
        or (coalesce(mm.phone,'')<>'' and
            regexp_replace(mm.phone,'[^0-9+]','','g')=v_identifier)
      )
    limit 1;
    v_identity:=v_member.user_id::text;
  else
    v_identity:=v_identifier;
  end if;

  v_key:=encode(extensions.digest(p_merchant_id::text||':'||v_identity,'sha256'),'hex');
  v_ip_key:=encode(extensions.digest(v_key||':'||coalesce(p_ip_hash,''),'sha256'),'hex');
  v_attempt_keys:=array[v_key,v_ip_key];

  perform 1 from public.team_login_attempts
    where attempt_key=any(v_attempt_keys) for update;
  if exists(select 1 from public.team_login_attempts
      where attempt_key=any(v_attempt_keys) and blocked_until>now()) then
    return jsonb_build_object('ok',false,'rate_limited',true);
  end if;

  if v_count<>1 or v_member.pin_hash is null
     or extensions.crypt(p_pin,v_member.pin_hash)<>v_member.pin_hash then
    foreach v_attempt_key in array v_attempt_keys loop
      insert into public.team_login_attempts(attempt_key,attempt_count,window_started_at,blocked_until)
      values(v_attempt_key,1,now(),null)
      on conflict(attempt_key) do update set
        attempt_count=case
          when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then 1
          else public.team_login_attempts.attempt_count+1 end,
        window_started_at=case
          when public.team_login_attempts.window_started_at<now()-interval '15 minutes' then now()
          else public.team_login_attempts.window_started_at end,
        blocked_until=case
          when public.team_login_attempts.attempt_count>=4 then now()+interval '15 minutes'
          else null end;
    end loop;
    return jsonb_build_object('ok',false);
  end if;

  delete from public.team_login_attempts where attempt_key=any(v_attempt_keys);
  update public.merchant_members set last_login_at=now() where id=v_member.id;
  return jsonb_build_object(
    'ok',true,'user_id',v_member.user_id,'merchant_id',v_member.merchant_id,
    'email',v_member.email,'phone',v_member.phone,'role',v_member.role
  );
end;
$$;
revoke all on function public.verify_merchant_member_pin(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.verify_merchant_member_pin(uuid,text,text,text) to service_role;
