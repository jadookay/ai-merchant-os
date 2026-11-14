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


## November 12 team access, sales and Shericeri extension

- Adds merchant-scoped staff subaccounts with name, phone, or email plus a hashed 6–8 digit PIN; login attempts are rate-limited.
- Adds role and permission assignment for managers, cashiers, inventory staff, and accountants. Only Owner/Admin can grant Admin; managers can delegate only permissions they hold. Managers can update staff names, email, phone, username, responsibilities, roles and permissions while preserving at least one login identifier.
- Restricts edit/delete/void actions to Owner/Admin/Manager. Staff records are suspended rather than hard-deleted so transaction history remains intact.
- Requires a reason for sensitive edits and deletions. The audit trail records the actor, action, affected record, reason, and transaction/invoice references.
- Adds manager-visible audit history in team settings.
- Adds multi-product sale cart operations, invoice/transaction IDs, immediate local confirmation, and printable receipts. Favorites are sorted before other products.
- Routes sale stock updates and invoice voids through atomic permission-checked database functions. Voiding an invoice restores stock only for lines whose stock decrement was applied and marks original journal entries voided; delayed journal batches cannot recreate voided revenue.
- Routes received-purchase stock and weighted-average cost updates through an atomic inventory RPC. Inventory staff can create products and receive purchases but cannot overwrite existing product master records.
- Adds expiration alerts to dashboard priorities and Shericeri's date-aware business calendar.
- Adds explicit voice-entry review with Done recording, transcript verification, Use/Save, and Discard actions.
- Expands Shericeri context with current date/time and timezone, business settings, products and barcodes, sales and invoices, inventory expiry, accounting summaries and formulas, staff details visible to the current user's permissions, audit history, calendar events, and product-image references. Product-image URLs are supplied as metadata; this does not yet provide visual interpretation of the underlying image bytes.

## Additional regression coverage

The static regression suite contained 44 tests at that earlier checkpoint; the November 13 additions bring it to 56 tests, all passing in run 43376754467. Run with:

```bash
node --test tests/prelaunch-static.test.mjs
```

The latest verified run at commit `51c15cbba74717f6ecadb216f04bcebab4f53011` passed 44/44 tests. This is source-level CI only; it is not a live multi-user or device integration test.

## Deployment status and required order

The feature branch includes two unapplied migrations, in order:

1. `20261112180000_aibos_sales_favorites_audit.sql`
2. `20261112183000_aibos_merchant_team_access.sql`

The `team-access` Edge Function is also not deployed. Production Supabase remains unchanged. Before rollout, validate both migrations and the Edge Function in a disposable staging project, then test Owner, Admin, Manager, Cashier, Inventory, and Accountant sessions, including offline/retry behavior and invoice-level voids. Do not merge this draft or deploy it until those checks pass.


## November 13 reporting, inventory governance and multi-device requirements

- Adds a Yearly calendar period to the shared Reports, Sales history, and Expense history date filters. The selected year runs from January 1 through the current local date; custom dates remain available.
- Presents the existing team-member status control as Enable / Disable in the interface. The database continues to store the established `active` / `suspended` values so historical records and existing policies remain compatible.
- Existing inventory permissions cover product creation and purchase receiving. Existing product-master edits and deletions remain manager-level controls; product edits require a reason. Before launch, verify every stock-changing path (purchase receipt, sale, return, void, opening stock, gain, write-off, and manual correction) records an actor, timestamp, quantity delta, valuation/COGS impact, source reference, and mandatory reason where the change is manual.
- Required inventory reporting: date-filtered stock-in and stock-out by product; opening and closing quantities; purchase receipts; sales quantities; returns; void reversals; adjustments/write-offs; unit cost and COGS; best-selling and highest-gross-profit products. Inventory visibility and financial valuation must be separately permission-gated. Owner/Admin (and explicitly authorized Managers) assign these report permissions.
- Multi-device security is a launch blocker until end-to-end verification. Each staff member must authenticate with their own identity on each device; never share a manager/owner session or PIN. The server must enforce merchant membership status and granular permissions on every read/write/RPC. Disabling a member must block all devices on their next server request, revoke or invalidate active sessions, prevent offline outbox replay, and clear sensitive in-memory/cache data when access is denied. Provide a per-device session list with last-seen details and revoke-one/revoke-all controls. Device labels are informational, not identity proof.
- Current migration policies check active membership on database access, but that alone does not prove immediate session revocation or protect data already cached in a browser's IndexedDB while offline. No claim of complete multi-device isolation or device-level revocation should be made until session handling, offline behavior, cache clearing, and concurrent-device tests pass.
- Required multi-device tests: same member on two devices; one device signs out; one device is revoked; member is disabled while both devices are online; member is disabled while one device is offline; permissions are reduced while a device is active; queued offline writes are replayed after suspension; a different merchant's data is inaccessible on both devices.
