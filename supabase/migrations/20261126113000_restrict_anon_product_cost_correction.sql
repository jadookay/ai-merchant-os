-- The product-cost correction RPC must never be callable by anonymous clients.
-- Signed-in callers are still checked for both inventory and finance permissions inside the function.
REVOKE ALL ON FUNCTION public.shericeri_correct_product_cost(uuid,uuid,numeric,numeric,text,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shericeri_correct_product_cost(uuid,uuid,numeric,numeric,text,uuid,date) TO authenticated;
