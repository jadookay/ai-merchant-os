import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html=readFileSync(new URL("../preview-live/index.html",import.meta.url),"utf8");
const module=readFileSync(new URL("../preview-live/contractors.js",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20261126083000_rwanda_contractors_consultants.sql",import.meta.url),"utf8");
const worker=readFileSync(new URL("../preview-live/shericeri_v14_4_aibos_sync_sw.js",import.meta.url),"utf8");
const rraMigration=readFileSync(new URL("../supabase/migrations/20261126090000_contractor_rra_notification_tracking.sql",import.meta.url),"utf8");
const whtLockMigration=readFileSync(new URL("../supabase/migrations/20261126091000_contractor_wht_period_lock.sql",import.meta.url),"utf8");

test("contractor module is reachable from isolated navigation and Command Center",()=>{
 assert.ok(html.includes("show('contractors')"));
 assert.ok(html.includes('id="contractors"'));
 assert.ok(html.includes('id="contractorsAppHost"'));
 assert.ok(html.includes("'businessInsight','payroll','contractors'"));
 assert.ok(html.includes('src="contractors.js?v=1"'));
 assert.ok(html.includes('V14.4.85 isolated POS payment-method controls'));
});

test("contractor module JavaScript parses and supports all three app languages",()=>{
 assert.doesNotThrow(()=>new Script(module));
 for(const value of ["en:{","rw:{","fr:{","shericeri_register_contractor","shericeri_record_contractor_invoice","shericeri_record_contractor_payment","shericeri_record_contractor_wht_remittance"])
  assert.ok(module.includes(value),"Missing contractor support: "+value);
});

test("contractors are kept outside employee payroll and mandatory employee RSSB calculations",()=>{
 assert.ok(module.includes("genuine independent service-provider relationship"));
 assert.ok(module.includes("does not deduct employee RSSB"));
 assert.ok(!/payroll_employees|payroll_pay_items|sheriSyncOutbox|sheriSaveSnapshot/.test(module));
});

test("contractor accounting schema is tenant-scoped and uses balanced payable and WHT journals",()=>{
 for(const value of ["create table if not exists public.contractors","create table if not exists public.contractor_invoices","create table if not exists public.contractor_payments","create table if not exists public.contractor_wht_remittances","enable row level security","contractor_invoice","contractor_payment","contractor_wht_remittance","2270","2050","6000","15 percent service-fee WHT"])
  assert.ok(migration.includes(value),"Missing migration support: "+value);
 assert.ok(migration.includes("private.user_can_access_merchant(p_merchant_id,'manage_finance')"));
 assert.ok(migration.includes("idempotency_key"));
});

test("preview worker cache is versioned without changing the sync wake-up path",()=>{
 assert.ok(worker.includes("shericeri-preview-v14.4-aibos-sync-v86"));
 assert.ok(worker.includes("const RELEASE='V14.4.86'"));
 assert.ok(worker.includes("shericeri-outbox-sync"));
});

test("subcontractor RRA notices and WHT remittance periods are safely tracked",()=>{
 assert.ok(module.includes("shericeri_mark_contractor_rra_notified"));
 assert.ok(module.includes("data-rra-id"));
 assert.ok(rraMigration.includes("private.user_can_access_merchant(p_merchant_id,'manage_finance')"));
 assert.ok(rraMigration.includes("p_notified_on<v_start"));
 assert.ok(whtLockMigration.includes("pg_advisory_xact_lock"));
 assert.ok(whtLockMigration.includes("contractor-wht:"));
});
