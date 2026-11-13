-- AIBOS release blocker fixes: separate operational writes from team administration.
-- Destructive deletes and voids remain manager/admin-only; ordinary updates use the
-- relevant operational permission without requiring manage_team.
do $$
declare t record; write_perm text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema='public' and column_name='merchant_id'
      and table_name in (
        'products','expenses','customers','suppliers','purchases','cash_entries',
        'budgets','chart_of_accounts','invoices','bills','payments','bank_accounts',
        'tax_rates','recurring_transactions','accounting_settings','shericeri_memory'
      )
  loop
    write_perm:=case
      when t.table_name='products' then 'manage_inventory'
      when t.table_name='expenses' then 'manage_expenses'
      when t.table_name='customers' then 'manage_customers'
      when t.table_name='suppliers' then 'manage_suppliers'
      when t.table_name='purchases' then 'manage_inventory'
      else 'manage_finance'
    end;
    -- UPDATE also needs a SELECT policy. Allow the assigned operator to see
    -- the rows they are authorized to maintain, without granting report access.
    execute format('drop policy if exists %I on public.%I',t.table_name||'_team_select',t.table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.user_can_access_merchant(merchant_id,%L) or private.user_can_access_merchant(merchant_id,%L))',
      t.table_name||'_team_select',t.table_name,
      case t.table_name
        when 'products' then 'view_inventory' when 'expenses' then 'view_expenses'
        when 'customers' then 'view_customers' when 'suppliers' then 'view_suppliers'
        when 'purchases' then 'view_inventory' else 'view_financial_reports' end,
      write_perm
    );
    execute format('drop policy if exists %I on public.%I',t.table_name||'_team_update',t.table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.user_can_access_merchant(merchant_id,%L)) with check (private.user_can_access_merchant(merchant_id,%L))',
      t.table_name||'_team_update',t.table_name,write_perm,write_perm
    );
  end loop;
end $;

-- Shericeri memory is business context. Allow staff with finance-management
-- responsibility to add memories; ordinary staff still cannot read it by default.
drop policy if exists shericeri_memory_team_insert on public.shericeri_memory;
create policy shericeri_memory_team_insert on public.shericeri_memory
  for insert to authenticated
  with check (private.user_can_access_merchant(merchant_id,'manage_finance'));

-- A user may record the audit event for an allowed operational update. Deletes and
-- voids still require manager/admin authority (manage_team is role-gated).
create or replace function public.shericeri_write_audit(
  p_merchant_id uuid,
  p_audit_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_permission text;
  v_manager_action boolean:=p_action in ('delete','void');
  v_actor_name text;
begin
  if p_merchant_id is null or p_audit_id is null
     or coalesce(trim(p_action),'')='' or coalesce(trim(p_entity_type),'')='' then
    raise exception 'Audit event identity is incomplete';
  end if;
  if p_action in ('update','edit','delete','void') and coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A clear reason is required for this change';
  end if;
  v_permission:=case p_entity_type
    when 'sale' then case when p_action='create' then 'create_sale' else 'manage_sales' end
    when 'expense' then 'manage_expenses'
    when 'product' then 'manage_inventory'
    when 'purchase' then 'manage_inventory'
    when 'customer' then 'manage_customers'
    when 'supplier' then 'manage_suppliers'
    when 'cash_entry' then 'manage_finance'
    when 'budget' then 'manage_finance'
    when 'adjustment' then 'manage_inventory'
    else 'manage_finance'
  end;
  if not private.user_can_access_merchant(p_merchant_id,v_permission)
     or (v_manager_action and not private.user_can_access_merchant(p_merchant_id,'manage_team')) then
    raise exception 'Not authorized to write this audit event';
  end if;
  select case when m.user_id=(select auth.uid()) then 'Owner'
    else coalesce((select mm.full_name from public.merchant_members mm
      where mm.merchant_id=p_merchant_id and mm.user_id=(select auth.uid())
        and mm.status='active' limit 1),'Staff') end
    into v_actor_name
  from public.merchants m where m.id=p_merchant_id;
  if not found then raise exception 'Business account not found'; end if;
  insert into public.audit_log(id,merchant_id,actor_user_id,action,entity_type,entity_id,reason,details,created_at)
  values(p_audit_id,p_merchant_id,auth.uid(),p_action,p_entity_type,p_entity_id,
    nullif(trim(p_reason),''),coalesce(p_details,'{}'::jsonb)-'actor_name'
      ||jsonb_build_object('actor_name',coalesce(v_actor_name,'Staff')),now())
  on conflict(id) do nothing;
  return p_audit_id;
end;
$$;
revoke all on function public.shericeri_write_audit(uuid,uuid,text,text,uuid,text,jsonb) from public,anon;
grant execute on function public.shericeri_write_audit(uuid,uuid,text,text,uuid,text,jsonb) to authenticated;

-- A finance permission alone must never authorize sale voiding. The permission
-- helper grants manage_sales only to manager/admin memberships (and the owner).
create or replace function public.shericeri_void_sale(
  p_merchant_id uuid,
  p_sale_id uuid,
  p_transaction_id uuid,
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
  v_original record;
  v_reversal_id uuid;
begin
  if p_sale_id is null or coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A clear void reason is required';
  end if;
  v_merchant_id:=coalesce(p_merchant_id,(select merchant_id from public.sales where id=p_sale_id));
  if v_merchant_id is null then return jsonb_build_object('ok',true,'already_voided',true,'not_found',true); end if;
  if not private.user_can_access_merchant(v_merchant_id,'manage_sales') then
    raise exception 'Only the owner, administrator or manager may void a sale';
  end if;
  perform 1 from public.sales
   where merchant_id=v_merchant_id
     and (id=p_sale_id or (p_transaction_id is not null and transaction_id=p_transaction_id))
   for update;
  select coalesce(transaction_id,p_transaction_id),invoice_number,created_at::date
    into v_transaction_id,v_invoice_number,v_sale_date
  from public.sales
  where merchant_id=v_merchant_id
    and (id=p_sale_id or (p_transaction_id is not null and transaction_id=p_transaction_id))
  order by case when id=p_sale_id then 0 else 1 end
  limit 1;
  if not found then return jsonb_build_object('ok',true,'already_voided',true,'not_found',true); end if;
  if not exists(select 1 from public.sales where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and coalesce(voided,false)=false) then
    return jsonb_build_object('ok',true,'already_voided',true,'not_found',false);
  end if;
  select locked_through into v_lock from public.accounting_settings where merchant_id=v_merchant_id;
  if v_lock is not null and (v_sale_date<=v_lock or current_date<=v_lock) then
    raise exception 'The sale or current accounting period is locked';
  end if;
  select coalesce(sum(qty*price),0),count(*),coalesce(jsonb_agg(id),'[]'::jsonb)
    into v_amount,v_line_count,v_sale_ids
  from public.sales
  where merchant_id=v_merchant_id
    and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
    and coalesce(voided,false)=false;

  update public.products p set stock=p.stock+x.qty
  from (
    select product_id,sum(qty)::integer as qty
    from public.sales
    where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and product_id is not null and stock_applied=true and coalesce(voided,false)=false
    group by product_id
  ) x
  where p.id=x.product_id and p.merchant_id=v_merchant_id;

  if exists(
    select 1 from public.journal_entries je
    left join public.journal_lines jl on jl.journal_entry_id=je.id and jl.merchant_id=je.merchant_id
    where je.merchant_id=v_merchant_id and je.source_type in ('sale','sale_cogs')
      and je.source_id in (
        select s.id from public.sales s where s.merchant_id=v_merchant_id
          and (s.id=p_sale_id or (v_transaction_id is not null and s.transaction_id=v_transaction_id))
      )
      and coalesce(je.voided,false)=false
    group by je.id
    having count(jl.id)<2 or abs(coalesce(sum(jl.debit),0)-coalesce(sum(jl.credit),0))>0.005
  ) then
    raise exception 'Sale journal is incomplete or unbalanced; reconcile it before voiding the sale';
  end if;

  for v_original in
    select je.id,je.entry_date,je.description
    from public.journal_entries je
    where je.merchant_id=v_merchant_id and je.source_type in ('sale','sale_cogs')
      and je.source_id in (
        select s.id from public.sales s where s.merchant_id=v_merchant_id
          and (s.id=p_sale_id or (v_transaction_id is not null and s.transaction_id=v_transaction_id))
      )
      and coalesce(je.voided,false)=false
    for update
  loop
    if not exists(select 1 from public.journal_entries
       where merchant_id=v_merchant_id and source_type='sale_void' and source_id=v_original.id) then
      v_reversal_id:=gen_random_uuid();
      insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id)
      values(v_reversal_id,v_merchant_id,current_date,'Reversal: '||v_original.description,'sale_void',v_original.id);
      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      select gen_random_uuid(),jl.merchant_id,v_reversal_id,jl.account_id,jl.credit,jl.debit,
             coalesce(jl.memo,'')||' (void reversal)'
      from public.journal_lines jl
      where jl.merchant_id=v_merchant_id and jl.journal_entry_id=v_original.id;
    end if;
    update public.journal_entries
      set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid()
      where id=v_original.id and merchant_id=v_merchant_id;
  end loop;

  update public.sales
    set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid(),stock_applied=false
    where merchant_id=v_merchant_id
      and (id=p_sale_id or (v_transaction_id is not null and transaction_id=v_transaction_id))
      and coalesce(voided,false)=false;

  insert into public.audit_log(id,merchant_id,actor_user_id,action,entity_type,entity_id,reason,details,created_at)
  values(p_audit_id,v_merchant_id,auth.uid(),'void','sale',p_sale_id,trim(p_reason),
    jsonb_build_object('reason',trim(p_reason),'invoice_number',v_invoice_number,'transaction_id',v_transaction_id,
      'amount',v_amount,'line_count',v_line_count,'sale_ids',v_sale_ids,
      'actor_name',case when exists(select 1 from public.merchants where id=v_merchant_id and user_id=auth.uid())
        then 'Owner' else coalesce((select full_name from public.merchant_members where merchant_id=v_merchant_id and user_id=auth.uid() and status='active' limit 1),'Staff') end),now())
  on conflict(id) do nothing;
  return jsonb_build_object('ok',true,'not_found',false,'invoice_number',v_invoice_number,'transaction_id',v_transaction_id,
    'amount',v_amount,'line_count',v_line_count,'sale_ids',v_sale_ids);
end;
$$;
revoke all on function public.shericeri_void_sale(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.shericeri_void_sale(uuid,uuid,uuid,text,uuid) to authenticated;

-- These RPCs expose privileged accounting data or mutate the ledger under a
-- SECURITY DEFINER context. Remove inherited PUBLIC/anon execute grants.
revoke execute on function public.shericeri_get_accounting_snapshot(uuid) from public,anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;
revoke execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) from public,anon;
grant execute on function public.shericeri_sync_journal_batch(uuid,uuid,date,text,text,uuid,jsonb) to authenticated;


-- Trigger functions below use fully-qualified public table names (or built-ins only),
-- so an empty search_path is safe and removes mutable-search-path warnings.
alter function public.set_merchants_updated_at() set search_path='';
alter function public.set_accounting_settings_updated_at() set search_path='';
alter function public.prevent_locked_journal_entry() set search_path='';
alter function public.prevent_locked_journal_line() set search_path='';
