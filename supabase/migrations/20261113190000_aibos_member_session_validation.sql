-- Lightweight server-side membership check used on resume and before outbox sync.
create or replace function public.shericeri_validate_member_session(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    exists(
      select 1 from public.merchants m
      where m.id=p_merchant_id and m.user_id=(select auth.uid())
    )
    or exists(
      select 1 from public.merchant_members mm
      where mm.merchant_id=p_merchant_id
        and mm.user_id=(select auth.uid())
        and mm.status='active'
    ),
    false
  );
$$;
revoke all on function public.shericeri_validate_member_session(uuid) from public,anon;
grant execute on function public.shericeri_validate_member_session(uuid) to authenticated;
