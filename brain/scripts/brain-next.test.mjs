// TDD tests for the issue #890 brain:next state machine.
// Durable capture is proven by issue provenance in records, never porcelain .memory/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('brain-next: importing is side-effect-free', async () => {
  const mod = await import('./brain-next.mjs');
  assert.equal(typeof mod.deriveNext, 'function');
});

const base = (overrides = {}) => ({
  branch: 'feature/42-demo',
  openPRsFn: async () => [],
  recordsFn: async () => [],
  repoCheckFn: async () => ({ ok: true }),
  config: { memory: { lane: { enabled: true } } },
  ...overrides,
});

test('brain-next: no branch recommends brain:start', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  const result = await deriveNext(base({ branch: 'main' }));
  assert.equal(result.state, 'no-branch');
  assert.match(result.nextCommand, /brain:start/);
});

test('brain-next: failed checks take precedence over capture state', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  const result = await deriveNext(base({ repoCheckFn: async () => ({ ok: false }) }));
  assert.equal(result.state, 'checks-failing');
  assert.match(result.nextCommand, /brain:check/);
});

test('brain-next: missing issue-scoped record recommends canonical capture', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  const result = await deriveNext(base({ recordsFn: async () => [{ type: 'decision', issue: 7 }] }));
  assert.equal(result.state, 'needs-memory');
  assert.match(result.nextCommand, /brain:memory:save --issue 42/);
  assert.doesNotMatch(result.nextCommand, /brain:save(?!:)/);
});

test('brain-next: issue-scoped record plus enabled lane reaches brain:ship', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  const result = await deriveNext(base({ recordsFn: async () => [{ type: 'session_summary', issue: 42 }] }));
  assert.equal(result.state, 'ready');
  assert.match(result.nextCommand, /brain:ship/);
  assert.match(result.nextCommand, /lane/i);
});

test('brain-next: issue-scoped record with disabled lane reaches brain:ship', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  const result = await deriveNext(base({
    recordsFn: async () => [{ type: 'session_summary', issue: 42 }],
    config: {},
  }));
  assert.equal(result.state, 'ready');
  assert.match(result.nextCommand, /brain:ship/);
  assert.match(result.nextCommand, /capture is recorded; the memory lane is not enabled/);
});

test('brain-next: open PR reports status without reading records', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  let read = false;
  const result = await deriveNext(base({
    openPRsFn: async () => [{ number: 99, title: 'Demo', headBranch: 'feature/42-demo' }],
    recordsFn: async () => { read = true; return []; },
  }));
  assert.equal(result.state, 'open-pr');
  assert.match(result.nextCommand, /PR #99/);
  assert.equal(read, false);
});

test('brain-next: never requests porcelain .memory/ input', async () => {
  const { deriveNext } = await import('./brain-next.mjs');
  let called = false;
  const result = await deriveNext(base({ memoryStatusFn: async () => { called = true; return ''; } }));
  assert.equal(result.state, 'needs-memory');
  assert.equal(called, false);
});
