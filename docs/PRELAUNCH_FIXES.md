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

- Adds a detailed Pending activity panel showing each outbox operation, retry count, server error, blocked state, and next retry time; blocked items require an explicit retry confirmation.
- Uses one MediaRecorder + authenticated Whisper transcription path for sale, product, expense, customer, and AI Advisor voice entry, with tap-to-stop, a recording limit, clear permission errors, and manual-entry fallback.
- Adds a back button to navigated views and horizontally scrollable data tables without forcing the whole phone page to scroll.
- Adds suggested searches for sales, products, expenses, invoices, bills, and payments.
- Adds daily, weekly, monthly, and custom calendar date filters shared by sales, expenses, and reports. Income statement totals use the selected period; balance sheet and trial balance use the selected end date; cash flow uses cash/bank ledger movements in the selected period.
- Sorts operational transaction histories and recent activity by their recorded occurrence timestamps; recent activity combines sales, expenses, purchases, cash movements, and payments.
- Posts new sales and COGS, expenses, and opening stock to balanced journal entries at record time; adds explicit inventory gain and write-off adjustments with confirmation.
- Adds confirmation and visible completion feedback for key save and adjustment actions.

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
