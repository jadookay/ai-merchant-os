import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/team-access/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261123120000_require_full_legal_name_for_auth_users.sql', import.meta.url), 'utf8');

test('full legal name validator accepts multi-part names and normalizes spacing', () => {
  const match = html.match(/function sheriNormalizeFullLegalName\(value\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'browser legal-name validator must exist');
  const context = {};
  vm.runInNewContext(match[0] + '; this.normalize = sheriNormalizeFullLegalName;', context);
  const normalize = context.normalize;
  assert.equal(normalize(' Jean   de Dieu Nubundiho '), 'Jean de Dieu Nubundiho');
  assert.equal(normalize('Anne-Marie O’Connor'), 'Anne-Marie O’Connor');
  assert.equal(normalize('J. R. Smith'), 'J. R. Smith');
  assert.equal(normalize('Jean'), null);
  assert.equal(normalize('12345 Smith'), null);
  assert.equal(normalize('Jean @ Smith'), null);
  assert.equal(normalize(''), null);
  assert.equal(normalize('A'.repeat(121) + ' Smith'), null);
});

test('owner and staff creation require the legal-name validator', () => {
  assert.match(html, /sheriNormalizeFullLegalName\(document\.getElementById\('signupFullName'\)/);
  assert.match(html, /sheriNormalizeFullLegalName\(document\.getElementById\('teamFullName'\)/);
  assert.match(html, /sheriNormalizeFullLegalName\(full_name_raw\)/);
  assert.match(edge, /function normalizeFullLegalName\(value: unknown\)/);
  assert.match(edge, /normalizeFullLegalName\(body\?\.full_name\)/);
  assert.match(edge, /fullNameToSave/);
});

test('new Auth users are server-side checked before insertion', () => {
  assert.match(migration, /create trigger require_full_legal_name_on_auth_user\s+before insert on auth\.users/i);
  assert.match(migration, /public\.is_valid_full_legal_name\(candidate_name\)/);
  assert.match(migration, /at least two name parts/i);
});
