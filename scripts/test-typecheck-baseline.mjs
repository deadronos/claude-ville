/* global process */

/**
 * The RATCHET for the test typecheck gate.
 *
 * `tsconfig.json` excluded every `*.test.ts` file until #163, so `npm run typecheck` checked no
 * test file at all and the 124 suites accumulated a static-error backlog. Turning that
 * into a blocking gate in one step is the failure mode this repo already paid for once:
 * the lint and typecheck gates were both silently off until #135 re-enabled them, so
 * nothing enforced them for the life of the project. A red gate nobody can fix in one
 * commit is a gate everybody learns to ignore.
 *
 * So the backlog is a NUMBER, not a pass/fail. This script runs the full test typecheck,
 * counts the errors, and compares that count against a recorded baseline:
 *
 * - count ABOVE the baseline ⇒ FAIL. New debt is blocked; existing debt is not.
 * - count EQUAL to the baseline ⇒ PASS, and the run summary says the backlog is unchanged.
 * - count BELOW the baseline ⇒ PASS, and it says to LOWER the baseline file, so the number
 *   cannot drift upward without anyone noticing that it was fixed past the recorded figure.
 *
 * The baseline therefore has to move in both directions, which is what stops it rotting:
 * nobody can quietly make the count worse, and nobody can quietly bank a fix and leave the
 * recorded number stale. When the last error goes, delete the baseline file and the step
 * becomes a plain `npm run typecheck:tests`.
 *
 * Local use: `npm run typecheck:tests:baseline`. The raw, non-compared gate is
 * `npm run typecheck:tests` — that is the one to run while fixing.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'test-typecheck-baseline.txt');

function readBaseline() {
  try {
    const raw = readFileSync(baselinePath, 'utf8').trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== raw) {
      throw new Error(`not a plain non-negative integer: ${JSON.stringify(raw)}`);
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Per-file counts, largest first. This is the follow-up work list: `tsc` prints
 * file:line:col for each error, and the backlog is only actionable once grouped.
 */
function countByFile(output) {
  const byFile = new Map();
  for (const line of output.split('\n')) {
    const match = /^(\S+\.tsx?)\(\d+,\d+\): error TS\d+:/.exec(line);
    if (!match) continue;
    byFile.set(match[1], (byFile.get(match[1]) ?? 0) + 1);
  }
  return [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// Written through `process.stdout` / `process.stderr` rather than `console`, matching
// `scripts/dev.mjs`. The eslint config gives `**/*.js` the node globals but `.mjs` matches
// no `files:` block, so a `console` call here is a `no-undef` error.
function out(text) {
  process.stdout.write(`${text}\n`);
}

function err(text) {
  process.stderr.write(`${text}\n`);
}

let output = '';
try {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.test.json'], { cwd: repoRoot, encoding: 'utf8' });
} catch (error) {
  // tsc exits non-zero when it finds errors, which is the normal case here.
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
}

const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
const total = errors.length;
const baseline = readBaseline();

if (baseline === null) {
  out('No baseline recorded; reporting only.');
} else if (total > baseline) {
  err(`\nTest typecheck REGRESSED: ${total} errors, baseline is ${baseline}.\n`);
  for (const [file, count] of countByFile(output)) err(`  ${String(count).padStart(4)}  ${file}`);
  err(
    '\nFix the new errors rather than raising scripts/test-typecheck-baseline.txt. ' +
      'The baseline is the debt this repo already has, not a quota.\n',
  );
  process.exit(1);
} else if (total < baseline) {
  out(`Test typecheck IMPROVED: ${total} errors, baseline is ${baseline}.`);
  out(`Lower the number in scripts/test-typecheck-baseline.txt to ${total} so the fix cannot be forgotten.`);
} else {
  out(`Test typecheck unchanged at the recorded backlog of ${total} errors.`);
}

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const lines = [
    '### Test typecheck (advisory ratchet)',
    '',
    `\`npm run typecheck:tests\` → **${total}** errors${baseline === null ? '' : `, baseline **${baseline}**`}.`,
    '',
    'Test files were excluded from `tsconfig.json` until #163, so this backlog is inherited, not new. ' +
      'The step blocks only on GROWTH above the recorded baseline; it does not block on the debt itself.',
    '',
  ];
  if (total > 0) {
    lines.push('<details><summary>Per-file breakdown (the follow-up work list)</summary>', '', '```');
    for (const [file, count] of countByFile(output)) lines.push(`${String(count).padStart(4)}  ${file}`);
    lines.push('```', '', '</details>');
  }
  appendFileSync(summary, `${lines.join('\n')}\n`);
}
