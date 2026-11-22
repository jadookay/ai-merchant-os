alter table public.bills add column if not exists purchase_id uuid;

create unique index if not exists bills_purchase_id_unique
  on public.bills(purchase_id)
  where purchase_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bills'::regclass
      and conname='bills_purchase_id_fkey'
  ) then
    alter table public.bills
      add constraint bills_purchase_id_fkey
      foreign key (purchase_id) references public.purchases(id)
      on delete restrict;
  end if;
end $$;

create or replace function private.validate_bill_purchase_link()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  purchase_row public.purchases%rowtype;
begin
  if new.purchase_id is null then
    return new;
  end if;

  if new.bill_type is distinct from 'inventory' then
    raise exception 'Only inventory bills can be linked to a stock purchase';
  end if;

  select * into purchase_row
  from public.purchases
  where id = new.purchase_id
    and merchant_id = new.merchant_id;

  if not found then
    raise exception 'Linked purchase was not found for this merchant';
  end if;

  if purchase_row.status is distinct from 'received' then
    raise exception 'Only received purchases can be linked to a supplier bill';
  end if;

  if purchase_row.supplier_id is null
     or new.supplier_id is distinct from purchase_row.supplier_id then
    raise exception 'Supplier bill and purchase must use the same supplier';
  end if;

  if abs(coalesce(new.total, 0) - coalesce(purchase_row.total, 0)) > 0.005 then
    raise exception 'Supplier bill total must match the linked purchase total';
  end if;

  return new;
end;
$$;

drop trigger if exists bills_validate_purchase_link on public.bills;
create trigger bills_validate_purchase_link
before insert or update of purchase_id, merchant_id, supplier_id, bill_type, total
on public.bills
for each row execute function private.validate_bill_purchase_link();