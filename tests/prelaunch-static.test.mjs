import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const quickService = await readFile(new URL("../supabase/functions/quick-service/index.ts", import.meta.url), "utf8");
const schemaPatch = await readFile(new URL("../supabase/patches/priority_one_storage_memory.sql", import.meta.url), "utf8");
const teamAccess = await readFile(new URL("../supabase/functions/team-access/index.ts", import.meta.url), "utf8");
const teamMigration = await readFile(new URL("../supabase/migrations/20261112183000_aibos_merchant_team_access.sql", import.meta.url), "utf8");

test("team managers cannot create administrator accounts or grant permissions they do not hold", () => {
  assert.match(teamAccess, /if \(role === "admin" && !isPrivilegedGrantor\)/);
  assert.match(teamAccess, /Only the business owner or an administrator can create another administrator/);
  assert.match(teamAccess, /callerPermissions\[permission\] !== true/);
  assert.match(teamAccess, /You cannot grant a permission you do not have/);
});

test("team permission delegation cannot exceed the manager's own permissions", () => {
  assert.ok(teamAccess.includes("callerPermissions[permission] !== true"));
  assert.ok(teamAccess.includes("You cannot grant a permission you do not have."));
  assert.ok(teamAccess.includes('action === "update_member"'));
  assert.ok(teamAccess.includes('action === "delete_member"'));
  assert.ok(teamAccess.includes('status: "suspended"') || teamAccess.includes('status=suspended'));
});

test("cancelled expense deletion does not post an accounting reversal", () => {
  assert.match(html, /await _v14_1_deleteExpense\(id\);if\(state\.expenses\.some\(x=>x\.id===id\)\)return;/);
});

test("sale void reason and transaction references are persisted to the audit trail", () => {
  assert.match(html, /type:'sale_void',id,reason:reason\.trim\(\),audit_id:auditId/);
  assert.match(html, /p_merchant_id:op\.merchant_id,p_sale_id:op\.id,p_transaction_id:op\.transaction_id\|\|null,p_reason:op\.reason,p_audit_id:op\.audit_id/);
  assert.ok(html.includes("invoice_number:invoice||null,transaction_id:transactionId"));
  assert.match(teamMigration, /create or replace function public\.shericeri_void_sale/);
  assert.match(teamMigration, /void_reason=trim\(p_reason\),voided_at=now\(\),voided_by=auth\.uid\(\)/);
});

test("cancelled sale void leaves records and accounting untouched", () => {
  assert.match(html, /if\(!confirm\(confirmText\)\)return;/);
  assert.doesNotMatch(html, /sourceType:'sale_void'/);
  assert.doesNotMatch(html, /const _v14_1_voidSale=voidSale/);
});

test("locally deleted expenses and voided invoice sale rows are removed from IndexedDB", () => {
  assert.match(html, /state\.expenses=state\.expenses\.filter\(x=>x\.id!==id\);await sheriDelete\('expenses',id\)/);
  assert.match(html, /for\(const row of rows\)[\s\S]*?await sheriDelete\('sales',row\.id\)/);
  assert.match(html, /state\.sales=state\.sales\.filter\(x=>!saleIds\.includes\(x\.id\)\)/);
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
  const browserFallback = html.indexOf("if(/^rw/i.test(lang))throw new Error('Kinyarwanda TTS native bridge is not installed');");
  const browserSpeak = html.indexOf("speechSynthesis.speak(utt);", browserFallback);
  assert.ok(browserFallback >= 0 && browserSpeak > browserFallback && browserSpeak - browserFallback < 800,
    "without a native bridge, Kinyarwanda must fail explicitly and browser TTS must remain reachable for supported languages");
  assert.match(html, /if\(window\.SHERICERI_VOICE_BRIDGE\?\.hasTtsBridge\)\{sheriDiagSet\('Kinyarwanda TTS fallback','LOCAL NATIVE BRIDGE'\)/);
});


test("stale TTS onstart callbacks never cancel a newer turn's global speech queue", () => {
  const start = html.indexOf("  utt.onstart=()=>{");
  const end = html.indexOf("\n  utt.onend=", start);
  assert.ok(start >= 0 && end > start, "expected utterance onstart handler");
  const onstart = html.slice(start, end);
  assert.match(onstart, /if\(turnId!==sheriTurnId\)\{[\s\S]*?return;/);
  assert.doesNotMatch(onstart, /speechSynthesis\.cancel\(\)/,
    "stale callbacks must not cancel newer utterances");
});

test("normal Android TTS waits for voices and does not cancel its fresh utterance", () => {
  const start = html.indexOf("  const speakNow=async()=>{");
  const end = html.indexOf("\n  // Explicit lifecycle:", start);
  assert.ok(start >= 0 && end > start, "expected normal speakNow implementation");
  const speakNow = html.slice(start, end);
  assert.match(speakNow, /await ensureVoicesLoaded\(500\)/);
  assert.match(speakNow, /speechSynthesis\.resume\(\);\s*speechSynthesis\.speak\(utt\)/);
  assert.match(speakNow, /const startTimeoutMs=isAndroid\?20000:5000/);
  assert.match(speakNow, /retrySpeech\('no onstart within '\+startTimeoutMs\+' ms'\)/);
  assert.doesNotMatch(speakNow, /speechSynthesis\.cancel\(\)/,
    "do not cancel the new utterance immediately before speaking");
  assert.match(html, /if\(isAndroid\)setTimeout\(\(\)=>\{if\(turnId===sheriTurnId\)speakNow\(\)\},90\)/);
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


test("Shericeri greets before opening the first recording and starts listening after playback", () => {
  const start = html.indexOf("async function startShericeriLoop()");
  const end = html.indexOf("\nfunction sheriSleepAfterGoodbye", start);
  assert.ok(start >= 0 && end > start, "expected session start function");
  const flow = html.slice(start, end);
  assert.match(flow, /sheriEnqueueSpeech\(sheriTapGreeting\(\),sheriTurnId\)/);
  assert.doesNotMatch(flow, /shericeriListenOnce\(\)/,
    "the mic must not record while the initial greeting is playing");
  assert.match(html, /function sheriTapGreeting\(\)[\s\S]*?Hello, how can I help you today\?/);
  assert.match(html, /function sheriDrainSpeakQueue\(\)[\s\S]*?sheriScheduleNextListen\(sheriTurnId\)/);
});

test("farewell and end-of-task phrases trigger sleep without treating a plain thank-you as goodbye", () => {
  const start = html.indexOf("function sheriIsGoodbyePhrase(q)");
  const end = html.indexOf("\nfunction sheriLanguageKey", start);
  assert.ok(start >= 0 && end > start);
  const goodbye = html.slice(start, end);
  assert.match(goodbye, /that's it/);
  assert.match(goodbye, /that's all/);
  assert.match(goodbye, /i'm done/);
  assert.match(goodbye, /c'est tout/);
  assert.match(goodbye, /birarangiye/);
  assert.doesNotMatch(goodbye, /\^\(thanks\|thank you\)\[!\?\.\]\*\$/);
});

test("recent Shericeri history survives sleep and is sent with validated memory to the server", () => {
  assert.doesNotMatch(html, /shericeriHistory=\[\];\s*sheriHistoryTurnId=0/,
    "session sleep must not erase the last exchanges");
  assert.match(html, /memory:sheriMemoryPayload/);
  assert.match(quickService, /history, memory \} = await req\.json\(\)/);
  assert.match(quickService, /const cleanMemory:[\s\S]*?slice\(0, 10\)/);
  assert.match(quickService, /grounding \+ memoryContext/);
});

test("mobile navigation wraps instead of forcing horizontal scrolling and dashboard metrics navigate", () => {
  assert.match(html, /\.nav\{display:flex;flex-wrap:wrap;[^}]*overflow:visible/);
  assert.match(html, /\.nav button\{white-space:normal;flex:1 1 calc\(33\.333% - 4px\)/);
  assert.match(html, /class=\"card metric-card\" onclick=\"show\('\$\{x\[3\]\}'\)\"/);
});

test("sync retries are scheduled and connectivity restoration kicks immediately", () => {
  assert.match(html, /async function sheriScheduleSyncRetry\(\)/);
  assert.match(html, /finally\{sheriSyncBusy=false; sheriScheduleSyncRetry\(\);\}/);
  assert.match(html, /addEventListener\('online',[\s\S]*?sherriSyncKick\(\)/);
  assert.match(html, /if\(navigator\.onLine\)sherriSyncKick\(\)/);
});

test("microphone waits briefly after playback to avoid capturing speaker echo", () => {
  assert.match(html, /Listen guard','400 ms post-playback echo guard'/);
  assert.match(html, /\},400\);\n\}\n\nlet sheriKinyaAudioEl=null/);
});

test("deterministic business fast-lane answers are added to recent memory", () => {
  assert.match(html, /sheriCommitAssistantHistory\(thisTurnId,localizedFast\);\s*const fastMemory=sheriDecideMemoryWrite\(transcript,localizedFast,'local_business'\)/);
  assert.match(html, /if\(fastMemory\)sheriQueueMemory\(fastMemory\.category,fastMemory\.content\)/);
});

test("pending sync button shows each queued activity, its status, failure reason and retry time", () => {
  assert.match(html, /onclick="sheriTogglePendingSync\(\)">Pending activity/);
  assert.match(html, /async function sheriTogglePendingSync\(\)/);
  assert.match(html, /item\.last_error/);
  assert.match(html, /item\.blocked/);
  assert.match(html, /item\.next_retry_at/);
});

test("all transaction tables scroll horizontally on small screens", () => {
  assert.match(html, /\[id\$="Table"\]\{max-width:100%;overflow-x:auto/);
  assert.match(html, /\[id\$="Table"\] \.table\{min-width:620px/);
});

test("each navigated page receives a back button and navigation history", () => {
  assert.match(html, /function sheriEnsureViewBack\(v\)/);
  assert.match(html, /function sheriGoBack\(\)/);
  assert.match(html, /sheriViewHistory\.push\(sheriCurrentView\)/);
  assert.match(html, /sheriEnsureViewBack\(v\);render\(\)/);
});

test("sale, product, advisor and expense voice entry share MediaRecorder and authenticated Whisper transcription", () => {
  assert.match(html, /async function sheriStartFormVoice\(statusId,onTranscript,hint\)/);
  assert.match(html, /new MediaRecorder\(sheriFormVoiceStream/);
  assert.match(html, /mode:lang==='rw'\?'kinya_transcribe':'transcribe'/);
  assert.match(html, /function startVoice\(\)\{sheriStartFormVoice\('voiceStatus',parseVoiceSale/);
  assert.match(html, /function startProductVoice\(\)\{sheriStartFormVoice\('productVoiceStatus',parseVoiceProduct/);
  assert.match(html, /function startAdvisorVoice\(\)\{sheriStartFormVoice\('advisorVoiceStatus'/);
  assert.match(html, /sheriStartFormVoice\('expenseVoiceStatus',parseVoiceExpense/);
});

test("sales and expenses confirm before saving and post balanced journal entries immediately", () => {
  const saleStart = html.indexOf("async function recordSale()");
  const saleEnd = html.indexOf("\nasync function voidSale", saleStart);
  assert.ok(saleStart >= 0 && saleEnd > saleStart, "expected the complete sale recording function");
  const sale = html.slice(saleStart, saleEnd);
  assert.ok(sale.includes("confirm('Confirm sale?"), "sale must be confirmed before it is recorded");
  assert.ok(sale.includes("sheriToast('Sale confirmed."), "sale confirmation must be immediate");
  assert.ok(sale.includes("Promise.resolve().then(()=>sheriSyncOutbox())"), "background sync must not delay the sale confirmation");

  const saleAccountingStart = html.indexOf("const _v14_1_recordSale=recordSale");
  const saleAccountingEnd = html.indexOf("const _v14_1_addOSPurchase", saleAccountingStart);
  assert.ok(saleAccountingStart >= 0 && saleAccountingEnd > saleAccountingStart, "expected the sale accounting wrapper");
  const saleAccounting = html.slice(saleAccountingStart, saleAccountingEnd);
  assert.ok(saleAccounting.includes("sourceType:'sale',sourceId:s.id"));
  assert.ok(saleAccounting.includes("sourceType:'sale_cogs',sourceId:s.id"));

  const expenseStart = html.indexOf("function addExpense()");
  const expenseEnd = html.indexOf("\nasync function deleteExpense", expenseStart);
  assert.ok(expenseStart >= 0 && expenseEnd > expenseStart, "expected the complete expense recording function");
  const expense = html.slice(expenseStart, expenseEnd);
  assert.ok(expense.includes("confirm('Record this expense?"));
  assert.ok(expense.includes("sourceType:'expense',sourceId:data.id"));
  assert.ok(expense.includes("sheriToast('Expense recorded."));
});

test("cashier sales use an atomic stock RPC on normal sync and auth-retry paths", () => {
  assert.ok(html.includes("async function sheriSyncSaleOperation(op)"));
  assert.ok(html.includes("sb.rpc('shericeri_sync_sale_stock'"));
  assert.ok(html.includes("op.type==='sale_upsert'){await sheriSyncSaleOperation(op)}"));
  assert.ok(html.includes("op.type==='sale_void'){await sheriSyncVoidSale(op)}"));
  assert.ok(teamMigration.includes("create or replace function public.shericeri_sync_sale_stock"));
  assert.ok(teamMigration.includes("private.user_can_access_merchant(v_merchant_id,'create_sale')"));
});

test("operational staff receive only chart identifiers while financial reports and audit logs stay permission-gated", () => {
  assert.match(teamMigration, /v_can_view_reports boolean/);
  assert.match(teamMigration, /'journalEntries',case when v_can_view_reports/);
  assert.match(teamMigration, /'auditLog',case when private\.user_can_access_merchant\(p_merchant_id,'view_audit_log'\)/);
  assert.match(teamMigration, /shericeri_ensure_operational_accounts/);
});

test("manager-only destructive actions require reasons and are protected by backend policies", () => {
  for (const fn of ["deleteProduct","deleteExpense","deleteCustomer","deleteOSSupplier","deleteOSPurchase","deleteOSCash","deleteOSBudget"]) {
    const start = html.indexOf("async function "+fn+"(");
    assert.ok(start >= 0, "missing "+fn);
    const block = html.slice(start, start + 1100);
    assert.match(block, /sheriCan\('manage_team'\)/, fn+" must be manager-gated");
    assert.match(block, /reason=prompt\(/, fn+" must require a reason");
  }
  assert.match(html, /if\(!sheriCan\('manage_team'\)\)return sheriToast\('Only a Manager, Admin or Owner can void sales/);
  assert.match(teamMigration, /write_perm:='manage_team'/);
  assert.match(teamMigration, /if not private\.user_can_access_merchant\(v_merchant_id,'manage_team'\) then/);
});

test("inventory staff can add products and receive purchases without editing existing product masters", () => {
  assert.ok(html.includes("async function sheriSyncPurchaseOperation(op)"));
  assert.ok(html.includes("sb.rpc('shericeri_sync_purchase_stock'"));
  assert.ok(html.includes("sheriCan('manage_inventory')"));
  assert.ok(html.includes("Only non-managers may create a product, but never overwrite an existing one.") || html.includes("Non-managers may create a product, but never overwrite an existing one."));
  assert.ok(teamMigration.includes("create or replace function public.shericeri_sync_purchase_stock"));
  assert.ok(teamMigration.includes("private.user_can_access_merchant(v_merchant_id,'manage_inventory')"));
  assert.ok(teamMigration.includes("stock_applied"));
});

test("team administration requires the manager role, not only a delegated flag", () => {
  assert.ok(teamAccess.includes("membership.role === \"manager\" && callerPermissions.manage_team === true"));
  assert.ok(teamAccess.includes("callerRole === \"manager\" && callerPermissions.manage_team === true"));
  assert.ok(teamAccess.includes("Team administration can only be assigned to a manager or administrator role."));
});

test("cashier accounting setup and journal posting are permission-scoped", () => {
  assert.match(html, /sb\.rpc\('shericeri_ensure_operational_accounts'/);
  assert.match(teamMigration, /private\.user_can_access_merchant\(p_merchant_id,'create_sale'\)/);
  assert.match(teamMigration, /p_source_type in \('sale','sale_cogs'\)/);
  assert.match(teamMigration, /'journalEntries',case when v_can_view_reports/);
});

test("multi-product sales support add, remove, confirmation, transaction IDs and printable receipts", () => {
  assert.ok(html.includes("function addSaleToCart()"));
  assert.ok(html.includes("function removeSaleCartItem(i)"));
  assert.ok(html.includes("function clearSaleCart()"));
  assert.ok(html.includes("function printLastReceipt()"));
  assert.ok(html.includes("transactionId=sheriUuid()"));
  assert.ok(html.includes("invoice='INV-'"));
});

test("favorite products are ordered before other products and expiry alerts reach the business snapshot", () => {
  assert.ok(html.includes("Number(!!b.favorite)-Number(!!a.favorite)"));
  assert.ok(html.includes("expiryAlerts=activeProducts()"));
  assert.ok(html.includes("expiry_date"));
  assert.ok(html.includes("systemSnapshot:{merchant:state.merchant,products:state.products"));
});

test("voice entry requires an explicit stop, review, use or discard action", () => {
  assert.ok(html.includes("Done recording"));
  assert.ok(html.includes("function sheriConfirmVoiceEntry()"));
  assert.ok(html.includes("function sheriDiscardVoiceEntry()"));
  assert.ok(html.includes("window.__sheriPendingVoice"));
});

test("Shericeri receives operational, accounting, team, calendar, image and formula context", () => {
  assert.ok(html.includes("teamMembers:state.teamMembers||[]"));
  assert.ok(html.includes("calendar:businessCalendar"));
  assert.ok(html.includes("currentDateTime,currentTimeZone,businessCalendar"));
  assert.ok(html.includes("productImages:state.products.filter(p=>p.image_url)"));
  assert.ok(html.includes("settings:{merchant:state.merchant,accounting:state.accountingSettings}"));
  assert.ok(html.includes("accountingSettings:state.accountingSettings"));
  assert.ok(html.includes("products:state.products"));
  assert.ok(html.includes("formulas:{revenue:"));
});

test("sales, expenses and reports support daily, weekly, monthly and custom calendar date ranges", () => {
  for (const id of ['reportPeriod','salesPeriod','expensePeriod']) assert.match(html, new RegExp('id="'+id+'"'));
  assert.match(html, /function sheriApplyDateRange\(mode,fromId,toId\)/);
  assert.match(html, /function accReportTotals\(startDate=null,endDate=null\)/);
  assert.match(html, /accReportTotals\(reportStart,reportEnd\),bs=accReportTotals\(null,reportEnd\)/);
  assert.match(html, /function accCashFlowForPeriod\(startDate,endDate\)/);
});

test("search suggestions are available for products, sales, expenses, invoices, bills and payments", () => {
  for (const host of ['salesSearchHost','inventorySearchHost','expenseSearchHost','accInvoiceSearchHost','accBillSearchHost','accPaymentSearchHost']) assert.ok(html.includes(host), 'missing '+host);
  assert.match(html, /function sheriSearchControl\(key,target,placeholder,values\)/);
  assert.match(html, /function sheriSearchTable\(input\)/);
});

test("operational transaction lists are ordered by occurrence timestamp", () => {
  assert.match(html, /state\.sales\.filter\(s=>sheriDateInReportRange\(s\.created_at\)\)\.slice\(\)\.sort\(\(a,b\)=>String\(b\.created_at/);
  assert.match(html, /state\.expenses\.filter\(e=>sheriDateInReportRange\(e\.created_at\)\)\.slice\(\)\.sort\(\(a,b\)=>String\(b\.created_at/);
  assert.match(html, /state\.payments\.slice\(\)\.sort\(\(a,b\)=>String\(b\.payment_date/);
});
test("recent activity combines business transactions and sorts them by occurrence time", () => {
  assert.match(html, /function sheriRecentActivitiesHtml\(\)/);
  assert.match(html, /for\(const s of state\.sales/);
  assert.match(html, /for\(const e of state\.expenses/);
  assert.match(html, /for\(const p of state\.purchases/);
  assert.match(html, /for\(const c of state\.cashEntries/);
  assert.match(html, /for\(const p of state\.payments/);
  assert.match(html, /sort\(\(a,b\)=>String\(b\.when/);
});

test("new product opening inventory and explicit stock gain/write-off adjustments post balanced journal entries", () => {
  assert.match(html, /sourceType:'product_opening_stock',sourceId:openingStockProduct\.id/);
  assert.match(html, /option value="stock_writeoff"/);
  assert.match(html, /option value="stock_gain"/);
  assert.match(html, /type==='stock_writeoff'\)\{lines=\[\{accountId:accAccountCode\('6000'\)\.id,debit:amount\}/);
  assert.match(html, /else\{lines=\[\{accountId:inv\.id,debit:amount\},\{accountId:accAccountCode\('3000'\)\.id,credit:amount\}/);
  assert.match(html, /function accAdjustTypeChanged\(\)/);
});

test("customer records support shared voice entry and confirmation before saving", () => {
  assert.match(html, /sheriStartFormVoice\('customerVoiceStatus',parseVoiceCustomer/);
  assert.match(html, /function parseVoiceCustomer\(transcript\)/);
  assert.match(html, /Add this customer\?/);
});
