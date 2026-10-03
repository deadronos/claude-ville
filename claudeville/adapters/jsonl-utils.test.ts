import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readLines, parseJsonLines, readJsonlEntries, collectJsonl, foldEntries, foldJsonl } from './jsonl-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Run `fn` with DEBUG on, collecting what debugAdapterError wrote to console.debug.
 * Restores both DEBUG and the console spy in `finally`, so a failing assertion
 * cannot leak DEBUG=1 into a later test.
 */
async function withDebug<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = process.env.DEBUG;
  const spy = vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  process.env.DEBUG = '1';
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    spy.mockRestore();
    if (original === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = original;
  }
}

describe('jsonl-utils', () => {
  describe('parseJsonLines', () => {
    it('parses valid JSON lines', () => {
      const input = [
        '{"name": "test1"}',
        '{"value": 42}'
      ];
      const result = parseJsonLines(input);
      expect(result).toEqual([{ name: 'test1' }, { value: 42 }]);
    });

    it('skips empty and whitespace-only lines', () => {
      const input = [
        '',
        '   ',
        '\t',
        '{"valid": true}'
      ];
      const result = parseJsonLines(input);
      expect(result).toEqual([{ valid: true }]);
    });

    it('skips invalid JSON lines', () => {
      const input = [
        '{"valid": true}',
        'not valid json',
        '{ bad format }',
        '{"another": "valid"}'
      ];
      const result = parseJsonLines(input);
      expect(result).toEqual([{ valid: true }, { another: 'valid' }]);
    });

    it('returns empty array for empty input', () => {
      expect(parseJsonLines([])).toEqual([]);
    });
  });

  describe('readLines', () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-utils-test-'));
      filePath = path.join(tmpDir, 'test.txt');
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns empty array if file does not exist', async () => {
      const result = await readLines(filePath);
      expect(result).toEqual([]);
    });

    it('reads lines from the end by default', async () => {
      fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5');
      const result = await readLines(filePath, { count: 2 });
      expect(result).toEqual(['line4', 'line5']);
    });

    it('reads lines from the start when specified', async () => {
      fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5');
      const result = await readLines(filePath, { from: 'start', count: 2 });
      expect(result).toEqual(['line1', 'line2']);
    });

    it('returns all lines if count exceeds total lines', async () => {
      fs.writeFileSync(filePath, 'line1\nline2');
      const result = await readLines(filePath, { count: 50 });
      expect(result).toEqual(['line1', 'line2']);
    });

    it('trims file content and handles empty lines properly', async () => {
      fs.writeFileSync(filePath, '\nline1\n\nline2\n\n');
      const result = await readLines(filePath, { from: 'start', count: 5 });
      // The implementation uses content.trim().split('\n')
      // '\nline1\n\nline2\n\n'.trim() is 'line1\n\nline2'
      // which splits into ['line1', '', 'line2']
      expect(result).toEqual(['line1', '', 'line2']);
    });

    it('handles default options', async () => {
      const lines = Array.from({ length: 60 }, (_, i) => `line${i + 1}`);
      fs.writeFileSync(filePath, lines.join('\n'));

      const result = await readLines(filePath);
      expect(result.length).toBe(50);
      expect(result[result.length - 1]).toBe('line60');
    });

    it('returns empty array if reading fails', async () => {
      // Create a directory instead of a file so readFile fails
      const dirPath = path.join(tmpDir, 'testdir');
      fs.mkdirSync(dirPath);

      const result = await readLines(dirPath);
      expect(result).toEqual([]);
    });
  });

  describe('readJsonlEntries / collectJsonl', () => {
    let tmpDir: string;

    const write = (name: string, content: string) => {
      const filePath = path.join(tmpDir, name);
      fs.writeFileSync(filePath, content);
      return filePath;
    };

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-jsonl-utils-'));
    });

    afterAll(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe('readJsonlEntries', () => {
      it('returns parsed objects and skips a malformed line', async () => {
        const filePath = write('mixed.jsonl', '{"id":1}\nnot valid json\n{"id":2}\n');

        const result = await readJsonlEntries(filePath);

        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it('returns only the first entry with from: start and count: 1', async () => {
        const filePath = write('first-only.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n');

        const result = await readJsonlEntries(filePath, { from: 'start', count: 1 });

        expect(result).toEqual([{ id: 1 }]);
      });
    });

    describe('collectJsonl', () => {
      it('forwards from and count to the reader', async () => {
        // Hardcoding { from: 'end', count: 50 } inside collectJsonl would make
        // every other case here still pass, so this pins the extra hop through
        // readJsonlEntries — the parameter adapters care most about (copilot
        // reads 100 lines for tool history but 60 for messages).
        const filePath = write('forwarded.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n');
        const options = {
          scope: 'test',
          operation: 'forwarded',
          onEntry: (entry: any, out: { id: number }[]) => out.push({ id: entry.id }),
        };

        const firstOnly = await collectJsonl<{ id: number }>(filePath, { ...options, from: 'start', count: 1 });
        const everything = await collectJsonl<{ id: number }>(filePath, options);

        expect(firstOnly).toEqual([{ id: 1 }]);
        expect(everything).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      });

      it('logs scope and operation when folding throws', async () => {
        const filePath = write('logged.jsonl', '{"id":1}\n');

        const { lines } = await withDebug(() => collectJsonl(filePath, {
          scope: 'my-adapter',
          operation: 'getToolHistory',
          onEntry: () => { throw new Error('boom'); },
        }));

        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('my-adapter');
        expect(lines[0]).toContain('getToolHistory');
        expect(lines[0]).toContain('boom');
      });

      it('folds entries and returns them in order', async () => {
        const filePath = write('fold.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n');

        const result = await collectJsonl<{ id: number }>(filePath, {
          scope: 'test',
          operation: 'fold',
          count: 10,
          onEntry: (entry, out) => out.push({ id: entry.id }),
        });

        expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      });

      it('keeps only the last N entries when maxItems is set', async () => {
        const filePath = write('capped.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n{"id":4}\n');

        const result = await collectJsonl<{ id: number }>(filePath, {
          scope: 'test',
          operation: 'capped',
          count: 10,
          maxItems: 2,
          onEntry: (entry, out) => out.push({ id: entry.id }),
        });

        expect(result).toEqual([{ id: 3 }, { id: 4 }]);
      });

      it('returns every entry when maxItems is omitted', async () => {
        const filePath = write('uncapped.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n');

        const result = await collectJsonl<{ id: number }>(filePath, {
          scope: 'test',
          operation: 'uncapped',
          count: 10,
          onEntry: (entry, out) => out.push({ id: entry.id }),
        });

        expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      });

      it('returns [] when maxItems is 0, even with entries to fold', async () => {
        const filePath = write('zero.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n');

        const result = await collectJsonl<{ id: number }>(filePath, {
          scope: 'test',
          operation: 'zero',
          count: 10,
          maxItems: 0,
          onEntry: (entry, out) => out.push({ id: entry.id }),
        });

        expect(result).toEqual([]);
      });

      it('returns [] when maxItems is negative', async () => {
        // Five entries and maxItems -2: the old `out.slice(-maxItems)` behaviour
        // would have computed slice(2) and returned three of them.
        const filePath = write('negative.jsonl', '{"id":1}\n{"id":2}\n{"id":3}\n{"id":4}\n{"id":5}\n');

        const result = await collectJsonl<{ id: number }>(filePath, {
          scope: 'test',
          operation: 'negative',
          count: 10,
          maxItems: -2,
          onEntry: (entry, out) => out.push({ id: entry.id }),
        });

        expect(result).toEqual([]);
      });

      it('returns [] for a nonexistent file without throwing', async () => {
        const result = await collectJsonl<{ id: number }>(path.join(tmpDir, 'nope.jsonl'), {
          scope: 'test',
          operation: 'missing',
          onEntry: (entry, out) => out.push({ id: entry.id }),
        });

        expect(result).toEqual([]);
      });

      it('keeps entries folded before an onEntry throw', async () => {
        const filePath = write('throwing.jsonl', '{"id":1}\n{"id":2}\n');

        const result = await collectJsonl<{ id: number }>(filePath, {
          scope: 'test',
          operation: 'throwing',
          count: 10,
          onEntry: (entry, out) => {
            if (entry.id === 2) throw new Error('boom');
            out.push({ id: entry.id });
          },
        });

        expect(result).toEqual([{ id: 1 }]);
      });
    });
  });

  describe('foldEntries', () => {
    type Sum = { total: number; visited: number[] };

    it('returns init untouched for an empty array', () => {
      const init = { total: 0, visited: [] as number[] };
      const onEntry = vi.fn();

      const result = foldEntries<Sum>([], { init, onEntry });

      expect(result).toBe(init);
      expect(result).toEqual({ total: 0, visited: [] });
      expect(onEntry).not.toHaveBeenCalled();
    });

    it('accumulates across every entry, in order', () => {
      const result = foldEntries<Sum>([{ n: 1 }, { n: 2 }, { n: 3 }], {
        init: { total: 0, visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
          acc.total += entry.n;
        },
      });

      expect(result.visited).toEqual([1, 2, 3]);
      expect(result.total).toBe(6);
    });

    it('consults until AFTER onEntry, so the stopping entry is still folded in', () => {
      // This is the ordering codex depends on: `until` decides on the
      // accumulator that `onEntry` has just updated, so the entry that trips
      // `until` is necessarily also an entry `onEntry` must have seen.
      //
      // The threshold is `> 5` so that entry 3 is the one that trips it (running
      // total 1, 3, 6). `byOnEntry` is the assertion with real teeth: swapping
      // the two statements in foldEntries to `if (until?.(acc, entry)) break;`
      // before `onEntry(acc, entry)` checks entry 4 first, so entry 3 would still
      // be folded but entry 4 would NOT, giving [1, 2, 3, 4] here. Note that the
      // accumulator itself CANNOT discriminate — `until` reads post-update state,
      // so the running total is 6 either way. The recorder is the only witness.
      const byOnEntry: number[] = [];
      const byUntil: number[] = [];

      const result = foldEntries<Sum>([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], {
        init: { total: 0, visited: [] },
        onEntry: (acc, entry) => {
          byOnEntry.push(entry.n);
          acc.visited.push(entry.n);
          acc.total += entry.n;
        },
        until: (acc, entry) => {
          byUntil.push(entry.n);
          return acc.total > 5;
        },
      });

      expect(byOnEntry).toEqual([1, 2, 3]);
      expect(byUntil).toEqual([1, 2, 3]);
      // The walk stopped: entry 4 never reached, and entry 3's value is included.
      expect(result.visited).toEqual([1, 2, 3]);
      expect(result.total).toBe(6);
    });

    it('still records the stopping entry on a two-field accumulator (codex shape)', () => {
      // codex accumulates `{thread, fallback}` over a newest-first walk and stops
      // at the first entry carrying thread_token_usage. That entry is the very
      // one that sets `thread`, so consulting `until` first would drop it and
      // silently hand back `fallback` instead. The array below is already in walk
      // order: a NEWER total first (accumulated as the fallback), then the
      // thread entry that stops the walk and must still be recorded.
      type TwoTier = { thread: number | null; fallback: number | null; visited: string[] };

      const result = foldEntries<TwoTier>(
        [{ kind: 'total', value: 11 }, { kind: 'thread', value: 99 }],
        {
          init: { thread: null, fallback: null, visited: [] },
          onEntry: (acc, entry) => {
            acc.visited.push(entry.kind);
            if (entry.kind === 'thread') acc.thread = entry.value;
            else acc.fallback = entry.value;
          },
          until: (_acc, entry) => entry.kind === 'thread',
        },
      );

      expect(result.visited).toEqual(['total', 'thread']);
      expect(result.thread).toBe(99);
      expect(result.fallback).toBe(11);
    });

    it('walks every entry when until is omitted', () => {
      const result = foldEntries<Sum>([{ n: 1 }, { n: 2 }, { n: 3 }], {
        init: { total: 0, visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
        },
      });

      expect(result.visited).toEqual([1, 2, 3]);
    });
  });

  describe('foldJsonl', () => {
    let tmpDir: string;

    const write = (name: string, content: string) => {
      const filePath = path.join(tmpDir, name);
      fs.writeFileSync(filePath, content);
      return filePath;
    };

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-fold-jsonl-'));
    });

    afterAll(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    const FIVE_LINES = '{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n{"n":5}\n';

    it('folds the HEAD when from is start', async () => {
      const filePath = write('head.jsonl', FIVE_LINES);

      const result = await foldJsonl<{ visited: number[] }>(filePath, {
        scope: 'test',
        operation: 'head',
        from: 'start',
        count: 2,
        init: { visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
        },
      });

      expect(result.visited).toEqual([1, 2]);
    });

    it('defaults to the TAIL when from is omitted', async () => {
      // count 2 over a 5-line file: the tail window is entries 4 and 5, the head
      // window is 1 and 2. These are different lists, so this pins which one a
      // caller gets by saying nothing — which is every real caller, since all 12
      // token reads in pi/codex/gemini want the tail. Flipping the default back to
      // 'start' turns this red.
      const filePath = write('tail-default.jsonl', FIVE_LINES);

      const result = await foldJsonl<{ visited: number[] }>(filePath, {
        scope: 'test',
        operation: 'tail-default',
        count: 2,
        init: { visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
        },
      });

      expect(result.visited).toEqual([4, 5]);
    });

    it('walks newest-first when reverse is set', async () => {
      const filePath = write('reverse.jsonl', '{"n":1}\n{"n":2}\n{"n":3}\n');

      const result = await foldJsonl<{ visited: number[] }>(filePath, {
        scope: 'test',
        operation: 'reverse',
        count: 10,
        reverse: true,
        init: { visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
        },
      });

      expect(result.visited).toEqual([3, 2, 1]);
    });

    it('reverse reorders only the window from chose, not the whole file', async () => {
      // Same window as the default-tail case above ([4, 5]), walked the other way.
      // `reverse` must compose with `from` rather than replace it: a `reverse`
      // that also flipped `from` to 'start' would yield [2, 1], and one that
      // reversed before applying `count` would yield all five, [5, 4, 3, 2, 1].
      const filePath = write('reverse-window.jsonl', FIVE_LINES);

      const result = await foldJsonl<{ visited: number[] }>(filePath, {
        scope: 'test',
        operation: 'reverse-window',
        count: 2,
        reverse: true,
        init: { visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
        },
      });

      expect(result.visited).toEqual([5, 4]);
    });

    it('reverse plus until reproduces the reverse early-return codex needs', async () => {
      // Written oldest-first: thread, then total. The default tail window covers
      // the whole file, and `reverse` walks it newest-first, so the walk sees the
      // NEWER total first — accumulating the fallback — and the thread entry
      // second. Because `until` runs after `onEntry`, the thread reading is
      // recorded before the walk stops. Dropping the reverse, or consulting
      // `until` first, each breaks one of the two value assertions.
      type TwoTier = { thread: number | null; fallback: number | null; visited: string[] };
      const filePath = write('codex-shape.jsonl', '{"kind":"thread","value":99}\n{"kind":"total","value":11}\n');

      const result = await foldJsonl<TwoTier>(filePath, {
        scope: 'test',
        operation: 'codex-shape',
        count: 10,
        reverse: true,
        init: { thread: null, fallback: null, visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.kind);
          if (entry.kind === 'thread') acc.thread = entry.value;
          else acc.fallback = entry.value;
        },
        until: (_acc, entry) => entry.kind === 'thread',
      });

      expect(result.visited).toEqual(['total', 'thread']);
      expect(result.thread).toBe(99);
      expect(result.fallback).toBe(11);
    });

    it('propagates until so the walk stops early', async () => {
      const filePath = write('until.jsonl', '{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n');

      const result = await foldJsonl<{ visited: number[] }>(filePath, {
        scope: 'test',
        operation: 'until',
        from: 'start',
        count: 10,
        init: { visited: [] },
        onEntry: (acc, entry) => {
          acc.visited.push(entry.n);
        },
        until: (acc) => acc.visited.length >= 2,
      });

      expect(result.visited).toEqual([1, 2]);
    });

    it('returns the very init it was given for a missing file, and does not throw', async () => {
      const init = { total: 0, visited: [] as number[] };

      const { result, lines } = await withDebug(() => foldJsonl<{ total: number; visited: number[] }>(
        path.join(tmpDir, 'no-such-file.jsonl'),
        { scope: 'test', operation: 'missing', init, onEntry: () => {} },
      ));

      expect(result).toBe(init);
      expect(result).toEqual({ total: 0, visited: [] });
      // A missing file is not an error: readLines short-circuits on existsSync, so
      // nothing is logged. A log here would mean the path went through the catch.
      expect(lines).toEqual([]);
    });

    it('logs a read failure under readLines, never under operation', async () => {
      // A directory in the file's place makes existsSync pass but read fail. This
      // pins the doc comment's central claim: readJsonlEntries does not throw,
      // because readLines swallows and logs first under its own label. So there is
      // NO `operation`-labelled line for a read failure — an adapter cannot assert
      // one, and folding a read error into foldJsonl's own catch would be a
      // behaviour change to readLines.
      const notAFile = path.join(tmpDir, 'a-directory.jsonl');
      fs.mkdirSync(notAFile, { recursive: true });
      const init = { total: 0 };

      const { result, lines } = await withDebug(() => foldJsonl<{ total: number }>(notAFile, {
        scope: 'my-adapter',
        operation: 'getTokenUsage',
        init,
        onEntry: () => {},
      }));

      expect(result).toBe(init);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('my-adapter');
      expect(lines[0]).toContain('readLines(');
      expect(lines[0]).toContain(notAFile);
      expect(lines[0]).not.toContain('getTokenUsage');
    });

    it('logs an onEntry throw under scope and operation', async () => {
      // The only failure that reaches foldJsonl's own catch. Distinguishes the
      // catch's real coverage from the read path above: here `operation` IS the
      // label, because the throw came from adapter logic.
      const filePath = write('throwing.jsonl', '{"n":1}\n{"n":2}\n');

      const { result, lines } = await withDebug(() => foldJsonl<{ visited: number[] }>(filePath, {
        scope: 'my-adapter',
        operation: 'getTokenUsage',
        from: 'start',
        count: 10,
        init: { visited: [] },
        onEntry: (acc, entry) => {
          if (entry.n === 2) throw new Error('boom');
          acc.visited.push(entry.n);
        },
      }));

      // The accumulator is the same reference the catch hands back, so what was
      // folded before the throw survives — the contract collectJsonl already has.
      expect(result.visited).toEqual([1]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('my-adapter');
      expect(lines[0]).toContain('getTokenUsage');
      expect(lines[0]).toContain('boom');
    });
  });
});
