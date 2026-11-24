-- Atomic, permission-checked product cost correction.
-- Cost changes for stock on hand update the product and Inventory/Owner Equity ledger in one transaction.
CREATE OR REPLACE FUNCTION public.shericeri_correct_product_cost(
  p_merchant_id uuid,
  p_product_id uuid,
  p_expected_cost numeric,
  p_new_cost numeric,
  p_reason text,
  p_source_id uuid,
  p_entry_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_inventory_account uuid;
  v_equity_account uuid;
  v_delta numeric;
  v_entry_id uuid;
  v_locked_through date;
BEGIN
  IF NOT private.user_can_access_merchant(p_merchant_id,'manage_inventory')
     OR NOT private.user_can_access_merchant(p_merchant_id,'manage_finance') THEN
    RAISE EXCEPTION 'Cost correction requires inventory and finance permissions';
  END IF;
  IF p_new_cost IS NULL OR p_new_cost < 0 OR p_expected_cost IS NULL
     OR p_source_id IS NULL OR p_entry_date IS NULL
     OR coalesce(length(trim(p_reason)),0) < 3 THEN
    RAISE EXCEPTION 'Cost correction details are incomplete or invalid';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id=p_product_id AND merchant_id=p_merchant_id AND coalesce(deleted,false)=false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or inactive'; END IF;

  -- A retry after a committed response loss must not create a second journal.
  IF v_product.cost = p_new_cost THEN
    RETURN jsonb_build_object('ok',true,'already_applied',true,'stock',v_product.stock,'cost',v_product.cost,'inventory_delta',0);
  END IF;
  IF v_product.cost IS DISTINCT FROM p_expected_cost THEN
    RAISE EXCEPTION 'Product cost changed on the server. Refresh before trying again.';
  END IF;

  v_delta := round(coalesce(v_product.stock,0) * (p_new_cost-v_product.cost),4);
  IF abs(v_delta) > 0.005 THEN
    SELECT locked_through INTO v_locked_through
    FROM public.accounting_settings WHERE merchant_id=p_merchant_id;
    IF v_locked_through IS NOT NULL AND p_entry_date <= v_locked_through THEN
      RAISE EXCEPTION 'Accounting period is locked through %',v_locked_through;
    END IF;
    SELECT id INTO v_inventory_account FROM public.chart_of_accounts
      WHERE merchant_id=p_merchant_id AND code='1200' AND active AND type='asset';
    SELECT id INTO v_equity_account FROM public.chart_of_accounts
      WHERE merchant_id=p_merchant_id AND code='3000' AND active AND type='equity';
    IF v_inventory_account IS NULL OR v_equity_account IS NULL THEN
      RAISE EXCEPTION 'Inventory (1200) or Owner equity (3000) account is unavailable';
    END IF;
    IF EXISTS(SELECT 1 FROM public.journal_entries
      WHERE merchant_id=p_merchant_id AND source_type='product_cost_correction'
        AND source_id=p_source_id AND NOT voided) THEN
      RAISE EXCEPTION 'This cost correction source has already been journaled';
    END IF;
  END IF;

  UPDATE public.products SET cost=p_new_cost,updated_at=now()
  WHERE id=p_product_id AND merchant_id=p_merchant_id;

  IF abs(v_delta) > 0.005 THEN
    INSERT INTO public.journal_entries(
      merchant_id,entry_date,description,source_type,source_id,created_by,created_by_name
    ) VALUES (
      p_merchant_id,p_entry_date,'Correction of mistakenly entered product unit cost - '||v_product.name,
      'product_cost_correction',p_source_id,auth.uid(),'Authorized user'
    ) RETURNING id INTO v_entry_id;

    IF v_delta > 0 THEN
      INSERT INTO public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by)
      VALUES
        (p_merchant_id,v_entry_id,v_inventory_account,v_delta,0,'Increase inventory value after correcting unit cost',auth.uid()),
        (p_merchant_id,v_entry_id,v_equity_account,0,v_delta,'Opening balance correction; not operating income',auth.uid());
    ELSE
      INSERT INTO public.journal_lines(merchant_id,journal_entry_id,account_id,debit,credit,memo,created_by)
      VALUES
        (p_merchant_id,v_entry_id,v_equity_account,abs(v_delta),0,'Reverse excess opening inventory value after correcting unit cost',auth.uid()),
        (p_merchant_id,v_entry_id,v_inventory_account,0,abs(v_delta),'Reduce inventory to corrected unit cost',auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object('ok',true,'already_applied',false,'stock',v_product.stock,
    'old_cost',v_product.cost,'cost',p_new_cost,'inventory_delta',v_delta,'journal_entry_id',v_entry_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.shericeri_correct_product_cost(uuid,uuid,numeric,numeric,text,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shericeri_correct_product_cost(uuid,uuid,numeric,numeric,text,uuid,date) TO authenticated;
