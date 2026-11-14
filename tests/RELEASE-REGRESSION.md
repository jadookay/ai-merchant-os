# Release regression verification

Run `node --test tests/prelaunch-static.test.mjs` and `node --test tests/aibos-regression.test.mjs` before release.

The pre-launch suite verifies the production inline JavaScript parses, sale voiding preserves the source sale and reverses journal entries, and the language switch uses the Kinyarwanda and French dictionaries.

The focused suite verifies the void-history and linked-invoice safeguards plus selected-language AI requests.
