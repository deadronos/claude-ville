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
 *
 * The adapter list is derived from claudeville/adapters/index.ts — its import
 * bindings and its `adapters` array literal — rather than hand-maintained, so a
 * tenth adapter added to the registry is checked without editing this file.
 * index.ts is parsed as text; it is never imported, because it pulls in sqlite
 * and child_process.
 *
 * PR B plans to extract a shared `buildSessionSummary(fields)` builder and move
 * each adapter's session literal into it. When that lands, this positive check
 * must be extended to the builder: the adapter files will no longer contain the
 * literal it inspects, and it would otherwise fail (or be weakened) rather than
 * track the field.
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
 * Derives the session records' key fingerprint. `sessionId` + `provider` alone
 * was too broad: a reviewer showed that an unrelated literal
 * `{ sessionId, provider, event: 'x' }` added to an adapter tripped the positive
 * check with a misleading "missing `project`" message. `lastActivity` is added
 * because all 14 real session records across the nine adapters carry it
 * (measured, not guessed). `sessionId` alone is far broader still: it also
 * selects `getSessionDetail()` return literals, which legitimately carry no
 * project.
 *
 * Two consequences of this fingerprint, both accepted deliberately:
 * - It is not globally unique. `e2e/live-session.e2e.ts` has unrelated literals
 *   carrying all three keys. They cannot trip the check because it only reads
 *   adapter files, but do not treat this as a tree-wide record detector.
 * - It can under-count. A record that omits `lastActivity` is skipped, not
 *   flagged, so a multi-record adapter could diverge on one branch and still
 *   pass. A whole adapter yielding zero fingerprinted records does fail loudly,
 *   which is the case that matters most.
 */
const SESSION_RECORD_KEYS = ['sessionId', 'provider', 'lastActivity'] as const;

type SessionRecord = { line: number; keys: Set<string> };

/**
 * Parses claudeville/adapters/index.ts and resolves the `adapters` array's
 * `new X()` entries to the files their imports name. The specifiers are
 * `.js`-suffixed (`./claude.js`), the NodeNext convention for what is on disk as
 * `.ts`, so the suffix is mapped back. Reading the registry through the AST
 * rather than importing it keeps sqlite and child_process out of the test.
 */
function adapterFiles(): string[] {
  const registry = path.join(REPO_ROOT, 'claudeville', 'adapters', 'index.ts');
  const parsed = ts.createSourceFile(
    registry,
    fs.readFileSync(registry, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = new Map<string, string>();
  // Collected in an array rather than assigned to a `let ... | null` from inside
  // `visit`: TypeScript collapses a nullable `let` that a nested closure writes
  // to down to `never` at every use site outside that closure, which made
  // `entries.elements` unreadable. Reading the accumulator afterwards is a
  // plain `const` narrowing instead. `index.ts` declares exactly one
  // `adapters` array, and taking the last match preserves the original
  // last-one-wins behaviour regardless.
  const found: ts.ArrayLiteralExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, node.moduleSpecifier.text);
        }
      }
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.name.text === 'adapters'
          && declaration.initializer
          && ts.isArrayLiteralExpression(declaration.initializer)
        ) {
          found.push(declaration.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);

  const entries = found[found.length - 1];
  if (!entries) {
    throw new Error('claudeville/adapters/index.ts has no `adapters` array literal to derive the adapter list from.');
  }

  const files: string[] = [];
  for (const entry of entries.elements) {
    const expression = ts.isNewExpression(entry) ? entry.expression : entry;
    if (!ts.isIdentifier(expression)) {
      throw new Error(`Unsupported entry in index.ts's \`adapters\` array: ${entry.getText(parsed)}`);
    }
    const specifier = imports.get(expression.text);
    if (!specifier) {
      throw new Error(`index.ts's \`adapters\` array references ${expression.text}, which has no import binding.`);
    }
    if (!specifier.startsWith('./')) {
      throw new Error(`index.ts's adapter ${expression.text} does not resolve to a sibling module: ${specifier}`);
    }
    files.push(path.resolve(path.dirname(registry), specifier).replace(/\.js$/, '.ts'));
  }
  return files;
}

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
    const files = adapterFiles();
    if (files.length === 0) {
      missing.push('claudeville/adapters/index.ts (no adapters derived from the registry)');
    }
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      if (!fs.existsSync(file)) {
        missing.push(`${rel} (referenced by the registry but not found on disk)`);
        continue;
      }
      const records = sessionRecords(file);
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
