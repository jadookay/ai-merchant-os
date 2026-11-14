-- Preserve the existing six-digit suffix of each business ID and enforce the limit.
update public.merchants
set shericeri_id = shericeri_id - 9900000
where shericeri_id between 10000000 and 10999999;

alter table public.merchants
  add constraint merchants_shericeri_id_six_digits_check
  check (shericeri_id between 100000 and 999999);
