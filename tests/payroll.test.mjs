import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const payroll = readFileSync(new URL("../payroll.js", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../supabase/migrations/20261125120000_rwanda_payroll_foundation.sql", import.meta.url), "utf8");
const restrictions = readFileSync(new URL("../supabase/migrations/20261125123000_restrict_payroll_workflow_writes.sql", import.meta.url), "utf8");
const futurePension = readFileSync(new URL("../supabase/migrations/20261125130000_rwanda_future_pension_rates.sql", import.meta.url), "utf8");
const workflows = readFileSync(new URL("../supabase/migrations/20261125140000_rwanda_payroll_run_workflows.sql", import.meta.url), "utf8");

test("Payroll is reachable from AIBOS Command Center navigation and hub", () => {
  assert.ok(html.includes("onclick=\"show('payroll')\">Payroll</button>"));
  assert.ok(html.includes("onclick=\"show('payroll')\"><h2>👥 Payroll</h2>"));
  assert.ok(html.includes("id=\"payroll\""));
  assert.ok(html.includes("'businessInsight','payroll'"));
  assert.ok(html.includes('src="payroll.js?v=1"'));
});

test("Rwanda payroll page is multilingual and keeps tax declarations and money transfers external", () => {
  for (const value of ["en:{", "rw:{", "fr:{", "PAYE", "RSSB Pension", "Occupational Hazards"])
    assert.ok(payroll.includes(value), "Missing payroll support: " + value);
  assert.match(payroll, /RRA\/RSSB declarations and bank or mobile-money transfers remain external/);
  assert.ok(payroll.includes("payrollCreateRun"));
  assert.ok(payroll.includes("aibosPayrollRunAction"));
  assert.ok(payroll.includes("aibosPayrollPayRun"));
  assert.ok(payroll.includes("aibosPayrollPayslips"));
});

test("PAYE estimator includes permanent, casual and secondary-employer classifications", () => {
  assert.match(payroll, /type==='secondary_employer'.*\.30/);
  assert.match(payroll, /type==='casual'.*\.15/);
  assert.match(payroll, /Math\.min\(g,100000\).*\.10/);
  assert.match(payroll, /Math\.min\(g,200000\).*\.20/);
  assert.match(payroll, /g-200000\).*\.30/);
});

test("payroll tables are tenant-scoped and RLS protected", () => {
  for (const table of ["payroll_employees","payroll_rule_sets","payroll_pay_runs","payroll_pay_items","payroll_payments","payroll_reminders"]) {
    assert.ok(foundation.includes("create table if not exists public." + table));
    assert.ok(foundation.includes("alter table public." + table + " enable row level security"));
  }
  assert.ok(foundation.includes("private.user_can_access_merchant(merchant_id,'manage_payroll')"));
});

test("Rwanda PAYE and pension rules are effective-dated", () => {
  assert.ok(foundation.includes("'PAYE_PERMANENT'"));
  assert.ok(foundation.includes("'PAYE_CASUAL'"));
  assert.ok(foundation.includes("'PAYE_SECONDARY'"));
  assert.ok(foundation.includes("'RSSB_PENSION'"));
  assert.ok(foundation.includes("'2025-01-01'"));
  assert.ok(foundation.includes("'RSSB_OCCUPATIONAL_HAZARDS'"));
  for (const [date,rate] of [["2027-01-01","0.07"],["2028-01-01","0.08"],["2029-01-01","0.09"],["2030-01-01","0.10"]]) {
    assert.ok(futurePension.includes(date));
    assert.ok(futurePension.includes(rate));
  }
  assert.ok(payroll.includes("period>='2030-01' ? 0.20"));
  assert.ok(payroll.includes("period>='2027-01' ? 0.14"));
  assert.match(payroll, /type==='casual'\)return Math\.round\(g\*\.15\)/);
});

test("payroll run, payslip item, salary payment and reminder writes are not exposed directly", () => {
  for (const table of ["payroll_pay_runs","payroll_pay_items","payroll_payments"])
    assert.ok(restrictions.includes("revoke insert, update, delete on public." + table + " from authenticated"));
  assert.ok(restrictions.includes("revoke delete on public.payroll_employees from authenticated"));
});

test("owner dashboard reminder generation is idempotent and dismissal does not mark payment", () => {
  assert.ok(payroll.includes("ensureStatutoryReminders"));
  assert.ok(payroll.includes("onConflict:'merchant_id,idempotency_key',ignoreDuplicates:true"));
  assert.ok(payroll.includes("status:'dismissed'"));
  assert.ok(payroll.includes("ensureRunReminders"));
  assert.ok(payroll.includes("reminder_type:'pay_salaries'"));
  assert.ok(payroll.includes("reminder_type:'approve_payroll'"));
  assert.ok(payroll.includes("reminder_type:'prepare_payroll'"));
  assert.ok(!payroll.includes("status:'paid'"));
});

test("Payroll headings and navigation react to the selected app language", () => {
  assert.ok(payroll.includes("pageTitle"));
  assert.ok(payroll.includes("translateHeader"));
  assert.ok(payroll.includes("aibos:languagechange"));
  assert.ok(payroll.includes("getElementById('aibosLanguageSelect')"));
  assert.ok(payroll.includes("host.dataset.lang!==lang()"));
});

test("Payroll workflow RPCs create, submit, approve, post and pay with server-side authorization", () => {
  for (const fn of [
    "shericeri_create_payroll_run",
    "shericeri_submit_payroll_run",
    "shericeri_approve_payroll_run",
    "shericeri_post_payroll_run",
    "shericeri_record_payroll_payment"
  ]) {
    assert.ok(workflows.includes("function public."+fn));
    assert.ok(workflows.includes("revoke all on function public."+fn));
    assert.ok(workflows.includes("grant execute on function public."+fn+" to authenticated"));
  }
  assert.ok(workflows.includes("private.user_can_access_merchant(p_merchant_id,'manage_payroll')"));
  assert.ok(workflows.includes("private.user_can_access_merchant(p_merchant_id,'manage_finance')"));
  assert.ok(workflows.includes("status='approved'"));
  assert.ok(workflows.includes("source_type,source_id,created_by"));
  assert.ok(workflows.includes("payroll_run"));
  assert.ok(workflows.includes("payroll_payment"));
  assert.ok(workflows.includes("pg_advisory_xact_lock"));
  assert.ok(workflows.includes("amount_paid_total=amount_paid_total+p_amount"));
  assert.ok(workflows.includes("Accounting period is locked"));
});

test("Payroll chart-of-account mappings are validated and salary journals use dedicated accounts", () => {
  for (const code of ["6300","6310","2210","2220","2230","2240"])
    assert.ok(workflows.includes("code='"+code+"'"));
  assert.ok(workflows.includes("type='expense' and normal_balance='debit'"));
  assert.ok(workflows.includes("type='liability' and normal_balance='credit'"));
  assert.ok(workflows.includes("type='asset' and normal_balance='debit'"));
  assert.ok(workflows.includes("no journal was posted"));
});

test("payroll JavaScript parses", () => {
  assert.doesNotThrow(() => new Script(payroll, { filename: "payroll.js" }));
});
