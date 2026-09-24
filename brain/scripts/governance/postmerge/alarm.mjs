// alarm.mjs — the ONE tested alarm filer for rung 3 (REQ-TS-4/-5, issues #466/#474).
//
// THE INVARIANT THIS EXISTS TO SERVE:
//   No terminal state of the post-merge audit may be both RED and SILENT.
//
// #466 was that invariant failing. `brain-audit` exited 1 with zero [FAIL-SHA]
// lines — a documented, legitimate state (§15.5: a violation in a
// non-auto-revertible class, or a tree-keyed failure whose revert would
// resurrect a payload). The `revert` step called that "incoherent" and exited 2,
// but the alarm step is gated on the AUDIT step's output (`== '2'`), which was
// `1`. Job red, nothing reverted, no issue filed, cursor frozen — observed live
// on 2026-08-06 in run 31094912872 over c724942.
//
// The lesson is not "add a branch for that state". It is that the alarm was
// gated on an ENUMERATION of exit codes, and an enumeration missed a state.
// So the alarm path is a tested function callable from any step, and the
// workflow's `always()` terminal step calls it as a BACKSTOP whenever the job
// is red and nothing else recorded an alarm — which holds for states nobody has
// enumerated yet.
//
// Idempotent by label (mirrors the bash the window/uncomputable steps already
// use): an open issue carrying the label is COMMENTED on rather than duplicated,
// so a halt that persists across the daily cron is one issue with N comments.
//
// Usage:
//   node alarm.mjs <label> <title> <body-file>
// Prints the label on success (the caller records it in $GITHUB_OUTPUT).
// Exits non-zero if the alarm could NOT be filed — never silently.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

/**
 * File (or update) the alarm issue for `label`.
 *
 * @param {string} label     e.g. 'governance:audit-unrevertible'
 * @param {string} title     issue title used only when creating
 * @param {string} bodyFile  path to the rendered markdown body
 * @param {(args: string[]) => {ok: boolean, stdout: string, stderr: string}} [run]
 *   injected `gh` runner — the seam the tests drive.
 * @returns {{ filed: boolean, action: 'created'|'commented'|null, reason: string|null }}
 */
export function fileAlarm(label, title, bodyFile, run = gh) {
  // --force so a pre-existing label is not an error. A failure here is NOT
  // fatal: the label may already exist with a different colour, and refusing to
  // file the alarm because we could not restyle its label would trade a loud
  // failure for a silent one — the exact bug this module exists to remove.
  run(['label', 'create', label, '--color', 'B60205', '--description', 'governance postmerge halt', '--force']);

  const existing = run(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number', '--jq', '.[0].number // empty']);
  if (existing.ok && existing.stdout) {
    const r = run(['issue', 'comment', existing.stdout, '--body-file', bodyFile]);
    return r.ok
      ? { filed: true, action: 'commented', reason: null }
      : { filed: false, action: null, reason: `gh issue comment failed: ${r.stderr}` };
  }

  const r = run(['issue', 'create', '--title', title, '--label', label, '--body-file', bodyFile]);
  return r.ok
    ? { filed: true, action: 'created', reason: null }
    : { filed: false, action: null, reason: `gh issue create failed: ${r.stderr}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [label, title, bodyFile] = process.argv.slice(2);
  if (!label || !title || !bodyFile) {
    console.log('[FAIL] alarm.mjs: usage: alarm.mjs <label> <title> <body-file>');
    process.exit(2);
  }
  try {
    readFileSync(bodyFile, 'utf8'); // fail loudly on an unreadable body rather than filing an empty alarm
  } catch (err) {
    console.log(`[FAIL] alarm.mjs: cannot read body file ${bodyFile}: ${err.message}`);
    process.exit(2);
  }
  const res = fileAlarm(label, title, bodyFile);
  if (!res.filed) {
    // The alarm itself failed. This is the irreducible residual — the issues API
    // is the only channel there is. Make it as loud as possible: the job fails
    // AND the reason is on stdout, so it is never a silent halt.
    console.log(`[FAIL] alarm.mjs: could NOT file the '${label}' alarm — ${res.reason}. `
      + 'The governance halt is UNREPORTED; a human must look at this job.');
    process.exit(2);
  }
  console.log(`${label} (${res.action})`);
}
