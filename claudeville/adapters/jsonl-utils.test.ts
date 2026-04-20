import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readLines, parseJsonLines } from './jsonl-utils';
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
});
