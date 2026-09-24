// alarm.test.mjs — the ONE tested alarm filer (REQ-TS-4/-5, issues #466/#474).
//
// The alarm path is the thing #466 proved nobody was watching: the job went red
// and no issue was ever filed. So the filer is a tested function with an
// injected `gh` runner, not three copies of bash nobody exercises.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fileAlarm } from './alarm.mjs';

/** A recording gh stub. `responses` maps 'verb sub' → {ok, stdout}. */
function recorder(responses = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const key = `${args[0]} ${args[1]}`;
    return { ok: true, stdout: '', stderr: '', ...(responses[key] ?? {}) };
  };
  run.calls = calls;
  return run;
}

test('fileAlarm: with no open issue for the label, CREATES one', () => {
  const run = recorder({ 'issue list': { ok: true, stdout: '' } });
  const res = fileAlarm('governance:audit-unrevertible', 'a title', '/tmp/body.md', run);

  assert.equal(res.filed, true);
  assert.equal(res.action, 'created');
  const created = run.calls.find((c) => c[0] === 'issue' && c[1] === 'create');
  assert.ok(created, `expected a gh issue create call, got:\n${JSON.stringify(run.calls)}`);
  assert.ok(created.includes('governance:audit-unrevertible'), 'the alarm must carry its label');
});

test('fileAlarm: with an OPEN issue for the label, COMMENTS instead of duplicating', () => {
  // A halt that persists across the daily cron must be one issue with N
  // comments, not N issues — otherwise the loud path becomes its own noise
  // problem and gets muted, which is how #462 stayed invisible for 12 days.
  const run = recorder({ 'issue list': { ok: true, stdout: '462' } });
  const res = fileAlarm('governance:audit-unrevertible', 'a title', '/tmp/body.md', run);

  assert.equal(res.action, 'commented');
  assert.ok(run.calls.some((c) => c[0] === 'issue' && c[1] === 'comment' && c.includes('462')),
    `expected a comment on #462, got:\n${JSON.stringify(run.calls)}`);
  assert.ok(!run.calls.some((c) => c[0] === 'issue' && c[1] === 'create'),
    'must NOT open a second issue for the same open alarm');
});

test('fileAlarm: a FAILED create is reported as not-filed (never a false success)', () => {
  // If this returned {filed:true} on failure, the backstop would believe the
  // alarm exists and the job would be red and silent again — the whole bug.
  const run = recorder({
    'issue list': { ok: true, stdout: '' },
    'issue create': { ok: false, stderr: 'HTTP 403: Resource not accessible by integration' },
  });
  const res = fileAlarm('governance:postmerge-unreported', 't', '/tmp/body.md', run);

  assert.equal(res.filed, false, 'a failed gh call must never report the alarm as filed');
  assert.match(res.reason, /403/, 'the real reason must survive for the operator');
});

test('fileAlarm: a FAILED comment is reported as not-filed', () => {
  const run = recorder({
    'issue list': { ok: true, stdout: '77' },
    'issue comment': { ok: false, stderr: 'network unreachable' },
  });
  const res = fileAlarm('governance:audit-unrevertible', 't', '/tmp/body.md', run);

  assert.equal(res.filed, false);
  assert.match(res.reason, /network unreachable/);
});

test('fileAlarm: a failing `label create` does NOT prevent the alarm', () => {
  // Refusing to file the alarm because the label could not be restyled would
  // trade a loud failure for a silent one.
  const run = recorder({
    'label create': { ok: false, stderr: 'label already exists' },
    'issue list': { ok: true, stdout: '' },
  });
  const res = fileAlarm('governance:audit-unrevertible', 't', '/tmp/body.md', run);

  assert.equal(res.filed, true, 'the alarm must still be filed when only the label styling failed');
});

test('fileAlarm: an unreadable issue list falls through to CREATE (never silently skips)', () => {
  // `gh issue list` failing must not be read as "an issue already exists".
  const run = recorder({ 'issue list': { ok: false, stdout: '', stderr: 'boom' } });
  const res = fileAlarm('governance:audit-unrevertible', 't', '/tmp/body.md', run);

  assert.equal(res.action, 'created',
    'a failed lookup must fall through to filing, never be mistaken for a deduped alarm');
});
