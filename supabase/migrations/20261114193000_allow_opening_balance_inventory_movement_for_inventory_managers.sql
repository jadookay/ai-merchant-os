create or replace function public.shericeri_adjust_product_stock(
  p_merchant_id uuid,
  p_product_id uuid,
  p_expected_stock integer,
  p_quantity_delta integer,
  p_reason text,
  p_movement_type text default 'adjustment',
  p_source_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.products%rowtype;
  v_next integer;
begin
  if not private.user_can_access_merchant(p_merchant_id,'manage_inventory') then
    raise exception 'Not authorized to adjust inventory';
  end if;
  if p_product_id is null or p_expected_stock is null or p_quantity_delta is null
     or p_quantity_delta=0 or coalesce(length(trim(p_reason)),0)<3 then
    raise exception 'A product, non-zero quantity and clear reason are required';
  end if;
  if p_movement_type not in ('adjustment','customer_return','supplier_return','writeoff','opening_balance') then
    raise exception 'Invalid inventory movement type';
  end if;
  if p_movement_type='opening_balance' and (p_expected_stock<>0 or p_quantity_delta<0) then
    raise exception 'Opening balance must add stock to a product with zero current stock';
  end if;
  if p_movement_type='customer_return' and p_quantity_delta<0 then
    raise exception 'Customer returns must increase stock';
  end if;
  if p_movement_type in ('supplier_return','writeoff') and p_quantity_delta>0 then
    raise exception 'Supplier returns and write-offs must reduce stock';
  end if;
  select * into v_product
  from public.products
  where id=p_product_id and merchant_id=p_merchant_id
  for update;
  if not found then raise exception 'Product not found'; end if;
  if p_source_id is null then raise exception 'A stable movement reference is required'; end if;
  if exists(
    select 1 from public.inventory_movements im
    where im.merchant_id=p_merchant_id and im.product_id=p_product_id
      and im.movement_type=p_movement_type and im.source_id=p_source_id
  ) then
    return jsonb_build_object('ok',true,'already_recorded',true,'stock',v_product.stock,'movement_type',p_movement_type);
  end if;
  if coalesce(v_product.stock,0)<>p_expected_stock then
    return jsonb_build_object('ok',false,'stock_conflict',true,'server_stock',v_product.stock,'expected_stock',p_expected_stock);
  end if;
  v_next:=coalesce(v_product.stock,0)+p_quantity_delta;
  if v_next<0 then raise exception 'Stock cannot become negative'; end if;
  perform set_config('aibos.stock_movement_type',p_movement_type,true);
  perform set_config('aibos.stock_movement_source_id',p_source_id::text,true);
  perform set_config('aibos.stock_movement_reason',trim(p_reason),true);
  perform set_config('aibos.stock_movement_unit_cost',coalesce(v_product.cost,0)::text,true);
  update public.products set stock=v_next where id=p_product_id and merchant_id=p_merchant_id;
  return jsonb_build_object('ok',true,'stock',v_next,'movement_type',p_movement_type);
end;
$function$;