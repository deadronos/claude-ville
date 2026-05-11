import { describe, expect, it } from 'vitest';
import manifest from './manifest.json' with { type: 'json' };

describe('Prism manifest', () => {
  it('matches the generated atlas dimensions', () => {
    expect(manifest.atlas).toEqual({
      columns: 8,
      rows: 9,
      cellWidth: 192,
      cellHeight: 208,
    });
  });

  it('contains every v1 animation state', () => {
    expect(Object.keys(manifest.states)).toEqual([
      'idle',
      'running-right',
      'running-left',
      'waving',
      'jumping',
      'failed',
      'waiting',
      'running',
      'review',
    ]);
  });

  it('uses the expected row and frame counts', () => {
    expect(manifest.states.idle).toMatchObject({ row: 0, frames: 6 });
    expect(manifest.states['running-right']).toMatchObject({ row: 1, frames: 8 });
    expect(manifest.states['running-left']).toMatchObject({ row: 2, frames: 8 });
    expect(manifest.states.waving).toMatchObject({ row: 3, frames: 4 });
    expect(manifest.states.jumping).toMatchObject({ row: 4, frames: 5 });
    expect(manifest.states.failed).toMatchObject({ row: 5, frames: 8 });
    expect(manifest.states.waiting).toMatchObject({ row: 6, frames: 6 });
    expect(manifest.states.running).toMatchObject({ row: 7, frames: 6 });
    expect(manifest.states.review).toMatchObject({ row: 8, frames: 6 });
  });
});
