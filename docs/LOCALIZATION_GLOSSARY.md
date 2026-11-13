# AIBOS language and terminology guide

This guide records the first English → Kinyarwanda → French terminology decisions for the merchant interface. English remains the source language. The language selector changes interface wording only; it does not change stored business data, account permissions, currency, or Shericeri's separately selected voice language.

## Translation principles

- Write Kinyarwanda as a Rwandan merchant would explain the action to another shopkeeper: short, direct and familiar.
- Prefer a clear phrase over a rare or overly formal one-word translation.
- Keep common product and payment terms such as PIN, PDF, Excel, CSV and Mobile Money where users already recognize them.
- Use precise accounting vocabulary for reports. Do not translate profit, revenue, cash balance and sales as if they were the same thing.
- Preserve product names, customer names, supplier names, merchant-entered notes, IDs, codes, amounts and transaction references.
- Keep confirmation and destructive-action messages clear about the action and reason required.
- Have fluent Rwanda-based merchants review the Kinyarwanda wording before a public release.

## Core interface glossary

| English | Kinyarwanda | French | Usage note |
|---|---|---|---|
| Dashboard | Incamake | Tableau de bord | Quick view of the business |
| Record sale | Andika igurisha | Enregistrer une vente | Action to save a sale |
| Records | Ibyanditswe | Registres | Business records |
| Inventory / stock | Ububiko bw’ibicuruzwa | Stock / Inventaire | Stock held by the shop |
| Products | Ibicuruzwa | Produits | Items sold |
| Sales | Ibyagurishijwe | Ventes | Completed sales |
| Expenses | Amafaranga yakoreshejwe | Dépenses | Business spending |
| Customers | Abakiriya | Clients | People buying from the business |
| Suppliers | Abagemura ibicuruzwa | Fournisseurs | People/businesses supplying goods |
| Purchases | Ibyaguzwe | Achats | Goods bought for the business |
| Reports | Raporo | Rapports | Reports |
| Financial reports | Raporo z’imari | Rapports financiers | Financial reporting |
| Revenue | Amafaranga yinjiye | Chiffre d’affaires | Sales income before expenses |
| Profit | Inyungu | Bénéfice | Earnings after relevant costs |
| Net profit | Inyungu nyayo | Bénéfice net | Profit after all expenses and taxes |
| Loss | Igihombo | Perte | Negative business result |
| Cost of goods sold (COGS) | Ikiguzi cy’ibicuruzwa byagurishijwe | Coût des marchandises vendues | Cost attached to goods sold |
| Selling price | Igiciro cyo kugurisha | Prix de vente | Customer price |
| Unit cost | Ikiguzi cya kimwe | Coût unitaire | Cost per item |
| Quantity | Umubare | Quantité | Number of units |
| Total | Igiteranyo | Total | Sum |
| Stock balance | Ibiri mu bubiko | Stock disponible | Quantity currently on hand |
| Stock in | Ibyinjiye mu bubiko | Entrées de stock | Receipts and additions |
| Stock out | Ibyasohotse mu bubiko | Sorties de stock | Sales, write-offs and other removals |
| Stock movement | Ibyinjiye n’ibyasohotse mu bubiko | Mouvements de stock | Movement history |
| Received | Byakiriwe | Réceptionné | Goods received |
| Adjustment | Gukosora umubare | Ajustement | Correction to stock quantity |
| Write-off | Ibicuruzwa byangiritse cyangwa byatakaye | Mise au rebut | Damaged, expired or lost goods |
| Customer return | Ibyagaruwe n’umukiriya | Retour client | Goods returned by a customer |
| Reason | Impamvu | Motif | Explanation required for sensitive actions |
| Audit trail | Amateka y’ibikorwa | Journal d’audit | Who did what and when |
| Owner | Nyir’ubucuruzi | Propriétaire | Business owner |
| Manager | Umuyobozi | Gestionnaire | Authorized manager |
| Cashier | Uwakira amafaranga | Caissier | Staff member handling sales/payments |
| Inventory officer | Ushinzwe ububiko | Responsable du stock | Staff member managing stock |
| Accountant | Umucungamutungo | Comptable | Accounting role |
| Enable | Emera gukoresha | Activer | Allow a member to sign in |
| Disable | Hagarika gukoresha | Désactiver | Block a member from using the account |
| Permissions | Uburenganzira | Autorisations | Actions a member may perform |
| Mobile Money | Mobile Money | Mobile Money | Retained as a familiar payment term |
| PIN | PIN | Code PIN | Keep the acronym recognizable |

## Important distinctions

- **Amafaranga yinjiye / Chiffre d’affaires** is revenue, not profit. A shop can receive money from sales and still make a loss after costs and expenses.
- **Inyungu / Bénéfice** means profit in the business context. Kinyarwanda words can have multiple meanings, so the surrounding label and report description must make the accounting meaning clear.
- **Ikiguzi cy’ibicuruzwa byagurishijwe / Coût des marchandises vendues** is COGS. It is not the same as all business expenses.
- **Ibiri mu bubiko / Stock disponible** is the current quantity on hand. **Ibyinjiye n’ibyasohotse mu bubiko / Mouvements de stock** is the history of stock changes.
- **Hagarika gukoresha / Désactiver** disables a team member's access. It must not be confused with deleting the employee or deleting business records.
- **Hagarika igurisha / Annuler la vente** is a reversal/cancellation action and must always retain the reason and audit history. It is not the same as deleting a product.

## Known localization limits in this first pass

- The selected language is stored locally on the device/browser. A user may need to select the preferred language on another device.
- Existing records entered by the merchant, imported spreadsheets, product names, customer/supplier names, and AI-generated free-form advice are not automatically translated.
- Shericeri's speech recognition and spoken-response language remain governed by its separate voice-language setting. Changing the app interface does not silently switch the voice engine.
- Some long-tail validation errors, third-party authentication messages and browser-native prompts may still appear in English until individually reviewed.
- The translation module uses a curated in-app glossary; it does not send business data to a third-party translation service.

## Review checklist before public release

1. Have at least two fluent Kinyarwanda-speaking small merchants review the sales, stock, expense and reporting screens.
2. Verify all buttons, dialogs, validation errors, empty states, tables, date filters and team permissions in all three languages.
3. Check text wrapping on small Android screens and horizontal-scroll tables.
4. Confirm changing language never changes merchant data, numeric values, accounting formulas, currency or permissions.
5. Confirm the setting persists on the same device and explain that each device has its own preference.
6. Check French accounting labels against the intended Rwandan tax/accounting workflow before release.
