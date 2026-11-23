import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/team-access/index.ts', import.meta.url), 'utf8');

test('phone normalization accepts Rwanda local and international formats', () => {
  const match = html.match(/function sheriNormalizeAuthPhone\(value\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'phone normalization helper must exist');
  const context = {};
  vm.runInNewContext(match[0] + '; this.normalize = sheriNormalizeAuthPhone;', context);
  const normalize = context.normalize;
  assert.equal(normalize('0788 123 456'), '+250788123456');
  assert.equal(normalize('788123456'), '+250788123456');
  assert.equal(normalize('+250 788 123 456'), '+250788123456');
  assert.equal(normalize('00250788123456'), '+250788123456');
  assert.equal(normalize('not a phone'), null);
  assert.equal(normalize('1234'), null);
});

test('owner registration uses phone identity, legal name metadata and SMS verification', () => {
  assert.match(html, /id="signupPhone"[^>]*required/);
  assert.match(html, /sb\.auth\.signUp\(\{phone,password,options/);
  assert.match(html, /sb\.auth\.verifyOtp\(\{phone,token,type:'sms'\}\)/);
  assert.match(html, /function verifyOwnerPhoneOtp\(/);
  assert.match(html, /full_name,contact_email:email\|\|null/);
});

test('owner login accepts phone or email and staff login is phone plus PIN', () => {
  assert.match(html, /sb\.auth\.signInWithPassword\(credentials\)/);
  assert.match(html, /function signInWithTeamPin\(\)[\s\S]*?identifier:phone,pin/);
  assert.match(html, /id="teamPhone" type="tel" required/);
  assert.match(edge, /if \(!phone\) return json\(\{ error: "A staff phone number is required/);
  assert.match(edge, /if \(!nextPhone\) return json\(\{ error: "A staff phone number is required/);
});

test('account authentication edits do not replace transaction, ledger or sync paths', () => {
  for (const name of ['recordSale','sheriQueue','sheriSyncOutbox','sheriSyncSaleOperation','sheriSyncSaleCartOperation','sheriWrapSyncBatch']) {
    assert.ok(html.includes('function ' + name) || html.includes('async function ' + name), 'Missing protected function ' + name);
  }
  assert.match(html, /function sheriWrapSyncBatch\(name\)\{/);
});
