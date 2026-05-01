import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

import { createPixiVillageRenderer } from './renderVillage.js';
import type { VillageBuilding } from '../model.js';

const tileWidth = 96;
const tileHeight = 48;
const mapWidth = 13;
const mapHeight = 10;

function isoToScreen(x: number, y: number, width: number) {
  const originX = width < 640 ? Math.round(width * 0.62) : Math.round(width / 2);
  const originY = width < 640 ? 86 : 70;
  return {
    x: originX + (x - y) * (tileWidth / 2),
    y: originY + (x + y) * (tileHeight / 2),
  };
}

function makeBuilding(id: string, x: number, y: number): VillageBuilding {
  return {
    id,
    name: id,
    description: `${id} description`,
    x,
    y,
    width: 2,
    depth: 2,
    height: 60,
    color: 0x112233,
    roofColor: 0x334455,
    status: 'running',
    agentCount: 1,
    activityLevel: 0.5,
    agents: [],
  };
}

describe('createPixiVillageRenderer', () => {
  it('keeps terrain tiles addressable and repositions them correctly on resize', () => {
    const root = new Container();
    const renderer = createPixiVillageRenderer(root, 800, 600);
    const scene = root.children[0] as Container;
    const buildingContainer = root.children[1] as Container;

    // scene has 130 tiles + 1 sparkleContainer (added at index 0)
    expect(scene.children).toHaveLength(mapWidth * mapHeight + 1);
    // buildingContainer is empty initially
    expect(buildingContainer.children).toHaveLength(0);

    renderer.resize(600, 480);

    // First child is sparkleContainer, then 130 tiles
    const firstTile = scene.children[1] as Container;
    const lastTile = scene.children[scene.children.length - 1] as Container;
    const firstExpected = isoToScreen(0, 0, 600);
    const lastExpected = isoToScreen(mapWidth - 1, mapHeight - 1, 600);

    expect(firstTile.x).toBe(firstExpected.x);
    expect(firstTile.y).toBe(firstExpected.y);
    expect(lastTile.x).toBe(lastExpected.x);
    expect(lastTile.y).toBe(lastExpected.y);
  });

  it('keeps building interaction order stable even when update input order changes', () => {
    const root = new Container();
    const renderer = createPixiVillageRenderer(root, 800, 600);
    const scene = root.children[0] as Container;
    const buildingContainer = root.children[1] as Container;
    const onSelect = vi.fn();

    const near = makeBuilding('near', 1, 1);
    const far = makeBuilding('far', 8, 8);

    renderer.update([far, near], null, onSelect, 0);
    // Buildings are in buildingContainer, sorted by depth (near before far)
    const firstBuildingView = buildingContainer.children[0] as Container;
    firstBuildingView.emit('pointertap');

    renderer.update([
      { ...far, status: 'idle' },
      { ...near, status: 'waiting' },
    ], null, onSelect, 1);
    // First building view should still be 'near' (depth order unchanged)
    const reFoundFirstBuildingView = buildingContainer.children[0] as Container;
    reFoundFirstBuildingView.emit('pointertap');

    expect(onSelect).toHaveBeenNthCalledWith(1, 'near');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'near');
  });
});