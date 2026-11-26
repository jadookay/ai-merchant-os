create or replace function public.shericeri_mark_contractor_rra_notified(p_merchant_id uuid,p_contractor_id uuid,p_notified_on date)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_start date;v_type text;
begin
 if auth.uid() is null or not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance permission is required to update RRA subcontract notification'; end if;
 if p_notified_on is null or p_notified_on>current_date then raise exception 'Enter the actual RRA notification date'; end if;
 select id,contract_start,engagement_type into v_id,v_start,v_type from public.contractors where id=p_contractor_id and merchant_id=p_merchant_id for update;
 if v_id is null or v_type<>'subcontractor' then raise exception 'Subcontractor record not found'; end if;
 if p_notified_on<v_start then raise exception 'RRA notification date cannot precede subcontract commencement'; end if;
 update public.contractors set rra_notified_on=p_notified_on,updated_at=now() where id=v_id and merchant_id=p_merchant_id;
 return v_id;
end; $$;
revoke all on function public.shericeri_mark_contractor_rra_notified(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.shericeri_mark_contractor_rra_notified(uuid,uuid,date) to authenticated;