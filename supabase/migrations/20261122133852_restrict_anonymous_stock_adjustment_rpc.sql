revoke execute on function public.shericeri_adjust_product_stock_v2(uuid,uuid,integer,integer,text,text,uuid,date) from anon;
grant execute on function public.shericeri_adjust_product_stock_v2(uuid,uuid,integer,integer,text,text,uuid,date) to authenticated, service_role;
