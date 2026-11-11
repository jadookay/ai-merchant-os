# AIBOS pre-launch fixes

This branch is based on production commit 89c9c874bcda02b1ca84c4d5f217b8f29f77ca33. It does not change the production branch.

## Changes in this branch

- Routes business AI, search, product-photo extraction, barcode lookup, spreadsheet import, and streamed Shericeri requests to the deployed `quick-service` Edge Function. The `advisor` function remains the voice transport endpoint for existing audio/TTS requests.
- Prevents accounting reversals when a user cancels a sale void or expense deletion.
- Removes locally deleted sales and expenses from IndexedDB so they do not reappear after reload.
- Queues newly created journal entries with their lines as one operation and syncs them through `shericeri_sync_journal_batch` in one database transaction.
- Captures deployed Edge Function source under `supabase/functions/`.
- Adds a reviewed-but-unapplied SQL patch for Shericeri memory, user-scoped product image uploads, bucket constraints, and authenticated-only execution of privileged accounting RPCs.
- Adds Supabase function JWT configuration. In particular, `kinya-tts` must be redeployed with JWT verification enabled before production rollout.

## Static regression checks

Run from the repository root:

```bash
node --test tests/prelaunch-static.test.mjs
```

These tests check source invariants. They do not replace browser, multi-user, offline, provider, or accounting integration tests.

## Deployment safeguards

1. Back up the database and export current Edge Function versions/secrets configuration.
2. Apply and verify the SQL patch in a non-production project first.
3. Deploy `quick-service` only after confirming its required secrets exist.
4. Deploy `kinya-tts` with `verify_jwt = true` and test with a real authenticated session.
5. Run end-to-end tests using disposable merchant accounts.
6. Promote through a reviewed pull request only after all tests pass.

No database migration or Edge Function deployment is performed by this branch.
