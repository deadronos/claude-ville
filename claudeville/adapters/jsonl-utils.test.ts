import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readLines, parseJsonLines, readJsonlEntries, collectJsonl } from './jsonl-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
        const lines: string[] = [];
        const original = process.env.DEBUG;
        const spy = vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        });
        process.env.DEBUG = '1';

        try {
          await collectJsonl(filePath, {
            scope: 'my-adapter',
            operation: 'getToolHistory',
            onEntry: () => { throw new Error('boom'); },
          });
        } finally {
          spy.mockRestore();
          if (original === undefined) delete process.env.DEBUG;
          else process.env.DEBUG = original;
        }

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
});
