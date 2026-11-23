import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../shericeri_v14_4_aibos_sync_sw.js", import.meta.url), "utf8");
const previewHtml = readFileSync(new URL("../preview-live/index.html", import.meta.url), "utf8");
const previewServiceWorker = readFileSync(new URL("../preview-live/shericeri_v14_4_aibos_sync_sw.js", import.meta.url), "utf8");
const expenseAccrualMigration = readFileSync(new URL("../supabase/migrations/20261121230000_expense_payment_accrual_workflow.sql", import.meta.url), "utf8");
const expenseStatusMigration = readFileSync(new URL("../supabase/migrations/20261121233000_expense_payment_status.sql", import.meta.url), "utf8");
const supplierBillMigration = readFileSync(new URL("../supabase/migrations/20261121234500_supplier_bill_account_classification.sql", import.meta.url), "utf8");
const purchaseLinkMigration = readFileSync(new URL("../supabase/migrations/20261122090000_link_supplier_bills_to_stock_purchases.sql", import.meta.url), "utf8");
const inventoryIntegrityMigration = readFileSync(new URL("../supabase/migrations/20261122150000_accounting_inventory_integrity_guards.sql", import.meta.url), "utf8");
const purchaseVoidBaseMigration = readFileSync(new URL("../supabase/migrations/20261122180000_audited_received_purchase_void.sql", import.meta.url), "utf8");
const purchaseVoidFinalMigration = readFileSync(new URL("../supabase/migrations/20261122183000_purchase_void_document_preflight.sql", import.meta.url), "utf8");
const purchaseVoidReversalMigration = readFileSync(new URL("../supabase/migrations/20261122184000_purchase_void_exact_reversal_and_ledger_awareness.sql", import.meta.url), "utf8");
const teamAccess = readFileSync(new URL("../supabase/functions/team-access/index.ts", import.meta.url), "utf8");
const liveSyncMigration = readFileSync(new URL("../supabase/migrations/20261114170000_enable_authorized_realtime_and_register_owner_devices.sql", import.meta.url), "utf8");
const realtimeRlsMigration = readFileSync(new URL("../supabase/migrations/20261114171500_authorize_realtime_device_and_inventory_views.sql", import.meta.url), "utf8");
const sixDigitIdMigration = readFileSync(new URL("../supabase/migrations/20261114162636_enforce_six_digit_shericeri_business_ids.sql", import.meta.url), "utf8");
const sequenceMaxMigration = readFileSync(new URL("../supabase/migrations/20261114190000_enforce_six_digit_business_id_sequence_max.sql", import.meta.url), "utf8");
const openingStockMigration = readFileSync(new URL("../supabase/migrations/20261114193000_allow_opening_balance_inventory_movement_for_inventory_managers.sql", import.meta.url), "utf8");
const openingTriggerMigration = readFileSync(new URL("../supabase/migrations/20261114194000_allow_opening_balance_inventory_movement_trigger.sql", import.meta.url), "utf8");

const voidBlock = html.slice(html.indexOf("async function voidSale(id){"), html.indexOf("const sheriSearchValues"));

test("Kinyarwanda covers core finance and stock terms", () => {
  for (const value of [
    "Amafaranga yinjiye", "Amafaranga umukiriya akurimo", "Inyungu",
    "Yahagaritswe", "Ibyatoranyijwe", "Ongeraho ibicuruzwa",
    "Ububiko", "Raporo z’imari", "Amateka y’ibikorwa"
  ]) assert.ok(html.includes(value), `Missing Kinyarwanda: ${value}`);
});

test("French covers core finance and stock terms", () => {
  for (const value of [
    "Chiffre d’affaires", "Créances clients", "Bénéfice",
    "Annulée", "Favoris", "Ajouter des produits",
    "Stock", "Rapports financiers", "Piste d’audit"
  ]) assert.ok(html.includes(value), `Missing French: ${value}`);
});

test("search placeholders and prompts have both language dictionaries", () => {
  for (const value of [
    "Shakisha ibicuruzwa cyangwa uko byinjiye", "Rechercher le stock par produit",
    "Shakisha amateka ukoresheje umukozi", "Rechercher dans la piste d’audit",
    "Shakisha raporo ukoresheje izina", "Rechercher les rapports par nom"
  ]) assert.ok(html.includes(value), `Missing translated search copy: ${value}`);
});

test("native alert, confirm and prompt dialogs are translated at runtime", () => {
  assert.match(html, /window\.alert=message=>nativeAlert\(translateString/);
  assert.match(html, /window\.confirm=message=>nativeConfirm\(translateString/);
  assert.match(html, /window\.prompt=\(message,defaultValue\)=>nativePrompt\(translateString/);
});

test("void confirmation summaries are translated in Kinyarwanda and French", () => {
  for (const value of ["['Void ','Hagarika ']", "['Void ','Annuler ']",
    "['Total:','Igiteranyo:']", "['Total:','Total :']"])
    assert.ok(html.includes(value), `Missing translated confirmation fragment: ${value}`);
});

test("voiding requires permission and a reason", () => {
  assert.match(voidBlock, /sheriCan\('manage_sales'\)/);
  assert.match(voidBlock, /prompt\('Enter the reason for voiding this sale \(required\):'\)/);
  assert.match(voidBlock, /reason\.trim\(\)\.length<3/);
  assert.match(voidBlock, /if\(!confirm\(confirmText\)\)return/);
});

test("voiding preserves sale rows instead of deleting them", () => {
  assert.ok(voidBlock.includes("Voids are status changes, never deletions"));
  assert.ok(voidBlock.includes("await sheriPut('sales',row.id"));
  assert.ok(!voidBlock.includes("sheriDelete('sales'"));
});

test("sales history renders void status and the reason", () => {
  assert.match(html, /s\.voided\?'<span class="pill">Voided<\/span>/);
  assert.ok(html.includes("esc(s.void_reason||'No reason recorded')"));
  assert.ok(html.includes("mergeKeepLocal(sales,state.sales,'sales')"));
});

test("voided sales are excluded from operating metrics and trends", () => {
  assert.match(html, /function revenue\(\)\{return state\.sales\.filter\(x=>!x\.voided\)/);
  assert.match(html, /function cogs\(\)\{return state\.sales\.filter\(x=>!x\.voided\)/);
  assert.ok(html.includes("state.sales.filter(s=>!s.voided&&s.created_at>=recentCutoff)"));
  assert.ok(html.includes("state.sales.filter(s=>!s.voided).length"));
});

test("sale void preflights linked invoices and receipts", () => {
  assert.ok(voidBlock.includes("sb.from('invoices').select('id,status')"));
  assert.ok(voidBlock.includes("eq('source_type','invoice').eq('source_id',linkedInvoice.id)"));
  assert.ok(voidBlock.includes("Could not verify the linked invoice and payments. No changes were made."));
});

test("AI Advisor sends the selected application language", () => {
  assert.ok(html.includes("language:window.AIBOS_I18N?.getLanguage?.()||'en'"));
});

test("Shericeri memory remains queued for retry and persisted locally", () => {
  assert.ok(html.includes("async function sheriQueueMemory(category,content)"));
  assert.ok(html.includes("type:'memory_insert',record"));
});


test("server snapshots replace stale confirmed IndexedDB rows but preserve queued local changes", () => {
  assert.ok(html.includes("const pendingOutbox=await sheriGetAll('outbox')"));
  assert.ok(html.includes("if(pendingIdsFor(store).has(x.id)&&!sm.has(x.id))sm.set(x.id,{...x,_serverConfirmed:false})"));
  assert.ok(!html.includes("if(sr.length===0&&lr.length>0)return lr.map"));
  assert.ok(!html.includes("const keep=!x._serverConfirmed||sheriSyncQueued>0"));
});

test("authorized multi-device refresh subscribes only to merchant-filtered inserts and updates", () => {
  const start=html.indexOf("function sheriSubscribeMerchantRealtime");
  const end=html.indexOf("async function onAuthed",start);
  const block=html.slice(start,end);
  assert.ok(block.includes("event:'INSERT'"));
  assert.ok(block.includes("event:'UPDATE'"));
  assert.ok(block.includes("filter:'merchant_id=eq.'+merchantId"));
  assert.ok(!block.includes("event:'*'"));
});

test("pending sync panel is scrollable and shows business amounts and descriptions", () => {
  assert.ok(html.includes("panel.style.maxHeight='440px'"));
  assert.ok(html.includes("panel.style.overflowY='auto'"));
  assert.ok(html.includes("function sheriPendingActivityDetails(op)"));
  for(const value of ["Total ","Cost value ","fmt(r.amount)","Waiting to sync"])
    assert.ok(html.includes(value), "Missing pending activity detail: "+value);
});

test("financial reports flag incomplete or unbalanced journal entries", () => {
  assert.ok(html.includes("function accLedgerIntegrity(endDate=null)"));
  assert.ok(html.includes("Financial statements are NOT reconciled"));
  assert.ok(html.includes("Balance Sheet does not balance."));
  assert.ok(html.includes("const statementsVerified=integrity.invalidCount===0"));
  assert.ok(html.includes("statementNotice?'<div style=\"grid-column:1/-1\">'+statementNotice"));
});

test("operational fallback financial statements exclude voided sales", () => {
  assert.ok(html.includes("const salesInRange=state.sales.filter(x=>!x.voided&&sheriDateInReportRange(x.created_at))"));
});

test("staff PIN reset is available to authorized team managers", () => {
  assert.ok(html.includes("onclick=\"resetTeamMemberPin('"));
  assert.ok(html.includes("async function resetTeamMemberPin(id)"));
  assert.ok(html.includes("pin:pin.trim()"));
  assert.ok(html.includes("Set a new 6–8 digit PIN"));
});

test("owner device sessions are registered and non-success RPC payloads are rejected", () => {
  assert.ok(html.includes("if(data?.ok!==true)"));
  assert.ok(html.includes("try{await sheriRegisterDeviceSession(merchantId)}catch(e)"));
});


test("financial statement calculations respect each account's normal balance", () => {
  assert.ok(html.includes("const normalSide=String(account.normal_balance||defaultSide).toLowerCase()"));
  assert.ok(html.includes("by[account.code]+=normalSide==='credit'?-raw:raw"));
  assert.ok(html.includes("function accStatementTotal(type,balances,naturalSide)"));
  assert.ok(html.includes("return sum+(normalSide===naturalSide?value:-value)"));
  assert.ok(html.includes("accStatementTotal('income',b,'credit')"));
  assert.ok(html.includes("accStatementTotal('equity',bs,'credit')"));
});

test("team access reuses existing employee Auth identities and returns actionable conflicts", () => {
  assert.ok(teamAccess.includes("admin.auth.admin.listUsers({ page, perPage })"));
  assert.ok(teamAccess.includes("page <= 50 && !authUser"));
  assert.ok(teamAccess.includes("reused_existing_auth_user"));
  assert.ok(teamAccess.includes("member_exists"));
  assert.ok(teamAccess.includes("email_exists"));
  assert.ok(teamAccess.includes("Use Edit access to change permissions or reset their PIN."));
});

test("live-update migration enables merchant tables in Realtime and tracks owner devices", () => {
  assert.ok(liveSyncMigration.includes("alter publication supabase_realtime add table public.%I"));
  assert.ok(liveSyncMigration.includes("merchant_device_sessions"));
  assert.ok(liveSyncMigration.includes("return jsonb_build_object('ok',true,'owner',v_is_owner"));
  assert.ok(liveSyncMigration.includes("where public.merchant_device_sessions.revoked_at is null"));
});


test("record confirmation immediately queues sync and schedules the next pending pass without an artificial delay", () => {
  const queueStart=html.indexOf("async function sheriQueue(op)");
  const queueEnd=html.indexOf("async function sheriQueueMemory",queueStart);
  const queue=html.slice(queueStart,queueEnd);
  assert.ok(queue.includes("await sheriPut('outbox',key"));
  assert.ok(queue.includes("if(navigator.onLine&&sheriSyncBatchDepth===0)sherriSyncKick()"));
  assert.ok(html.includes("const delay=Math.max(0,Math.min(2147483000,dueAt-Date.now()))"));
});


test("pending activity details are translated for Kinyarwanda and French users", () => {
  assert.ok(html.includes("function sheriPendingText(value)"));
  assert.ok(html.includes("'waiting to sync':'Birategereje koherezwa'"));
  assert.ok(html.includes("'waiting to sync':'En attente de synchronisation'"));
  assert.ok(html.includes("pending activities on this device"));
});

test("Realtime access to device and inventory movement rows remains permission-scoped", () => {
  assert.ok(realtimeRlsMigration.includes("merchant_device_sessions_team_select"));
  assert.ok(realtimeRlsMigration.includes("private.user_can_access_merchant(merchant_id,'manage_team')"));
  assert.ok(realtimeRlsMigration.includes("inventory_movements_cost_view_select"));
  assert.ok(realtimeRlsMigration.includes("private.user_can_access_merchant(merchant_id,'view_inventory_costs')"));
});

test("business IDs are capped at six digits in the app, staff login and database", () => {
  assert.ok(html.includes('maxlength="6"'));
  assert.ok(html.includes("!/^\\d{1,6}$/.test(merchant_code)"));
  assert.ok(teamAccess.includes("!/^\\d{1,6}$/.test(merchantCode)"));
  assert.ok(sixDigitIdMigration.includes("merchants_shericeri_id_six_digits_check"));
});

test("cross-device server rows override stale local rows and foreground tabs refresh", () => {
  assert.ok(html.includes("if(pendingIdsFor(store).has(x.id)&&!sm.has(x.id))"));
  assert.ok(html.includes("sheriSyncQueued=items.length"));
  assert.ok(html.includes("loadAll(true).then(()=>{if(!sheriDeferBackgroundRender())render()})"));
});

test("trial balance places abnormal account balances on the opposite side", () => {
  assert.ok(html.includes("debit=normalSide==='debit'?Math.max(0,balance):Math.max(0,-balance)"));
  assert.ok(html.includes("credit=normalSide==='credit'?Math.max(0,balance):Math.max(0,-balance)"));
});


test("ledger repair is explicit, permission-gated and skips voided sales", () => {
  assert.ok(html.includes("async function accEnsureOperationalLedger({approved=false}={})"));
  assert.ok(html.includes("if(!approved||!state.merchant||!navigator.onLine||!accServerSnapshotAuthoritative"));
  assert.ok(html.includes("(state.sales||[]).filter(x=>!x.voided)"));
  assert.ok(html.includes("async function accReconcileOperationalLedger()"));
  assert.ok(html.includes("if(!await accShowRepairConfirmation(promptText))return"));
  assert.ok(html.includes('id="accReconcileButton"'));
});

test("journal recovery adds only missing expected lines and refuses conflicting entries", () => {
  assert.ok(html.includes("const existingEntry=sourceType&&sourceId?"));
  assert.ok(html.includes("const unexpected=existingLines.filter(l=>!used.has(l.id))"));
  assert.ok(html.includes("Existing journal lines conflict with the source transaction."));
  assert.ok(html.includes("lines:syncLines"));
});

test("multi-step records batch local writes before starting network sync", () => {
  assert.ok(html.includes("let sheriSyncBatchDepth=0"));
  assert.ok(html.includes("if(navigator.onLine&&sheriSyncBatchDepth===0)sherriSyncKick()"));
  assert.ok(html.includes("sheriSyncBusy||sheriSyncBatchDepth>0"));
  assert.ok(html.includes("async function sheriWithSyncBatch(task)"));
  assert.ok(html.includes("function sheriWrapSyncBatch(name)"));
});

test("six-digit business ID sequence has a hard upper bound", () => {
  assert.ok(sequenceMaxMigration.includes("maxvalue 999999"));
  assert.ok(sequenceMaxMigration.includes("minvalue 100000"));
  assert.ok(sixDigitIdMigration.includes("merchants_shericeri_id_six_digits_check"));
});

test("new product opening stock creates an audited inventory movement", () => {
  assert.ok(html.includes("record:{...p,stock:0}"));
  assert.ok(html.includes("expected_stock:0,quantity_delta:initialStock"));
  assert.ok(html.includes("movement_type:'opening_balance'"));
  assert.ok(openingStockMigration.includes("p_movement_type not in ('adjustment','customer_return','supplier_return','writeoff','opening_balance')"));
  assert.ok(openingTriggerMigration.includes("'opening_balance','sale','purchase_receipt'"));
  assert.ok(openingTriggerMigration.includes("v_type='opening_balance' and (old.stock<>0 or new.stock<=old.stock)"));
});

test("service worker cache is bumped to release V14.4.81", () => {
  assert.ok(serviceWorker.includes("shericeri-v14.4-aibos-sync-v81"));
  assert.ok(serviceWorker.includes("V14.4.81"));
  assert.ok(html.includes('name="app-version" content="V14.4.81 reconciled accounting, supplier payments and legal-name enforcement"'));
});

test("duplicate team identifiers return a conflict instead of an ambiguous 2xx response", () => {
  assert.ok(teamAccess.includes('code === "23505"'));
  assert.ok(teamAccess.includes("duplicate_member_identifier"));
});

test("English, French and Kinyarwanda share one horizontal whole-word table layout", () => {
  assert.ok(html.includes('id="aibos-locale-invariant-data-layout-v57"'));
  assert.ok(html.includes("width:max-content!important"));
  assert.ok(html.includes("word-break:normal!important"));
  assert.ok(html.includes("overflow-wrap:normal!important"));
  assert.ok(html.includes("white-space:nowrap!important"));
});

test("opening stock and purchase synchronization verify parent records before posting", () => {
  assert.ok(html.includes("async function sheriEnsureProductBeforeStockChange(op)"));
  assert.ok(html.includes("async function sheriEnsurePurchaseDependencies(op)"));
  assert.ok(html.includes("await sheriUnblockSchemaRepairedOperations()"));
  assert.ok(html.includes("Purchase is waiting for its supplier to sync"));
  assert.ok(html.includes("The server did not confirm that this purchase was recorded."));
  assert.ok(html.includes("Purchase stock conflict — manual review is required."));
  assert.ok(html.includes("conflict.status=422"));
});

test("received purchases persist the updated local stock and record the registered actor name", () => {
  const start=html.indexOf("async function addOSPurchase()");
  const end=html.indexOf("async function deleteOSPurchase",start);
  const block=html.slice(start,end);
  assert.ok(block.includes("created_by_name:sheriCurrentActor()"));
  assert.ok(block.includes("await sheriPut('products',p.id,{merchant_id:state.merchant.id,record:{...p}})"));
});
 
test("the production application shell uses V14.4.81", () => {
  assert.ok(serviceWorker.includes("shericeri-v14.4-aibos-sync-v81"));
  assert.ok(serviceWorker.includes("const RELEASE='V14.4.81'"));
});

test("the preview application shell is bumped to V14.4.79 without changing production", () => {
  assert.ok(previewServiceWorker.includes("shericeri-preview-v14.4-aibos-sync-v79"));
  assert.ok(previewServiceWorker.includes("const RELEASE='V14.4.79'"));
  assert.ok(previewHtml.includes("V14.4.79"));
});

test("supplier bills post to the selected inventory, operating expense, service or other asset account", () => {
  assert.ok(previewHtml.includes('<option value="inventory">Inventory / stock</option>'));
  assert.ok(previewHtml.includes('<option value="operating_expense">Operating expense</option>'));
  assert.ok(previewHtml.includes('<option value="service">Service / professional fees</option>'));
  assert.ok(previewHtml.includes('<option value="other_purchase">Other asset or purchase</option>'));
  assert.ok(previewHtml.includes("const mappedAccountCode={inventory:'1200',operating_expense:'6000',service:'6200'}[billType]"));
  assert.ok(previewHtml.includes("debit_account_id:debitAccount.id"));
  assert.ok(previewHtml.includes("accountId:debitAccount.id,debit:subtotal"));
  assert.ok(previewHtml.includes("const billDebitAccountId=bill.debit_account_id||accAccountCode('1200')?.id"));
  assert.ok(previewHtml.includes("accountId:billDebitAccountId,debit:Number(bill.subtotal||0)"));
  assert.ok(previewHtml.includes("if(!supplierId)return alert('Select the supplier for this bill.')"));
  assert.ok(previewHtml.includes("bill_type:'inventory'")===false);
  assert.ok(supplierBillMigration.includes("add column if not exists bill_type"));
  assert.ok(supplierBillMigration.includes("add column if not exists debit_account_id"));
  assert.ok(supplierBillMigration.includes("'6200','Service & professional fees','expense','debit','not_applicable',true"));
});

test("preview inline JavaScript blocks parse without syntax errors", () => {
  const blocks=[...previewHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([,attrs])=>!/\bsrc\s*=|application\/(?:json|ld\+json)/i.test(attrs));
  assert.ok(blocks.length>0);
  blocks.forEach(([,attrs,source],index)=>{try{new Script(source,{filename:"preview-inline-"+(index+1)+".js"});}catch(error){const line=Number(String(error.stack||'').match(/preview-inline-\\d+\\.js:(\\d+)/)?.[1]||0);throw new Error("Inline script "+(index+1)+" failed: "+error.stack+"; excerpt: "+source.slice(0,300));}});
});

test("expense payment workflow accrues expenses and settles the payable without duplicating expense", () => {
  assert.ok(previewHtml.includes("payment_status:'unpaid'"));
  assert.ok(previewHtml.includes("async function accRecordExpensePayment"));
  assert.ok(previewHtml.includes("source_type:'expense',source_id:expense.id"));
  assert.ok(previewHtml.includes("{accountId:payable.id,debit:amount}"));
  assert.ok(previewHtml.includes("expense.payment_status=paidAfter+0.005>=Number(expense.amount||0)?'paid':'partial'"));
  assert.ok(previewHtml.includes("const credit=String(e.payment_status||'paid')==='paid'&&!hasLinkedPayments?cash:payable"));
  assert.ok(!previewHtml.includes("_v14_1_addExpense"));
  assert.ok(expenseAccrualMigration.includes("'2050','Accrued expenses payable','liability','credit','current',true"));
  assert.ok(expenseStatusMigration.includes("payment_status text not null default 'paid'"));
  assert.ok(expenseStatusMigration.includes("check (payment_status in ('paid','unpaid','partial'))"));
});

 
test("large accounting reads paginate beyond the PostgREST row limit", () => {
  assert.ok(html.includes("async function sheriFetchAllRows"));
  assert.ok(html.includes(".range(offset,offset+pageSize-1)"));
  assert.ok(html.includes("sheriFetchAllRows(()=>sb.from('journal_entries')"));
  assert.ok(html.includes("sheriFetchAllRows(()=>sb.from('journal_lines')"));
});
 
test("large local snapshots use batched IndexedDB writes", () => {
  assert.ok(html.includes("async function sheriBulkPut"));
  assert.ok(html.includes("await Promise.all(jobs)"));
  assert.ok(html.includes("['journalLines',state.journalLines]"));
});
 
test("financial statement verification checks missing source postings and cash reconciliation", () => {
  assert.ok(html.includes("Source sale has no active revenue journal"));
  assert.ok(html.includes("Source sale has no active revenue journal"));
  assert.ok(html.includes("accounting_correction"));
  assert.ok(html.includes("cashFlow.reconciliationDifference"));
  assert.ok(html.includes("history_incomplete_count"));
  assert.ok(html.includes("opening_history_complete"));
});


test("supplier bill PDF loads jsPDF and AutoTable before generating the document", () => {
  assert.match(previewHtml, /async function accBillPdf\(id\)[\s\S]*?await sheriEnsurePdf\(\)/);
  assert.match(previewHtml, /function sheriEnsurePdf\(\)[\s\S]*?jspdf-autotable@3\.8\.2/);
  assert.match(previewHtml, /d\.autoTable\(\{startY:68/);
  assert.ok(previewHtml.includes("accBillPaid(b)"));
  assert.ok(previewHtml.includes("accBillStatus(b)"));
  assert.ok(previewHtml.includes("safeName+'.pdf'"));
});

test("supplier bill register displays saved line descriptions and catches PDF errors", () => {
  assert.ok(previewHtml.includes("<th>Description</th>"));
  assert.ok(previewHtml.includes("map(item=>item.description).filter(Boolean).join(', ')"));
  assert.ok(previewHtml.includes("accBillPdfClick("));
  assert.ok(previewHtml.includes("function accBillPdfClick(id){accBillPdf(id).catch(error=>"));
});

test("supplier bill PDF labels and bill register have French and Kinyarwanda translations", () => {
  for (const value of [
    "'description':'Ibisobanuro'",
    "'bill type':'Ubwoko bwa fagitire'",
    "'payment summary':'Incamake y’ubwishyu'",
    "'description':'Description'",
    "'bill type':'Type de facture'",
    "'payment summary':'Résumé du paiement'"
  ]) assert.ok(previewHtml.includes(value), "Missing bill translation: "+value);
});

test("preview localization covers recently identified navigation, payments and supplier-bill UI gaps", () => {
  for (const value of [
    "'activity & report period':'Ibikorwa n’igihe cya raporo'",
    "'payment status':'Imiterere y’ubwishyu'",
    "'paid now':'Yishyuwe ubu'",
    "'product / service':'Igicuruzwa / Serivisi'",
    "'what is this bill for?':'Iyi fagitire ni iyo iki?'",
    "'debit account for this purchase':'Konti igomba kwandikwaho ikiguzi cy’icyaguzwe'",
    "'activity & report period':'Activité et période du rapport'",
    "'payment status':'Statut du paiement'",
    "'paid now':'Payé maintenant'",
    "'product / service':'Produit / Service'",
    "'what is this bill for?':'Quel est l’objet de cette facture ?'",
    "'debit account for this purchase':'Compte à débiter pour cet achat'"
  ]) assert.ok(previewHtml.includes(value), "Missing preview translation: "+value);
});

test("preview localization retains English, French and Kinyarwanda and exposes a runtime language switch", () => {
  assert.match(previewHtml, /<option value="en">English<\/option><option value="rw">Ikinyarwanda<\/option><option value="fr">Français<\/option>/);
  assert.match(previewHtml, /window\.AIBOS_I18N=\{version:'1',getLanguage:.*?setLanguage:applyLanguage/s);
  assert.match(previewHtml, /window\.dispatchEvent\(new CustomEvent\('aibos:languagechange'/);
});

test("invoice and payment receipt PDFs also load the PDF engine before use", () => {
  assert.match(previewHtml, /async function accInvoicePdf\(id\)[\s\S]*?await sheriEnsurePdf\(\)/);
  assert.match(previewHtml, /async function accReceiptPdf\(id\)[\s\S]*?await sheriEnsurePdf\(\)/);
});

test("received purchases can be matched to supplier bills without duplicate inventory or payable journals", () => {
  assert.ok(previewHtml.includes('id="accBillPurchase"'));
  assert.ok(previewHtml.includes("function accBillPurchaseOptions()"));
  assert.ok(previewHtml.includes("purchase_id:purchaseId"));
  assert.ok(previewHtml.includes("if(!linkedPurchase){stage='posting the balanced accounting journal'"));
  assert.ok(previewHtml.includes("Matched bill must not create a second inventory/payable journal"));
  assert.ok(previewHtml.includes("function accPurchaseLinkedBill(p)"));
  assert.ok(previewHtml.includes("function accPurchasePaid(p)"));
  assert.ok(previewHtml.includes("source_type==='purchase'"));
});

test("supplier payments can settle bills or received purchases and are checked against outstanding balances", () => {
  assert.ok(previewHtml.includes("— Select a supplier bill or received purchase —"));
  assert.ok(previewHtml.includes("kind:'purchase'"));
  assert.ok(previewHtml.includes("sourceKind==='purchase'?accPurchaseOutstanding(doc)"));
  assert.ok(previewHtml.includes("sourceType=sourceKind||'bill'"));
  assert.ok(previewHtml.includes("['bill','purchase'].includes(payment.source_type)"));
});

test("purchase-to-bill link migration enforces one-to-one, same-merchant, supplier, status and amount matching", () => {
  assert.ok(purchaseLinkMigration.includes("add column if not exists purchase_id uuid"));
  assert.ok(purchaseLinkMigration.includes("create unique index if not exists bills_purchase_id_unique"));
  assert.ok(purchaseLinkMigration.includes("references public.purchases(id)"));
  assert.ok(purchaseLinkMigration.includes("and merchant_id = new.merchant_id"));
  assert.ok(purchaseLinkMigration.includes("purchase_row.status is distinct from 'received'"));
  assert.ok(purchaseLinkMigration.includes("new.supplier_id is distinct from purchase_row.supplier_id"));
  assert.ok(purchaseLinkMigration.includes("abs(coalesce(new.total, 0) - coalesce(purchase_row.total, 0)) > 0.005"));
});

test("language switching translates dynamically rendered nodes, form attributes and native dialogs", () => {
  assert.ok(previewHtml.includes("new MutationObserver(records=>"));
  assert.ok(previewHtml.includes("observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true"));
  assert.ok(previewHtml.includes("window.alert=message=>nativeAlert(translateString"));
  assert.ok(previewHtml.includes("window.confirm=message=>nativeConfirm(translateString"));
  assert.ok(previewHtml.includes("window.prompt=(message,defaultValue)=>nativePrompt(translateString"));
  assert.ok(previewHtml.includes("function renderReports()"));
  assert.ok(previewHtml.includes("sheriLocalized('Historical inventory valuation is not available"));
  assert.ok(previewHtml.includes("function sheriSyncLangSelectors(source)"));
  assert.ok(previewHtml.includes("window.AIBOS_I18N?.setLanguage?.(appLang)"));
});

test("received purchases require a supplier and linked purchase payments roll into the matched bill balance", () => {
  assert.ok(previewHtml.includes("Select a supplier so this purchase can be tracked and settled through Accounts Payable."));
  assert.ok(previewHtml.includes("purchasePayments=purchase?"));
  assert.ok(previewHtml.includes("return bill?accBillPaid(bill):"));
  assert.ok(previewHtml.includes("x.status==='received'&&!x.voided_at&&x.supplier_id&&!accPurchaseLinkedBill(x)"));
});


test("received purchase quantities and values must exactly match one stock receipt", () => {
  assert.match(inventoryIntegrityMigration, /abs\(v_receipt_qty-v_purchase_qty\)>0\.0001/);
  assert.match(inventoryIntegrityMigration, /abs\(v_receipt_value-\(v_purchase_qty\*v_purchase_unit_cost\)\)>0\.005/);
  assert.match(inventoryIntegrityMigration, /exactly one receipt movement/);
});

test("received purchase accounting fields cannot be edited after posting", () => {
  assert.match(inventoryIntegrityMigration, /old\.status='received'/);
  assert.match(inventoryIntegrityMigration, /new\.qty is distinct from old\.qty/);
  assert.match(inventoryIntegrityMigration, /new\.unit_cost is distinct from old\.unit_cost/);
  assert.match(inventoryIntegrityMigration, /supplier return or adjustment instead/);
  assert.match(inventoryIntegrityMigration, /before update on public\.purchases/i);
});

test("new opening-stock migrations require traceable product-level journals", () => {
  assert.match(inventoryIntegrityMigration, /new\.source_type='inventory_migration_reconciliation'/);
  assert.match(inventoryIntegrityMigration, /one source-linked opening-stock journal per product/);
  assert.match(inventoryIntegrityMigration, /before insert on public\.journal_entries/i);
});


test("received purchase voiding is atomic, permission-scoped, and preserves its audit trail", () => {
  for (const value of [
    "create or replace function public.void_received_purchase",
    "for update",
    "private.user_can_access_merchant(v_purchase.merchant_id,'manage_inventory')",
    "private.user_can_access_merchant(v_purchase.merchant_id,'manage_team')",
    "linked to a supplier bill",
    "payment is linked directly",
    "product_opening_stock",
    "inventory_reconciliation",
    "set_config('aibos.stock_movement_type','supplier_return'",
    "shericeri_write_audit",
    "voided_at=now()",
    "No records changed"
  ]) assert.ok(purchaseVoidFinalMigration.includes(value), "Missing purchase void safeguard: "+value);
});

test("voided legacy partial receipts are permitted only after a controlled void", () => {
  for (const value of [
    "v_voided_at timestamptz",
    "if v_voided_at is not null then",
    "Normal, non-voided purchases still require exact receipts",
    "abs(v_receipt_qty-v_purchase_qty)>0.0001"
  ]) assert.ok(purchaseVoidBaseMigration.includes(value), "Missing legacy receipt guard: "+value);
});

test("received purchase void action is online-only, reason-required, confirmed, and localized", () => {
  for (const app of [html, previewHtml]) {
    for (const value of [
      "async function voidOSPurchase(id)",
      "sb.rpc('void_received_purchase'",
      "reason.trim().length<3",
      "if(!confirm(confirmText))return",
      "Purchase voiding requires an online connection",
      "Hagarika ibyaguzwe",
      "Achat annulé",
      "await loadAll(true);render();"
    ]) assert.ok(app.includes(value), "Missing purchase void UI safeguard: "+value);
  }
});

test("voided purchases are excluded from supplier spend, rebuilds, bill matching and ledger completeness", () => {
  for (const app of [html, previewHtml]) {
    assert.ok(app.includes("function osPurchasesTotal(){return (state.purchases||[]).filter(x=>x.status!=='ordered'&&!x.voided_at)"));
    assert.ok(app.includes("function osSupplierSpend(id){return (state.purchases||[]).filter(x=>x.supplier_id===id&&!x.voided_at)"));
    assert.ok(app.includes("purchase.voided_at||purchase.status!=='received'"));
    assert.ok(app.includes("type:'Voided purchase'"));
    assert.ok(app.includes("state.purchases.filter(x=>x.status!=='ordered'&&!x.voided_at)"));
  }
});

test("purchase voiding does not modify the fixed online sync worker", () => {
  assert.ok(!serviceWorker.includes("void_received_purchase"));
  assert.ok(!previewServiceWorker.includes("void_received_purchase"));
});


test("purchase void creates one exact inverse and offsets the supplier-return movement journal", () => {
  for (const value of [
    "void_movement_offset_journal_entry_id",
    "'purchase_void',v_purchase.id",
    "v_payable,v_purchase.total,0",
    "v_inventory,0,v_purchase.total",
    "'supplier_return',v_purchase.id",
    "'purchase_void_movement_offset',v_purchase.id",
    "v_inventory,v_receipt_value,0",
    "v_payable,0,v_receipt_value"
  ]) assert.ok(purchaseVoidReversalMigration.includes(value), "Missing exact purchase reversal detail: "+value);
});

test("accounting balances and integrity checks recognize purchase_void as the exact reversal source", () => {
  for (const app of [html,previewHtml]) {
    const reversalLists=app.split("\n").filter(line=>line.includes("accounting_correction")&&line.includes("sale_void"));
    assert.ok(reversalLists.length>=2);
    assert.ok(reversalLists.every(line=>line.includes("purchase_void")));
    assert.ok(app.includes("['sale','sale_cogs','purchase'].includes(entry.source_type)"));
  }
});
