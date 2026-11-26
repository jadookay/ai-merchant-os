import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html=readFileSync(new URL("../preview-live/index.html",import.meta.url),"utf8");
const worker=readFileSync(new URL("../preview-live/shericeri_v14_4_aibos_sync_sw.js",import.meta.url),"utf8");
const teamAccess=readFileSync(new URL("../supabase/functions/team-access/index.ts",import.meta.url),"utf8");
const legalMigration=readFileSync(new URL("../supabase/migrations/20261123120000_require_full_legal_name_for_auth_users.sql",import.meta.url),"utf8");
const costMigration=readFileSync(new URL("../supabase/migrations/20261124150000_product_cost_correction.sql",import.meta.url),"utf8");
const payroll=readFileSync(new URL("../preview-live/payroll.js",import.meta.url),"utf8");
const contractors=readFileSync(new URL("../preview-live/contractors.js",import.meta.url),"utf8");
const payments=readFileSync(new URL("../preview-live/pos-payment-summary.js",import.meta.url),"utf8");

function block(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"Expected source block "+start);
 return html.slice(a,b);
}

test("isolated preview is versioned V14.4.93 and retains every preview-only extension",()=>{
 assert.ok(html.includes('name="app-version" content="V14.4.93 isolated full-feature reconciliation"'));
 assert.ok(worker.includes("shericeri-preview-v14.4-aibos-sync-v93"));
 assert.ok(worker.includes("const RELEASE='V14.4.93'"));
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
});

test("inventory table layout remains readable on narrow screens",()=>{
 assert.ok(html.includes('id="aibos-inventory-table-fit-v1"'));
 assert.ok(html.includes("#inventoryTable .table{width:100%;min-width:1120px;table-layout:auto}"));
 assert.ok(html.includes("#inventoryTable .table th:nth-child(2),#inventoryTable .table td:nth-child(2){min-width:230px}"));
});

test("payroll, contractors and Cash/MoMo/Credit reporting remain independently localized",()=>{
 for(const source of [payroll,contractors,payments])
  for(const language of ["en:{","rw:{","fr:{"])assert.ok(source.includes(language),"Missing "+language);
 assert.ok(payroll.includes("A payroll run must cover one complete calendar month"));
 assert.ok(payroll.includes("casualConfirm"));
 assert.ok(contractors.includes("rssb_self_managed"));
 assert.ok(contractors.includes("shericeri_record_contractor_wht_remittance"));
 assert.ok(payments.includes("salePaymentMethod"));
 assert.ok(payments.includes("daily")&&payments.includes("weekly")&&payments.includes("monthly")&&payments.includes("custom"));
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
