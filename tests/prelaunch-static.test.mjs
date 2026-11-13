import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const quickService = await readFile(new URL("../supabase/functions/quick-service/index.ts", import.meta.url), "utf8");
const schemaPatch = await readFile(new URL("../supabase/patches/priority_one_storage_memory.sql", import.meta.url), "utf8");
const teamAccess = await readFile(new URL("../supabase/functions/team-access/index.ts", import.meta.url), "utf8");
const teamMigration = await readFile(new URL("../supabase/migrations/20261112183000_aibos_merchant_team_access.sql", import.meta.url), "utf8");
const authorizationFixMigration = await readFile(new URL("../supabase/migrations/20261113150000_aibos_release_authorization_fixes.sql", import.meta.url), "utf8");
const atomicCartMigration = await readFile(new URL("../supabase/migrations/20261113153000_aibos_atomic_cart_sync.sql", import.meta.url), "utf8");
const pinRateLimitMigration = await readFile(new URL("../supabase/migrations/20261113160000_aibos_pin_rate_limit.sql", import.meta.url), "utf8");
const storageMemoryMigration = await readFile(new URL("../supabase/migrations/20261112170000_aibos_priority_storage_memory.sql", import.meta.url), "utf8");
const previewHtml = await readFile(new URL("../preview/index.html", import.meta.url), "utf8");
const previewScript = previewHtml.slice(previewHtml.indexOf("<script>") + 8, previewHtml.lastIndexOf("</script>"));
new vm.Script(previewScript, { filename: "preview/index.html" });


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
  assert.match(html, /type:'sale_void',id,merchant_id:state\.merchant\.id,reason:reason\.trim\(\),audit_id:auditId/);
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

test("staff login identifiers can be edited without exposing PIN hashes", () => {
  assert.ok(html.includes("Email address (leave blank to remove email login)"));
  assert.ok(html.includes("Phone number in international format"));
  assert.ok(html.includes("Username (optional; leave blank to remove)"));
  assert.ok(teamAccess.includes("const memberPatch: Record<string, unknown> = { full_name: fullName, responsibility, role, permissions, status"));
  assert.ok(teamAccess.includes("admin.auth.admin.updateUserById(target.user_id, { email, email_confirm: true })"));
  assert.ok(teamAccess.includes("Keep at least one staff login identifier"));
  assert.doesNotMatch(teamAccess, /select\([^\n]*pin_hash/);
});

test("manager accounts receive team and sales-control capabilities by default", () => {
  assert.ok(html.includes("manage_sales:role==='manager'||document.getElementById('teamSalesManage').checked"));
  assert.ok(html.includes("manage_team:role==='manager'||document.getElementById('teamManage').checked"));
  assert.ok(teamAccess.includes("permissions.manage_sales === true) && role !== \"manager\""));
});

test("manager-only destructive actions require reasons and are protected by backend policies", () => {
  for (const fn of ["deleteProduct","deleteExpense","deleteCustomer","deleteOSSupplier","deleteOSPurchase","deleteOSCash","deleteOSBudget"]) {
    const start = html.indexOf("async function "+fn+"(");
    assert.ok(start >= 0, "missing "+fn);
    const block = html.slice(start, start + 1100);
    assert.match(block, /sheriCan\('manage_team'\)/, fn+" must be manager-gated");
    assert.match(block, /reason=prompt\(/, fn+" must require a reason");
  }
  assert.match(html, /if\(!sheriCan\('manage_sales'\)\)return sheriToast\('Only an Owner, Admin or authorized Manager can void sales/);
  assert.match(teamMigration, /when t\.table_name='sales' then 'manage_sales'/);
  assert.match(teamMigration, /private\.user_can_access_merchant\(v_merchant_id,'manage_sales'\)/);
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
  assert.ok(teamAccess.includes("Manager-level controls can only be assigned to a manager or administrator role."));
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


test("team migration preserves owner RLS, prevents forged staff audit inserts and scopes edits by function", () => {
  assert.ok(teamMigration.includes("without removing or replacing the existing owner policies"));
  assert.ok(!teamMigration.includes("for pol in select policyname"));
  assert.ok(teamMigration.includes("t.table_name not in ('audit_log','sales','purchases','journal_entries','journal_lines')"));
  assert.ok(teamMigration.includes("when t.table_name='sales' then 'manage_sales'"));
  assert.ok(teamMigration.includes("when t.table_name='products' then 'manage_inventory'"));
  assert.ok(teamMigration.includes("when t.table_name='expenses' then 'manage_expenses'"));
  assert.ok(teamMigration.includes("private.user_can_access_merchant(merchant_id,''manage_team'') and private.user_can_access_merchant(merchant_id,%L)"));
});

test("sale voiding retains source rows, reverses posted journals and is idempotent", () => {
  assert.ok(teamMigration.includes("add column if not exists voided boolean not null default false"));
  assert.ok(teamMigration.includes("set voided=true,void_reason=trim(p_reason),voided_at=now(),voided_by=auth.uid(),stock_applied=false"));
  assert.ok(teamMigration.includes("source_type='sale_void' and source_id=v_original.id"));
  assert.ok(teamMigration.includes("jl.credit,jl.debit"));
  assert.ok(!teamMigration.includes("delete from public.sales"));
  assert.ok(teamMigration.includes("private.user_can_access_merchant(v_merchant_id,'manage_sales')"));
});

test("stock conflicts do not create partial sale or purchase records", () => {
  const saleStart=teamMigration.indexOf("create or replace function public.shericeri_sync_sale_stock");
  const saleEnd=teamMigration.indexOf("revoke all on function public.shericeri_sync_sale_stock",saleStart);
  const sale=teamMigration.slice(saleStart,saleEnd);
  assert.ok(sale.indexOf("if v_current_stock<>p_expected_server_stock") < sale.indexOf("insert into public.sales"));
  assert.ok(sale.includes("return jsonb_build_object('ok',false,'stock_conflict',true"));
  const purchaseStart=teamMigration.indexOf("create or replace function public.shericeri_sync_purchase_stock");
  const purchase=teamMigration.slice(purchaseStart);
  assert.ok(purchase.indexOf("if v_current_stock<>p_expected_server_stock") < purchase.indexOf("insert into public.purchases"));
  assert.ok(purchase.includes("return jsonb_build_object('ok',false,'stock_conflict',true"));
});

test("voided server sales are excluded from the active sales workspace", () => {
  assert.ok(html.includes("state.sales=mergeKeepLocal(sales,state.sales,sheriCan('view_sales')||sheriCan('manage_sales')).filter(x=>!x.voided)"));
});


test("destructive controls require both a manager-level role and the relevant responsibility", () => {
  for (const [fn,permission] of [
    ["deleteProduct","manage_inventory"],["deleteExpense","manage_expenses"],
    ["deleteCustomer","manage_customers"],["deleteOSSupplier","manage_suppliers"],
    ["deleteOSPurchase","manage_inventory"],["deleteOSCash","manage_finance"],
    ["deleteOSBudget","manage_finance"]
  ]) {
    const start=html.indexOf("async function "+fn+"(");
    assert.ok(start>=0,"missing "+fn);
    const block=html.slice(start,start+500);
    assert.ok(block.includes("sheriCan('manage_team')") && block.includes("sheriCan('"+permission+"')"),
      fn+" must require both manager role and the relevant permission");
  }
});


test("staff sales, purchases, journal entries and audit records must use trusted RPCs", () => {
  assert.ok(teamMigration.includes("t.table_name not in ('audit_log','sales','purchases','journal_entries','journal_lines')"));
  assert.ok(teamMigration.includes("t.table_name not in ('audit_log','sales','journal_entries','journal_lines')"));
  assert.ok(teamMigration.includes("shericeri_write_audit"));
  assert.ok(teamMigration.includes("shericeri_delete_ordered_purchase"));
  assert.ok(html.includes("sb.rpc('shericeri_write_audit'"));
  assert.ok(html.includes("sb.rpc('shericeri_delete_ordered_purchase'"));
  assert.ok(!html.includes("op.table==='audit_log'){const {error}=await sb.from(op.table).upsert"));
});

test("ordered purchase deletion carries its reason and is checked server-side", () => {
  assert.ok(html.includes("type:'purchase_delete',id,merchant_id:state.merchant.id,reason:reason.trim(),audit_id:sheriUuid()"));
  assert.ok(teamMigration.includes("v_purchase.status<>'ordered'"));
  assert.ok(teamMigration.includes("Received purchases cannot be deleted"));
  assert.ok(teamMigration.includes("private.user_can_access_merchant(p_merchant_id,'manage_team')"));
});


test("team status changes preserve omitted email, phone and username login identifiers", () => {
  assert.ok(teamAccess.includes('body?.email === undefined ? undefined'));
  assert.ok(teamAccess.includes('body?.phone === undefined ? undefined'));
  assert.ok(teamAccess.includes('body?.username === undefined ? undefined'));
  assert.ok(teamAccess.includes('const nextEmail = email === undefined ? target.email : email'));
  assert.ok(teamAccess.includes('if (email !== undefined) memberPatch.email = email'));
  assert.ok(teamAccess.includes('if (phone !== undefined) memberPatch.phone = phone'));
  assert.ok(teamAccess.includes('if (username !== undefined) memberPatch.username = username'));
});

test("team account creation validates email, phone, username and PIN formats", () => {
  assert.ok(teamAccess.includes('if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))'));
  assert.ok(teamAccess.includes('if (phone && !/^\\+?\\d{7,15}$/.test(phone))'));
  assert.ok(teamAccess.includes('if (username && !/^[a-z0-9._-]{3,40}$/.test(username))'));
  assert.ok(teamAccess.includes('!/^\\d{6,8}$/.test(pin)'));
});


test("ordered purchase deletion uses the same guarded RPC after token refresh", () => {
  assert.ok((html.match(/sb\.rpc\('shericeri_delete_ordered_purchase'/g)||[]).length>=2);
  assert.ok(teamMigration.includes("if v_purchase.status<>'ordered' then"));
});


test("reports, sales and expenses include a calendar-year filter", () => {
  assert.equal(html.split('<option value="yearly">Yearly</option>').length - 1, 3);
  assert.ok(html.includes("else if(mode==='yearly')start=sheriLocalDateKey(new Date(today.getFullYear(),0,1))"));
});

test("team status is presented as an enabled/disabled control while preserving suspended backend state", () => {
  assert.ok(html.includes("m.status==='active'?'Enabled':m.status==='suspended'?'Disabled'"));
  assert.ok(html.includes("m.status==='active'?'Disable':'Enable'"));
  assert.ok(html.includes("const status=m.status==='active'?'suspended':'active'"));
});

test("safe preview contains inventory movements, reports and device-session controls", () => {
  assert.match(previewHtml, /Stock Movements/);
  assert.match(previewHtml, /Business performance reports/);
  assert.match(previewHtml, /Signed-in devices/);
  assert.match(previewHtml, /function recordMovement/);
  assert.match(previewHtml, /function revokeAllDevices/);
  assert.match(previewHtml, /Security simulation only/);
  assert.doesNotMatch(previewHtml, /supabase\.co|fetch\s*\(/i);
});

test("safe preview includes mandatory stock reasons, date reports and separated valuation permissions", () => {
  assert.match(previewHtml, /Mandatory reason \/ source/);
  assert.match(previewHtml, /value="year"/);
  assert.match(previewHtml, /view_inventory_costs/);
  assert.match(previewHtml, /function revokeDevice/);
  assert.match(previewHtml, /function removeStaff/);
});


test("AIBOS language switch supports English, everyday Kinyarwanda and French without external translation calls", () => {
  const localeStart = html.indexOf("/* AIBOS_I18N_V1");
  assert.ok(localeStart >= 0, "missing localization module");
  const localeScriptStart = html.lastIndexOf("<script>", localeStart) + 8;
  const localeScriptEnd = html.indexOf("</script>", localeStart);
  assert.ok(localeScriptStart >= 8 && localeScriptEnd > localeScriptStart);
  const localeScript = html.slice(localeScriptStart, localeScriptEnd);
  new vm.Script(localeScript, { filename: "AIBOS_I18N_V1" });
  assert.ok(html.includes('id="aibosLanguageSelect"'));
  assert.ok(html.includes('<option value="rw">Ikinyarwanda</option>'));
  assert.ok(html.includes('<option value="fr">Français</option>'));
  assert.ok(localeScript.includes("localStorage.setItem('aibos_language',current)"));
  assert.ok(localeScript.includes("'record sale':'Andika igurisha'"));
  assert.ok(localeScript.includes("'profit':'Inyungu'"));
  assert.ok(localeScript.includes("'revenue':'Amafaranga yinjiye'"));
  assert.ok(localeScript.includes("'record sale':'Enregistrer une vente'"));
  assert.ok(localeScript.includes("'profit':'Bénéfice'"));
  assert.ok(localeScript.includes("new MutationObserver"));
  assert.ok(localeScript.includes("aibos:languagechange"));
  assert.ok(localeScript.includes("window.alert=message=>"));
  assert.ok(localeScript.includes("window.confirm=message=>"));
  assert.ok(localeScript.includes("window.prompt=(message,defaultValue)=>"));
  assert.ok(localeScript.includes("phraseFragments"));
  assert.ok(localeScript.includes("'cost of goods sold':'Ikiguzi cy’ibicuruzwa byagurishijwe'"));
  assert.doesNotMatch(localeScript, /fetch\s*\(|https?:\/\//i);
  assert.ok(localeScript.includes("does not change business records"));
});


test("operational updates do not require team administration, while deletes remain manager-gated", () => {
  assert.match(authorizationFixMigration, /for update to authenticated using \(private\.user_can_access_merchant\(merchant_id,%L\)\) with check \(private\.user_can_access_merchant\(merchant_id,%L\)\)/);
  assert.match(authorizationFixMigration, /v_manager_action boolean:=p_action in \('delete','void'\)/);
  assert.match(authorizationFixMigration, /v_manager_action and not private\.user_can_access_merchant\(p_merchant_id,'manage_team'\)/);
  assert.match(authorizationFixMigration, /Only the owner, administrator or manager may void a sale/);
  assert.match(authorizationFixMigration, /revoke execute on function public\.shericeri_get_accounting_snapshot\(uuid\) from public,anon/);
  assert.match(authorizationFixMigration, /revoke execute on function public\.shericeri_sync_journal_batch\(uuid,uuid,date,text,text,uuid,jsonb\) from public,anon/);
});

test("multi-line cart sync validates all stock before inserting any sale or changing stock", () => {
  assert.match(atomicCartMigration, /create or replace function public\.shericeri_sync_sale_cart/);
  assert.match(atomicCartMigration, /for update/);
  assert.match(atomicCartMigration, /if jsonb_array_length\(v_conflicts\)>0 then[\s\S]*?return jsonb_build_object\('ok',false,'stock_conflict',true/);
  assert.ok(atomicCartMigration.indexOf("if jsonb_array_length(v_conflicts)>0 then") < atomicCartMigration.indexOf("insert into public.sales"));
  assert.match(atomicCartMigration, /already_recorded/);
  assert.match(atomicCartMigration, /revoke all on function public\.shericeri_sync_sale_cart/);
});

test("new carts are queued and synchronized as one transaction in both sync paths", () => {
  assert.match(html, /async function sheriSyncSaleCartOperation\(op\)[\s\S]*?sb\.rpc\('shericeri_sync_sale_cart'/);
  assert.match(html, /type:'sale_cart',merchant_id:state\.merchant\.id,transaction_id:transactionId,invoice_number:invoice,records:rows,stockChanges/);
  const syncStart = html.indexOf("async function sheriSyncOutbox(){");
  const syncEnd = html.indexOf("\nfunction sheriOnlineEvents(){", syncStart);
  const sync = html.slice(syncStart, syncEnd);
  assert.equal((sync.match(/op\.type==='sale_cart'/g)||[]).length, 2,
    "normal sync and one-time auth retry must both support atomic cart operations");
});


test("legacy queued cart lines are grouped into one atomic retry and retained together on failure", () => {
  assert.match(html, /const legacySaleGroups=new Map\(\),items=\[\]/);
  assert.match(html, /op\.type==='sale_upsert'&&op\.record\?\.transaction_id/);
  assert.match(html, /type:'sale_cart',merchant_id:records\[0\]\.merchant_id,transaction_id:transactionId/);
  assert.match(html, /_outboxKeys:group\.map\(x=>x\.key\)/);
  assert.match(html, /for\(const key of \(item\._outboxKeys\|\|\[item\.key\]\)\)await sheriDelete\('outbox',key\)/);
  assert.match(html, /for\(const key of \(item\._outboxKeys\|\|\[item\.key\]\)\)\{const original=sourceByKey\.get\(key\)/);
});


test("suspended team identities are banned in Auth and re-enabled without losing profile data", () => {
  assert.match(teamAccess, /status !== target\.status/);
  assert.match(teamAccess, /ban_duration: status === "suspended" \? "876000h" : "none"/);
  assert.match(teamAccess, /if \(authStatusError\)[\s\S]*?status: target\.status[\s\S]*?email: target\.email[\s\S]*?phone: target\.phone[\s\S]*?username: target\.username/);
  assert.match(teamMigration, /mm\.status='active'/);
});

test("PIN throttling follows the staff identity across IP changes and applies an IP-pair limit too", () => {
  assert.match(pinRateLimitMigration, /v_identity:=v_member\.user_id::text/);
  assert.match(pinRateLimitMigration, /v_key:=encode\(extensions\.digest\(p_merchant_id::text\|\|':'\|\|v_identity,'sha256'\)/);
  assert.match(pinRateLimitMigration, /v_ip_key:=encode\(extensions\.digest\(v_key\|\|':'\|\|coalesce\(p_ip_hash,''\),'sha256'\)/);
  assert.match(pinRateLimitMigration, /blocked_until>now\(\)/);
  assert.ok(pinRateLimitMigration.includes("if coalesce(auth.jwt()->>'role','')<>'service_role'"));
  assert.match(pinRateLimitMigration, /revoke all on function public\.verify_merchant_member_pin\(uuid,text,text,text\) from public,anon,authenticated/);
});


test("staff cache reads are permission-gated and suspended or unverifiable memberships fail closed", () => {
  assert.match(html, /member\.status!=='active'/);
  assert.match(html, /if\(navigator\.onLine\)await loadTeamMembers\(true\)/);
  assert.match(html, /function sheriCan\(permission\)[\s\S]*?member\.status!=='active'/);
  assert.match(html, /state\.journalEntries=canReports\?pick\(jes\):\[\]/);
  assert.match(html, /state\.auditLog=canAudit\?pick\(vals\[10\]\|\|\[\]\):\[\]/);
  assert.match(html, /state\.sales=mergeKeepLocal\(sales,state\.sales,sheriCan\('view_sales'\)\|\|sheriCan\('manage_sales'\)\)/);
  assert.match(html, /if\(!allowed\)return \[\]/);
  assert.match(html, /setInterval\(\(\)=>\{if\(navigator\.onLine&&session\?\.user&&state\.merchant\)loadTeamMembers\(true\)\},60000\)/);
});

test("failed membership verification clears staff-only in-memory business and accounting data", () => {
  assert.match(html, /state\.currentMembership=null;state\.products=\[\];state\.sales=\[\];state\.expenses=\[\]/);
  assert.match(html, /state\.journalEntries=\[\];state\.journalLines=\[\];state\.invoices=\[\]/);
});


test("PIN login validates identifier length, numeric merchant code and exact PIN format", () => {
  assert.ok(teamAccess.includes("identifier.length > 120"));
  assert.ok(teamAccess.includes("!/^\\d{1,12}$/.test(merchantCode)"));
  assert.ok(teamAccess.includes("!/^\\d{6,8}$/.test(pin)"));
});


test("suspended PIN users are rejected before merchant workspace lookup or onboarding", () => {
  assert.match(html, /from\('merchant_members'\)\.select\('id,merchant_id,user_id,full_name,role,permissions,status'\)\.eq\('user_id',session\.user\.id\)/);
  assert.match(html, /if\(memberResult\.data\.status!=='active'\)\{await sb\.auth\.signOut\(\);session=null;return false;\}/);
  assert.match(html, /complete=await ensureMerchant\(\);\s*if\(!session\?\.user\)return;/);
});


test("team identity updates roll back database and Auth state if a later step fails", () => {
  assert.match(teamAccess, /const rollbackMemberAndAuth = async \(\) =>/);
  assert.match(teamAccess, /admin\.auth\.admin\.getUserById\(target\.user_id\)/);
  assert.match(teamAccess, /if \(authStatusUpdated\)[\s\S]*?ban_duration: target\.status/);
  assert.match(teamAccess, /if \(authEmailUpdated && originalAuthEmail\)[\s\S]*?email: originalAuthEmail/);
  assert.match(teamAccess, /if \(pinError\) \{\s*await rollbackMemberAndAuth\(\)/);
});


test("clean staging receives Shericeri memory and the product-images bucket before team policies", () => {
  assert.match(storageMemoryMigration, /create table if not exists public\.shericeri_memory/);
  assert.match(storageMemoryMigration, /insert into storage\.buckets/);
  assert.match(storageMemoryMigration, /file_size_limit=4194304/);
  assert.match(authorizationFixMigration, /create policy shericeri_memory_team_insert[\s\S]*?manage_finance/);
});
