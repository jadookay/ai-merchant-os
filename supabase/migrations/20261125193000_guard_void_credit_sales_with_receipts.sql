-- Prevent credit-sale voids from leaving collected customer receipts unreconciled.
create or replace function private.aibos_guard_credit_sale_void()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(new.voided,false) and not coalesce(old.voided,false)
     and new.transaction_id is not null
     and exists (
       select 1 from public.payments p
        where p.merchant_id=new.merchant_id
          and p.source_type='sale_invoice'
          and p.source_id=new.transaction_id
          and p.direction='receipt'
          and p.amount>0
     ) then
    raise exception 'This credit invoice has collected customer payments. Refund or reverse those receipts before voiding the sale.';
  end if;
  return new;
end;
$function$;

drop trigger if exists aibos_guard_credit_sale_void on public.sales;
create trigger aibos_guard_credit_sale_void
before update of voided on public.sales
for each row execute function private.aibos_guard_credit_sale_void();
