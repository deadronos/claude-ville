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
        this.width = width || 4;
        this.height = height || 4;
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
