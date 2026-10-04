/**
 * Read-only SQLite helpers for adapters whose upstream tool has moved to a
 * SQLite-backed session store (OpenClaw, Hermes).
 *
 * We open provider-owned databases with `readonly: true` so a live agent can
 * keep writing (including WAL checkpoints) while we inspect it. Never use
 * `immutable: true` here — the databases are actively changing.
 */
import fs from 'fs';
import { zstdDecompressSync } from 'node:zlib';

import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { debugAdapterError } from './jsonl-utils.js';

export type SqliteDb = BetterSqliteDatabase;
export type SqliteParam = string | number | bigint | Buffer | null;

export function isSqliteFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function openReadonlySqlite(filePath: string, scope: string): SqliteDb | null {
  if (!isSqliteFile(filePath)) return null;
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true, timeout: 2500 });
    try {
      db.pragma('busy_timeout = 2500');
    } catch {
      // pragma unsupported on some builds; non-fatal
    }
    return db;
  } catch (err) {
    debugAdapterError(scope, 'openReadonlySqlite', err, filePath);
    return null;
  }
}

/**
 * Close a handle opened by {@link openReadonlySqlite}, never throwing. Its own
 * `finally`, so a caller that has to classify what went wrong INSIDE the
 * callback — and therefore cannot use {@link withReadonlySqlite}, which folds a
 * throw into the same `null` as a failed open — still gets the close.
 */
export function closeSqlite(db: SqliteDb): void {
  try {
    db.close();
  } catch {
    // already closed
  }
}

/**
 * Open a read-only handle, run `fn`, and always close. Returns null when the
 * database cannot be opened or the query throws.
 */
export function withReadonlySqlite<T>(filePath: string, scope: string, fn: (db: SqliteDb) => T): T | null {
  const db = openReadonlySqlite(filePath, scope);
  if (!db) return null;
  try {
    return fn(db);
  } catch (err) {
    debugAdapterError(scope, 'query', err, filePath);
    return null;
  } finally {
    closeSqlite(db);
  }
}

export function queryAll<T = Record<string, unknown>>(
  db: SqliteDb,
  sql: string,
  params: SqliteParam[] = [],
): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch (err) {
    debugAdapterError('sqlite', 'queryAll', err, sql.substring(0, 140));
    return [];
  }
}

/**
 * {@link hasTable} with the third state KEPT: `false` when the table is absent,
 * `null` when the database could not answer the question at all.
 *
 * `hasTable` folds those two together, and `false` therefore means both "this
 * store has no such table" and "this file is not a database" — so a `state.db`
 * of plain text and a `state.db` from a different tool are indistinguishable, and
 * both read as "this provider has no sessions". An adapter that has to report
 * which of the two happened needs them apart. `hasTable` is the coercing wrapper
 * over this, so there is one probe and not two.
 */
export function hasTableOrNull(db: SqliteDb, name: string): boolean | null {
  try {
    const row = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1")
      .get(name);
    return Boolean(row);
  } catch (err) {
    debugAdapterError('sqlite', 'hasTableOrNull', err, name);
    return null;
  }
}

/** True when a table/view exists in the attached database. */
export function hasTable(db: SqliteDb, name: string): boolean {
  return hasTableOrNull(db, name) === true;
}

/**
 * Sibling of {@link isSqliteFile}, for the call sites that must not act on a
 * path they cannot actually read.
 *
 * `isSqliteFile` only asks `statSync().isFile()`, so a regular file that is not a
 * database — an unrelated `.sqlite` file, a truncated download, an empty file —
 * passes it and then fails to read. `openReadonlySqlite` answers `null` for
 * those once a query runs, and `hermes.ts` / `opencode.ts` depend on that
 * `null`; a caller that wants to know "can this be read?" before it advertises
 * or suppresses anything needs the answer directly. Opens a read-only handle,
 * reads one row to force the header check and closes, so it never leaves a
 * descriptor behind and never throws.
 */
export function isOpenableSqliteDatabase(filePath: string | null | undefined, scope: string): boolean {
  if (!filePath || !isSqliteFile(filePath)) return false;
  return (
    withReadonlySqlite(filePath, scope, (db) => {
      // better-sqlite3 opens LAZILY: a file of garbage yields a usable handle and
      // the `file is not a database` error only surfaces on the first read, so
      // "the open succeeded" is not the answer. A throw here becomes
      // `withReadonlySqlite`'s `null`, which is the whole point of the check.
      db.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
      return true;
    }) === true
  );
}

/**
 * The columns `table` actually has, so a query can project only those and a
 * drifted schema costs one field instead of the whole result set.
 *
 * A sibling rather than a change to `queryAll`/`hasTable`, both of which are
 * shared with `hermes` and `opencode`: `queryAll`'s swallow is load-bearing at
 * the NESTED call sites, where a throw would abort the enclosing `.map()` and
 * lose every sibling row. Reading a column list is a separate question from
 * "should this query throw", and answering it here keeps that swallow intact.
 * Returns an empty set for a missing table, which callers treat as "unusable".
 */
export function tableColumns(db: SqliteDb, table: string): Set<string> {
  const rows = queryAll<{ name: string }>(db, 'SELECT name FROM pragma_table_info(?)', [table]);
  return new Set(rows.map((row) => row.name));
}

export function decodeZstdText(value: Buffer | Uint8Array | null | undefined): string | null {
  if (!value) return null;
  try {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return zstdDecompressSync(buf).toString('utf8');
  } catch (err) {
    debugAdapterError('sqlite', 'decodeZstdText', err);
    return null;
  }
}

/** Best-effort JSON parse that never throws. */
export function safeJsonParse<T = unknown>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
