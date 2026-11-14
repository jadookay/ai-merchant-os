-- Existing merchant-facing IDs were 8 digits. Preserve their trailing six-digit code
-- and enforce the new six-digit limit for every future business account.
update public.merchants
set shericeri_id = shericeri_id - 9900000
where shericeri_id between 10000000 and 10999999;

alter table public.merchants
  add constraint merchants_shericeri_id_six_digits_check
  check (shericeri_id between 100000 and 999999);

select setval(
  'public.shericeri_id_seq',
  coalesce((select max(shericeri_id) from public.merchants), 100000),
  true
);
