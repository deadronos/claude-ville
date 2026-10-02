/**
 * Guards the project-field contract: a session's project is spelled `project`
 * on the wire, in shared/types.ts, and on the domain Agent.
 *
 * The other spelling, `projectPath`, used to be declared on `Session` while
 * every producer wrote `project`. `AgentSessionSummary` inherited the dead
 * field and declared the live one on top of it. Nothing caught that, because
 * the collector's `SessionSummary` carries `[key: string]: unknown` and
 * hubreceiver/state.ts casts snapshots to `AnyRecord` — a half-finished rename
 * typechecks clean and breaks at runtime. That gap is why readProject() had to
 * learn to accept two spellings in #111.
 *
 * The pattern is word-bounded on purpose. Substring matching would also reject
 * claude.ts's `projectPathMap`, which really does map encoded dir names to
 * project paths, and the presentation helper `truncateProjectPath`. widget/Sources/main.swift
 * is Swift and its `projectPath` is the repo root, unrelated to this field.
 *
 * Banning one spelling is only half a contract, so a second test asserts the
 * positive half: every production adapter must actually build a session record
 * that carries `project`. Without it, renaming pi.ts's emitted key to a third
 * spelling satisfies both the ban and the wire tests, which supply their own
 * fixtures. That positive half is checked against the TypeScript AST rather than
 * the text, because the text is full of `project` that is not the field: in
 * pi.ts, lines 32, 234 and 333 are type positions (`project: string | null`)
 * that survive an edit of the emitted key on line 321 untouched.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = ['claudeville', 'collector', 'e2e', 'hubreceiver', 'shared'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'widget', '.worktrees', '.git', 'coverage']);
const FORBIDDEN = /\bprojectPath\b/g;

/**
 * The provider adapters that ship in the default suite, one file each. Kept as
 * an explicit list rather than read off adapters/index.ts: importing the registry
 * would pull the whole adapter graph (and its sqlite/child_process imports) into
 * a test that only needs to read nine files as text.
 */
const PRODUCTION_ADAPTERS = [
  'claude',
  'codex',
  'copilot',
  'gemini',
  'hermes',
  'openclaw',
  'opencode',
  'pi',
  'vscode',
] as const;

/**
 * A session record is the object literal an adapter returns from
 * getActiveSessions(). Anchoring on two keys that only such a record carries —
 * `sessionId` identifies the record, `provider` comes from Session and is absent
 * from AdapterSessionDetail — separates the 14 session records across the nine
 * adapters from the detail records that also carry a `sessionId`. The check
 * ignores formatting entirely: it is indifferent to indentation, trailing commas,
 * and whether the value is written `project: x` or shorthand `project`.
 */
const SESSION_RECORD_KEYS = ['sessionId', 'provider'] as const;

type SessionRecord = { line: number; keys: Set<string> };

function sessionRecords(file: string): SessionRecord[] {
  const source = fs.readFileSync(file, 'utf-8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const records: SessionRecord[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) continue;
        const name = prop.name;
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) keys.add(name.text);
      }
      if (SESSION_RECORD_KEYS.every((key) => keys.has(key))) {
        records.push({
          line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
          keys,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return records;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // claudeville/shared is a tracked symlink to ../shared, which vitest also
    // collects twice. These Dirent use lstat semantics, so a symlinked dir
    // reports isDirectory() === false and is never descended into anyway;
    // skipping it keeps that explicit rather than an accident of lstat, and
    // loses no real file because shared/ is its own SOURCE_ROOT.
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|browser\.test)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Repo-root .ts files — runtime-config.shared.ts, load-local-env.ts, the vite
 * and vitest configs — are production source but are not inside any SOURCE_ROOT,
 * so the recursive walk above cannot reach them. Collected non-recursively:
 * only files sitting directly in the repo root, same extension and same
 * test-file exclusion. Recursing from the repo root instead would sweep in
 * node_modules and every other top-level directory.
 */
function collectRepoRootFiles(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink() && entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => !/\.(test|browser\.test)\.tsx?$/.test(name))
    .map((name) => path.join(REPO_ROOT, name));
}

function scannedFiles(): string[] {
  const files = collectRepoRootFiles();
  for (const root of SOURCE_ROOTS) {
    files.push(...collectSourceFiles(path.join(REPO_ROOT, root)));
  }
  return files.sort();
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of scannedFiles()) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const match of source.matchAll(FORBIDDEN)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${path.relative(REPO_ROOT, file)}:${line}`);
    }
  }
  return violations.sort();
}

describe('project field contract', () => {
  it('spells the session project `project` in every production source file', () => {
    const violations = findViolations();
    expect(
      violations,
      `Found the retired \`projectPath\` spelling. Rename it to \`project\`:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('emits the session project as `project` from every production adapter', () => {
    // A session record that lost its `project` key still typechecks whenever
    // the value is produced through a variable, and the wire tests pass because
    // they supply their own fixtures. Renaming the key is therefore invisible
    // to the ban above unless something asserts the key is actually present.
    const missing: string[] = [];
    for (const adapter of PRODUCTION_ADAPTERS) {
      const rel = path.join('claudeville', 'adapters', `${adapter}.ts`);
      const records = sessionRecords(path.join(REPO_ROOT, rel));
      const withProject = records.filter((record) => record.keys.has('project'));
      // No record at all is a failure too: it means the adapter stopped emitting
      // sessions in a shape this guard can see, which would otherwise pass
      // vacuously.
      if (withProject.length === 0) {
        const seen = records.length === 0 ? 'no session record found' : `${records.length} session record(s) found`;
        missing.push(`${rel} (${seen}, none carries \`project\`)`);
        continue;
      }
      missing.push(
        ...records
          .filter((record) => !record.keys.has('project'))
          .map((record) => `${rel}:${record.line} (session record is missing \`project\`)`),
      );
    }
    expect(
      missing,
      `Adapters must emit the session project under the name \`project\`:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
