// change-route.test.mjs — GET /api/change/{issue}'s IO composition (#881,
// PR 3 / B1, D8/D11-D14). `buildChangeView` is exercised directly here
// (server.test.mjs covers the HTTP route + parity); this file is the
// fixture matrix cold review round 1-7 of #971 taught this project to build
// FIRST, before code (lessons: `sdd/issue-881-ui-server-canvas/review-lessons`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { testTmp } from '../lib/test-tmp.mjs';
import { buildChangeView, REVIEWS_SOURCE_NOTE } from './change-route.mjs';

const ISSUE = 881;
const CHANGE_DIR = 'openspec/changes/issue-881-ui-server-canvas';
const BRANCH = 'feat/issue-881-slice-3-lib';
const TASKS_PATH = `${CHANGE_DIR}/tasks.md`;

const SPEC_TEXT = [
  '### R881-8: the inspector drawer, four tabs, every value sourced',
  '#### Scenario: full drawer for a change with a spec and tasks',
  "- **WHEN** a node's issue has a change dir",
  '- **THEN** the Spec tab shows its cards',
].join('\n');

const TASKS_TEXT = ['## Phase 1', '- [x] ship layout.mjs', '- [ ] ship change-route.mjs'].join('\n');

const BLAME_PORCELAIN = [
  'abc1234abc1234abc1234abc1234abc1234abc1 1 2 1',
  'author csrinaldi',
  'author-mail <c@example.com>',
  'author-time 1694700000',
  'author-tz +0000',
  'committer csrinaldi',
  'committer-mail <c@example.com>',
  'committer-time 1694700000',
  'committer-tz +0000',
  'summary ship layout.mjs',
  'filename tasks.md',
  '\t- [x] ship layout.mjs',
  'def5678def5678def5678def5678def5678def5 2 3',
  '\t- [ ] ship change-route.mjs',
].join('\n');

const RESUME_TEXT = ['---', 'next_action: ship change-route.mjs', 'current_slice: 3', 'blockers:', '---', 'prose'].join('\n');

function makeRoot({ withSpec = true, withTasks = true } = {}) {
  const root = testTmp('change-route-');
  if (withSpec || withTasks) mkdirSync(join(root, CHANGE_DIR), { recursive: true });
  if (withSpec) writeFileSync(join(root, CHANGE_DIR, 'spec.md'), SPEC_TEXT);
  if (withTasks) writeFileSync(join(root, CHANGE_DIR, 'tasks.md'), TASKS_TEXT);
  return root;
}

function makeSnapshot({
  changes = [{ id: 'issue-881-ui-server-canvas', issue: ISSUE, slug: 'ui-server-canvas', dir: CHANGE_DIR }],
  prs = [], reviews = [], records = { ok: true, value: { records: [], duplicates: { ids: 0 } } },
} = {}) {
  return {
    changes: { ok: true, value: changes },
    prs: { ok: true, value: prs },
    reviews: { ok: true, value: reviews },
    records,
  };
}

/** Records every `run(file, args)` call and hands each argv to `handler` — the "recording `_run` stub" every T7 assertion needs (no real subprocess, ever). */
function recordingRun(handler) {
  const calls = [];
  const run = (file, args) => { calls.push(args); return handler(args); };
  run.calls = calls;
  return run;
}

// ── 1. a change dir and an open PR ──────────────────────────────────────────

test('#881: a change dir + an open PR resolves the branch from the PR, never calling `git branch --list`', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ prs: [{ number: 957, title: 'x', headBranch: BRANCH, issue: ISSUE }] });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, project: 'o/r', _run: run });
  assert.equal(result.ok, true);
  assert.equal(result.value.issue, ISSUE);
  assert.equal(result.value.changeDir, CHANGE_DIR);
  assert.equal(result.value.spec.ok, true);
  assert.equal(result.value.spec.value.length, 1);
  assert.equal(result.value.workingMemory.ok, true);
  assert.deepEqual(result.value.workingMemory.value.next_action, { ok: true, value: 'ship change-route.mjs', source: { path: `${BRANCH}:resume.md` } });
  assert.deepEqual(result.value.workingMemory.value.blockers, { ok: true, value: [], source: { path: `${BRANCH}:resume.md` } });
  assert.ok(!run.calls.some((args) => args[0] === 'branch'), 'a PR headBranch is authoritative — no branch listing needed');
  assert.deepEqual(run.calls.find((args) => args[0] === 'show'), ['show', `${BRANCH}:resume.md`]);
});

// ── 2. a change dir, no PR, exactly one matching branch ─────────────────────

test('#881: no PR but exactly one feat/issue-<N>-* branch resolves working memory from it', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ prs: [] });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return `  ${BRANCH}\n`;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.workingMemory.ok, true);
  assert.equal(result.value.workingMemory.value.current_slice.value, '3'); // parseFrontmatter scalars are always strings — resume-frontmatter.mjs does no type coercion
  assert.deepEqual(run.calls.find((args) => args[0] === 'branch'), ['branch', '--list', `feat/issue-${ISSUE}-*`]);
});

// ── 3. two matching branches ─────────────────────────────────────────────────

test('#881: two matching feat/issue-<N>-* branches renders none, listing both, and never calls `git show`', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ prs: [] });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return `  feat/issue-${ISSUE}-a\n  feat/issue-${ISSUE}-b\n`;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.workingMemory.ok, false);
  assert.match(result.value.workingMemory.reason, new RegExp(`feat/issue-${ISSUE}-a`));
  assert.match(result.value.workingMemory.reason, new RegExp(`feat/issue-${ISSUE}-b`));
  assert.ok(!run.calls.some((args) => args[0] === 'show'), 'ambiguous branch resolution must never guess which one to read');
});

// ── 4. no change dir ─────────────────────────────────────────────────────────

test('#881: no change dir — Spec and Tasks both say so, naming the expected glob as their source', () => {
  const root = makeRoot({ withSpec: false, withTasks: false });
  const snapshot = makeSnapshot({ changes: [] });
  const run = recordingRun((args) => {
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.changeDir, null);
  assert.deepEqual(result.value.spec, { ok: false, reason: `no change dir at openspec/changes/issue-${ISSUE}-*`, source: { path: `openspec/changes/issue-${ISSUE}-*` } });
  assert.deepEqual(result.value.tasks, { ok: false, reason: `no change dir at openspec/changes/issue-${ISSUE}-*`, source: { path: `openspec/changes/issue-${ISSUE}-*` } });
});

// ── 5. unreadable spec.md ────────────────────────────────────────────────────

test('#881: a change dir with tasks.md but no spec.md — Spec says unreadable, Tasks is unaffected', () => {
  const root = makeRoot({ withSpec: false, withTasks: true });
  const snapshot = makeSnapshot();
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.spec.ok, false);
  assert.match(result.value.spec.reason, /spec\.md could not be read/);
  assert.deepEqual(result.value.spec.source, { path: `${CHANGE_DIR}/spec.md` });
  assert.equal(result.value.tasks.ok, true);
  assert.equal(result.value.tasks.value.length, 2);
});

// ── 6. tasks.md present but blame throws ─────────────────────────────────────

test('#881: tasks.md present but `git blame` throws — the checklist still renders in full, attribution said false per row, never dropped', () => {
  const root = makeRoot({ withSpec: true, withTasks: true });
  const snapshot = makeSnapshot();
  const run = recordingRun((args) => {
    if (args[0] === 'blame') throw new Error("fatal: no such path 'tasks.md' in HEAD");
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.tasks.ok, true);
  assert.equal(result.value.tasks.value.length, 2);
  for (const item of result.value.tasks.value) {
    assert.equal(item.attribution.ok, false);
    assert.match(item.attribution.reason, /no such path/);
    assert.equal(item.actor, 'unknown', 'never dropped — tasks-list.mjs\'s own "unknown" default still renders');
  }
  const blameCall = run.calls.find((args) => args[0] === 'blame');
  assert.deepEqual(blameCall, ['blame', '--porcelain', 'HEAD', '--', TASKS_PATH]);
});

// ── 7. resume.md absent on the branch ────────────────────────────────────────

test('#881: a resolved branch with no committed resume.md — the tab says so and points at slice 5 / #883', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ prs: [{ number: 5, title: 'x', headBranch: BRANCH, issue: ISSUE }] });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') throw new Error(`fatal: path 'resume.md' does not exist in '${BRANCH}'`);
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.deepEqual(result.value.workingMemory, {
    ok: false,
    reason: `no committed resume.md on ${BRANCH}; the local overlay arrives in slice 5 (#883)`,
  });
});

// ── 8. resume.md present ─────────────────────────────────────────────────────

test('#881: a resolved branch with a committed resume.md shapes all three ruling-3 fields, sourced to <branch>:resume.md', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ prs: [{ number: 5, title: 'x', headBranch: BRANCH, issue: ISSUE }] });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.workingMemory.ok, true);
  const { next_action: nextAction, current_slice: currentSlice, blockers } = result.value.workingMemory.value;
  assert.deepEqual(nextAction, { ok: true, value: 'ship change-route.mjs', source: { path: `${BRANCH}:resume.md` } });
  assert.deepEqual(currentSlice, { ok: true, value: '3', source: { path: `${BRANCH}:resume.md` } }); // parseFrontmatter scalars are always strings
  assert.deepEqual(blockers, { ok: true, value: [], source: { path: `${BRANCH}:resume.md` } });
});

// ── 9. reviews with two rounds ───────────────────────────────────────────────

test('#881: two review rounds on the issue\'s PR render oldest first, each sourced to the PR URL, with the D14 caveat note', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({
    prs: [{ number: 957, title: 'x', headBranch: BRANCH, issue: ISSUE }],
    reviews: [{
      pr: 957,
      ok: true,
      verdicts: [
        { pr: 957, head_sha: 'aaa1111', rev: 1, verdict: 'request-changes', author: 'reviewer-a', findings: 2, malformed: [] },
        { pr: 957, head_sha: 'bbb2222', rev: 2, verdict: 'approve', author: 'reviewer-a', findings: 0, malformed: [] },
      ],
      latest: null,
    }],
  });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, project: 'o/r', _run: run });
  assert.equal(result.value.reviews.ok, true);
  assert.equal(result.value.reviews.sourceNote, REVIEWS_SOURCE_NOTE);
  assert.equal(result.value.reviews.value.length, 2);
  assert.equal(result.value.reviews.value[0].rev, 1, 'oldest first');
  assert.equal(result.value.reviews.value[1].rev, 2);
  for (const round of result.value.reviews.value) assert.deepEqual(round.source, { url: 'https://github.com/o/r/pull/957' });
});

// ── 10. an issue not in the graph at all ─────────────────────────────────────

test('#881: an issue absent from snapshot.graph still gets a full view — the route never depends on graph membership', () => {
  const root = makeRoot();
  const snapshot = {
    ...makeSnapshot({ prs: [{ number: 957, title: 'x', headBranch: BRANCH, issue: ISSUE }] }),
    graph: { ok: true, value: { nodes: [{ number: 999, state: 'open' }], edges: [] } }, // 881 is nowhere in here
  };
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.ok, true);
  assert.equal(result.value.changeDir, CHANGE_DIR);
  assert.equal(result.value.spec.ok, true);
  assert.equal(result.value.tasks.ok, true);
});

// ── top-level guards ─────────────────────────────────────────────────────────

test('#881: a non-positive-integer issue is a said failure, never a thrown error', () => {
  assert.equal(buildChangeView({ root: '/x', issue: 0, snapshot: makeSnapshot() }).ok, false);
  assert.equal(buildChangeView({ root: '/x', issue: -1, snapshot: makeSnapshot() }).ok, false);
  assert.equal(buildChangeView({ root: '/x', issue: 1.5, snapshot: makeSnapshot() }).ok, false);
});

test('#881: no snapshot supplied is a said failure, never a thrown error', () => {
  const result = buildChangeView({ root: '/x', issue: ISSUE, snapshot: null });
  assert.equal(result.ok, false);
  assert.ok(result.reason.length > 0);
});

// ── pre-push review of slice 3, blocker: an unreadable review thread is said ──
//
// `reviewRows` in status/snapshot.mjs fails PER PR while the outer list still
// resolves: a row is `{pr, ok:false, reason}`. Skipping it left the tab
// `ok:true` with an empty list — the same reading as "no rounds ever posted"
// (`evidence-reader-empty-on-failure.md`, R881-9).

test('#881: one readable and one unreadable review thread — the rounds render and the unreadable PR is said with its reason and URL', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({
    prs: [{ number: 957, title: 'x', headBranch: BRANCH, issue: ISSUE }, { number: 958, title: 'y', headBranch: 'feat/other', issue: ISSUE }],
    reviews: [
      { pr: 957, ok: true, verdicts: [{ pr: 957, head_sha: 'aaa1111', rev: 1, verdict: 'approve', author: 'reviewer-a', findings: 0, malformed: [] }], latest: null },
      { pr: 958, ok: false, reason: 'thread unreadable: rate limited' },
    ],
  });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const reviews = buildChangeView({ root, issue: ISSUE, snapshot, project: 'o/r', _run: run }).value.reviews;
  assert.equal(reviews.ok, true);
  assert.equal(reviews.value.length, 1, 'the readable round is still there');
  assert.deepEqual(reviews.unreadable, [{ pr: 958, ok: false, reason: 'thread unreadable: rate limited', source: { url: 'https://github.com/o/r/pull/958' } }]);
});

// ── #998 R998-6: the records tab — this issue's own memory records ──────────

test('#998 R998-6: two records filed against this issue and one against another render newest first, sourced to their own file', () => {
  const root = makeRoot();
  const records = {
    ok: true,
    value: {
      records: [
        { id: 'rec-a', ts: '2026-09-15T10:00:00Z', actor: 'csrinaldi', actorKind: 'human', type: 'decision', issue: ISSUE, file: '.memory/records/rec-a.jsonl' },
        { id: 'rec-b', ts: '2026-09-16T10:00:00Z', actor: 'claude', actorKind: 'agent', type: 'bugfix', issue: ISSUE, supersedes: 'rec-a', file: '.memory/records/rec-b.jsonl' },
        { id: 'rec-c', ts: '2026-09-16T11:00:00Z', actor: 'csrinaldi', actorKind: 'human', type: 'decision', issue: 999, file: '.memory/records/rec-c.jsonl' },
      ],
      duplicates: { ids: 0 },
    },
  };
  const snapshot = makeSnapshot({ records });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.records.ok, true);
  assert.deepEqual(result.value.records.value.map((r) => r.id), ['rec-b', 'rec-a'], 'newest first, and the other issue\'s record is excluded');
  assert.deepEqual(result.value.records.value[0], {
    id: 'rec-b', ts: '2026-09-16T10:00:00Z', actor: 'claude', actorKind: 'agent', type: 'bugfix', supersedes: 'rec-a',
    source: { path: '.memory/records/rec-b.jsonl' },
  });
});

test('#998 R998-6: an unreadable records section is the tab\'s own reason, never an empty list read as "no records"', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ records: { ok: false, reason: '.memory/index.jsonl is unreadable' } });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.deepEqual(result.value.records, { ok: false, reason: '.memory/index.jsonl is unreadable' });
});

// ── #998 R998-6: the sdd tab — this issue's own seven-stage presence ────────

test('#998 R998-6/#1059: the sdd tab names each stage\'s FILE and sources the row to that file, not to the directory all seven share', () => {
  const root = makeRoot();
  const changes = [{ id: 'issue-881-ui-server-canvas', issue: ISSUE, slug: 'ui-server-canvas', dir: CHANGE_DIR, artefacts: { proposal: true, spec: true, design: false, tasks: true, apply: false, verify: false, archive: false } }];
  const snapshot = makeSnapshot({ changes });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.equal(result.value.sdd.ok, true);
  // The maintainer, clicking a ticket: "SDD no está listando los files".
  // Seven rows carried the same `{path: CHANGE_DIR}` stamp, so the tab said a
  // stage was present without ever naming the file that made it present, and
  // the provenance — the thing every value on this page is supposed to carry
  // — pointed all seven readers at one directory.
  assert.deepEqual(result.value.sdd.value, [
    { stage: 'proposal', file: 'proposal.md', present: true, source: { path: `${CHANGE_DIR}/proposal.md` } },
    { stage: 'spec', file: 'spec.md', present: true, source: { path: `${CHANGE_DIR}/spec.md` } },
    { stage: 'design', file: 'design.md', present: false, source: { path: `${CHANGE_DIR}/design.md` } },
    { stage: 'tasks', file: 'tasks.md', present: true, source: { path: `${CHANGE_DIR}/tasks.md` } },
    { stage: 'apply', file: 'apply-progress.md', present: false, source: { path: `${CHANGE_DIR}/apply-progress.md` } },
    { stage: 'verify', file: 'verify-report.md', present: false, source: { path: `${CHANGE_DIR}/verify-report.md` } },
    { stage: 'archive', file: 'archive-report.md', present: false, source: { path: `${CHANGE_DIR}/archive-report.md` } },
  ]);

  // A stage that is MISSING still names the file it would be, because "design
  // is missing" is only actionable if the reader knows what to create.
  const design = result.value.sdd.value.find((row) => row.stage === 'design');
  assert.equal(design.present, false);
  assert.equal(design.file, 'design.md', 'an absent stage names the file it would be written to');
});

test('#998 R998-6: no change dir for this issue is the sdd tab\'s own said reason — the exact noChangeDirTab reason, the same fact the spec/tasks tabs already share for this cause, never a second wording for it', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({ changes: [] });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'branch') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const result = buildChangeView({ root, issue: ISSUE, snapshot, _run: run });
  assert.deepEqual(result.value.sdd, {
    ok: false,
    reason: `no change dir at openspec/changes/issue-${ISSUE}-*`,
    source: { path: `openspec/changes/issue-${ISSUE}-*` },
  });
});

test('#881: when every review thread of the issue is unreadable the tab is ok:false and names them — never an empty list', () => {
  const root = makeRoot();
  const snapshot = makeSnapshot({
    prs: [{ number: 957, title: 'x', headBranch: BRANCH, issue: ISSUE }],
    reviews: [{ pr: 957, ok: false, reason: 'thread unreadable: rate limited' }],
  });
  const run = recordingRun((args) => {
    if (args[0] === 'blame') return BLAME_PORCELAIN;
    if (args[0] === 'show') return RESUME_TEXT;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  });
  const reviews = buildChangeView({ root, issue: ISSUE, snapshot, project: 'o/r', _run: run }).value.reviews;
  assert.equal(reviews.ok, false);
  assert.match(reviews.reason, /957.*rate limited/);
  assert.equal(reviews.unreadable.length, 1);
  assert.equal(reviews.sourceNote, REVIEWS_SOURCE_NOTE);
});

// ── #1059 region 08: the panel's SDD tab carries the slice plan ───────────
// The design puts the slice plan under the stage strip, in the same tab. The
// plan is DECLARED in tasks.md and read into `sliceScopes`; what a PR actually
// did with it is not read, and the tab says so rather than implying it.
test('#1059 region 08: the sdd tab carries the declared slice plan beside the stages', () => {
  const snapshot = {
    changes: { ok: true, value: [{
      issue: 881, dir: 'openspec/changes/issue-881-ui', artefacts: { proposal: true, spec: true },
      sliceScopes: { ok: true, value: [
        { slice: 1, claims: ['R881-1', 'R881-2'], terminal_pr: 'this PR -> main' },
        { slice: 2, claims: ['R881-3'], terminal_pr: null },
      ] },
    }] },
  };

  const view = buildChangeView({ snapshot, issue: 881, project: 'o/r' });
  const sdd = view.value.sdd;

  assert.equal(sdd.ok, true);
  assert.ok(Array.isArray(sdd.value), 'the stages stay an array, so every existing reader keeps working');
  assert.equal(sdd.slices.ok, true);
  assert.equal(sdd.slices.value.length, 2);
  assert.deepEqual(sdd.slices.value[0].claims, ['R881-1', 'R881-2'], 'a slice is judged against what it claims');
  assert.match(sdd.slices.note, /not read/i, 'what a PR did with the plan is not read, and the tab says so');
});

test('#1059 region 08: a change with no declared plan says so, and an unreadable one passes its reason through', () => {
  const none = buildChangeView({ snapshot: { changes: { ok: true, value: [{ issue: 5, dir: 'd', artefacts: {} }] } }, issue: 5 });
  assert.equal(none.value.sdd.slices.ok, false);
  assert.match(none.value.sdd.slices.reason, /no slice plan/i);

  const broken = buildChangeView({ snapshot: { changes: { ok: true, value: [{ issue: 5, dir: 'd', artefacts: {}, sliceScopes: { ok: false, reason: 'the block would not parse' } }] } }, issue: 5 });
  assert.equal(broken.value.sdd.slices.reason, 'the block would not parse');
});
