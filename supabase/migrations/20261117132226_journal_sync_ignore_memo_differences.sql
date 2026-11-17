CREATE OR REPLACE FUNCTION public.shericeri_sync_journal_batch(p_merchant_id uuid, p_entry_id uuid, p_entry_date date, p_description text, p_source_type text, p_source_id uuid, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line jsonb;
  v_line_id uuid;
  v_account uuid;
  v_d numeric;
  v_c numeric;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_existing_merchant uuid;
  v_existing_entry uuid;
  v_lock date;
  v_authorized boolean:=false;
  v_incoming_count integer;
  v_existing_count integer;
begin
  if p_source_type in ('sale','sale_cogs') then
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'create_sale')
      or private.user_can_access_merchant(p_merchant_id,'manage_finance');
  elsif p_source_type='expense' then
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'manage_expenses')
      or private.user_can_access_merchant(p_merchant_id,'manage_finance');
  elsif p_source_type in ('purchase','product_opening_stock','stock_gain','stock_writeoff') then
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'manage_inventory')
      or private.user_can_access_merchant(p_merchant_id,'manage_finance');
  else
    v_authorized:=private.user_can_access_merchant(p_merchant_id,'manage_finance');
  end if;
  if not v_authorized then raise exception 'Not authorized to post this accounting entry'; end if;

  if p_source_type in ('sale','sale_cogs') and not exists(
    select 1 from public.sales
    where id=p_source_id and merchant_id=p_merchant_id and coalesce(voided,false)=false
  ) then
    return p_entry_id;
  end if;

  if p_entry_id is null or p_entry_date is null or coalesce(trim(p_description),'')='' then
    raise exception 'Journal entry identity is incomplete';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then
    raise exception 'Journal batch requires at least two lines';
  end if;

  select locked_through into v_lock
  from public.accounting_settings where merchant_id=p_merchant_id;
  if v_lock is not null and p_entry_date<=v_lock then
    raise exception 'Accounting period is locked through %',v_lock;
  end if;

  -- Serialize retries for the same source so simultaneous devices cannot race the unique index.
  if p_source_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_merchant_id::text||':'||coalesce(p_source_type,'')||':'||p_source_id::text, 0
      )
    );
  end if;

  select merchant_id into v_existing_merchant
  from public.journal_entries where id=p_entry_id;
  if v_existing_merchant is not null and v_existing_merchant<>p_merchant_id then
    raise exception 'Journal entry belongs to another merchant';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id:=nullif(v_line->>'id','')::uuid;
    v_account:=nullif(v_line->>'account_id','')::uuid;
    v_d:=coalesce((v_line->>'debit')::numeric,0);
    v_c:=coalesce((v_line->>'credit')::numeric,0);
    if v_line_id is null or v_account is null then
      raise exception 'Journal line identity is incomplete';
    end if;
    if v_d<0 or v_c<0 or ((v_d=0)=(v_c=0)) then
      raise exception 'Invalid journal line';
    end if;
    if not exists(
      select 1 from public.chart_of_accounts
      where id=v_account and merchant_id=p_merchant_id and active
    ) then
      raise exception 'Invalid ledger account';
    end if;
    v_debit:=v_debit+v_d;
    v_credit:=v_credit+v_c;
  end loop;
  if v_debit<=0 or abs(v_debit-v_credit)>0.005 then
    raise exception 'Journal entry is not balanced';
  end if;

  -- A different client-generated UUID may represent the same already-posted source.
  if p_source_id is not null then
    select id into v_existing_entry
    from public.journal_entries
    where merchant_id=p_merchant_id
      and source_type=p_source_type
      and source_id=p_source_id
    limit 1;

    if v_existing_entry is not null and v_existing_entry<>p_entry_id then
      if not exists(
        select 1 from public.journal_entries
        where id=v_existing_entry and merchant_id=p_merchant_id
          and entry_date=p_entry_date and description=p_description
      ) then
        raise exception 'Accounting sync conflict: source already has a journal entry with different header details';
      end if;

      select count(*) into v_incoming_count
      from jsonb_array_elements(p_lines);
      select count(*) into v_existing_count
      from public.journal_lines
      where merchant_id=p_merchant_id and journal_entry_id=v_existing_entry;

      if v_existing_count<>v_incoming_count
        or exists(
          select 1
          from jsonb_array_elements(p_lines) incoming
          where not exists(
            select 1 from public.journal_lines existing
            where existing.merchant_id=p_merchant_id
              and existing.journal_entry_id=v_existing_entry
              and existing.account_id=(incoming->>'account_id')::uuid
              and existing.debit=coalesce((incoming->>'debit')::numeric,0)
              and existing.credit=coalesce((incoming->>'credit')::numeric,0)
              -- Memo is descriptive; only account and debit/credit values determine equality.
          )
        )
      then
        raise exception 'Accounting sync conflict: existing journal lines differ; no records were changed';
      end if;

      -- Return the queued UUID so the current client acknowledges and clears this retry.
      return p_entry_id;
    end if;
  end if;

  if v_existing_merchant is null then
    insert into public.journal_entries(id,merchant_id,entry_date,description,source_type,source_id)
    values(p_entry_id,p_merchant_id,p_entry_date,p_description,p_source_type,p_source_id);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id:=(v_line->>'id')::uuid;
    if not exists(select 1 from public.journal_lines where id=v_line_id) then
      insert into public.journal_lines(id,merchant_id,journal_entry_id,account_id,debit,credit,memo)
      values(v_line_id,p_merchant_id,p_entry_id,(v_line->>'account_id')::uuid,
        coalesce((v_line->>'debit')::numeric,0),coalesce((v_line->>'credit')::numeric,0),v_line->>'memo');
    elsif not exists(
      select 1 from public.journal_lines
      where id=v_line_id and merchant_id=p_merchant_id and journal_entry_id=p_entry_id
    ) then
      raise exception 'Journal line UUID belongs to another record';
    end if;
  end loop;
  return p_entry_id;
end;
$function$
