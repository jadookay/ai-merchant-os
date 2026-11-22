-- Accounting integrity guards: opening-stock migration traceability and exact purchase receipts.
-- Existing historical rows are intentionally not rewritten by this migration.

create or replace function private.assert_aibos_purchase_receipt(p_merchant_id uuid, p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_product_id uuid;
  v_status text;
  v_stock_applied boolean;
  v_purchase_qty numeric;
  v_purchase_unit_cost numeric;
  v_receipt_count integer;
  v_receipt_qty numeric;
  v_receipt_value numeric;
  v_wrong_product boolean;
begin
  select p.product_id,p.status,p.stock_applied,p.qty,p.unit_cost
    into v_product_id,v_status,v_stock_applied,v_purchase_qty,v_purchase_unit_cost
  from public.purchases p
  where p.merchant_id=p_merchant_id and p.id=p_purchase_id;

  if not found then
    if exists (
      select 1 from public.inventory_movements m
      where m.merchant_id=p_merchant_id
        and m.source_id=p_purchase_id
        and m.movement_type='purchase_receipt'
    ) then
      raise exception 'AIBOS integrity: purchase receipt movement % has no matching purchase',p_purchase_id;
    end if;
    return;
  end if;

  select count(*)::integer,
         coalesce(bool_or(m.product_id is distinct from v_product_id),false),
         coalesce(sum(m.quantity_delta),0),
         coalesce(sum(m.quantity_delta*m.unit_cost),0)
    into v_receipt_count,v_wrong_product,v_receipt_qty,v_receipt_value
  from public.inventory_movements m
  where m.merchant_id=p_merchant_id
    and m.source_id=p_purchase_id
    and m.movement_type='purchase_receipt';

  if v_wrong_product then
    raise exception 'AIBOS integrity: purchase receipt % references a different product',p_purchase_id;
  end if;

  if v_stock_applied then
    if v_status<>'received' or v_receipt_count<>1 then
      raise exception 'AIBOS integrity: stock-applied purchase % must be received and have exactly one receipt movement',p_purchase_id;
    end if;
    if abs(v_receipt_qty-v_purchase_qty)>0.0001 then
      raise exception 'AIBOS integrity: purchase % quantity (%) does not equal receipt movement quantity (%)',
        p_purchase_id,v_purchase_qty,v_receipt_qty;
    end if;
    if abs(v_receipt_value-(v_purchase_qty*v_purchase_unit_cost))>0.005 then
      raise exception 'AIBOS integrity: purchase % receipt value (%) does not equal purchase quantity x unit cost (%)',
        p_purchase_id,v_receipt_value,(v_purchase_qty*v_purchase_unit_cost);
    end if;
  elsif v_receipt_count>0 then
    raise exception 'AIBOS integrity: purchase % has a receipt movement but stock_applied is false',p_purchase_id;
  end if;
end;
$function$;

-- Once received, a purchase is an accounting source document. Correct it with
-- a return/adjustment transaction rather than rewriting its historical values.
create or replace function private.guard_aibos_received_purchase_immutable()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.status='received' and (
    new.product_id is distinct from old.product_id
    or new.supplier_id is distinct from old.supplier_id
    or new.qty is distinct from old.qty
    or new.unit_cost is distinct from old.unit_cost
    or new.total is distinct from old.total
  ) then
    raise exception 'AIBOS integrity: received purchase values are immutable; record a supplier return or adjustment instead';
  end if;
  return new;
end;
$function$;

drop trigger if exists aibos_received_purchase_immutable on public.purchases;
create trigger aibos_received_purchase_immutable
before update on public.purchases
for each row execute function private.guard_aibos_received_purchase_immutable();

-- New opening inventory must be traceable to individual product journals.
-- The legacy aggregate journal remains untouched; new untraceable aggregate
-- migration entries are rejected. Use private.ensure_aibos_opening_stock_journal
-- for each product so Dr Inventory / Cr Owner Equity matches its movement value.
create or replace function private.reject_untraceable_inventory_migration_journal()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.source_type='inventory_migration_reconciliation' then
    raise exception 'AIBOS integrity: aggregate inventory migration journals are disabled; post one source-linked opening-stock journal per product';
  end if;
  return new;
end;
$function$;

drop trigger if exists aibos_reject_aggregate_inventory_migration_journal on public.journal_entries;
create trigger aibos_reject_aggregate_inventory_migration_journal
before insert on public.journal_entries
for each row execute function private.reject_untraceable_inventory_migration_journal();

revoke all on function private.guard_aibos_received_purchase_immutable() from public,anon,authenticated;
revoke all on function private.reject_untraceable_inventory_migration_journal() from public,anon,authenticated;
