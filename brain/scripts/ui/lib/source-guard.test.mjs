// source-guard.test.mjs — the D9 boundary, enforced by a scan, not a promise
// (#881 PR 3). `ui/lib/**` is imported by the browser AND by `node:test`
// (D9); one `node:fs` import there breaks the page silently in a way no
// node test would catch, so the rule is asserted here instead of trusted.
//
// Scoped test-only, no production change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));

function libModules() {
  return readdirSync(LIB_DIR)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .sort();
}

function importSpecifiers(text) {
  const specs = [];
  for (const line of text.split('\n')) {
    if (!/^\s*import\b/.test(line) && !/\bimport\(/.test(line)) continue;
    const m = /from\s+['"]([^'"]+)['"]/.exec(line) ?? /import\(\s*['"]([^'"]+)['"]/.exec(line);
    if (m) specs.push(m[1]);
  }
  return specs;
}

test('#881: ui/lib/ exists and ships at least one pure module', () => {
  const modules = libModules();
  assert.ok(modules.length > 0, 'brain/scripts/ui/lib/ must contain at least one .mjs module');
});

test('#881: no file under ui/lib/** imports anything outside ui/lib/** (D9)', () => {
  const modules = libModules();
  assert.ok(modules.length > 0, 'no modules to scan — see the previous test');
  for (const name of modules) {
    const text = readFileSync(join(LIB_DIR, name), 'utf8');
    for (const spec of importSpecifiers(text)) {
      assert.ok(
        spec.startsWith('./'),
        `${name}: imports "${spec}" — only sibling ./*.mjs imports are allowed under ui/lib/** ` +
          '(no node: builtin, no ../status/*, no npm package)',
      );
    }
  }
});

test('#881: no ui/lib/** module reaches for wall-clock time, randomness, process, or the network', () => {
  const modules = libModules();
  assert.ok(modules.length > 0, 'no modules to scan — see the first test');
  const forbidden = [
    [/\bDate\.now\s*\(/, 'Date.now()'],
    [/\bMath\.random\s*\(/, 'Math.random()'],
    [/\bprocess\./, 'process.*'],
    [/\bfetch\s*\(/, 'fetch()'],
    [/\bimport\.meta\b/, 'import.meta'], // environment-dependent: the browser and node disagree on it
  ];
  for (const name of modules) {
    const text = readFileSync(join(LIB_DIR, name), 'utf8');
    for (const [re, label] of forbidden) {
      assert.ok(!re.test(text), `${name}: matched forbidden pattern ${label} — ui/lib/** must stay pure`);
    }
  }
});
