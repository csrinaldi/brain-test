// local-ci-parity.test.mjs — one rule, two surfaces, pinned to each other (issue #340).
//
// `brain:check` is the verb the golden path tells you to trust before shipping. When it
// is more permissive than CI it produces CONFIDENT FALSE GREENS: the contributor ships,
// CI rejects, and the local gate gave no warning. #340 was found by accident on PR #338
// and hit again in production on PR #484 — nothing was looking for it.
//
// THE DIRECTION IS THE RULE. A local check STRICTER than CI is an annoyance. A local
// check LAXER than CI is a broken promise. So every assertion below is one-sided:
// local may fail where CI passes; local may NEVER pass where CI fails.
//
// This is the same shape as `vcs.contract.test.mjs`'s parameterized parity suite, moved
// from the provider seam to the local-gate/CI-gate seam — because #340's real content is
// that a rule with two implementations and nothing pinning them together will drift, and
// the fix is only durable if something looks.
//
// The audit #340 asked for ("audit the other five checks before assuming this one is
// isolated") is the FIXTURE TABLE below: it covers every check `brain:check` runs, not
// just the one the ticket was opened about. It found two more.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCheck as runLocal } from '../brain-check.mjs';
import { runCheck as runCi } from './run-check.mjs';

const APPROVED = async () => ({ labels: ['status:approved'] });
const UNAPPROVED = async () => ({ labels: ['type:bug'] });

/**
 * Every fixture is ONE change, described once, and fed to both surfaces. Anything
 * described twice is a place the two can disagree by transcription rather than by rule.
 */
const FIXTURES = [
  {
    name: 'the headline case — `Part of #N` on a PR to the default branch (PR #338)',
    body: 'Part of #335',
    targetBranch: 'main',
    defaultBranch: 'main',
    fetchIssue: APPROVED,
    observations: [{ type: 'session_summary', issue: 335 }],
  },
  {
    name: '`Part of #N` on a SLICE PR — the case the chained-PR flow needs to keep passing',
    body: 'Part of #335',
    targetBranch: 'feature/epic',
    defaultBranch: 'main',
    fetchIssue: APPROVED,
    observations: [{ type: 'session_summary', issue: 335 }],
  },
  {
    name: 'a closing reference to an issue that is NOT approved (PR #484 class)',
    body: 'Closes #999',
    targetBranch: 'main',
    defaultBranch: 'main',
    fetchIssue: UNAPPROVED,
    observations: [{ type: 'session_summary', issue: 999 }],
  },
  {
    name: 'a session summary scoped to a DIFFERENT issue than the one being closed',
    body: 'Closes #340',
    targetBranch: 'main',
    defaultBranch: 'main',
    fetchIssue: APPROVED,
    observations: [{ type: 'session_summary', issue: 999 }],
  },
  {
    name: 'no memory record at all',
    body: 'Closes #340',
    targetBranch: 'main',
    defaultBranch: 'main',
    fetchIssue: APPROVED,
    observations: [],
  },
  {
    name: 'no issue reference of any kind',
    body: 'just prose',
    targetBranch: 'main',
    defaultBranch: 'main',
    fetchIssue: APPROVED,
    observations: [{ type: 'session_summary', issue: 1 }],
  },
  {
    name: 'the fully coherent change — everything lines up',
    body: 'Closes #340',
    targetBranch: 'main',
    defaultBranch: 'main',
    fetchIssue: APPROVED,
    observations: [{ type: 'session_summary', issue: 340 }],
  },
];

/** The local verdict for one named check, out of the aggregate result. */
async function localVerdict(check, f) {
  const result = await runLocal({
    numstat: '1\t0\tsrc/a.mjs\n',
    changedFiles: ['src/a.mjs'],
    addedFiles: [],
    prBody: f.body,
    ignoreList: [],
    observations: f.observations,
    budget: 1000,
    targetBranch: f.targetBranch,
    defaultBranch: f.defaultBranch,
    fetchIssue: f.fetchIssue,
    npmTestFn: async () => ({ ok: true }),
    repoCheckFn: async () => ({ ok: true }),
  });
  const failed = result.failures.some(x => x.check === check);
  const unver = result.unverified.some(x => x.check === check);
  return { pass: !failed && !unver, unverified: unver };
}

const CI_JOB = { issueLink: 'issue-link', memoryPresence: 'memory-gate' };

async function ciVerdict(check, f) {
  return runCi(CI_JOB[check], {
    ctx: { body: f.body, targetBranch: f.targetBranch, defaultBranch: f.defaultBranch },
    fetchIssue: f.fetchIssue,
    readRecords: () => f.observations,
  });
}

for (const check of Object.keys(CI_JOB)) {
  for (const f of FIXTURES) {
    test(`#340 parity [${check}] ${f.name}`, async () => {
      const local = await localVerdict(check, f);
      const ci = await ciVerdict(check, f);

      assert.ok(
        !(local.pass && !ci.pass),
        `brain:check PASSES ${check} where CI FAILS it — a confident false green, which is ` +
        `the defect #340 records. CI said: ${ci.reason}`,
      );

      // And the same evidence must actually produce the same verdict, not merely a
      // safe one: a local check hardcoded to fail would satisfy the one-sided rule
      // above while being useless. This is the half that keeps it honest.
      assert.equal(
        local.pass, ci.pass,
        `${check} disagrees on identical evidence — local ${local.pass ? 'PASS' : 'FAIL'}, ` +
        `CI ${ci.pass ? 'PASS' : 'FAIL'}. CI said: ${ci.reason}`,
      );
    });
  }
}

// ── the two checks that stay on the pure functions, and why (#340's audit) ──────

test('#340: diffSize diverges ONLY in the safe direction — local is stricter, never laxer', async () => {
  // CI honours a `size:exception` label. No label exists before the PR does, so local
  // cannot honour it and fails a change CI would pass. That is the annoying direction,
  // deliberately kept: teaching this verb to honour a label it cannot see would mean
  // inventing a label set, which is the one change that could make local LAXER.
  const over = '900\t200\tsrc/a.mjs\n';
  const local = await runLocal({
    numstat: over, changedFiles: ['src/a.mjs'], addedFiles: [], prBody: 'Closes #1',
    ignoreList: [], observations: [{ type: 'session_summary', issue: 1 }], budget: 400,
    targetBranch: 'main', defaultBranch: 'main', fetchIssue: APPROVED,
    npmTestFn: async () => ({ ok: true }), repoCheckFn: async () => ({ ok: true }),
  });
  const ci = await runCi('diff-size', {
    ctx: { labels: ['size:exception'], baseSha: 'B', headSha: 'H' },
    diffNumstat: () => over,
  });

  assert.ok(local.failures.some(x => x.check === 'diffSize'), 'local fails it');
  assert.equal(ci.pass, true, 'CI passes it on the label');
  // The assertion that matters is the direction, stated as the property rather than as
  // these two values: local failing where CI passes is permitted; the reverse is not.
  assert.ok(!(local.failures.every(x => x.check !== 'diffSize') && !ci.pass),
    'diffSize may be stricter locally, never laxer');
});

test('#340: adrPresence is aligned BY CONSTRUCTION — both surfaces get the same two lists', async () => {
  // The one check that never diverged, and it is worth a test saying why: #510 gave it
  // an `addedFiles` parameter and all three enforcement surfaces pass it. There is no
  // policy layer on top of it for a second implementation to disagree about.
  const changed = ['brain/project/decisions/adr-0099-new.md'];
  const added = changed;
  const local = await runLocal({
    numstat: '1\t0\tx\n', changedFiles: changed, addedFiles: added, prBody: 'Closes #1',
    ignoreList: [], observations: [{ type: 'session_summary', issue: 1 }], budget: 1000,
    targetBranch: 'main', defaultBranch: 'main', fetchIssue: APPROVED,
    npmTestFn: async () => ({ ok: true }), repoCheckFn: async () => ({ ok: true }),
  });
  const ci = await runCi('decision-gate', {
    diffNameOnly: () => changed,
    diffNameOnlyAdded: () => added,
  });
  assert.ok(local.failures.some(x => x.check === 'adrPresence'));
  assert.equal(ci.pass, false);
});

// ── UNVERIFIED is not PASS (#340) ───────────────────────────────────────────────

test('#340: an unresolvable base branch is UNVERIFIED, never a pass', async () => {
  // Hazard 1 from the ticket: "if the base branch is unresolvable, the honest answer is
  // cannot evaluate, not assume slice". Assuming slice is the permissive direction and
  // reproduces this ticket exactly.
  const result = await runLocal({
    numstat: '1\t0\tx\n', changedFiles: ['x'], addedFiles: [], prBody: 'Part of #335',
    ignoreList: [], observations: [{ type: 'session_summary', issue: 335 }], budget: 1000,
    targetBranch: null, defaultBranch: null, fetchIssue: APPROVED,
    npmTestFn: async () => ({ ok: true }), repoCheckFn: async () => ({ ok: true }),
  });
  assert.ok(result.unverified.some(x => x.check === 'issueLink'),
    'an unresolvable base must land in `unverified`');
  assert.ok(!result.failures.some(x => x.check === 'issueLink'),
    'and it is not a hard local failure either — it is absent evidence, not a violation');
  assert.match(result.summary, /\[UNVERIFIED\] issueLink/,
    'the summary must SHOW the third state — rendering it as PASS is the false green itself');
});

test('#340: a failed approved-label lookup is UNVERIFIED, never a pass', async () => {
  const result = await runLocal({
    numstat: '1\t0\tx\n', changedFiles: ['x'], addedFiles: [], prBody: 'Closes #340',
    ignoreList: [], observations: [{ type: 'session_summary', issue: 340 }], budget: 1000,
    targetBranch: 'main', defaultBranch: 'main',
    fetchIssue: async () => { throw new Error('offline'); },
    npmTestFn: async () => ({ ok: true }), repoCheckFn: async () => ({ ok: true }),
  });
  assert.ok(result.unverified.some(x => x.check === 'issueLink'));
  assert.ok(!/\[PASS\] issueLink/.test(result.summary),
    'no network must never render as a verified pass');
});
