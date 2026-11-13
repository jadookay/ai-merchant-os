-- AIBOS: commit a multi-line cart as one all-or-nothing stock and sales transaction.
create or replace function public.shericeri_sync_sale_cart(
  p_merchant_id uuid,
  p_transaction_id uuid,
  p_invoice_number text,
  p_sales jsonb,
  p_stock_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_sale jsonb;
  v_change jsonb;
  v_product_id uuid;
  v_qty integer;
  v_expected integer;
  v_local integer;
  v_current integer;
  v_sale_count integer;
  v_existing_count integer;
  v_conflicts jsonb:='[]'::jsonb;
  v_customer_id uuid;
begin
  if p_merchant_id is null or p_transaction_id is null
     or coalesce(trim(p_invoice_number),'')=''
     or jsonb_typeof(p_sales)<>'array' or jsonb_array_length(p_sales)<1
     or jsonb_typeof(p_stock_changes)<>'array' or jsonb_array_length(p_stock_changes)<1 then
    raise exception 'Cart identity, sale lines and stock changes are required';
  end if;
  if not private.user_can_access_merchant(p_merchant_id,'create_sale') then
    raise exception 'Not authorized to record sales';
  end if;

  v_sale_count:=jsonb_array_length(p_sales);
  select count(*) into v_existing_count from public.sales
    where merchant_id=p_merchant_id and transaction_id=p_transaction_id;
  if v_existing_count>0 then
    if v_existing_count=v_sale_count
       and not exists(
         select 1 from jsonb_array_elements(p_sales) s(value)
         where not exists(
           select 1 from public.sales db
           where db.id=(s.value->>'id')::uuid
             and db.merchant_id=p_merchant_id
             and db.transaction_id=p_transaction_id
             and db.invoice_number=p_invoice_number
             and coalesce(db.stock_applied,false)=true
         )
       ) then
      return jsonb_build_object('ok',true,'already_recorded',true,'stock_conflict',false);
    end if;
    raise exception 'A partial or mismatched cart transaction already exists; manual reconciliation is required';
  end if;

  -- Validate every line before locking or changing inventory.
  for v_sale in select value from jsonb_array_elements(p_sales) loop
    if nullif(v_sale->>'id','') is null
       or nullif(v_sale->>'product_id','') is null
       or (v_sale->>'merchant_id')::uuid is distinct from p_merchant_id
       or (v_sale->>'transaction_id')::uuid is distinct from p_transaction_id
       or coalesce(v_sale->>'invoice_number','')<>p_invoice_number
       or coalesce((v_sale->>'qty')::integer,0)<1
       or coalesce((v_sale->>'price')::numeric,-1)<0
       or coalesce((v_sale->>'cost')::numeric,0)<0 then
      raise exception 'A cart line has invalid identity, quantity, price or cost';
    end if;
    if exists(select 1 from public.sales where id=(v_sale->>'id')::uuid) then
      raise exception 'A cart line ID is already in use';
    end if;
    v_customer_id:=nullif(v_sale->>'customer_id','')::uuid;
    if v_customer_id is not null and not exists(
      select 1 from public.customers where id=v_customer_id and merchant_id=p_merchant_id
    ) then raise exception 'A cart customer does not belong to this business'; end if;
  end loop;

  if (select count(distinct (value->>'product_id')::uuid) from jsonb_array_elements(p_sales))
      <> jsonb_array_length(p_stock_changes) then
    raise exception 'Cart stock changes do not match the unique products in the sale';
  end if;

  -- Lock product rows in stable ID order. Validate all quantities and stock before
  -- applying any updates, so one conflict leaves every product and sale untouched.
  for v_change in
    select value from jsonb_array_elements(p_stock_changes)
    order by value->>'product_id'
  loop
    v_product_id:=nullif(v_change->>'product_id','')::uuid;
    v_qty:=coalesce((select sum((s.value->>'qty')::integer)
      from jsonb_array_elements(p_sales) s(value)
      where (s.value->>'product_id')::uuid=v_product_id),0);
    v_expected:=nullif(v_change->>'expected_server_stock','')::integer;
    v_local:=nullif(v_change->>'local_stock','')::integer;
    if v_product_id is null or v_qty<1 or v_expected is null or v_local is null
       or v_local<0 or v_local<>v_expected-v_qty then
      raise exception 'A cart stock precondition is invalid';
    end if;
    select coalesce(stock,0) into v_current from public.products
      where id=v_product_id and merchant_id=p_merchant_id and coalesce(deleted,false)=false for update;
    if not found then raise exception 'A cart product was not found for this business'; end if;
    if v_current<>v_expected then
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
        'product_id',v_product_id,'expected_server_stock',v_expected,
        'server_stock',v_current,'local_stock',v_local,'quantity',v_qty
      ));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts)>0 then
    return jsonb_build_object('ok',false,'stock_conflict',true,'conflicts',v_conflicts);
  end if;

  -- No writes occur until all stock checks have passed.
  for v_sale in select value from jsonb_array_elements(p_sales) loop
    insert into public.sales
    select (jsonb_populate_record(null::public.sales,
      v_sale||jsonb_build_object('cost',coalesce(nullif(v_sale->>'cost','')::integer,0),'stock_applied',true,'voided',false))).*;
  end loop;
  for v_change in select value from jsonb_array_elements(p_stock_changes) loop
    update public.products
      set stock=(v_change->>'local_stock')::integer
      where id=(v_change->>'product_id')::uuid and merchant_id=p_merchant_id;
  end loop;

  return jsonb_build_object('ok',true,'already_recorded',false,'stock_conflict',false,
    'transaction_id',p_transaction_id,'line_count',v_sale_count);
end;
$$;
revoke all on function public.shericeri_sync_sale_cart(uuid,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.shericeri_sync_sale_cart(uuid,uuid,text,jsonb,jsonb) to authenticated;
