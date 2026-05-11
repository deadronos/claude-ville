import { describe, expect, it } from 'vitest';
import { getFrameStyle, getStateDefinition } from './sprite-animator.js';

const manifest = {
  atlas: { columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 },
  states: {
    running: { row: 7, frames: 6, fps: 8, loop: true },
  },
};

describe('getStateDefinition', () => {
  it('returns the requested state', () => {
    expect(getStateDefinition(manifest, 'running')).toEqual({
      row: 7,
      frames: 6,
      fps: 8,
      loop: true,
    });
  });

  it('falls back to idle then first state', () => {
    const fallbackManifest = {
      atlas: manifest.atlas,
      states: {
        idle: { row: 0, frames: 6, fps: 6, loop: true },
      },
    };
    expect(getStateDefinition(fallbackManifest, 'missing').row).toBe(0);
  });
});

describe('getFrameStyle', () => {
  it('builds CSS for a manifest frame', () => {
    expect(getFrameStyle(manifest, 'running', 2)).toEqual({
      width: '192px',
      height: '208px',
      backgroundSize: '1536px 1872px',
      backgroundPosition: '-384px -1456px',
    });
  });
});
