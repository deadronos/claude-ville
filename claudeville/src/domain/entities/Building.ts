import { Position } from '../value-objects/Position.js';

export class Building {
    type: string;
    position: Position;
    width: number;
    height: number;
    label: string;
    icon: string;
    description: string;

    constructor({ type, x, y, width, height, label, icon, description }: { type: string; x: number; y: number; width: number; height: number; label: string; icon: string; description: string }) {
        this.type = type;
        this.position = new Position(x, y);
        // Stored as given. These were `width || 4` / `height || 4`, which fired
        // only for `0` — every field here is required, and the one production
        // construction site (`ClaudeVilleController`, from `BUILDING_DEFS`) is
        // 5x4, 4x3, 4x3, 3x3, 4x3, so nothing reached the default. A `0` is a real
        // tile count: it makes `containsPoint` false at the building's own origin
        // rather than silently giving it a 4x4 footprint.
        this.width = width;
        this.height = height;
        this.label = label;
        this.icon = icon;
        this.description = description;
    }

    containsPoint(tileX: number, tileY: number) {
        return tileX >= this.position.tileX &&
               tileX < this.position.tileX + this.width &&
               tileY >= this.position.tileY &&
               tileY < this.position.tileY + this.height;
    }
}
