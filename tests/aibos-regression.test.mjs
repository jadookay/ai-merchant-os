import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
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
  assert.ok(html.includes("if(pendingIdsFor(store).has(x.id))sm.set(x.id,{...x,_serverConfirmed:false})"));
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
  assert.ok(html.includes("panel.style.maxHeight='360px'"));
  assert.ok(html.includes("panel.style.overflowY='auto'"));
  assert.ok(html.includes("function sheriPendingActivityDetails(op)"));
  for(const value of ["Total ","Cost value ","fmt(r.amount)","Waiting to sync"])
    assert.ok(html.includes(value), "Missing pending activity detail: "+value);
});

test("financial reports flag incomplete or unbalanced journal entries", () => {
  assert.ok(html.includes("function accLedgerIntegrity(endDate=null)"));
  assert.ok(html.includes("Financial statements are NOT reconciled"));
  assert.ok(html.includes("Balance sheet is NOT verified because journal entries are incomplete."));
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
