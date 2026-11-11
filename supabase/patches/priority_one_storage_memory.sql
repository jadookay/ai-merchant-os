-- AIBOS priority-one schema patch. REVIEW AND TEST BEFORE APPLYING TO PRODUCTION.
-- Adds Shericeri cloud memory and owner-scoped product image uploads.

-- The accounting RPCs are SECURITY DEFINER and enforce auth.uid() ownership
-- internally. Remove inherited PUBLIC/anon execution; retain authenticated use.
revoke execute on function public.shericeri_get_accounting_snapshot(uuid) from public, anon;
grant execute on function public.shericeri_get_accounting_snapshot(uuid) to authenticated;

revoke execute on function public.shericeri_sync_journal_batch(uuid, uuid, date, text, text, uuid, jsonb) from public, anon;
grant execute on function public.shericeri_sync_journal_batch(uuid, uuid, date, text, text, uuid, jsonb) to authenticated;


create table if not exists public.shericeri_memory (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  category text not null,
  content text not null check (char_length(content) <= 2000),
  created_at timestamptz not null default now(),
  last_referenced_at timestamptz,
  reference_count integer not null default 0 check (reference_count >= 0),
  deleted boolean not null default false
);

create index if not exists shericeri_memory_merchant_created_idx
  on public.shericeri_memory (merchant_id, created_at desc)
  where deleted = false;

alter table public.shericeri_memory enable row level security;
grant select, insert, update, delete on public.shericeri_memory to authenticated;
revoke all on public.shericeri_memory from anon;

create policy shericeri_memory_owner_select
  on public.shericeri_memory for select to authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id and m.user_id = (select auth.uid())));

create policy shericeri_memory_owner_insert
  on public.shericeri_memory for insert to authenticated
  with check (exists (select 1 from public.merchants m where m.id = merchant_id and m.user_id = (select auth.uid())));

create policy shericeri_memory_owner_update
  on public.shericeri_memory for update to authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.merchants m where m.id = merchant_id and m.user_id = (select auth.uid())));

create policy shericeri_memory_owner_delete
  on public.shericeri_memory for delete to authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id and m.user_id = (select auth.uid())));

-- The app uploads to {auth.uid()}/{product-id}-{timestamp}.{extension}.
update storage.buckets
set file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'product-images';

create policy product_images_owner_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy product_images_owner_select
  on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy product_images_owner_update
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = (select auth.uid()::text));
