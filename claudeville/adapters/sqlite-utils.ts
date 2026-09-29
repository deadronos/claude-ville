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
    try {
      db.close();
    } catch {
      // already closed
    }
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

/** True when a table/view exists in the attached database. */
export function hasTable(db: SqliteDb, name: string): boolean {
  try {
    const row = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1")
      .get(name);
    return Boolean(row);
  } catch (err) {
    debugAdapterError('sqlite', 'hasTable', err, name);
    return false;
  }
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
