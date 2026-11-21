import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../shericeri_v14_4_aibos_sync_sw.js", import.meta.url), "utf8");
const teamAccess = readFileSync(new URL("../supabase/functions/team-access/index.ts", import.meta.url), "utf8");
const liveSyncMigration = readFileSync(new URL("../supabase/migrations/20261114170000_enable_authorized_realtime_and_register_owner_devices.sql", import.meta.url), "utf8");
const realtimeRlsMigration = readFileSync(new URL("../supabase/migrations/20261114171500_authorize_realtime_device_and_inventory_views.sql", import.meta.url), "utf8");
const sixDigitIdMigration = readFileSync(new URL("../supabase/migrations/20261114162636_enforce_six_digit_shericeri_business_ids.sql", import.meta.url), "utf8");
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
  assert.ok(html.includes("loadAll(true).then(()=>render())"));
});

test("trial balance places abnormal account balances on the opposite side", () => {
  assert.ok(html.includes("debit=normalSide==='debit'?Math.max(0,balance):Math.max(0,-balance)"));
  assert.ok(html.includes("credit=normalSide==='credit'?Math.max(0,balance):Math.max(0,-balance)"));
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
 
test("the offline application shell cache is bumped with the V14.4.70 release", () => {
  assert.ok(serviceWorker.includes("shericeri-v14.4-aibos-sync-v71"));
  assert.ok(serviceWorker.includes("const RELEASE='V14.4.71'"));
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


test("offline accounting restores its local snapshot before initializing the ledger", () => {
  assert.match(html, /if\(!navigator\.onLine\)\{await sheriLoadAccountingSnapshot\(mId\);await accEnsureBase\(\);/);
  assert.ok(html.includes("async function sheriLoadAccountingSnapshot(merchantId)"));
});

test("tax-rate setup avoids duplicate default rates and deduplicates equivalent choices", () => {
  assert.ok(!html.includes("name:'No tax',rate:0,type:'output',active:true"));
  assert.ok(html.includes("function accUniqueTaxRates(rows=state.taxRates||[])"));
  assert.ok(html.includes("accUniqueTaxRates().filter(x=>x.active&&x.type===kind)"));
  assert.ok(html.includes("accUniqueTaxRates().map(x=>"));
  assert.ok(html.includes("An active tax rate with this name, rate and type already exists."));
});

test("ledger integrity verifies invoice, bill, payment and cash source journals", () => {
  assert.ok(html.includes("Invoice source has no active invoice journal"));
  assert.ok(html.includes("Bill source has no active bill journal"));
  assert.ok(html.includes("Payment source has no active payment journal"));
  assert.ok(html.includes("Cash movement source has no active cash journal"));
  assert.ok(html.includes("Duplicate active journal postings exist for the same source"));
  assert.ok(html.includes("Invoice journal does not match its subtotal, discount, tax or accounts"));
  assert.ok(html.includes("Payment journal does not match its direction, amount or cash/bank account"));
});

test("expense and cash deletions post exact reversals before deleting source rows", () => {
  assert.ok(html.includes("sourceType:'expense_delete',sourceId:expense.id"));
  assert.ok(html.includes("sourceType:'cash_entry_delete',sourceId:cash.id"));
  assert.ok(html.includes("The expense was not deleted"));
  assert.ok(html.includes("The cash record was not deleted"));
  assert.ok(html.includes("Deleted expense has no exact accounting reversal"));
  assert.ok(html.includes("Deleted cash movement has no exact accounting reversal"));
});

test("other income payments are recorded as receipts, not payments", () => {
  assert.ok(html.includes("direction:type==='customer_receipt'||type==='other_income'?'receipt':'payment'"));
});

test("cash transfer memo deletions are excluded from ledger reversal requirements", () => {
  assert.ok(html.includes("a.details?.kind!=='transfer'"));
  assert.ok(html.includes("if(cash.kind!=='transfer'&&originals.length!==1)"));
});
