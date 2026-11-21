-- Expense payment workflow: accrue expenses first, then settle the payable without
-- recording a second expense. This migration is preview-safe and contains no
-- business-record data movement.

insert into public.chart_of_accounts
  (merchant_id, code, name, type, normal_balance, balance_sheet_class, active)
select m.id, '2050', 'Accrued expenses payable', 'liability', 'credit', 'current', true
from public.merchants m
on conflict (merchant_id, code) do nothing;

create or replace function public.shericeri_ensure_operational_accounts(p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not (
    private.user_can_access_merchant(p_merchant_id,'create_sale')
    or private.user_can_access_merchant(p_merchant_id,'manage_expenses')
    or private.user_can_access_merchant(p_merchant_id,'manage_inventory')
    or private.user_can_access_merchant(p_merchant_id,'manage_finance')
    or private.user_can_access_merchant(p_merchant_id,'view_financial_reports')
  ) then
    raise exception 'Not authorized to initialize operational accounting accounts';
  end if;

  insert into public.chart_of_accounts
    (merchant_id,code,name,type,normal_balance,balance_sheet_class,active)
  values
    (p_merchant_id,'1000','Cash on hand','asset','debit','current',true),
    (p_merchant_id,'1010','Bank accounts','asset','debit','current',true),
    (p_merchant_id,'1020','Mobile money','asset','debit','current',true),
    (p_merchant_id,'1100','Accounts receivable','asset','debit','current',true),
    (p_merchant_id,'1200','Inventory','asset','debit','current',true),
    (p_merchant_id,'2000','Accounts payable','liability','credit','current',true),
    (p_merchant_id,'2050','Accrued expenses payable','liability','credit','current',true),
    (p_merchant_id,'2100','Tax payable','liability','credit','current',true),
    (p_merchant_id,'2110','Input tax receivable','asset','debit','current',true),
    (p_merchant_id,'2200','Other liabilities','liability','credit',null,true),
    (p_merchant_id,'3000','Owner equity','equity','credit','not_applicable',true),
    (p_merchant_id,'3100','Owner drawings','equity','debit','not_applicable',true),
    (p_merchant_id,'4000','Sales revenue','income','credit','not_applicable',true),
    (p_merchant_id,'4050','Sales returns & discounts','income','debit','not_applicable',true),
    (p_merchant_id,'4100','Other income','income','credit','not_applicable',true),
    (p_merchant_id,'5000','Cost of goods sold','cogs','debit','not_applicable',true),
    (p_merchant_id,'6000','Operating expenses','expense','debit','not_applicable',true),
    (p_merchant_id,'6100','Tax expense','expense','debit','not_applicable',true)
  on conflict (merchant_id,code) do nothing;

  return jsonb_build_object(
    'accounts',
    coalesce((
      select jsonb_agg(x order by x.code)
      from (
        select id,merchant_id,code,name,type,normal_balance,balance_sheet_class,active,created_at
        from public.chart_of_accounts
        where merchant_id=p_merchant_id
      ) x
    ),'[]'::jsonb)
  );
end;
$function$;
