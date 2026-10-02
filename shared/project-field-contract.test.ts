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
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = ['claudeville', 'collector', 'hubreceiver', 'shared'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'widget', '.worktrees', '.git', 'coverage']);
const FORBIDDEN = /\bprojectPath\b/g;

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

function findViolations(): string[] {
  const violations: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of collectSourceFiles(path.join(REPO_ROOT, root))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(FORBIDDEN)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${path.relative(REPO_ROOT, file)}:${line}`);
      }
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
});
