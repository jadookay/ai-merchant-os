# AIBOS regression suite

The Node regression suite is `aibos-regression.test.mjs`. It checks localization dictionaries and dynamic dialogs, sale void preservation and reporting, invoice/payment safeguards, selected-language advisor requests, and Shericeri memory queue behavior.

Production database scenarios for invoice/payment blocking, stock restoration, journal reversal balance, idempotency, and authenticated Shericeri memory insert were also exercised in rollback-only SQL transactions during the release audit.
