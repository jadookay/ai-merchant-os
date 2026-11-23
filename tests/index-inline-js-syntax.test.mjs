import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('all inline JavaScript blocks parse without syntax errors', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let parsed = 0;
  scripts.forEach((match, index) => {
    const attrs = match[1] || '';
    const code = match[2] || '';
    if (!code.trim() || /\bsrc\s*=/.test(attrs) || /application\/ld\+json/i.test(attrs)) return;
    if (/\btype\s*=\s*["']module["']/i.test(attrs)) return;
    assert.doesNotThrow(() => new vm.Script(code, { filename: 'index-inline-' + index + '.js' }), 'Inline script ' + index + ' must parse');
    parsed++;
  });
  assert.ok(parsed > 0, 'Expected at least one inline JavaScript block to parse');
});
