import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html=readFileSync(new URL("../preview-live/index.html",import.meta.url),"utf8");
const worker=readFileSync(new URL("../preview-live/shericeri_v14_4_aibos_sync_sw.js",import.meta.url),"utf8");
const teamAccess=readFileSync(new URL("../supabase/functions/team-access/index.ts",import.meta.url),"utf8");
const legalMigration=readFileSync(new URL("../supabase/migrations/20261123120000_require_full_legal_name_for_auth_users.sql",import.meta.url),"utf8");
const costMigration=readFileSync(new URL("../supabase/migrations/20261124150000_product_cost_correction.sql",import.meta.url),"utf8");
const costGrantMigration=readFileSync(new URL("../supabase/migrations/20261126113000_restrict_anon_product_cost_correction.sql",import.meta.url),"utf8");
const payroll=readFileSync(new URL("../preview-live/payroll.js",import.meta.url),"utf8");
const payrollWorkflow=readFileSync(new URL("../supabase/migrations/20261125140000_rwanda_payroll_run_workflows.sql",import.meta.url),"utf8");
const contractors=readFileSync(new URL("../preview-live/contractors.js",import.meta.url),"utf8");
const payments=readFileSync(new URL("../preview-live/pos-payment-summary.js",import.meta.url),"utf8");
const quickService=readFileSync(new URL("../preview-live/edge-functions/quick-service/index.ts",import.meta.url),"utf8");

function block(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"Expected source block "+start);
 return html.slice(a,b);
}

test("isolated preview is versioned V14.4.94 and retains every preview-only extension",()=>{
 assert.ok(html.includes('name="app-version" content="V14.4.94 isolated full-feature reconciliation"'));
 assert.ok(html.includes("hicvgrkltwkqhnioakcg.supabase.co"));
 assert.ok(!html.includes("bhtodxjhgucgwarpaqzy"));
 assert.ok(worker.includes("shericeri-preview-v14.4-aibos-sync-v94"));
 assert.ok(worker.includes("const RELEASE='V14.4.94'"));
 for(const path of ['src="payroll.js?v=1"','src="contractors.js?v=1"','src="pos-payment-summary.js?v=1"'])
  assert.ok(html.includes(path), "Missing preview module "+path);
});

test("owner registration and sign-in use phone plus password without Twilio or SMS",()=>{
 assert.ok(html.includes('id="signupPhone"'));
 assert.ok(html.includes('id="signupFullName"'));
 assert.ok(html.includes("function sheriPhoneLoginEmail(phone)"));
 assert.ok(html.includes("phone-login.shericeri.test"));
 assert.ok(html.includes("auth_method:'phone_password_test'"));
 assert.ok(html.includes("No Supabase Phone provider, Twilio SID, Auth Token, or SMS is used."));
 const signup=block("async function handleSignUp(){","async function handleSignIn(){");
 assert.ok(signup.includes("sheriPhoneLoginEmail(phone)"));
 assert.ok(signup.includes("contact_phone:phone"));
 assert.doesNotMatch(signup,/signUp\(\{phone/);
 const signin=block("async function handleSignIn(){","async function probeAuthProviders()");
 assert.ok(signin.includes("sheriPhoneLoginEmail(phone)"));
 assert.ok(signin.includes("Enter your phone number or email and password."));
});

test("full legal names and required staff phone are enforced in UI, Edge Function and Auth trigger",()=>{
 assert.ok(html.includes("function sheriNormalizeFullLegalName(value)"));
 assert.ok(html.includes('id="teamFullName" minlength="3" maxlength="120" required'));
 assert.ok(html.includes('id="teamPhone" type="tel" required'));
 assert.ok(html.includes("sheriNormalizeFullLegalName(document.getElementById('teamFullName').value)"));
 assert.ok(html.includes("valid staff phone number is required"));
 assert.ok(teamAccess.includes("function normalizeFullLegalName(value: unknown)"));
 assert.ok(teamAccess.includes("const fullName = normalizeFullLegalName(body?.full_name) ||"));
 assert.ok(teamAccess.includes("A staff phone number is required"));
 assert.ok(teamAccess.includes("fullNameToSave"));
 assert.ok(legalMigration.includes("create trigger require_full_legal_name_on_auth_user"));
 assert.ok(legalMigration.includes("before insert on auth.users"));
});

test("Reports refresh from the authoritative server snapshot without the old timeout or stale cached warning",()=>{
 assert.ok(html.includes("function sheriRenderAfterServerRefresh(){"));
 assert.ok(html.includes("if(sheriCurrentView==='reports'&&typeof renderReports==='function'){renderReports();return;}"));
 assert.ok(html.includes("sheriRenderAfterServerRefresh()"));
 assert.ok(!html.includes("sheriWithTimeout(loadAll(true),9000"));
 assert.ok(html.includes("Inventory valuation has not yet been verified against a complete server ledger snapshot"));
 assert.ok(html.includes("id=\"accTB\""));
});

test("opening-stock and purchase sync use safe, permission-aware and idempotent workflows",()=>{
 const product=block("async function sheriSyncProductOperation(op){","async function sheriEnsurePurchaseDependencies(op){");
 assert.ok(product.includes("const productInsertRecord={...record,stock:0}"));
 assert.ok(product.includes("products').insert(productInsertRecord)"));
 const errorInfo=block("function sheriSyncErrorInfo(err){","function sheriSyncDelayMs");
 assert.ok(errorInfo.includes("aibos integrity"));
 assert.ok(errorInfo.includes("opening stock requires exactly one active opening inventory journal"));
 const recovery=block("async function sheriUnblockSchemaRepairedOperations(){","async function sheriSyncAccountingSettingsOperation(op){");
 assert.ok(recovery.includes("canManageInventory=sheriCan('manage_inventory')"));
 assert.ok(recovery.includes("canManageFinance=sheriCan('manage_finance')"));
 assert.ok(recovery.includes("retry_recovered_v88:true"));
 const purchase=block("async function sheriSyncPurchaseOperation(op){","function sheriOutboxPriority(op)");
 assert.ok(purchase.includes("confirmed.status==='received'&&confirmed.stock_applied!==true"));
 assert.doesNotMatch(purchase,/sb\.from\(['"]inventory_movements['"]\)/);
});

test("product cost corrections update the ledger atomically and never bypass finance permissions",()=>{
 const save=block("async function saveProduct(){","async function deleteProduct(id){");
 assert.ok(save.includes("shericeri_correct_product_cost"));
 assert.ok(save.includes("sheriCan('manage_finance')"));
 assert.ok(save.includes("if(!navigator.onLine)"));
 assert.ok(save.includes("productCostCorrection"));
 assert.ok(costMigration.includes("private.user_can_access_merchant(p_merchant_id,'manage_inventory')"));
 assert.ok(costMigration.includes("private.user_can_access_merchant(p_merchant_id,'manage_finance')"));
 assert.ok(costMigration.includes("source_type='product_cost_correction'"));
 assert.ok(costMigration.includes("INSERT INTO public.journal_lines"));
 assert.ok(costMigration.includes("SET search_path = ''"));
 assert.ok(costGrantMigration.includes("FROM PUBLIC, anon"));
 assert.ok(costGrantMigration.includes("TO authenticated"));
});

test("inventory table layout remains readable on narrow screens",()=>{
 assert.ok(html.includes('id="aibos-inventory-table-fit-v1"'));
 assert.ok(html.includes("#inventoryTable .table{width:100%;min-width:1120px;table-layout:auto}"));
 assert.ok(html.includes("#inventoryTable .table th:nth-child(2),#inventoryTable .table td:nth-child(2){min-width:230px}"));
});

test("payroll, contractors and Cash/MoMo/Credit reporting remain independently localized",()=>{
 for(const source of [payroll,contractors,payments])
  for(const language of ["en:{","rw:{","fr:{"])assert.ok(source.includes(language),"Missing "+language);
 assert.ok(payrollWorkflow.includes("A payroll run must cover one complete calendar month"));
 assert.ok(payroll.includes("casualConfirm"));
 assert.ok(contractors.includes("rssb_self_managed"));
 assert.ok(contractors.includes("shericeri_record_contractor_wht_remittance"));
 assert.ok(payments.includes("salePaymentMethod"));
 assert.ok(payments.includes("daily")&&payments.includes("weekly")&&payments.includes("monthly")&&payments.includes("custom"));
});


function evaluateCashFlow(fixture,startDate,endDate){
 const start=html.indexOf("function accCashFlowForPeriod(");
 const end=html.indexOf("function renderReports()",start);
 assert.ok(start>=0&&end>start,"Classified cash flow calculation must exist");
 const source=html.slice(start,end).trim();
 const calculate=new Script("("+source+")").runInNewContext({state:fixture});
 return calculate(startDate,endDate);
}

test("classified cash flow separates operating, investing, financing and unclassified movements",()=>{
 const accounts=[
  {id:"cash",code:"1000",type:"asset",balance_sheet_class:"current"},
  {id:"bank",code:"1010",type:"asset",balance_sheet_class:"current"},
  {id:"sales",code:"4000",type:"income",balance_sheet_class:"not_applicable"},
  {id:"expense",code:"6000",type:"expense",balance_sheet_class:"not_applicable"},
  {id:"inventory",code:"1200",type:"asset",balance_sheet_class:"current"},
  {id:"ppe",code:"1500",type:"asset",balance_sheet_class:"non_current"},
  {id:"equity",code:"3000",type:"equity",balance_sheet_class:"not_applicable"},
  {id:"loan",code:"2300",type:"liability",balance_sheet_class:"non_current"},
  {id:"other",code:"2200",type:"liability",balance_sheet_class:null}
 ];
 const entries=[],lines=[];
 const add=(id,date,source_type,source_id,parts,voided=false)=>{
  entries.push({id,entry_date:date,source_type,source_id,voided});
  for(const [account_id,debit,credit] of parts)lines.push({journal_entry_id:id,account_id,debit,credit});
 };
 add("opening-sale","2026-10-31","sale","opening-sale-source",[["cash",500,0],["sales",0,500]]);
 add("sale","2026-11-02","sale","sale-source",[["cash",1000,0],["sales",0,1000]]);
 add("expense","2026-11-03","expense","expense-source",[["expense",250,0],["cash",0,250]]);
 add("asset-buy","2026-11-04","purchase","asset-buy-source",[["ppe",500,0],["cash",0,500]]);
 add("asset-sale","2026-11-05","asset-disposal","asset-sale-source",[["cash",150,0],["ppe",0,150]]);
 add("capital","2026-11-06","capital","capital-source",[["cash",800,0],["equity",0,800]]);
 add("loan","2026-11-07","loan","loan-source",[["cash",2000,0],["loan",0,2000]]);
 add("unclassified","2026-11-08","other","other-source",[["cash",300,0],["other",0,300]]);
 add("cash-transfer","2026-11-09","transfer","transfer-source",[["bank",100,0],["cash",0,100]]);
 add("voided-purchase","2026-11-10","purchase","purchase-source",[["inventory",400,0],["cash",0,400]],true);
 add("purchase-reversal","2026-11-10","purchase_void","purchase-source",[["cash",400,0],["inventory",0,400]]);
 add("unreversed-voided-sale","2026-11-11","sale","voided-sale-source",[["cash",200,0],["sales",0,200]],true);
 const result=evaluateCashFlow({accounts,bankAccounts:[],journalEntries:entries,journalLines:lines},"2026-11-01","2026-11-30");
 assert.equal(result.operating.inflows,1400);
 assert.equal(result.operating.outflows,650);
 assert.equal(result.operating.net,750);
 assert.equal(result.investing.inflows,150);
 assert.equal(result.investing.outflows,500);
 assert.equal(result.investing.net,-350);
 assert.equal(result.financing.inflows,2800);
 assert.equal(result.financing.outflows,0);
 assert.equal(result.financing.net,2800);
 assert.equal(result.unclassified.inflows,300);
 assert.equal(result.unclassified.outflows,0);
 assert.equal(result.inflows,4650);
 assert.equal(result.outflows,1150);
 assert.equal(result.net,3500);
 assert.equal(result.opening,500);
 assert.equal(result.closing,4000);
 assert.equal(result.reconciliationDifference,0);
});

test("classified cash flow is translated in English, French and Kinyarwanda",()=>{
 for(const label of ["Operating activities","Activités opérationnelles","Ibikorwa bisanzwe by’ubucuruzi","Investing activities","Activités d’investissement","Ibikorwa by’ishoramari","Financing activities","Activités de financement","Ibikorwa byo kubona no kwishyura inkunga n’imyenda","Unclassified cash flows","Flux de trésorerie non classés","Amafaranga atarashyirwa mu byiciro","Net change in cash and cash equivalents","Variation nette de la trésorerie et des équivalents","Impinduka rusange mu mafaranga n’ibihwanye na yo"])
  assert.ok(html.includes(label),"Missing cash-flow label "+label);
 for(const marker of ["cashFlow.operating.inflows","cashFlow.investing.inflows","cashFlow.financing.inflows","cashFlow.unclassified.inflows","cashFlowClassificationNotice"])
  assert.ok(html.includes(marker),"Missing classified cash-flow output "+marker);
 assert.ok(!html.includes("Direct cash movement summary (unclassified)"));
});

test("Income Statement separates other income and stock write-offs without changing profit",()=>{
 const wrapper=block('<script id="aibos-ifrs-statements-v1">','</script>');
 for(const marker of ["sourceAccountTotal('inventory_adjustment','6000'","const otherIncomeAccounts=accounts.filter(a=>a.type==='income'&&!['4000','4050'].includes(String(a.code)))","moneyRow('Inventory write-offs / stock losses'","const net=periodIncome-periodCogs-operatingExpenses-inventoryWriteOffs-taxExpense","balance_sheet_class==='current'","balance_sheet_class==='non_current'"])
  assert.ok(wrapper.includes(marker),"Missing IFRS statement treatment "+marker);
 for(const label of ["Autres produits","Ayandi mafaranga yinjijwe","Sorties et pertes de stock","Ibicuruzwa byakuwe mu bubiko n’igihombo cyabyo","Actifs courants","Umutungo w’igihe gito","Passifs courants","Imyenda y’igihe gito"])
  assert.ok(wrapper.includes(label),"Missing translated statement label "+label);
 assert.ok(wrapper.includes("sheriLocalizedAccountName(a)"));
});

test("AI Business Insight produces a complete selected-language report with a local fallback",()=>{
 assert.ok(html.includes("function buildOSBusinessInsightContext()"));
 assert.ok(html.includes("function osLocalBusinessReview"));
 assert.ok(html.includes("function osRenderInsight"));
 assert.ok(html.includes("sb.functions.invoke('quick-service'"));
 assert.ok(html.includes("business_insight"));
 assert.ok(quickService.includes('if (mode === "business_insight")'));
 assert.ok(quickService.includes("8–10 substantial, connected paragraphs"));
 assert.ok(quickService.includes("max_tokens: 2800"));
 assert.ok(quickService.includes("max_tokens: 3600"));
 assert.ok(quickService.includes("finish_reason"));
 assert.ok(quickService.includes("Use the selected language throughout the entire report."));
});

test("Shericeri opens as a dedicated page, persists transcript locally and exposes diagnostics to signed-in users",()=>{
 assert.ok(html.includes("function sheriTranscriptStorageKey()"));
 assert.ok(html.includes("function sheriPersistTranscript()"));
 assert.ok(html.includes("function sheriRestoreTranscript()"));
 assert.ok(html.includes("function sheriObserveTranscript()"));
 assert.ok(html.includes("new MutationObserver"));
 assert.ok(html.includes("localStorage.setItem"));
 assert.ok(html.includes("if(v==='shericeri'){sheriRestoreTranscript();sheriObserveTranscript()}"));
 const launch=block("function launchShericeri(){","function stopShericeriHero()");
 assert.ok(launch.includes("show('shericeri')"));
 assert.doesNotMatch(launch,/startShericeriLoop|startShericeri\(/);
 assert.ok(html.includes("function sheriCanUseVoiceDiagnostics(){return !!session?.user?.id;}"));
 assert.ok(!html.includes("SHERI_DEVELOPER_USER_IDS.has(session.user.id)"));
});


test("More and Suppliers & Purchases views are unique and localized",()=>{
 assert.equal((html.match(/id="records"/g)||[]).length,1);
 assert.equal((html.match(/id="suppliersPurchases"/g)||[]).length,1);
 const more=block('<section id="records"','</section>');
 const suppliers=block('<section id="suppliersPurchases"','</section>');
 assert.equal((more.match(/show\('suppliersPurchases'\)/g)||[]).length,1);
 assert.ok(more.includes("<h1>More</h1>"));
 assert.ok(suppliers.length>100);
 assert.ok(html.includes("'customers, suppliers, reports and business settings.':'Abakiriya, abaranguza, raporo n’igenamiterere ry’ubucuruzi.'"));
 assert.ok(html.includes("'suppliers & purchases':'Abaranguza n’ibyaguzwe'"));
 assert.ok(html.includes("fr:['Clients','Fournisseurs & achats'"));
});

test("accounting source integrity and exact deletion reversals remain in the isolated build",()=>{
 for(const marker of [
  "function accLedgerIntegrity(",
  "Duplicate active journal postings exist for the same source",
  "Deleted expense has no exact accounting reversal",
  "Deleted cash movement has no exact accounting reversal",
  "expense_delete",
  "cash_entry_delete",
  "accUniqueTaxRates",
  "direction:type==='customer_receipt'||type==='other_income'?'receipt':'payment'"
 ])assert.ok(html.includes(marker),"Missing accounting-integrity safeguard "+marker);
});

test("all isolated preview inline JavaScript blocks parse",()=>{
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
 let parsed=0;
 for(const [index,match] of scripts.entries()){
  const attrs=match[1]||"",code=match[2]||"";
  if(!code.trim()||/\bsrc\s*=|application\/(?:json|ld\+json)/i.test(attrs)||/\btype\s*=\s*["']module["']/i.test(attrs))continue;
  assert.doesNotThrow(()=>new Script(code,{filename:"preview-inline-"+index+".js"}));
  parsed++;
 }
 assert.ok(parsed>0);
});
