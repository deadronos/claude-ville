// Canonical isometric projection for the village grid.
// isoX = (tileX - tileY) * tileWidth / 2
// isoY = (tileX + tileY) * tileHeight / 2

export function isoToScreen(tileX: number, tileY: number, tileWidth = 64, tileHeight = 32) {
  return {
    x: (tileX - tileY) * tileWidth / 2,
    y: (tileX + tileY) * tileHeight / 2,
  };
}

export function isoToWorld(isoX: number, isoY: number, tileWidth = 64, tileHeight = 32) {
  const x = (isoX / (tileWidth / 2) + isoY / (tileHeight / 2)) / 2;
  const z = isoY / (tileHeight / 2) - x;
  return { x, z };
}
