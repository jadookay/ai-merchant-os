create or replace function public.capture_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_type text;
  v_reason text;
  v_source_id uuid;
  v_unit_cost numeric;
begin
  if tg_op='INSERT' then
    if coalesce(new.stock,0)>0 then
      insert into public.inventory_movements(
        merchant_id,product_id,movement_type,quantity_delta,quantity_before,quantity_after,
        unit_cost,source_type,source_id,reason,actor_user_id,created_at
      ) values(
        new.merchant_id,new.id,'opening_balance',new.stock,0,new.stock,
        coalesce(new.cost,0),'product_create',new.id,'Opening stock on product creation',auth.uid(),coalesce(new.created_at,now())
      );
    end if;
    return new;
  end if;

  if new.stock is distinct from old.stock then
    v_type:=nullif(current_setting('aibos.stock_movement_type',true),'');
    v_reason:=nullif(trim(current_setting('aibos.stock_movement_reason',true)),'');
    v_source_id:=nullif(current_setting('aibos.stock_movement_source_id',true),'')::uuid;
    v_unit_cost:=coalesce(nullif(current_setting('aibos.stock_movement_unit_cost',true),'')::numeric,new.cost,0);
    if v_type is null or v_reason is null then
      raise exception 'Stock changes must use a recorded movement with a reason';
    end if;
    if v_type not in ('opening_balance','sale','purchase_receipt','sale_void','customer_return','supplier_return','adjustment','writeoff') then
      raise exception 'Invalid inventory movement type';
    end if;
    if v_type='opening_balance' and (old.stock<>0 or new.stock<=old.stock) then
      raise exception 'Opening balance must increase stock from zero';
    end if;
    insert into public.inventory_movements(
      merchant_id,product_id,movement_type,quantity_delta,quantity_before,quantity_after,
      unit_cost,source_type,source_id,reason,actor_user_id
    ) values(
      new.merchant_id,new.id,v_type,new.stock-old.stock,old.stock,new.stock,
      greatest(v_unit_cost,0),v_type,v_source_id,v_reason,auth.uid()
    );
  end if;
  return new;
end;
$function$;