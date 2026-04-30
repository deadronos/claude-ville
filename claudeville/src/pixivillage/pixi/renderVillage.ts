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

export function renderVillage(
  root: Container,
  width: number,
  height: number,
  buildings: VillageBuilding[],
  options: {
    selectedBuildingId: string | null;
    onSelectBuilding: (buildingId: string) => void;
    tick: number;
  },
) {
  root.removeChildren();
  const scene = new Container();
  scene.x = width < 720 ? 16 : 0;
  scene.scale.set(width < 640 ? 0.5 : 1);
  root.addChild(scene);

  const origin = {
    x: width < 640 ? Math.round(width * 0.62) : Math.round(width / 2),
    y: width < 640 ? 86 : 70,
  };

  drawTerrain(scene, origin.x, origin.y);

  for (const building of buildings) {
    const point = isoToScreen(building.x, building.y, origin.x, origin.y);
    const container = new Container();
    container.x = point.x;
    container.y = point.y;
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.hitArea = new Polygon([-92, -110, 100, -110, 132, 52, -116, 52]);
    container.on('pointertap', () => options.onSelectBuilding(building.id));

    const selected = options.selectedBuildingId === building.id;
    if (selected || building.status === 'running' || building.status === 'error') {
      drawStatusRing(container, building.status, selected, options.tick);
    }
    drawBuildingBody(container, building);
    drawResidents(container, building, options.tick);
    drawLabel(container, building);
    scene.addChild(container);
  }

  drawFrameVegetation(scene, width, height, options.tick);
}

function isoToScreen(x: number, y: number, originX: number, originY: number) {
  return {
    x: originX + (x - y) * (tileWidth / 2),
    y: originY + (x + y) * (tileHeight / 2),
  };
}

function isRoadTile(x: number, y: number) {
  return x === y || x + y === 10 || (y === 5 && x > 1 && x < 11);
}

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

function drawStatusRing(container: Container, status: VillageStatus, selected: boolean, tick: number) {
  const pulse = selected ? 1 : 0.45 + Math.sin(tick / 8) * 0.18;
  const ring = new Graphics();
  ring.ellipse(0, 20, 78 + pulse * 16, 30 + pulse * 5);
  ring.stroke({ color: statusColor[status], alpha: selected ? 0.95 : 0.62, width: selected ? 3 : 2 });
  container.addChild(ring);
}

function drawBuildingBody(container: Container, building: VillageBuilding) {
  const halfW = (building.width * tileWidth) / 2;
  const halfD = (building.depth * tileWidth) / 2;
  const baseY = 18;

  const shadow = new Graphics();
  shadow.ellipse(0, baseY + 16, halfW * 0.92, halfD * 0.24);
  shadow.fill({ color: 0x02050a, alpha: 0.46 });
  container.addChild(shadow);

  const leftWall = new Graphics();
  leftWall.poly([-halfW / 2, baseY, 0, baseY + halfD / 4, 0, baseY + halfD / 4 - building.height, -halfW / 2, baseY - building.height]);
  leftWall.fill({ color: building.color, alpha: 0.95 });
  leftWall.stroke({ color: 0x111820, width: 2, alpha: 0.9 });
  container.addChild(leftWall);

  const rightWall = new Graphics();
  rightWall.poly([halfW / 2, baseY, 0, baseY + halfD / 4, 0, baseY + halfD / 4 - building.height, halfW / 2, baseY - building.height]);
  rightWall.fill({ color: shade(building.color, 0.76), alpha: 0.95 });
  rightWall.stroke({ color: 0x111820, width: 2, alpha: 0.9 });
  container.addChild(rightWall);

  const roofShape = new Graphics();
  roofShape.poly([0, baseY - building.height - 34, halfW / 1.75, baseY - building.height, 0, baseY - building.height + 26, -halfW / 1.75, baseY - building.height]);
  roofShape.fill({ color: building.roofColor, alpha: building.status === 'offline' ? 0.5 : 1 });
  roofShape.stroke({ color: building.status === 'error' ? 0xff5a68 : 0x15191f, width: building.status === 'error' ? 4 : 2, alpha: 0.95 });
  container.addChild(roofShape);

  const glow = new Graphics();
  glow.roundRect(-18, baseY - building.height + 8, 12, 18, 2);
  glow.roundRect(10, baseY - building.height + 2, 12, 18, 2);
  glow.fill({ color: building.status === 'offline' ? 0x343b44 : statusColor[building.status], alpha: building.status === 'idle' ? 0.62 : 0.88 });
  container.addChild(glow);
}

function drawResidents(container: Container, building: VillageBuilding, tick: number) {
  const visibleCount = Math.min(building.agentCount, 5);
  for (let index = 0; index < visibleCount; index += 1) {
    const dot = new Graphics();
    dot.circle(0, 0, 4);
    dot.fill({ color: statusColor[building.status], alpha: 0.9 });
    dot.stroke({ color: 0x071018, width: 1, alpha: 0.9 });
    dot.x = -36 + index * 18;
    dot.y = 58 + Math.sin(tick / 8 + index) * 3;
    container.addChild(dot);
  }
}

function drawLabel(container: Container, building: VillageBuilding) {
  const label = new Container();
  label.y = -building.height - 78;
  const panelWidth = Math.max(118, building.name.length * 8 + 28);
  const panel = new Graphics();
  panel.roundRect(-panelWidth / 2, -21, panelWidth, 58, 6);
  panel.fill({ color: 0x101922, alpha: 0.92 });
  panel.stroke({ color: 0x30404f, alpha: 0.95, width: 1 });
  label.addChild(panel);

  const title = new Text({
    text: building.name.toUpperCase(),
    style: {
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 12,
      fontWeight: '700',
      fill: 0xf7f3df,
    },
  });
  title.anchor.set(0.5, 0);
  title.y = -15;
  label.addChild(title);

  const status = new Text({
    text: `${building.status}${building.agentCount > 0 ? ` · ${building.agentCount}` : ''}`,
    style: {
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 11,
      fill: statusColor[building.status],
    },
  });
  status.anchor.set(0.5, 0);
  status.y = 9;
  label.addChild(status);
  container.addChild(label);
}

function drawFrameVegetation(scene: Container, width: number, height: number, tick: number) {
  const count = Math.max(20, Math.floor(width / 48));
  for (let index = 0; index < count; index += 1) {
    const tree = new Graphics();
    const x = (index * 137) % Math.max(width, 1);
    const y = index % 2 === 0 ? 20 + ((index * 23) % 74) : height - 90 + ((index * 11) % 58);
    tree.poly([0, -18, 15, 10, -15, 10]);
    tree.fill({ color: 0x173e2b, alpha: 0.52 + Math.sin(tick / 30 + index) * 0.05 });
    tree.rect(-3, 8, 6, 12);
    tree.fill({ color: 0x3c2a1d, alpha: 0.7 });
    tree.x = x;
    tree.y = y;
    scene.addChild(tree);
  }
}

function shade(color: number, factor: number) {
  const r = Math.round(((color >> 16) & 255) * factor);
  const g = Math.round(((color >> 8) & 255) * factor);
  const b = Math.round((color & 255) * factor);
  return (r << 16) + (g << 8) + b;
}
