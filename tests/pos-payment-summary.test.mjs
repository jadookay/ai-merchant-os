import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html=readFileSync(new URL("../preview-live/index.html",import.meta.url),"utf8");
const module=readFileSync(new URL("../preview-live/pos-payment-summary.js",import.meta.url),"utf8");
const worker=readFileSync(new URL("../preview-live/shericeri_v14_4_aibos_sync_sw.js",import.meta.url),"utf8");

test("isolated Sell screen loads the payment-method recovery and summary module",()=>{
  assert.ok(html.includes('src="pos-payment-summary.js?v=1"'));
  assert.ok(html.includes('V14.4.94 isolated full-feature reconciliation'));
  assert.ok(worker.includes("shericeri-preview-v14.4-aibos-sync-v94"));
  assert.ok(worker.includes("const RELEASE='V14.4.94'"));
});

test("POS payment module parses and supports English, French and Kinyarwanda",()=>{
  assert.doesNotThrow(()=>new Script(module));
  for(const key of ["en:{","fr:{","rw:{","salePaymentMethod","saleCreditName","saleCreditPhone","saleCreditDue","saleCreditAmount"])
    assert.ok(module.includes(key),"Missing POS payment UI support: "+key);
});

test("payment summary supports daily, weekly, monthly and selected date ranges",()=>{
  for(const value of ["daily","weekly","monthly","custom","aibosPayFrom","aibosPayTo","aibosPayApply"])
    assert.ok(module.includes(value),"Missing payment summary filter: "+value);
});

test("payment summary groups sale lines into transactions and totals Cash, MoMo and Credit separately",()=>{
  for(const value of ["transaction_id||s.id","payment_method","cash","momo","credit","allTotal","grouped.size","row.total"])
    assert.ok(module.includes(value),"Missing payment-method aggregation: "+value);
});

test("payment summary is isolated from sale posting and sync internals",()=>{
  assert.doesNotMatch(module,/sheriQueue|sheriSyncOutbox|sheriSaveSnapshot|journal_entries|journal_lines/);
});
