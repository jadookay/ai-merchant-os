import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const quickService = await readFile(new URL("../supabase/functions/quick-service/index.ts", import.meta.url), "utf8");
const schemaPatch = await readFile(new URL("../supabase/patches/priority_one_storage_memory.sql", import.meta.url), "utf8");

test("cancelled expense deletion does not post an accounting reversal", () => {
  assert.match(html, /await _v14_1_deleteExpense\(id\);if\(state\.expenses\.some\(x=>x\.id===id\)\)return;/);
});

test("cancelled sale void does not post an accounting reversal", () => {
  assert.match(html, /await _v14_1_voidSale\(id\);if\(state\.sales\.some\(x=>x\.id===id\)\)return;/);
});

test("locally deleted expenses and sales are removed from IndexedDB", () => {
  assert.match(html, /state\.expenses=state\.expenses\.filter\(x=>x\.id!==id\);await sheriDelete\('expenses',id\)/);
  assert.match(html, /state\.sales=state\.sales\.filter\(x=>x\.id!==id\);\s*await sheriDelete\('sales',id\)/);
});

test("journal entries synchronize as one atomic RPC batch", () => {
  assert.match(html, /async function sheriSyncJournalBatch\(op\)[\s\S]*?sb\.rpc\('shericeri_sync_journal_batch'/);
  assert.match(html, /syncLines\.push\(line\)/);
  assert.match(html, /type:'accounting_journal_batch',entry,lines:syncLines/);
  assert.equal((html.match(/op\.type==='accounting_journal_batch'/g) || []).length, 2);
});

test("AI Advisor, extraction and Shericeri use the deployed quick-service function", () => {
  for (const mode of ["extract", "barcode", "extract_batch", "organize_import"]) {
    assert.match(html, new RegExp("sb\\.functions\\.invoke\\('quick-service',\\{body:\\{mode:'" + mode + "'"));
    assert.match(quickService, new RegExp('mode === "' + mode + '"'));
  }
  assert.match(html, /functions\/v1\/quick-service/);
  assert.match(quickService, /mode === "shericeri"/);
  assert.doesNotMatch(html, /sb\.functions\.invoke\('advisor',\{body:\{mode:'(?:extract|barcode|extract_batch|organize_import)/);
});

test("cloud memory and product image access are represented by a reviewed SQL patch", () => {
  assert.match(schemaPatch, /create table if not exists public\.shericeri_memory/i);
  assert.match(schemaPatch, /enable row level security/i);
  assert.match(schemaPatch, /product_images_owner_insert/i);
  assert.match(schemaPatch, /file_size_limit = 4194304/i);
  assert.match(schemaPatch, /revoke execute on function public\.shericeri_sync_journal_batch/i);
});

test("all inline application scripts parse without syntax errors", () => {
  const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 1, "expected inline application scripts");
  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` }));
  }
});
