// brain/scripts/memory/lib/auto-resume.mjs — isolation-wrapped feature-resume helper.
//
// Provides tryFeatureResume(root, opts) for use by ticket-start.mjs on the
// re-checkout path (branch already exists / resuming, including worktree-attach).
//
// Design contract (REQ-S3-1):
//   - FULLY ISOLATED: any failure (ambiguous feature, non-zero exit, thrown error,
//     engram absent) is caught and produces a null return. NEVER throws.
//   - On exit 0: returns the stdout string (the verb already prints the resume point).
//   - On any failure: returns null so the calling code can show a single-line warning.
//
// Injectable seam:
//   opts._runner(root) — receives the repo root, returns { status, stdout, stderr }.
//   Used in unit tests to avoid real subprocess spawns.
//   Default: spawnSync(process.execPath, ['brain/scripts/memory/cli.mjs', 'feature-resume'],
//             { cwd: root, encoding: 'utf8' })

import { spawnSync } from 'node:child_process';

/**
 * Default subprocess runner — spawns `node brain/scripts/memory/cli.mjs feature-resume`
 * with {cwd: root, encoding: 'utf8'}.
 *
 * @param {string} root  Repo root to use as cwd.
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
function defaultRunner(root) {
  return spawnSync(
    process.execPath,
    ['brain/scripts/memory/cli.mjs', 'feature-resume'],
    { cwd: root, encoding: 'utf8' },
  );
}

/**
 * Try to run `feature-resume` and return the output, or null on any failure.
 *
 * This function is FULLY ISOLATED — it never throws regardless of:
 *   - Ambiguous feature (multiple openspec/changes/* dirs) → cli exits non-zero → null.
 *   - Missing engram or non-zero exit for any reason → null.
 *   - Runner itself throws (node not found, permission error, etc.) → null.
 *   - A resume.md with no resume point → cli exits 0 with informational message → returns it.
 *
 * Callers may safely log a warning on null and continue with the surrounding
 * checkout / env-copy / VCS-auth flow without any change to that flow's outcome.
 *
 * @param {string} root            Repo root (or worktree root) to run the verb in.
 * @param {object} [opts]          Injectable seams for testing.
 * @param {(root: string) => { status: number|null, stdout: string, stderr: string }}
 *        [opts._runner]           Subprocess runner; defaults to spawnSync wrapper above.
 * @returns {string|null}          stdout on exit 0; null on any failure.
 */
export function tryFeatureResume(root, { _runner } = {}) {
  try {
    const run = _runner ?? defaultRunner;
    const result = run(root);
    if (result.status === 0) {
      return result.stdout ?? '';
    }
    return null;
  } catch {
    // Runner threw (binary not found, permission error, etc.) — isolate.
    return null;
  }
}
