-- AIBOS MVP: make sale creation audit atomic with the sale, stock and ledger transaction.
-- Additive trigger only. Existing financial posting triggers and account mappings are unchanged.
create or replace function private.audit_sale_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
begin
  select case
    when m.user_id = auth.uid() then 'Owner'
    else coalesce(mm.full_name, 'Staff')
  end
  into v_actor_name
  from public.merchants m
  left join public.merchant_members mm
    on mm.merchant_id = m.id
   and mm.user_id = auth.uid()
   and mm.status = 'active'
  where m.id = new.merchant_id;

  insert into public.audit_log (
    id, merchant_id, actor_user_id, action, entity_type, entity_id,
    reason, details, created_at
  )
  values (
    gen_random_uuid(), new.merchant_id, auth.uid(), 'create', 'sale', new.id,
    null,
    jsonb_build_object(
      'sale_id', new.id,
      'transaction_id', new.transaction_id,
      'invoice_number', new.invoice_number,
      'product_id', new.product_id,
      'product_name', new.product_name_snapshot,
      'quantity', new.qty,
      'unit_price', new.price,
      'unit_cost', new.cost,
      'line_total', new.qty::numeric * new.price::numeric,
      'stock_applied', new.stock_applied,
      'actor_name', coalesce(v_actor_name, 'Staff')
    ),
    coalesce(new.created_at, now())
  );

  return new;
end;
$$;

revoke all on function private.audit_sale_after_insert() from public, anon, authenticated;

drop trigger if exists sales_record_create_audit_after_insert on public.sales;
create trigger sales_record_create_audit_after_insert
after insert on public.sales
for each row
execute function private.audit_sale_after_insert();
