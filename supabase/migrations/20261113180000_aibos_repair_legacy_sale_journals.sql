-- Repair legacy sale/sale-COGS journals that were created without all lines.
-- Only incomplete one-line-or-zero-line postings are repaired. Any unexpected
-- line, locked period, missing sale, or missing account aborts the migration.
do $$
declare
  r record;
  v_debit_account uuid;
  v_credit_account uuid;
  v_amount numeric;
  v_line_count integer;
  v_debit numeric;
  v_credit numeric;
  v_lock date;
  v_has_debit boolean;
  v_has_credit boolean;
begin
  for r in
    select je.id as entry_id,je.merchant_id,je.entry_date,je.source_type,je.source_id,
           s.qty,s.price,s.cost
    from public.journal_entries je
    join public.sales s on s.id=je.source_id and s.merchant_id=je.merchant_id
    where je.source_type in ('sale','sale_cogs')
      and coalesce(je.voided,false)=false
    order by je.created_at,je.id
  loop
    select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
      into v_line_count,v_debit,v_credit
    from public.journal_lines
    where merchant_id=r.merchant_id and journal_entry_id=r.entry_id;

    if v_line_count>=2 then
      if abs(v_debit-v_credit)>0.005 then
        raise exception 'Refusing automatic repair of multi-line unbalanced journal entry %',r.entry_id;
      end if;
      continue;
    end if;

    select locked_through into v_lock
    from public.accounting_settings where merchant_id=r.merchant_id;
    if v_lock is not null and r.entry_date<=v_lock then
      raise exception 'Cannot repair journal entry % because its accounting period is locked through %',r.entry_id,v_lock;
    end if;

    if r.source_type='sale' then
      v_amount:=r.qty::numeric*r.price::numeric;
      select id into v_debit_account from public.chart_of_accounts
        where merchant_id=r.merchant_id and code='1000' and active;
      select id into v_credit_account from public.chart_of_accounts
        where merchant_id=r.merchant_id and code='4000' and active;
    else
      v_amount:=r.qty::numeric*r.cost::numeric;
      select id into v_debit_account from public.chart_of_accounts
        where merchant_id=r.merchant_id and code='5000' and active;
      select id into v_credit_account from public.chart_of_accounts
        where merchant_id=r.merchant_id and code='1200' and active;
    end if;

    if v_amount is null or v_amount<=0 or v_debit_account is null or v_credit_account is null then
      raise exception 'Cannot determine the expected accounts or amount for journal entry %',r.entry_id;
    end if;

    if exists(
      select 1 from public.journal_lines jl
      where jl.merchant_id=r.merchant_id and jl.journal_entry_id=r.entry_id
        and not (
          (jl.account_id=v_debit_account and jl.debit=v_amount and jl.credit=0)
          or (jl.account_id=v_credit_account and jl.debit=0 and jl.credit=v_amount)
        )
    ) then
      raise exception 'Refusing automatic repair because journal entry % contains an unexpected line',r.entry_id;
    end if;

    select exists(select 1 from public.journal_lines where merchant_id=r.merchant_id
      and journal_entry_id=r.entry_id and account_id=v_debit_account and debit=v_amount and credit=0),
      exists(select 1 from public.journal_lines where merchant_id=r.merchant_id
      and journal_entry_id=r.entry_id and account_id=v_credit_account and debit=0 and credit=v_amount)
      into v_has_debit,v_has_credit;

    if not v_has_debit then
      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      values(gen_random_uuid(),r.merchant_id,r.entry_id,v_debit_account,v_amount,0,'Automated repair: missing source debit line');
    end if;
    if not v_has_credit then
      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      values(gen_random_uuid(),r.merchant_id,r.entry_id,v_credit_account,0,v_amount,'Automated repair: missing source credit line');
    end if;

    select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
      into v_line_count,v_debit,v_credit
    from public.journal_lines
    where merchant_id=r.merchant_id and journal_entry_id=r.entry_id;
    if v_line_count<2 or abs(v_debit-v_credit)>0.005 then
      raise exception 'Journal repair did not balance entry %',r.entry_id;
    end if;
  end loop;
end;
$$;
