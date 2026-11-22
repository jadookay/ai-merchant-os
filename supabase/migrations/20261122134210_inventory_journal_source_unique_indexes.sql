create unique index if not exists journal_entries_inventory_movement_source_unique
  on public.journal_entries (merchant_id, source_type, source_id)
  where source_type in ('stock_gain','stock_writeoff','sales_return_stock','supplier_return')
    and voided = false;

create unique index if not exists journal_entries_opening_stock_source_unique
  on public.journal_entries (merchant_id, source_id)
  where source_type = 'product_opening_stock'
    and voided = false;
