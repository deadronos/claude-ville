import fs from 'fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFileWatchers } from './watch-utils.js';

// `createFileWatchers` keeps each `fs.watch` result in a `fs.FSWatcher[]` and
// later calls only `close()` on it, so a `close` spy is the whole surface used.
function makeWatcher(close: () => void): fs.FSWatcher {
  return { close } as unknown as fs.FSWatcher;
}

describe('createFileWatchers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns close handles for watched files and directories', () => {
    const closeFile = vi.fn();
    const closeDirectory = vi.fn();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const watchSpy = vi.spyOn(fs, 'watch')
      .mockReturnValueOnce(makeWatcher(closeFile))
      .mockReturnValueOnce(makeWatcher(closeDirectory));

    const result = createFileWatchers([
      { path: '/tmp/session.jsonl', type: 'file' },
      { path: '/tmp/sessions', type: 'directory', filter: '.jsonl', recursive: true },
    ], vi.fn());

    expect(result.watchCount).toBe(2);
    expect(result.watchers).toHaveLength(2);
    expect(watchSpy).toHaveBeenCalledTimes(2);

    result.close();
    result.close();

    expect(closeFile).toHaveBeenCalledTimes(1);
    expect(closeDirectory).toHaveBeenCalledTimes(1);
  });

  it('clears a pending debounce timer when closed', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const onChange = vi.fn();
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'watch').mockImplementation((_path, listener) => {
      if (typeof listener === 'function') {
        listener('change', 'session.jsonl');
      }
      return makeWatcher(close);
    });

    const result = createFileWatchers([{ path: '/tmp/session.jsonl', type: 'file' }], onChange, 50);
    result.close();
    vi.advanceTimersByTime(50);

    expect(onChange).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
