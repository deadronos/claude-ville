import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { collectScanByMtime } from './scan-utils';

let tmpDir = '';

const HOUR_MS = 60 * 60 * 1000;

const sessionDir = () => path.join(tmpDir, 'session-state');
const eventsFile = (name: string) => path.join(sessionDir(), name, 'events.jsonl');

/** Create a session dir holding `events.jsonl`, the shape every JSONL-family adapter uses. */
function makeSession(name: string, contents = '{}\n') {
  fs.mkdirSync(path.join(sessionDir(), name), { recursive: true });
  fs.writeFileSync(eventsFile(name), contents);
  return eventsFile(name);
}

type ScanOptions = Parameters<typeof collectScanByMtime>[0];
type ScanRecord = { sessionId: string; filePath: string; mtime: number };

function scanOptions(overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    dir: sessionDir(),
    scope: 'test',
    operation: 'scanAllSessions',
    thresholdMs: HOUR_MS,
    fileFor: eventsFile,
    build: (candidate) => ({ sessionId: candidate.name, filePath: candidate.filePath, mtime: candidate.mtimeMs }),
    ...overrides,
  };
}

const idsOf = (records: ScanRecord[]) => records.map((r) => r.sessionId).sort();

describe('collectScanByMtime', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-scan-utils-'));
  });

  afterEach(() => {
    fs.rmSync(sessionDir(), { recursive: true, force: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns a record for every fresh file under thresholdMs', async () => {
    makeSession('aaa');
    makeSession('bbb');

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(idsOf(result)).toEqual(['aaa', 'bbb']);
    const bbb = result.find((r) => r.sessionId === 'bbb');
    expect(bbb?.filePath).toBe(eventsFile('bbb'));
    expect(bbb?.mtime).toBeGreaterThan(0);
  });

  it('drops files older than thresholdMs', async () => {
    const fresh = makeSession('fresh');
    const stale = makeSession('stale');
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS);
    fs.utimesSync(stale, twoHoursAgo, twoHoursAgo);

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(idsOf(result)).toEqual(['fresh']);
    expect(result[0].filePath).toBe(fresh);
  });

  it('skips children whose fileFor returns null', async () => {
    makeSession('wanted');
    makeSession('ignored');

    const result = await collectScanByMtime<ScanRecord>(scanOptions({
      fileFor: (name) => (name === 'wanted' ? eventsFile(name) : null),
    }));

    expect(idsOf(result)).toEqual(['wanted']);
  });

  it('returns [] when the base dir does not exist', async () => {
    const result = await collectScanByMtime<ScanRecord>(scanOptions({ dir: path.join(tmpDir, 'no-such-dir') }));

    expect(result).toEqual([]);
  });

  it('filters out records for which build returns null', async () => {
    makeSession('kept');
    makeSession('dropped');

    const result = await collectScanByMtime<ScanRecord>(scanOptions({
      build: (candidate) => (candidate.name === 'dropped' ? null : { sessionId: candidate.name, filePath: '', mtime: 0 }),
    }));

    expect(result).toEqual([{ sessionId: 'kept', filePath: '', mtime: 0 }]);
  });

  it('skips a child whose candidate file is missing', async () => {
    makeSession('present');
    fs.mkdirSync(path.join(sessionDir(), 'empty'), { recursive: true });

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(idsOf(result)).toEqual(['present']);
  });

  it('ignores plain files sitting in the scanned dir', async () => {
    fs.mkdirSync(sessionDir(), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(), 'stray.jsonl'), '{}\n');

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(result).toEqual([]);
  });
});