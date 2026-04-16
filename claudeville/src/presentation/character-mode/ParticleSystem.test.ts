/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParticleSystem } from './ParticleSystem.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParticleSystem', () => {
  it('spawns directional particles, updates them, draws them, and clears them', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const system = new ParticleSystem();
    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    system.spawn('footstep', 10, 20, 2);
    system.spawn('sparkle', 30, 40, 1);

    expect(system.particles).toHaveLength(3);

    const firstLife = system.particles[0].life;
    const firstY = system.particles[0].y;
    system.update();
    expect(system.particles[0].life).toBe(firstLife - 1);
    expect(system.particles[0].y).not.toBe(firstY);

    system.draw(ctx);
    expect(ctx.fillRect).toHaveBeenCalled();

    system.clear();
    expect(system.particles).toEqual([]);
  });

  it('ignores unknown presets and removes dead particles during updates', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const system = new ParticleSystem();

    system.spawn('unknown', 0, 0, 3);
    expect(system.particles).toHaveLength(0);

    system.spawn('mining', 5, 5, 1);
    expect(system.particles).toHaveLength(1);

    system.particles[0].life = 1;
    system.update();
    expect(system.particles).toHaveLength(0);
  });
});
