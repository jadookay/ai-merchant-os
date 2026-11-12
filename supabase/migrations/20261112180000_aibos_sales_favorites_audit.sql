-- AIBOS multi-line sales, favorites and audit metadata.
-- Additive only: existing sales, stock, accounting and audit rows are preserved.
alter table public.sales
  add column if not exists transaction_id uuid,
  add column if not exists invoice_number text,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists stock_applied boolean not null default true;

create index if not exists sales_merchant_transaction_idx
  on public.sales (merchant_id, transaction_id);

create index if not exists sales_merchant_invoice_idx
  on public.sales (merchant_id, invoice_number);

alter table public.products
  add column if not exists favorite boolean not null default false;

alter table public.audit_log
  add column if not exists reason text,
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null;

create index if not exists audit_log_merchant_created_idx
  on public.audit_log (merchant_id, created_at desc);


-- Track whether received purchases were applied to product stock; ordered purchases are marked applied without changing stock.
alter table public.purchases
  add column if not exists stock_applied boolean not null default true;
