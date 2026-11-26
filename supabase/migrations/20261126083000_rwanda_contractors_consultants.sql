-- Rwanda contractors and consultants: tenant-isolated records and audited accounting workflow.
create table if not exists public.contractors (
 id uuid primary key default gen_random_uuid(), merchant_id uuid not null references public.merchants(id) on delete cascade,
 contractor_code text not null, contractor_kind text not null check(contractor_kind in('individual','business')),
 legal_name text not null, trading_name text, tin text, email text, phone text,
 rssb_self_managed boolean not null default false, rssb_member_number text,
 engagement_type text not null check(engagement_type in('independent','subcontractor')),
 contract_number text not null, contract_start date not null, contract_end date, service_description text not null,
 contract_value numeric(18,2) not null default 0 check(contract_value>=0), rra_notified_on date,
 status text not null default 'active' check(status in('active','closed','suspended')),
 independent_status_confirmed boolean not null default false check(independent_status_confirmed),
 notes text, created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(merchant_id,contractor_code), unique(merchant_id,contract_number),
 check(contract_end is null or contract_end>=contract_start), check(length(trim(legal_name))>1), check(length(trim(service_description))>1)
);
create table if not exists public.contractor_invoices (
 id uuid primary key default gen_random_uuid(), merchant_id uuid not null references public.merchants(id) on delete cascade,
 contractor_id uuid not null references public.contractors(id), invoice_number text not null, invoice_date date not null, due_date date not null,
 service_description text not null, gross_amount numeric(18,2) not null check(gross_amount>0),
 withholding_rate numeric(6,5) not null default 0.15 check(withholding_rate in(0,0.15)), withholding_exemption_reason text,
 gross_settled numeric(18,2) not null default 0 check(gross_settled>=0 and gross_settled<=gross_amount),
 withholding_total numeric(18,2) not null default 0 check(withholding_total>=0),
 status text not null default 'approved' check(status in('approved','partially_paid','paid','void')),
 journal_entry_id uuid references public.journal_entries(id), created_by uuid default auth.uid(), created_at timestamptz not null default now(),
 unique(merchant_id,invoice_number), check(due_date>=invoice_date), check(withholding_total<=gross_settled),
 check(withholding_rate<>0 or length(trim(coalesce(withholding_exemption_reason,'')))>=5)
);
create table if not exists public.contractor_payments (
 id uuid primary key default gen_random_uuid(), merchant_id uuid not null references public.merchants(id) on delete cascade,
 invoice_id uuid not null references public.contractor_invoices(id), payment_date date not null,
 gross_amount numeric(18,2) not null check(gross_amount>0), withholding_amount numeric(18,2) not null default 0 check(withholding_amount>=0),
 net_amount numeric(18,2) not null check(net_amount>0), payment_method text not null check(payment_method in('bank','mobile_money','cash')),
 reference text, journal_entry_id uuid references public.journal_entries(id), idempotency_key text not null,
 recorded_by uuid default auth.uid(), created_at timestamptz not null default now(),
 unique(merchant_id,idempotency_key), check(gross_amount=withholding_amount+net_amount)
);
create table if not exists public.contractor_wht_remittances (
 id uuid primary key default gen_random_uuid(), merchant_id uuid not null references public.merchants(id) on delete cascade,
 period_start date not null, period_end date not null, payment_date date not null, amount numeric(18,2) not null check(amount>0),
 payment_method text not null check(payment_method in('bank','mobile_money','cash')), reference text,
 journal_entry_id uuid references public.journal_entries(id), idempotency_key text not null, recorded_by uuid default auth.uid(),
 created_at timestamptz not null default now(), unique(merchant_id,idempotency_key),
 check(period_start=date_trunc('month',period_start)::date),
 check(period_end=(date_trunc('month',period_start)+interval '1 month - 1 day')::date), check(payment_date>=period_end)
);
create index if not exists contractors_merchant_status_idx on public.contractors(merchant_id,status,legal_name);
create index if not exists contractor_invoices_merchant_due_idx on public.contractor_invoices(merchant_id,due_date,status);
create index if not exists contractor_payments_merchant_date_idx on public.contractor_payments(merchant_id,payment_date);
create index if not exists contractor_wht_merchant_period_idx on public.contractor_wht_remittances(merchant_id,period_start,period_end);
insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,balance_sheet_class,active)
select m.id,a.code,a.name,a.type,a.normal_balance,a.balance_sheet_class,true from public.merchants m
cross join(values ('2050','Accrued expenses payable','liability','credit','current'),('2270','Contractor withholding tax payable','liability','credit','current'),('6000','Operating expenses','expense','debit','not_applicable')) a(code,name,type,normal_balance,balance_sheet_class)
on conflict(merchant_id,code) do nothing;
alter table public.contractors enable row level security;
alter table public.contractor_invoices enable row level security;
alter table public.contractor_payments enable row level security;
alter table public.contractor_wht_remittances enable row level security;
grant select on public.contractors,public.contractor_invoices,public.contractor_payments,public.contractor_wht_remittances to authenticated;
revoke insert,update,delete on public.contractors,public.contractor_invoices,public.contractor_payments,public.contractor_wht_remittances from anon,authenticated;
drop policy if exists contractors_finance_read on public.contractors;
create policy contractors_finance_read on public.contractors for select to authenticated using(private.user_can_access_merchant(merchant_id,'manage_finance'));
drop policy if exists contractor_invoices_finance_read on public.contractor_invoices;
create policy contractor_invoices_finance_read on public.contractor_invoices for select to authenticated using(private.user_can_access_merchant(merchant_id,'manage_finance'));
drop policy if exists contractor_payments_finance_read on public.contractor_payments;
create policy contractor_payments_finance_read on public.contractor_payments for select to authenticated using(private.user_can_access_merchant(merchant_id,'manage_finance'));
drop policy if exists contractor_wht_remittances_finance_read on public.contractor_wht_remittances;
create policy contractor_wht_remittances_finance_read on public.contractor_wht_remittances for select to authenticated using(private.user_can_access_merchant(merchant_id,'manage_finance'));

CREATE OR REPLACE FUNCTION public.shericeri_record_contractor_invoice(p_merchant_id uuid, p_contractor_id uuid, p_invoice_number text, p_invoice_date date, p_due_date date, p_service_description text, p_gross_amount numeric, p_withholding_rate numeric, p_exemption_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;v_expense uuid;v_payable uuid;v_journal uuid;v_contract public.contractors%rowtype;
begin
 if auth.uid() is null or not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance permission is required to record contractor invoices'; end if;
 if p_gross_amount is null or p_gross_amount<=0 or p_invoice_date is null or p_due_date is null or p_due_date<p_invoice_date then raise exception 'Invoice amount and dates are invalid'; end if;
 if p_withholding_rate is null or p_withholding_rate not in(0,0.15) or (p_withholding_rate=0 and length(trim(coalesce(p_exemption_reason,'')))<5) then raise exception 'Use 15 percent service-fee WHT unless a documented legal exemption applies'; end if;
 if coalesce(trim(p_invoice_number),'')='' or coalesce(trim(p_service_description),'')='' then raise exception 'Invoice number and service description are required'; end if;
 select * into v_contract from public.contractors where id=p_contractor_id and merchant_id=p_merchant_id and status='active' for update;
 if not found then raise exception 'Active contractor not found for this business'; end if;
 if p_invoice_date<v_contract.contract_start or (v_contract.contract_end is not null and p_invoice_date>v_contract.contract_end) then raise exception 'Invoice date is outside the contractor agreement dates'; end if;
 if exists(select 1 from public.accounting_settings where merchant_id=p_merchant_id and locked_through>=p_invoice_date) then raise exception 'Invoice date is in a locked accounting period'; end if;
 select id into v_expense from public.chart_of_accounts where merchant_id=p_merchant_id and code='6000' and active and type='expense' and normal_balance='debit';
 select id into v_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2050' and active and type='liability' and normal_balance='credit';
 if v_expense is null or v_payable is null then raise exception 'Contractor expense or accrued payable account mapping is missing'; end if;
 v_id:=gen_random_uuid();v_journal:=gen_random_uuid();
 insert into public.contractor_invoices(id,merchant_id,contractor_id,invoice_number,invoice_date,due_date,service_description,gross_amount,withholding_rate,withholding_exemption_reason,status,created_by)
 values(v_id,p_merchant_id,p_contractor_id,trim(p_invoice_number),p_invoice_date,p_due_date,trim(p_service_description),p_gross_amount,p_withholding_rate,nullif(trim(p_exemption_reason),''),'approved',auth.uid());
 insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id,created_by)
 values(v_journal,p_merchant_id,p_invoice_date,'Contractor service invoice - '||trim(p_invoice_number),'contractor_invoice',v_id,auth.uid());
 insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
 values(p_merchant_id,v_journal,v_expense,p_gross_amount,0,'Contractor services expense'),(p_merchant_id,v_journal,v_payable,0,p_gross_amount,'Gross contractor payable before withholding');
 update public.contractor_invoices set journal_entry_id=v_journal where id=v_id;
 return v_id;
end; $function$


CREATE OR REPLACE FUNCTION public.shericeri_record_contractor_payment(p_merchant_id uuid, p_invoice_id uuid, p_payment_date date, p_gross_amount numeric, p_payment_method text, p_reference text, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_invoice public.contractor_invoices%rowtype;v_payment uuid;v_cash uuid;v_payable uuid;v_wht uuid;v_journal uuid;v_wht_amount numeric(18,2);v_net numeric(18,2);v_remaining numeric(18,2);
begin
 if auth.uid() is null or not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance permission is required to settle contractor invoices'; end if;
 if p_payment_date is null or p_gross_amount is null or p_gross_amount<=0 or coalesce(trim(p_idempotency_key),'')='' then raise exception 'Payment date, amount and idempotency key are required'; end if;
 if p_payment_method not in('bank','mobile_money','cash') then raise exception 'Unsupported contractor payment method'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_merchant_id::text||':contractor-payment:'||p_idempotency_key,0));
 select id into v_payment from public.contractor_payments where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key;
 if v_payment is not null then return v_payment; end if;
 select * into v_invoice from public.contractor_invoices where id=p_invoice_id and merchant_id=p_merchant_id and status in('approved','partially_paid') for update;
 if not found or v_invoice.journal_entry_id is null or not exists(select 1 from public.journal_entries where id=v_invoice.journal_entry_id and merchant_id=p_merchant_id and voided=false) then raise exception 'A valid posted contractor invoice is required before payment'; end if;
 v_remaining:=round(v_invoice.gross_amount-v_invoice.gross_settled,2);
 if p_gross_amount>v_remaining then raise exception 'Settlement exceeds remaining gross invoice balance'; end if;
 if exists(select 1 from public.accounting_settings where merchant_id=p_merchant_id and locked_through>=p_payment_date) then raise exception 'Payment date is in a locked accounting period'; end if;
 v_wht_amount:=round(p_gross_amount*v_invoice.withholding_rate,2);v_net:=round(p_gross_amount-v_wht_amount,2);
 if v_net<=0 then raise exception 'Net contractor payment must be greater than zero'; end if;
 select id into v_cash from public.chart_of_accounts where merchant_id=p_merchant_id and code=case p_payment_method when 'bank' then '1010' when 'mobile_money' then '1020' else '1000' end and active and type='asset' and normal_balance='debit';
 select id into v_payable from public.chart_of_accounts where merchant_id=p_merchant_id and code='2050' and active and type='liability' and normal_balance='credit';
 select id into v_wht from public.chart_of_accounts where merchant_id=p_merchant_id and code='2270' and active and type='liability' and normal_balance='credit';
 if v_cash is null or v_payable is null or v_wht is null then raise exception 'Contractor payment account mapping is incomplete'; end if;
 v_payment:=gen_random_uuid();v_journal:=gen_random_uuid();
 insert into public.contractor_payments(id,merchant_id,invoice_id,payment_date,gross_amount,withholding_amount,net_amount,payment_method,reference,journal_entry_id,idempotency_key,recorded_by)
 values(v_payment,p_merchant_id,p_invoice_id,p_payment_date,p_gross_amount,v_wht_amount,v_net,p_payment_method,nullif(trim(p_reference),''),v_journal,p_idempotency_key,auth.uid());
 insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id,created_by)
 values(v_journal,p_merchant_id,p_payment_date,'Contractor invoice settlement - '||v_invoice.invoice_number,'contractor_payment',v_payment,auth.uid());
 insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
 values(p_merchant_id,v_journal,v_payable,p_gross_amount,0,'Clear gross contractor payable'),(p_merchant_id,v_journal,v_cash,0,v_net,'Net contractor payment');
 if v_wht_amount>0 then insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo) values(p_merchant_id,v_journal,v_wht,0,v_wht_amount,'Contractor withholding tax payable'); end if;
 update public.contractor_invoices set gross_settled=gross_settled+p_gross_amount,withholding_total=withholding_total+v_wht_amount,status=case when gross_settled+p_gross_amount>=gross_amount then 'paid' else 'partially_paid' end where id=p_invoice_id and merchant_id=p_merchant_id;
 return v_payment;
end; $function$


CREATE OR REPLACE FUNCTION public.shericeri_record_contractor_wht_remittance(p_merchant_id uuid, p_period_start date, p_period_end date, p_payment_date date, p_amount numeric, p_payment_method text, p_reference text, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_due numeric(18,2);v_paid numeric(18,2);v_cash uuid;v_wht uuid;v_id uuid;v_journal uuid;
begin
 if auth.uid() is null or not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance permission is required to remit withholding tax'; end if;
 if p_period_start is null or p_period_end is null or p_payment_date is null or p_period_end<>(date_trunc('month',p_period_start)+interval '1 month - 1 day')::date or p_period_start<>date_trunc('month',p_period_start)::date then raise exception 'Choose one complete withholding-tax month'; end if;
 if p_payment_date<p_period_end or p_amount is null or p_amount<=0 or coalesce(trim(p_idempotency_key),'')='' then raise exception 'Remittance amount, date and idempotency key are required'; end if;
 if p_payment_method not in('bank','mobile_money','cash') then raise exception 'Unsupported remittance payment method'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_merchant_id::text||':contractor-wht:'||p_period_start::text||':'||p_idempotency_key,0));
 select id into v_id from public.contractor_wht_remittances where merchant_id=p_merchant_id and idempotency_key=p_idempotency_key;
 if v_id is not null then return v_id; end if;
 select coalesce(sum(withholding_amount),0) into v_due from public.contractor_payments where merchant_id=p_merchant_id and payment_date between p_period_start and p_period_end;
 select coalesce(sum(amount),0) into v_paid from public.contractor_wht_remittances where merchant_id=p_merchant_id and period_start=p_period_start and period_end=p_period_end;
 if p_amount>round(v_due-v_paid,2) then raise exception 'Remittance exceeds contractor WHT due for this month'; end if;
 if exists(select 1 from public.accounting_settings where merchant_id=p_merchant_id and locked_through>=p_payment_date) then raise exception 'Remittance date is in a locked accounting period'; end if;
 select id into v_cash from public.chart_of_accounts where merchant_id=p_merchant_id and code=case p_payment_method when 'bank' then '1010' when 'mobile_money' then '1020' else '1000' end and active and type='asset' and normal_balance='debit';
 select id into v_wht from public.chart_of_accounts where merchant_id=p_merchant_id and code='2270' and active and type='liability' and normal_balance='credit';
 if v_cash is null or v_wht is null then raise exception 'Contractor WHT account mapping is incomplete'; end if;
 v_id:=gen_random_uuid();v_journal:=gen_random_uuid();
 insert into public.contractor_wht_remittances(id,merchant_id,period_start,period_end,payment_date,amount,payment_method,reference,journal_entry_id,idempotency_key,recorded_by)
 values(v_id,p_merchant_id,p_period_start,p_period_end,p_payment_date,p_amount,p_payment_method,nullif(trim(p_reference),''),v_journal,p_idempotency_key,auth.uid());
 insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id,created_by)
 values(v_journal,p_merchant_id,p_payment_date,'Contractor WHT remittance - '||to_char(p_period_start,'YYYY-MM'),'contractor_wht_remittance',v_id,auth.uid());
 insert into public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo)
 values(p_merchant_id,v_journal,v_wht,p_amount,0,'Clear contractor withholding-tax payable'),(p_merchant_id,v_journal,v_cash,0,p_amount,'RRA withholding-tax remittance');
 return v_id;
end; $function$


CREATE OR REPLACE FUNCTION public.shericeri_register_contractor(p_merchant_id uuid, p_contractor_code text, p_contractor_kind text, p_legal_name text, p_trading_name text, p_tin text, p_email text, p_phone text, p_rssb_self_managed boolean, p_rssb_member_number text, p_engagement_type text, p_contract_number text, p_contract_start date, p_contract_end date, p_service_description text, p_contract_value numeric, p_rra_notified_on date, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if auth.uid() is null or not private.user_can_access_merchant(p_merchant_id,'manage_finance') then raise exception 'Finance permission is required to manage contractors'; end if;
 if coalesce(trim(p_contractor_code),'')='' or coalesce(trim(p_legal_name),'')='' or coalesce(trim(p_contract_number),'')='' or coalesce(trim(p_service_description),'')='' then raise exception 'Contractor code, legal name, contract number and service description are required'; end if;
 if p_contract_start is null or (p_contract_end is not null and p_contract_end<p_contract_start) then raise exception 'Contract dates are invalid'; end if;
 if p_contractor_kind not in('individual','business') or p_engagement_type not in('independent','subcontractor') then raise exception 'Contractor classification is invalid'; end if;
 if p_contract_value is null or p_contract_value<0 then raise exception 'Contract value cannot be negative'; end if;
 if p_engagement_type='subcontractor' and p_rra_notified_on is not null and p_rra_notified_on<p_contract_start then raise exception 'RRA notification date cannot precede subcontract commencement'; end if;
 insert into public.chart_of_accounts(merchant_id,code,name,type,normal_balance,balance_sheet_class,active) values
 (p_merchant_id,'2050','Accrued expenses payable','liability','credit','current',true),
 (p_merchant_id,'2270','Contractor withholding tax payable','liability','credit','current',true),
 (p_merchant_id,'6000','Operating expenses','expense','debit','not_applicable',true) on conflict(merchant_id,code) do nothing;
 insert into public.contractors(merchant_id,contractor_code,contractor_kind,legal_name,trading_name,tin,email,phone,rssb_self_managed,rssb_member_number,engagement_type,contract_number,contract_start,contract_end,service_description,contract_value,rra_notified_on,independent_status_confirmed,notes,created_by)
 values(p_merchant_id,trim(p_contractor_code),p_contractor_kind,trim(p_legal_name),nullif(trim(p_trading_name),''),nullif(trim(p_tin),''),nullif(trim(p_email),''),nullif(trim(p_phone),''),coalesce(p_rssb_self_managed,false),nullif(trim(p_rssb_member_number),''),p_engagement_type,trim(p_contract_number),p_contract_start,p_contract_end,trim(p_service_description),p_contract_value,p_rra_notified_on,true,nullif(trim(p_notes),''),auth.uid()) returning id into v_id;
 return v_id;
end; $function$


revoke all on function public.shericeri_register_contractor(uuid,text,text,text,text,text,text,text,boolean,text,text,text,date,date,text,numeric,date,text) from public,anon,authenticated;
revoke all on function public.shericeri_record_contractor_invoice(uuid,uuid,text,date,date,text,numeric,numeric,text) from public,anon,authenticated;
revoke all on function public.shericeri_record_contractor_payment(uuid,uuid,date,numeric,text,text,text) from public,anon,authenticated;
revoke all on function public.shericeri_record_contractor_wht_remittance(uuid,date,date,date,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.shericeri_register_contractor(uuid,text,text,text,text,text,text,text,boolean,text,text,text,date,date,text,numeric,date,text) to authenticated;
grant execute on function public.shericeri_record_contractor_invoice(uuid,uuid,text,date,date,text,numeric,numeric,text) to authenticated;
grant execute on function public.shericeri_record_contractor_payment(uuid,uuid,date,numeric,text,text,text) to authenticated;
grant execute on function public.shericeri_record_contractor_wht_remittance(uuid,date,date,date,numeric,text,text,text) to authenticated;
