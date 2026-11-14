do $policies$
begin
  if not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='merchant_device_sessions' and policyname='merchant_device_sessions_team_select') then
    create policy merchant_device_sessions_team_select
      on public.merchant_device_sessions
      for select to authenticated
      using (private.user_can_access_merchant(merchant_id,'manage_team'));
  end if;
  if not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='inventory_movements' and policyname='inventory_movements_cost_view_select') then
    create policy inventory_movements_cost_view_select
      on public.inventory_movements
      for select to authenticated
      using (private.user_can_access_merchant(merchant_id,'view_inventory_costs'));
  end if;
end;
$policies$;