// scripts/harness/backends/claude.test.mjs — unit tests for claude platform backend (issue #305).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CLAUDE_SETTINGS_EMIT_PATH, init, runStage } from './claude.mjs';
import { compileSettingsHooksJson } from './settings-hooks.mjs';

test('CLAUDE_SETTINGS_EMIT_PATH === ".claude/settings.json"', () => {
  assert.equal(CLAUDE_SETTINGS_EMIT_PATH, '.claude/settings.json');
});

test('compileSettingsHooksJson() emits valid JSON with SessionStart and PreToolUse hooks', () => {
  const jsonStr = compileSettingsHooksJson();
  const parsed = JSON.parse(jsonStr);

  assert.ok(parsed.hooks);
  assert.ok(Array.isArray(parsed.hooks.PreToolUse));
  assert.ok(Array.isArray(parsed.hooks.SessionStart));

  const sessionStartHook = parsed.hooks.SessionStart[0].hooks[0].command;
  assert.equal(sessionStartHook, 'npm run brain:session:start');

  const preToolUseHook = parsed.hooks.PreToolUse[0].hooks[0].command;
  assert.match(preToolUseHook, /--no-verify/);
});

test('init() calls _writeClaudeSettings with CLAUDE_SETTINGS_EMIT_PATH and valid JSON', async () => {
  const writeCalls = [];
  const _writeClaudeSettings = (relPath, content) => writeCalls.push({ relPath, content });

  await init({ _writeClaudeSettings, _repoRoot: '/fake/repo' });

  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].relPath, CLAUDE_SETTINGS_EMIT_PATH);
  assert.equal(writeCalls[0].content, compileSettingsHooksJson());
});

// ── agent runtime descriptor (issue #123) ────────────────────────────────────

test('AGENT_RUNTIME declares a probeable claude runtime with an update hint', async () => {
  const { AGENT_RUNTIME } = await import('./claude.mjs');

  assert.equal(AGENT_RUNTIME.bin, 'claude');
  assert.ok(Array.isArray(AGENT_RUNTIME.versionArgs));
  assert.ok(AGENT_RUNTIME.versionArgs.length > 0);
  assert.equal(AGENT_RUNTIME.latest.cmd, 'npm');
  assert.ok(AGENT_RUNTIME.latest.args.includes('@anthropic-ai/claude-code'));
  assert.match(AGENT_RUNTIME.updateHint, /@anthropic-ai\/claude-code/);
});

test('AGENT_RUNTIME probes cleanly through the generic prober', async () => {
  const { AGENT_RUNTIME } = await import('./claude.mjs');
  const { probeAgentRuntime } = await import('./agent-runtime.mjs');

  const calls = [];
  const _run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return { status: 0, stdout: '1.0.0\n', stderr: '' };
  };

  assert.equal(probeAgentRuntime(AGENT_RUNTIME, { _run }).state, 'up-to-date');
  // The descriptor's own update hint is never executed by the probe.
  assert.ok(!calls.some(c => c === AGENT_RUNTIME.updateHint || /install|update/.test(c.split(' ').slice(0, 2).join(' '))));
});


// ── #775 — the forge config shadow rides through, and only after the scrub ──

test('runStage: forgeConfigDir points every forge CLI at the per-run directory', async () => {
  let seen = null;
  await runStage({
    stage: 'cold-review', prompt: 'p', cwd: '/tmp',
    forgeConfigDir: '/tmp/run-1',
    _env: { PATH: '/usr/bin' },
    _run: (_bin, _args, opts) => { seen = opts.env; return { status: 0, stdout: '' }; },
  });
  assert.equal(seen.GH_CONFIG_DIR, '/tmp/run-1');
  assert.equal(seen.GLAB_CONFIG_DIR, '/tmp/run-1');
  assert.equal(seen.PATH, '/usr/bin');
});

test('runStage: the shadow does NOT re-admit a scrubbed credential', async () => {
  // The shadow is applied to the ALREADY-SCRUBBED env. If it were applied to
  // `_env` and then merged, a credential the scrub removed would come back —
  // which is the one thing this parameter must never be able to do. That is
  // also why it takes a PATH and not an env bag.
  let seen = null;
  await runStage({
    stage: 'cold-review', prompt: 'p', cwd: '/tmp',
    forgeConfigDir: '/tmp/run-1',
    _env: { PATH: '/usr/bin', GH_TOKEN: 'SECRET', BRAIN_REVIEWER_TOKEN: 'SECRET' },
    _run: (_bin, _args, opts) => { seen = opts.env; return { status: 0, stdout: '' }; },
  });
  assert.equal(seen.GH_TOKEN, undefined);
  assert.equal(seen.BRAIN_REVIEWER_TOKEN, undefined);
  assert.equal(seen.GH_CONFIG_DIR, '/tmp/run-1');
});

test('runStage: without forgeConfigDir the env is exactly the scrubbed one', async () => {
  // No default. A backend that invented a directory would shadow the operator's
  // forge CLI on every stage brain ever routes, which is not this ticket's to
  // decide for stages that do not spawn a cold-review producer.
  let seen = null;
  await runStage({
    stage: 'cold-review', prompt: 'p', cwd: '/tmp',
    _env: { PATH: '/usr/bin', GH_CONFIG_DIR: '/home/x/.config/gh' },
    _run: (_bin, _args, opts) => { seen = opts.env; return { status: 0, stdout: '' }; },
  });
  assert.equal(seen.GH_CONFIG_DIR, '/home/x/.config/gh');
});

// ── #1010 — the producer must never mutate what it is asked to review ───────

test('runStage: every run carries --settings {disableAllHooks: true} — this repo\'s committed .claude/settings.json SessionStart hook must never run for the engine reviewing its own candidate (#1010)', async () => {
  let seenArgs = null;
  await runStage({
    stage: 'cold-review', prompt: 'p', cwd: '/tmp',
    _env: { PATH: '/usr/bin' },
    _run: (_bin, args) => { seenArgs = args; return { status: 0, stdout: '' }; },
  });

  const flagIndex = seenArgs.indexOf('--settings');
  assert.notEqual(flagIndex, -1, 'the spawned claude CLI must be given --settings');
  assert.deepEqual(
    JSON.parse(seenArgs[flagIndex + 1]),
    { disableAllHooks: true },
    'the settings payload must disable every hook, including SessionStart',
  );
});
