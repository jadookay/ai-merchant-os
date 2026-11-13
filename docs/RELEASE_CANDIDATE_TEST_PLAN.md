# AIBOS Release Candidate — Staging Test Plan

**Target:** PR #4 consolidated candidate plus PR #5 release-blocker fixes  
**Environment:** isolated Supabase staging branch and a separate Pages preview; never production  
**Rule:** use synthetic merchants, staff, products, sales and customer data only.

## 0. Staging preflight

- [ ] Create an isolated Supabase branch and record its project ref, region, and hourly cost.
- [ ] Confirm production migration history and Edge Function versions have not changed.
- [ ] Apply candidate migrations in timestamp order.
- [ ] Confirm the storage bucket and policies exist.
- [ ] Deploy candidate Edge Functions to staging only.
- [ ] Create at least two synthetic merchants with separate owners.
- [ ] Create Owner, Admin, Manager, Cashier, Inventory, Accountant and read-only staff accounts.
- [ ] Record the exact Git SHA, migration versions, and function versions under test.

## 1. PIN login and membership security

- [ ] Sign in using staff full name, username, phone and email with the correct business ID and PIN.
- [ ] Reject malformed business IDs, identifiers longer than 120 characters, and PINs outside 6–8 digits.
- [ ] Confirm wrong PIN attempts trigger throttling by normalized account identity, including when the IP changes.
- [ ] Confirm repeated whitespace or phone formatting does not reset account-level throttling.
- [ ] Confirm PIN verification is callable only through the service-role Edge Function path.
- [ ] Suspend a member and verify new sign-in/refresh is blocked and the member is denied by RLS.
- [ ] Re-enable the member and verify sign-in works again.
- [ ] Change a member's email and PIN; force a later step to fail and verify database/Auth state rolls back.
- [ ] Confirm an employee of Merchant A cannot read or mutate Merchant B data by changing IDs or requests.

## 2. Role and permission matrix

- [ ] Cashier with create-sale permission can record sales but cannot edit, delete or void them.
- [ ] Inventory staff can perform assigned inventory operations without manage_team.
- [ ] Expense staff can record permitted expenses without gaining team administration or financial reports.
- [ ] Accountant with manage_finance can perform authorized accounting tasks but cannot void sales solely because of manage_finance.
- [ ] Manager/Admin/Owner can edit, delete or void only when the relevant operational permission is also granted.
- [ ] Team administration remains restricted to authorized Owner/Admin/Manager accounts.
- [ ] Financial reports remain hidden unless view_financial_reports is explicitly granted.
- [ ] Every edit/delete/void requires a reason and creates an audit event with the correct actor.

## 3. Sales, cart atomicity and inventory

- [ ] Record a one-line sale and a multi-line cart sale.
- [ ] Verify every cart line shares one transaction ID and invoice number.
- [ ] Force insufficient stock for one product in a multi-line cart.
- [ ] Verify no sale lines are inserted and no stock is changed for any line in the rejected cart.
- [ ] Verify the pending-sync panel shows the conflict, server stock, local stock and invoice.
- [ ] Increase stock, retry the invoice, and verify all lines synchronize exactly once.
- [ ] Delete a product before retry and verify the cart is rejected with a clear message.
- [ ] Replay the same transaction with identical values and verify idempotent success.
- [ ] Replay the same transaction with changed values and verify it is rejected.
- [ ] Cancel a queued invoice before it reaches the server; verify no sale or journal remains and the audit event is retained.
- [ ] Void a synchronized invoice; verify stock restoration occurs once and journal reversals balance.
- [ ] Attempt to void a sale with an incomplete journal and verify the server rejects it.

## 4. Offline and multi-device behavior

- [ ] Record sales, expenses and inventory changes while offline.
- [ ] Reload the PWA offline as the same staff member and verify only permitted cached records appear.
- [ ] Verify cached staff permission expires after 8 hours without online revalidation.
- [ ] Reconnect and verify outbox order, retry backoff, and no duplicate records.
- [ ] Create a stock conflict on one device while another device changes stock.
- [ ] Verify conflict retry refreshes server stock before attempting the full invoice again.
- [ ] Suspend a member on one device and verify their online session is denied on another device after revalidation.
- [ ] Verify an offline device cannot sync after suspension; document the unavoidable offline cache grace period.

## 5. Accounting and period controls

- [ ] Verify sale postings debit cash and credit revenue.
- [ ] Verify COGS postings debit COGS and credit inventory.
- [ ] Verify purchases, expenses and stock adjustments use the expected accounts.
- [ ] Verify every journal entry has at least two lines and total debits equal total credits.
- [ ] Verify a source event cannot create a second active journal posting.
- [ ] Verify an existing journal ID cannot be reused with different header metadata.
- [ ] Verify a missing sale cannot post a sale or COGS journal; a voided sale cannot recreate revenue.
- [ ] Lock an accounting period and verify both client and server reject postings/edits inside it.
- [ ] Seed synthetic incomplete sale and COGS journal entries; run the guarded repair migration and verify it fills only missing expected lines.
- [ ] Verify the repair migration aborts on unexpected lines or locked periods.
- [ ] Reconcile trial balance, P&L, balance sheet, cash flow and inventory valuation against independent SQL totals.

## 6. Shericeri, voice and localization

- [ ] Confirm Shericeri receives only the signed-in merchant's authorized business context.
- [ ] Verify Shericeri memory read/write permissions for Owner, Manager and authorized Finance staff.
- [ ] Test Kinyarwanda TTS from Android Chrome with a valid Supabase access token.
- [ ] Confirm kinya-tts rejects missing/invalid JWTs after candidate config is deployed.
- [ ] Confirm the Amatavida function remains JWT-disabled as in production.
- [ ] Test English, Kinyarwanda and French across dashboard, sales, inventory, expenses, reports and team screens.
- [ ] Have at least two native Kinyarwanda-speaking merchants review everyday wording and voice output.

## 7. Release exit criteria

- [ ] All candidate migrations apply cleanly in staging and are recorded in migration history.
- [ ] All staging security/RLS tests pass, including cross-merchant denial.
- [ ] All accounting and inventory reconciliation tests pass.
- [ ] All PIN, suspension, session and multi-device tests pass.
- [ ] Offline sync and conflict retry tests pass without partial invoices or duplicate journals.
- [ ] Android Kinyarwanda voice works with the intended JWT configuration.
- [ ] All static regression tests pass on the exact candidate commit.
- [ ] Production backup is verified before any production migration.
- [ ] User explicitly approves the release; no automatic merge or deployment.
