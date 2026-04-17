/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
// @ts-ignore
import { createFileWatchers } from './watch-utils.js';

vi.mock('node:fs');

describe('watch-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('should increment watchCount for existing files and directories', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const watchPaths = [
      { path: 'file1.txt', type: 'file' },
      { path: 'dir1', type: 'directory' },
      { path: 'non-existent', type: 'file' }
    ];

    // For the third one, we want it to NOT exist
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const { watchCount } = createFileWatchers(watchPaths, () => {});

    expect(watchCount).toBe(2);
    expect(fs.watch).toHaveBeenCalledTimes(2);
  });

  it('should call onChange when a file changes (debounced)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    let watchCallback: any;
    vi.mocked(fs.watch).mockImplementation((path: any, callback: any) => {
      watchCallback = callback;
      return {} as any;
    });

    const onChange = vi.fn();
    createFileWatchers([{ path: 'file.txt', type: 'file' }], onChange, 100);

    // Simulate change event
    watchCallback('change');
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    watchCallback('change'); // trigger again to test debounce

    vi.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('should call onChange when a directory has changes (with filter)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    let watchCallback: any;
    vi.mocked(fs.watch).mockImplementation((path: any, options: any, callback?: any) => {
      if (typeof options === 'function') {
        watchCallback = options;
      } else {
        watchCallback = callback;
      }
      return {} as any;
    });

    const onChange = vi.fn();
    createFileWatchers([
      { path: 'dir', type: 'directory', filter: '.jsonl' }
    ], onChange, 100);

    // Should NOT trigger for non-matching extension
    watchCallback('rename', 'other.txt');
    vi.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();

    // Should trigger for matching extension
    watchCallback('rename', 'data.jsonl');
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('should pass recursive option to fs.watch for directories', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    createFileWatchers([
      { path: 'dir', type: 'directory', recursive: true }
    ], () => {});

    expect(fs.watch).toHaveBeenCalledWith('dir', { recursive: true }, expect.any(Function));
  });

  it('should handle watch failures gracefully', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.watch).mockImplementationOnce(() => {
      throw new Error('Watch failed');
    }).mockImplementationOnce(() => ({} as any));

    const watchPaths = [
      { path: 'fail.txt', type: 'file' },
      { path: 'success.txt', type: 'file' }
    ];

    const { watchCount } = createFileWatchers(watchPaths, () => {});

    expect(watchCount).toBe(1);
    expect(fs.watch).toHaveBeenCalledTimes(2);
  });
});
