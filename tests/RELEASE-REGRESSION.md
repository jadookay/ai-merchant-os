# Release regression verification

Run `node --test tests/prelaunch-static.test.mjs` and `node --test tests/aibos-regression.test.mjs` before release.

The full pre-launch suite parses all inline scripts and checks team permissions, sale voiding, accounting reversals, language selection, inventory movements, device sessions and offline synchronization.
