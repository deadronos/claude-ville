/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuildingRenderer } from './BuildingRenderer.js';

function makeBuilding(type: string, tileX: number, tileY: number, width: number, height: number) {
  return {
    type,
    position: { tileX, tileY },
    width,
    height,
    label: `${type.toUpperCase()} HQ`,
    icon: '⚙',
    containsPoint: (x: number, y: number) => x >= tileX && x <= tileX + width && y >= tileY && y <= tileY + height,
  };
}

function makeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BuildingRenderer', () => {
  it('updates roof alpha and spawns building-specific particles when agents are nearby', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const particleSystem = { spawn: vi.fn() };
    const renderer = new BuildingRenderer(particleSystem as any);
    const forge = makeBuilding('forge', 20, 20, 4, 3);
    const mine = makeBuilding('mine', 12, 24, 4, 3);
    const command = makeBuilding('command', 18, 18, 5, 4);

    renderer.setBuildings(new Map([
      ['forge', forge],
      ['mine', mine],
      ['command', command],
    ]));
    renderer.setAgentSprites([
      { x: renderer._getBuildingCenter(forge).x, y: renderer._getBuildingCenter(forge).y },
      { x: renderer._getBuildingCenter(mine).x, y: renderer._getBuildingCenter(mine).y },
    ]);

    renderer.update();

    expect(renderer.torchFrame).toBeGreaterThan(0);
    expect(renderer.roofAlpha.get(forge)).toBeLessThan(1);
    expect(renderer.roofAlpha.get(mine)).toBeLessThan(1);
    expect(particleSystem.spawn).toHaveBeenCalledWith('torch', expect.any(Number), expect.any(Number), 1);
    expect(particleSystem.spawn).toHaveBeenCalledWith('smoke', expect.any(Number), expect.any(Number), 1);
    expect(particleSystem.spawn).toHaveBeenCalledWith('sparkle', expect.any(Number), expect.any(Number), 1);
  });

  it('draws shadows, buildings, decorations, bubbles, and hit tests across all building styles', () => {
    const particleSystem = { spawn: vi.fn() };
    const renderer = new BuildingRenderer(particleSystem as any);
    const ctx = makeContext();
    const buildings = [
      makeBuilding('command', 18, 18, 5, 4),
      makeBuilding('forge', 28, 15, 4, 3),
      makeBuilding('mine', 12, 24, 4, 3),
      makeBuilding('taskboard', 25, 25, 3, 3),
      makeBuilding('chathall', 15, 14, 4, 3),
    ];

    renderer.setBuildings(new Map(buildings.map((building) => [building.type, building])));
    renderer.hoveredBuilding = buildings[0];
    buildings.forEach((building) => renderer.roofAlpha.set(building, 0.5));

    renderer.drawShadows(ctx);
    renderer.draw(ctx);

    const world = {
      agents: new Map([
        ['inside-command', { position: { tileX: 19, tileY: 19 } }],
        ['inside-chat', { position: { tileX: 16, tileY: 15 } }],
      ]),
    };
    renderer.drawBubbles(ctx, world as any);

    expect(ctx.ellipse).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(renderer.hitTest(renderer._getBuildingCenter(buildings[0]).x, renderer._getBuildingCenter(buildings[0]).y)).toBe(buildings[0]);
    expect(renderer.hitTest(-999, -999)).toBeNull();
    expect(renderer._lighten('#112233', 20)).toBe('rgb(37,54,71)');
  });
});
