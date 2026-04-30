import { Application, Container, Graphics, Polygon, Text } from 'pixi.js';

import type { VillageBuilding, VillageStatus } from '../model.js';

const tileWidth = 96;
const tileHeight = 48;
const mapWidth = 13;
const mapHeight = 10;

const statusColor: Record<VillageStatus, number> = {
  running: 0x2bdd68,
  waiting: 0xf4bd38,
  idle: 0x4da3ff,
  error: 0xff5a68,
  offline: 0x7f8a96,
};

// ─── Public API ─────────────────────────────────────────────────────────────

export async function createPixiVillageApp(container: HTMLDivElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: container,
    backgroundAlpha: 0,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  app.canvas.className = 'pixi-village__canvas';
  container.appendChild(app.canvas);
  return app;
}

/** Persistent renderer that updates PixiJS objects in-place instead of
 *  recreating the scene every frame. Terrain is drawn once; buildings and
 *  vegetation are mutated/relocated rather than destroyed and rebuilt. */
export interface PixiVillageRenderer {
  update(
    buildings: VillageBuilding[],
    selectedBuildingId: string | null,
    onSelectBuilding: (buildingId: string) => void,
    tick: number,
  ): void;
}

export function createPixiVillageRenderer(
  root: Container,
  screenWidth: number,
  screenHeight: number,
): PixiVillageRenderer {
  const origin = {
    x: screenWidth < 640 ? Math.round(screenWidth * 0.62) : Math.round(screenWidth / 2),
    y: screenWidth < 640 ? 86 : 70,
  };

  // ── Terrain: drawn once and never touched again ──────────────────────────
  drawTerrain(root, origin.x, origin.y);

  // ── Persistent scene container ───────────────────────────────────────────
  const scene = new Container();
  scene.x = screenWidth < 720 ? 16 : 0;
  scene.scale.set(screenWidth < 640 ? 0.5 : 1);
  root.addChild(scene);

  // ── Building view pool (pre-allocate; grows to cover all buildings) ────────
  const buildingViews: BuildingView[] = [];

  // ── Vegetation pool ──────────────────────────────────────────────────────
  let vegetationContainer: Container | null = null;
  const treePool: Graphics[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  function update(
    buildings: VillageBuilding[],
    selectedBuildingId: string | null,
    onSelectBuilding: (id: string) => void,
    tick: number,
  ) {
    const sorted = depthSort(buildings);

    // Grow / shrink view pool to match building count.
    while (buildingViews.length < sorted.length) {
      buildingViews.push(createBuildingView(scene));
    }
    while (buildingViews.length > sorted.length) {
      const view = buildingViews.pop()!;
      scene.removeChild(view.container);
      view.container.destroy({ children: true });
    }

    // Sync each view to its building data — mutates existing PixiJS objects.
    for (let i = 0; i < sorted.length; i++) {
      syncBuildingView(buildingViews[i], sorted[i], origin, selectedBuildingId, onSelectBuilding, tick);
    }

    // Sync vegetation (pool grows cheaply; doesn't rebuild existing trees).
    syncVegetation(screenWidth, screenHeight, tick);
  }

  function syncVegetation(width: number, height: number, tick: number) {
    const treeCount = Math.max(20, Math.floor(width / 48));

    if (!vegetationContainer) {
      vegetationContainer = new Container();
      // Vegetation goes behind buildings (insert at index 0, after terrain).
      scene.addChildAt(vegetationContainer, 0);
    }

    // Grow tree pool.
    while (treePool.length < treeCount) {
      const t = new Graphics();
      t.poly([0, -18, 15, 10, -15, 10]);
      t.rect(-3, 8, 6, 12);
      t.fill({ color: 0x173e2b });
      t.fill({ color: 0x3c2a1d });
      treePool.push(t);
    }

    // Sync visible trees.
    for (let i = 0; i < treeCount; i++) {
      const t = treePool[i];
      if (!vegetationContainer.children.includes(t)) vegetationContainer.addChild(t);
      t.x = (i * 137) % Math.max(width, 1);
      t.y = i % 2 === 0 ? 20 + ((i * 23) % 74) : height - 90 + ((i * 11) % 58);
      t.alpha = 0.52 + Math.sin(tick / 30 + i) * 0.05;
    }

    // Detach excess trees instead of destroying them (avoids create/destroy churn).
    for (let i = treeCount; i < treePool.length; i++) {
      vegetationContainer.removeChild(treePool[i]);
    }
  }

  return { update };
}

// ─── Building view types ────────────────────────────────────────────────────

interface BuildingView {
  container: Container;
  ringGraphics: Graphics;
  bodyGraphics: Graphics;
  residentsContainer: Container;
  labelContainer: Container;
  titleText: Text;
  statusText: Text;
  panelGraphics: Graphics;
}

// Pre-allocated Text styles (created once per view, reused on sync).
const titleStyle = {
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: 12,
  fontWeight: '700' as const,
  fill: 0xf7f3df,
};

function createBuildingView(scene: Container): BuildingView {
  const container = new Container();
  scene.addChild(container);

  const ringGraphics = new Graphics();
  const bodyGraphics = new Graphics();
  const residentsContainer = new Container();
  const labelContainer = new Container();
  const panelGraphics = new Graphics();

  const titleText = new Text({ text: '', style: titleStyle });
  titleText.anchor.set(0.5, 0);
  titleText.y = -15;

  const statusText = new Text({ text: '', style: { fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11, fill: statusColor.running } });
  statusText.anchor.set(0.5, 0);
  statusText.y = 9;

  labelContainer.addChild(panelGraphics);
  labelContainer.addChild(titleText);
  labelContainer.addChild(statusText);

  container.addChild(ringGraphics);
  container.addChild(bodyGraphics);
  container.addChild(residentsContainer);
  container.addChild(labelContainer);

  return { container, ringGraphics, bodyGraphics, residentsContainer, labelContainer, titleText, statusText, panelGraphics };
}

function syncBuildingView(
  view: BuildingView,
  building: VillageBuilding,
  origin: { x: number; y: number },
  selectedBuildingId: string | null,
  onSelectBuilding: (id: string) => void,
  tick: number,
) {
  const point = isoToScreen(building.x, building.y, origin.x, origin.y);
  view.container.x = point.x;
  view.container.y = point.y;
  view.container.eventMode = 'static';
  view.container.cursor = 'pointer';
  view.container.hitArea = makeBuildingHitArea(building);
  view.container.off('pointertap');
  view.container.on('pointertap', () => onSelectBuilding(building.id));

  // ── Status ring ─────────────────────────────────────────────────────────
  view.ringGraphics.clear();
  const selected = selectedBuildingId === building.id;
  const showRing = selected || building.status === 'running' || building.status === 'error';
  if (showRing) {
    drawStatusRingGraphics(view.ringGraphics, building.status, selected, tick);
  }

  // ── Building body ───────────────────────────────────────────────────────
  view.bodyGraphics.clear();
  drawBuildingBodyGraphics(view.bodyGraphics, building);

  // ── Residents ───────────────────────────────────────────────────────────
  const visibleCount = Math.min(building.agentCount, 5);
  const rc = view.residentsContainer;
  while (rc.children.length > visibleCount) rc.removeChildAt(rc.children.length - 1);
  while (rc.children.length < visibleCount) {
    const dot = new Graphics();
    dot.stroke({ color: 0x071018, width: 1, alpha: 0.9 });
    rc.addChild(dot);
  }
  for (let i = 0; i < visibleCount; i++) {
    const dot = rc.children[i] as Graphics;
    dot.clear();
    dot.circle(0, 0, 4);
    dot.fill({ color: statusColor[building.status], alpha: 0.9 });
    dot.stroke({ color: 0x071018, width: 1, alpha: 0.9 });
    dot.x = -36 + i * 18;
    dot.y = 58 + Math.sin(tick / 8 + i) * 3;
  }

  // ── Label ───────────────────────────────────────────────────────────────
  view.labelContainer.y = -building.height - 78;
  const panelWidth = Math.max(118, building.name.length * 8 + 28);
  view.panelGraphics.clear();
  view.panelGraphics.roundRect(-panelWidth / 2, -21, panelWidth, 58, 6);
  view.panelGraphics.fill({ color: 0x101922, alpha: 0.92 });
  view.panelGraphics.stroke({ color: 0x30404f, alpha: 0.95, width: 1 });

  view.titleText.text = building.name.toUpperCase();
  view.statusText.text = `${building.status}${building.agentCount > 0 ? ` · ${building.agentCount}` : ''}`;
  view.statusText.style.fill = statusColor[building.status];
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

function isoToScreen(x: number, y: number, originX: number, originY: number) {
  return {
    x: originX + (x - y) * (tileWidth / 2),
    y: originY + (x + y) * (tileHeight / 2),
  };
}

function depthSort<T extends { x: number; y: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.x + a.y) - (b.x + b.y));
}

function isRoadTile(x: number, y: number) {
  return x === y || x + y === 10 || (y === 5 && x > 1 && x < 11);
}

function makeBuildingHitArea(building: VillageBuilding) {
  const hw = (building.width * tileWidth) / 2;
  const overhang = 18;
  return new Polygon([
    -hw - overhang, 52,
    hw + overhang, 52,
    hw + 28, -112,
    -hw - 28, -112,
  ]);
}

// ─── Drawing primitives (mutate a pre-existing Graphics object) ─────────────

function drawTerrain(scene: Container, originX: number, originY: number) {
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const point = isoToScreen(x, y, originX, originY);
      const water = x < 2 && y > 6;
      const road = isRoadTile(x, y);
      const tile = new Graphics();
      tile.poly([0, -tileHeight / 2, tileWidth / 2, 0, 0, tileHeight / 2, -tileWidth / 2, 0]);
      tile.fill({ color: water ? 0x12395a : road ? 0x4d4b45 : 0x1f4b33, alpha: 0.96 });
      tile.stroke({ color: road ? 0x777065 : 0x173326, alpha: 0.8, width: 1 });
      tile.x = point.x;
      tile.y = point.y;
      scene.addChild(tile);

      if (!road && !water && (x * 7 + y * 3) % 5 === 0) {
        const sparkle = new Graphics();
        sparkle.circle(point.x + ((x % 2) - 0.5) * 22, point.y + ((y % 3) - 1) * 7, 2);
        sparkle.fill({ color: (x + y) % 2 === 0 ? 0xf4bd38 : 0x9c6cff, alpha: 0.82 });
        scene.addChild(sparkle);
      }
    }
  }
}

function drawStatusRingGraphics(graphics: Graphics, status: VillageStatus, selected: boolean, tick: number) {
  const pulse = selected ? 1 : 0.45 + Math.sin(tick / 8) * 0.18;
  graphics.ellipse(0, 20, 78 + pulse * 16, 30 + pulse * 5);
  graphics.stroke({ color: statusColor[status], alpha: selected ? 0.95 : 0.62, width: selected ? 3 : 2 });
}

function drawBuildingBodyGraphics(graphics: Graphics, building: VillageBuilding) {
  const halfW = (building.width * tileWidth) / 2;
  const halfD = (building.depth * tileWidth) / 2;
  const baseY = 18;

  // Shadow
  graphics.ellipse(0, baseY + 16, halfW * 0.92, halfD * 0.24);
  graphics.fill({ color: 0x02050a, alpha: 0.46 });

  // Left wall
  graphics.poly([-halfW / 2, baseY, 0, baseY + halfD / 4, 0, baseY + halfD / 4 - building.height, -halfW / 2, baseY - building.height]);
  graphics.fill({ color: building.color, alpha: 0.95 });
  graphics.stroke({ color: 0x111820, width: 2, alpha: 0.9 });

  // Right wall
  graphics.poly([halfW / 2, baseY, 0, baseY + halfD / 4, 0, baseY + halfD / 4 - building.height, halfW / 2, baseY - building.height]);
  graphics.fill({ color: shade(building.color, 0.76), alpha: 0.95 });
  graphics.stroke({ color: 0x111820, width: 2, alpha: 0.9 });

  // Roof
  graphics.poly([0, baseY - building.height - 34, halfW / 1.75, baseY - building.height, 0, baseY - building.height + 26, -halfW / 1.75, baseY - building.height]);
  graphics.fill({ color: building.roofColor, alpha: building.status === 'offline' ? 0.5 : 1 });
  graphics.stroke({ color: building.status === 'error' ? 0xff5a68 : 0x15191f, width: building.status === 'error' ? 4 : 2, alpha: 0.95 });

  // Windows / glow
  graphics.roundRect(-18, baseY - building.height + 8, 12, 18, 2);
  graphics.roundRect(10, baseY - building.height + 2, 12, 18, 2);
  graphics.fill({ color: building.status === 'offline' ? 0x343b44 : statusColor[building.status], alpha: building.status === 'idle' ? 0.62 : 0.88 });
}

function shade(color: number, factor: number) {
  const r = Math.round(((color >> 16) & 255) * factor);
  const g = Math.round(((color >> 8) & 255) * factor);
  const b = Math.round((color & 255) * factor);
  return (r << 16) + (g << 8) + b;
}
