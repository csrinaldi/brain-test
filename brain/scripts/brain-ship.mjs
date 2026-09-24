#!/usr/bin/env node
// brain-ship.mjs — Golden-path verb: verify checks then open the PR (REQ-S5-4).
//
// Usage: npm run brain:ship
//   1. Runs brain:check (all 4 governance checks + npm test + repo:check).
//   2. Exits non-zero if any check fails.
//   3. Reads the linked issue (issueViewFn) and finds its type:* label
//      (issue #334 — the label is no longer hardcoded to 'kind:feature',
//      a label that never existed on this repo's remote).
//   4. Confirms that label exists on the remote (labelPreflightFn) BEFORE
//      any write — the two providers disagree on an unknown label (GitHub
//      hard-errors, GitLab silently creates it), so this is caught here,
//      uniformly, first (design A2).
//   5. Creates a PR via the configured VCS provider's mrCreate() verb:
//        • Title = conventional-commit prefix (from the SAME label, via
//          deriveBranchType) + the branch's slug
//        • Body = PR template + `Closes #<issue>` footer
//        • Labels = the issue's type:* label, VERBATIM — never re-mapped
//   6. Prints the PR URL on success.
//
// Ordering (design A4, issue #334): checkFn → issueViewFn → findTypeLabel →
// labelPreflightFn → mrCreateFn — preserves REQ-S5-4's gate semantics and
// the stronger invariant that a red tree makes ZERO remote calls.
//
// The script performs NO action on import — side effects are guarded at the bottom.

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveBranchType, findTypeLabel } from './lib/branch-type.mjs';
import { labelPreflight } from './vcs/label-preflight.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── helpers ───────────────────────────────────────────────────────────────────

function git(args, cwd = process.cwd()) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', cwd, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function readTemplate(repoRoot) {
  const tmpl = resolve(repoRoot, '.github/PULL_REQUEST_TEMPLATE.md');
  if (existsSync(tmpl)) return readFileSync(tmpl, 'utf8');
  return '<!-- PR template not found -->';
}

function buildPRBody(template, issueNumber) {
  return `${template.trim()}\n\nCloses #${issueNumber}\n`;
}

function titleFromBranch(branch, type) {
  // e.g. feature/42-add-cli-i18n + 'feat' → "feat: add cli i18n" — conventional
  // commit format (.github/PULL_REQUEST_TEMPLATE.md:73 requires it; the
  // `type` prefix is derived from the issue's type:* label via
  // deriveBranchType, independently of the label sent to mrCreateFn).
  const slug = branch
    .replace(/^.*\/\d+-/, '')   // strip prefix up to and including <number>-
    .replace(/-/g, ' ')
    .trim() || branch;
  return `${type}: ${slug}`;
}

/**
 * Resolves the issue number encoded in the branch name
 * (`<prefix>/<number>-<slug>`, the shape `brain:start` creates).
 *
 * FAILS CLOSED rather than falling back to a placeholder: a silent `'0'`
 * fallback produced a PR whose body said `Closes #0` and whose issue lookup
 * queried a non-existent issue — a fabricated answer to an uncomputable
 * question. An unparseable branch is a real, actionable operator error, so it
 * is reported as one.
 *
 * @param {string} branch
 * @returns {{ issueNumber: string } | { exitCode: 1, message: string }}
 */
export function resolveIssueNumber(branch) {
  const issueMatch = String(branch ?? '').match(/\/(\d+)-/);
  if (!issueMatch) {
    return {
      exitCode: 1,
      message:
        `brain:ship: cannot determine issue number from branch "${branch}" — ` +
        `expected <prefix>/<number>-<slug> (e.g. feature/42-add-cli-i18n). ` +
        `Run "npm run brain:start" to create a correctly-named branch.`,
    };
  }
  return { issueNumber: issueMatch[1] };
}

// ── core logic (injectable for tests) ────────────────────────────────────────

/**
 * Run the brain:ship flow.
 *
 * Ordering (design A4): checkFn → issueViewFn → findTypeLabel →
 * labelPreflightFn → mrCreateFn. A red checkFn makes ZERO remote calls.
 *
 * @param {object} ctx
 * @param {string}   ctx.issueNumber      Issue number (string).
 * @param {string}   ctx.project          VCS project slug.
 * @param {string}   ctx.provider         VCS provider name (passed to labelPreflightFn's default dispatch).
 * @param {string}   ctx.branchName       Current git branch.
 * @param {string}   ctx.base             Target base branch (default: 'main').
 * @param {Function} ctx.checkFn          Async fn() → {ok, output?}. Injected for tests.
 * @param {Function} ctx.issueViewFn      Async fn({project,number}) → {number,title,labels,body,author}.
 *   REJECTS on an unreachable issue (design A5) — matches the real providers, do not stub with `null`.
 * @param {Function} ctx.labelPreflightFn Async fn({provider,project,label}) → {exists,error?}. Never throws.
 * @param {Function} ctx.mrCreateFn       Async fn({title,body,head,base,labels}) → {url,error?}.
 * @returns {Promise<{exitCode:number, message:string, url?:string}>}
 */
export async function runShip({
  issueNumber,
  project,
  provider,
  branchName,
  base = 'main',
  checkFn,
  issueViewFn,
  labelPreflightFn,
  mrCreateFn,
  template = '',
}) {
  // Step 1: run all checks — a red tree makes ZERO remote calls (design A4).
  const checkResult = await checkFn();
  if (!checkResult.ok) {
    return {
      exitCode: 1,
      message:
        `brain:ship: checks failed — fix them before shipping.\n` +
        `  Run "npm run brain:check" for details.\n` +
        (checkResult.output ? `  Output: ${checkResult.output}` : ''),
    };
  }

  // Step 2: read the linked issue — the single source of truth for the PR label.
  let issue;
  try {
    issue = await issueViewFn({ project, number: Number(issueNumber) });
  } catch (e) {
    return {
      exitCode: 1,
      message: `brain:ship: issue #${issueNumber} not found or not accessible — ${e.message}`,
    };
  }

  // Step 3: find the issue's type:* label — fail closed if none exists.
  const labels = issue.labels ?? [];
  const typeLabel = findTypeLabel(labels);
  if (!typeLabel) {
    return {
      exitCode: 1,
      message:
        `brain:ship: no type:* label found on issue #${issueNumber}.\n` +
        `  Labels found: [${labels.join(', ')}]\n` +
        `  Add a type:* label before shipping.`,
    };
  }

  // Step 4: confirm the label exists on the remote BEFORE any write (design
  // A2 — GitHub hard-errors on an unknown label, GitLab silently creates it).
  const preflight = await labelPreflightFn({ provider, project, label: typeLabel });
  if (!preflight.exists) {
    return {
      exitCode: 1,
      message:
        `brain:ship: label "${typeLabel}" not found in the remote label set — ` +
        `add it on the remote, or correct issue #${issueNumber}'s type:* label` +
        (preflight.error ? ` — ${preflight.error}` : ''),
    };
  }

  // Step 5: build PR body + title. The label travels VERBATIM to mrCreateFn;
  // deriveBranchType maps the SAME label to the title's conventional-commit
  // prefix only — the two derivations are independent.
  const body = buildPRBody(template, issueNumber);
  const title = titleFromBranch(branchName, deriveBranchType([typeLabel]));

  // Step 6: create PR
  const mrResult = await mrCreateFn({
    title,
    body,
    head: branchName,
    base,
    labels: [typeLabel],
  });

  if (!mrResult.url) {
    return {
      exitCode: 1,
      message: `brain:ship: PR creation failed — ${mrResult.error ?? 'unknown error'}`,
    };
  }

  return {
    exitCode: 0,
    url: mrResult.url,
    message: `brain:ship: PR opened → ${mrResult.url}`,
  };
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = process.cwd();
  const repoRoot = resolve(__dirname, '..', '..');

  // Read config
  let config;
  try {
    config = JSON.parse(readFileSync(resolve(repoRoot, 'brain.config.json'), 'utf8'));
  } catch (e) {
    console.error(`brain:ship: cannot read brain.config.json — ${e.message}`);
    process.exit(1);
  }

  const provider = config?.vcs?.provider;
  const project = config?.project?.slug;
  if (!provider || !project) {
    console.error('brain:ship: vcs.provider and project.slug must be set in brain.config.json');
    process.exit(1);
  }

  let providerModule;
  try {
    providerModule = await import(`./vcs/providers/${provider}.mjs`);
  } catch (e) {
    console.error(`brain:ship: cannot load provider "${provider}" — ${e.message}`);
    process.exit(1);
  }

  const branch = git('rev-parse --abbrev-ref HEAD', cwd);
  if (!branch || branch === 'HEAD') {
    console.error('brain:ship: not on a named branch — run brain:start first');
    process.exit(1);
  }

  // Extract issue number from branch name (feature/<number>-<slug>) — fails
  // closed on an unparseable branch rather than fabricating a placeholder.
  const resolved = resolveIssueNumber(branch);
  if (resolved.exitCode) {
    console.error(resolved.message);
    process.exit(resolved.exitCode);
  }
  const { issueNumber } = resolved;

  const template = readTemplate(repoRoot);

  const result = await runShip({
    issueNumber,
    project,
    provider,
    branchName: branch,
    base: config?.project?.defaultBranch ?? 'main',
    template,
    checkFn: async () => {
      const r = spawnSync('npm', ['run', 'brain:check'], { encoding: 'utf8', cwd, stdio: 'inherit' });
      return { ok: r.status === 0 };
    },
    issueViewFn: (args) => providerModule.issueView(args),
    labelPreflightFn: (args) => labelPreflight(args),
    mrCreateFn: (args) => providerModule.mrCreate({ project, ...args }),
  });

  if (result.exitCode === 0) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }
  process.exit(result.exitCode);
}
