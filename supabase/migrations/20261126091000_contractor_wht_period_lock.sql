-- Serialize contractor WHT remittances by merchant and withholding month to prevent concurrent over-remittance.
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
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_merchant_id::text||':contractor-wht:'||p_period_start::text,0));
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

