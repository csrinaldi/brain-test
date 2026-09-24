// brain/scripts/lib/config-migrations.test.mjs — unit tests for the `1.6.0`
// entry (#906 A6): `memory.lane.enabled` defaults to false, additive-only,
// never overwriting an already-set value.
//
// This file did not exist before #906 — the migrations were previously
// exercised only indirectly, through installer.test.mjs, vcs/cli.test.mjs,
// and stage-engine.test.mjs (each importing `migrations` for their own
// purpose). This is the first test file that owns the migration LIST itself.
//
// Lives here, not beside brain/core/config-migrations.mjs: `npm test`'s
// globs (test-hygiene's #850 guard) only reach `brain/scripts/**/*.test.mjs`
// and `test/**/*.e2e.test.mjs` — a test under brain/core/ is never run. Same
// precedent as brain/scripts/lib/managed-paths.test.mjs, whose subject
// (brain/core/managed-paths.mjs) lives one directory over too.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrations } from '../../core/config-migrations.mjs';
import { migrateConfig } from './installer.mjs';

const ENTRY = migrations.find((m) => m.version === '1.6.0');

test('#906 A6: a 1.6.0 entry exists and declares memory.lane.enabled: false', () => {
  assert.ok(ENTRY, 'migrations must contain a 1.6.0 entry');
  assert.deepEqual(ENTRY.defaults, { memory: { lane: { enabled: false } } });
});

test('#906 A6: additive — a config with no memory key gets enabled:false after 1.6.0', () => {
  const { config } = migrateConfig({ schemaVersion: '0.1.0' }, migrations, '1.6.0');
  assert.equal(config.memory.lane.enabled, false);
});

test('#906 A6: additive-only — an already-true value is NEVER overwritten by the migration', () => {
  const { config } = migrateConfig(
    { schemaVersion: '0.1.0', memory: { lane: { enabled: true } } },
    migrations,
    '1.6.0',
  );
  assert.equal(config.memory.lane.enabled, true, 'a consumer-set true must survive the migration');
});

test('#906 A6: every migration version is unique (never reused, per config-migrations.mjs doctrine)', () => {
  const versions = migrations.map((m) => m.version);
  assert.equal(new Set(versions).size, versions.length, 'a duplicated version number names two indistinguishable states');
});

// #906 cold review C1: the entry's own description claims dormancy until
// 1.6.0 is cut — this pins that claim against the SAME migrateConfig()
// walk a real `brain:config`/`brain:upgrade` caller uses (targetVersion is
// the installed package.json version, still 1.5.0 at the time this test
// was written). buildDefaultConfig() (lib/brain-config.mjs) is a DELIBERATE
// exception to this dormancy — it applies every migration unfiltered and is
// pinned separately below.
test('#906 A6/C1: dormant against a real caller — targetVersion 1.5.0 never applies the 1.6.0 entry, memory stays absent', () => {
  const { config, applied } = migrateConfig({ schemaVersion: '0.1.0' }, migrations, '1.5.0');
  assert.ok(!applied.includes('1.6.0'), '1.6.0 must not be in the applied list when targetVersion is 1.5.0');
  assert.equal(config.memory, undefined, 'memory must be entirely absent, not just enabled:false — the entry never ran');
});

// #906 cold review C1's other half: lib/brain-config.mjs's private
// buildDefaultConfig() applies every migration's defaults UNFILTERED — no
// targetVersion, no package.json read at all (its own real behavior is
// pinned directly in brain-config.test.mjs's full-default-schema assertion,
// since the function itself is module-private and not exported here). This
// test reproduces the same math migrateConfig() performs when its
// targetVersion filter cannot exclude anything (targetVersion = the latest
// migration's own version) as an honest proxy for "unfiltered", proving the
// entry's description's named EXCEPTION is real: a real caller through
// migrateConfig() with a real (lower) targetVersion stays dormant (pin
// above); a walk with nothing left to filter does not.
test('#906 C1: a migration walk with nothing left to filter DOES plant 1.6.0 — the same shape as buildDefaultConfig()\'s documented exception to dormancy', () => {
  const ordered = [...migrations].sort((a, b) => {
    const va = a.version.split('.').map(Number);
    const vb = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (va[i] !== vb[i]) return va[i] - vb[i];
    }
    return 0;
  });
  const { config: cfg } = migrateConfig({}, ordered, ordered.at(-1).version);
  assert.equal(cfg.memory.lane.enabled, false, 'a config built from every migration, unfiltered, DOES carry the 1.6.0 default');
  assert.equal(cfg.schemaVersion, '1.6.0', 'and its schemaVersion is stamped to the latest entry — ahead of package.json until the 1.6.0 cut');
});
