alter table public.bills
  drop constraint if exists bills_debit_account_id_fkey;

alter table public.bills
  add constraint bills_debit_account_merchant_fkey
  foreign key (debit_account_id, merchant_id)
  references public.chart_of_accounts(id, merchant_id)
  on delete restrict;

create or replace function private.validate_bill_debit_account()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_account public.chart_of_accounts%rowtype;
  v_code text;
begin
  if new.debit_account_id is null then
    v_code := case new.bill_type
      when 'inventory' then '1200'
      when 'operating_expense' then '6000'
      when 'service' then '6200'
      else null
    end;
    if v_code is null then
      raise exception 'Other purchase bills require an explicit debit account';
    end if;
    select id into new.debit_account_id
    from public.chart_of_accounts
    where merchant_id=new.merchant_id and code=v_code and active=true;
  end if;

  select * into v_account
  from public.chart_of_accounts
  where id=new.debit_account_id
    and merchant_id=new.merchant_id
    and active=true;

  if not found then
    raise exception 'Bill debit account must be active and belong to the same merchant';
  end if;
  if v_account.type not in ('asset','expense','cogs') or v_account.code='2110' then
    raise exception 'Bill debit account must be an asset, expense or cost-of-goods-sold account (input tax is posted separately)';
  end if;

  return new;
end;
$function$;

drop trigger if exists bills_validate_debit_account on public.bills;
create trigger bills_validate_debit_account
before insert or update of merchant_id,bill_type,debit_account_id
on public.bills
for each row execute function private.validate_bill_debit_account();

alter table public.bills
  alter column debit_account_id set not null;
