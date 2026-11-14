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
  assert.ok(html.includes("mergeKeepLocal(sales,state.sales);"));
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
