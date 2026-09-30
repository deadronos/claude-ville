import { Graphics, Polygon } from 'pixi.js';

import { isoToScreen as projectIso } from '../../domain/value-objects/iso.js';
import type { VillageBuilding, VillageStatus } from '../model.js';

export const tileWidth = 96;
export const tileHeight = 48;

export const statusColor: Record<VillageStatus, number> = {
  running: 0x2bdd68,
  waiting: 0xf4bd38,
  idle: 0x4da3ff,
  error: 0xff5a68,
  offline: 0x7f8a96,
};

// ─── Projection & hit areas ─────────────────────────────────────────────────

export function isoToScreen(x: number, y: number, originX: number, originY: number) {
  const point = projectIso(x, y, tileWidth, tileHeight);
  return {
    x: originX + point.x,
    y: originY + point.y,
  };
}

export function isRoadTile(x: number, y: number) {
  return x === y || x + y === 10 || (y === 5 && x > 1 && x < 11);
}

export function makeBuildingHitArea(building: VillageBuilding) {
  const hw = (building.width * tileWidth) / 2;
  const overhang = 18;
  return new Polygon([
    -hw - overhang, 52,
    hw + overhang, 52,
    hw + 28, -112,
    -hw - 28, -112,
  ]);
}

// ─── Building drawing ───────────────────────────────────────────────────────

export function drawStatusRingGraphics(graphics: Graphics, status: VillageStatus, selected: boolean, tick: number) {
  const pulse = selected ? 1 : 0.45 + Math.sin(tick / 8) * 0.18;
  graphics.ellipse(0, 20, 78 + pulse * 16, 30 + pulse * 5);
  graphics.stroke({ color: statusColor[status], alpha: selected ? 0.95 : 0.62, width: selected ? 3 : 2 });
}

export function drawBuildingBodyGraphics(graphics: Graphics, building: VillageBuilding) {
  const halfW = (building.width * tileWidth) / 2;
  const halfD = (building.depth * tileWidth) / 2;
  const baseY = 18;

  graphics.ellipse(0, baseY + 16, halfW * 0.92, halfD * 0.24);
  graphics.fill({ color: 0x02050a, alpha: 0.46 });

  graphics.poly([-halfW / 2, baseY, 0, baseY + halfD / 4, 0, baseY + halfD / 4 - building.height, -halfW / 2, baseY - building.height]);
  graphics.fill({ color: building.color, alpha: 0.95 });
  graphics.stroke({ color: 0x111820, width: 2, alpha: 0.9 });

  graphics.poly([halfW / 2, baseY, 0, baseY + halfD / 4, 0, baseY + halfD / 4 - building.height, halfW / 2, baseY - building.height]);
  graphics.fill({ color: shade(building.color, 0.76), alpha: 0.95 });
  graphics.stroke({ color: 0x111820, width: 2, alpha: 0.9 });

  graphics.poly([0, baseY - building.height - 34, halfW / 1.75, baseY - building.height, 0, baseY - building.height + 26, -halfW / 1.75, baseY - building.height]);
  graphics.fill({ color: building.roofColor, alpha: building.status === 'offline' ? 0.5 : 1 });
  graphics.stroke({ color: building.status === 'error' ? 0xff5a68 : 0x15191f, width: building.status === 'error' ? 4 : 2, alpha: 0.95 });

  graphics.roundRect(-18, baseY - building.height + 8, 12, 18, 2);
  graphics.roundRect(10, baseY - building.height + 2, 12, 18, 2);
  graphics.fill({ color: building.status === 'offline' ? 0x343b44 : statusColor[building.status], alpha: building.status === 'idle' ? 0.62 : 0.88 });
}

export function shade(color: number, factor: number) {
  const r = Math.round(((color >> 16) & 255) * factor);
  const g = Math.round(((color >> 8) & 255) * factor);
  const b = Math.round((color & 255) * factor);
  return (r << 16) + (g << 8) + b;
}
