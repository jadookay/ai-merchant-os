import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function functionBody(name) {
  const asyncMarker = 'async function ' + name;
  const syncMarker = 'function ' + name;
  const start = html.indexOf(asyncMarker) >= 0 ? html.indexOf(asyncMarker) : html.indexOf(syncMarker);
  assert.notEqual(start, -1, 'Missing function ' + name);
  const next = [html.indexOf('\nfunction ', start + 10), html.indexOf('\nasync function ', start + 10)]
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0] ?? html.length;
  return html.slice(start, next);
}

test('supplier bills classify correctly and link to a received purchase without duplicate journal posting', () => {
  assert.match(html, /id="accBillType"/);
  assert.match(html, /id="accBillOtherAccount"/);
  assert.match(html, /function accBillTypeChanged/);
  assert.match(html, /function accBillPurchaseOptions/);
  const bill = functionBody('accCreateBill');
  assert.match(bill, /bill_type:billType/);
  assert.match(bill, /purchase_id:purchaseId/);
  assert.match(bill, /linkedQty/);
  assert.match(bill, /taxAmount>0\.005/);
  assert.match(bill, /if\(!linkedPurchase\)/);
  assert.doesNotMatch(bill, /sourceType:'purchase'/);
});

test('supplier payments can be allocated to received purchases and their linked bills', () => {
  assert.match(html, /function accPurchaseLinkedBill/);
  assert.match(html, /function accPurchasePaid/);
  assert.match(html, /function accPurchaseOutstanding/);
  assert.match(html, /function accPaymentSourceOptions/);
  const sources = functionBody('accPaymentSourceOptions');
  assert.match(sources, /purchase:/);
  const payment = functionBody('accCreatePayment');
  assert.match(payment, /sourceKind==='purchase'/);
  assert.match(payment, /accPurchaseOutstanding/);
  assert.match(payment, /accBillPaid/);
  assert.match(html, /purchasePayments/);
});

test('paid and unpaid expenses are both recorded and payment posting precedes paid-status updates', () => {
  assert.match(html, /id="ePaymentStatus"/);
  assert.match(html, /id="ePaymentAccount"/);
  assert.match(html, /function toggleExpensePaymentFields/);
  const helper = functionBody('accRecordExpensePayment');
  assert.ok(helper.indexOf('await accPostEntry') < helper.indexOf('state.payments.push(row)'));
  assert.match(helper, /payment_status=paidAfter/);
  const expenseRenderer = functionBody('renderExpenses');
  assert.match(expenseRenderer, /Payment status/);
  assert.match(expenseRenderer, /accExpenseStatus/);
  assert.match(html, /function accExpenseStatus/);
});

test('purchase register displays payments and bill links and prevents direct void of linked purchases', () => {
  assert.match(html, /accPurchasePaid\(x\)/);
  assert.match(html, /accPurchaseLinkedBill\(x\)/);
  assert.match(html, /Reverse linked bill first/);
  assert.match(html, /async function voidOSPurchase\(id\)/);
});

test('dashboard profit follows the posted accounting ledger snapshot', () => {
  assert.match(html, /function osAccountingProfitSnapshot/);
  assert.match(html, /function profit\(\)\{const snapshot=osAccountingProfitSnapshot\(\)/);
  assert.match(html, /function osGrossProfit\(\)\{const snapshot=osAccountingProfitSnapshot\(\)/);
});

test('PDF export is loaded on demand and has guarded bill, invoice and receipt actions', () => {
  assert.match(html, /async function sheriEnsurePdf/);
  assert.match(html, /async function accBillPdf/);
  assert.match(html, /async function accInvoicePdf/);
  assert.match(html, /async function accReceiptPdf/);
  assert.match(html, /function accBillPdfClick/);
  assert.match(html, /function accInvoicePdfClick/);
  assert.match(html, /function accReceiptPdfClick/);
});

test('the existing transaction and sync functions remain in place without importing preview sync wrappers', () => {
  for (const name of ['sheriQueue', 'sheriSyncOutbox', 'sheriSyncSaleOperation', 'sheriSyncSaleCartOperation']) {
    assert.ok(html.includes('function ' + name) || html.includes('async function ' + name), 'Missing protected function ' + name);
  }
  assert.doesNotMatch(html, /function sheriWrapSyncBatch/);
});
