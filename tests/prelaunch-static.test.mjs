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

test("journal entries synchronize as one atomic RPC batch on normal and auth-retry paths", () => {
  assert.match(html, /async function sheriSyncJournalBatch\(op\)[\s\S]*?sb\.rpc\('shericeri_sync_journal_batch'/);
  assert.match(html, /syncLines\.push\(line\)/);
  assert.match(html, /type:'accounting_journal_batch',entry,lines:syncLines/);

  const syncStart = html.indexOf("async function sheriSyncOutbox(){");
  const syncEnd = html.indexOf("\nfunction sheriOnlineEvents(){", syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, "expected complete outbox sync function");
  const sync = html.slice(syncStart, syncEnd);
  const normalEnd = sync.indexOf("      }catch(err){");
  const retryStart = sync.indexOf("// Re-run this operation exactly once");
  const retryEnd = sync.indexOf("await sheriDelete('outbox',item.key);", retryStart);
  assert.ok(normalEnd > 0 && retryStart > normalEnd && retryEnd > retryStart, "expected normal and 401 retry sections");

  const countBatch = source => (source.match(/op\.type==='accounting_journal_batch'/g) || []).length;
  assert.equal(countBatch(sync.slice(0, normalEnd)), 1, "normal outbox processing must handle journal batches exactly once");
  assert.equal(countBatch(sync.slice(retryStart, retryEnd)), 1, "401 retry must handle journal batches exactly once");
  assert.equal(countBatch(sync), 2, "there must be exactly two handlers total: normal path and auth retry");
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

test("browser TTS fallback is used when the compatibility bridge is only a placeholder", () => {
  assert.match(html, /hasTtsBridge:!!oldTTS\?\.speak/);
  assert.match(html, /window\.SHERICERI_VOICE_BRIDGE\?\.hasTtsBridge/);
  assert.match(html, /if\(window\.SHERICERI_VOICE_BRIDGE\?\.hasTtsBridge\)\{await window\.SHERICERI_VOICE_BRIDGE\.speak\(next,lang\);finish\('local-bridge-complete'\);return;\}/);
  assert.match(html, /if\(\/^rw\/i\.test\(lang\)\)throw new Error\('Kinyarwanda TTS native bridge is not installed'\);\s*speechSynthesis\.resume\(\);\s*speechSynthesis\.cancel\(\);\s*speechSynthesis\.speak\(utt\);/);
  assert.match(html, /if\(window\.SHERICERI_VOICE_BRIDGE\?\.hasTtsBridge\)\{sheriDiagSet\('Kinyarwanda TTS fallback','LOCAL NATIVE BRIDGE'\)/);
});

test("product image picker matches the storage MIME allowlist", () => {
  assert.match(html, /!\['image\/jpeg','image\/png','image\/webp','image\/gif'\]\.includes\(file\.type\)/);
});

test("cloud memory and product image access are represented by a reviewed SQL patch", () => {
  assert.match(schemaPatch, /create table if not exists public\.shericeri_memory/i);
  assert.match(schemaPatch, /enable row level security/i);
  assert.match(schemaPatch, /product_images_owner_insert/i);
  assert.match(schemaPatch, /file_size_limit = 4194304/i);
  assert.match(schemaPatch, /revoke execute on function public\.shericeri_sync_journal_batch/i);
});

test("all inline application scripts parse without syntax errors", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 1, "expected inline application scripts");
  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` }));
  }
});
