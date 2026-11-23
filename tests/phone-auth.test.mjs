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

test('owner registration and login use a phone-derived email alias without Twilio or SMS', () => {
  assert.match(html, /id="signupPhone"[^>]*required/);
  assert.match(html, /function sheriPhoneLoginEmail\(phone\)/);
  assert.match(html, /phone-login\.shericeri\.test/);
  assert.match(html, /sb\.auth\.signUp\(\{email:loginEmail,password,options\}\)/);
  assert.ok(html.includes("if(data.session){setAuthStatus('Account created. Let’s set up your business…');await onAuthed(data.session);}"), 'registration must continue immediately when Supabase returns a session');
  assert.ok(html.includes('No Supabase Phone provider, Twilio SID, Auth Token, or SMS is used.'), 'signup screen must explain no-SMS testing mode');
  assert.match(html, /contact_phone:phone,contact_email:email\|\|null,auth_method:'phone_password_test'/);
  assert.match(html, /email:sheriPhoneLoginEmail\(phone\),password/);
  assert.match(html, /Legacy phone sign-in request timed out/);
  assert.match(html, /Confirm email under Supabase Auth/);
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

test('generated staff Auth passwords stay within Supabase 72-character limit', () => {
  const match = edge.match(/function randomPassword\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'staff password generator must exist');
  const context = { crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = i; return bytes; } } };
  vm.runInNewContext(match[0] + '; this.makePassword = randomPassword;', context);
  const password = context.makePassword();
  assert.equal(password.length, 64);
  assert.ok(password.length <= 72);
  assert.match(password, /^[0-9a-f]{64}$/);
});
