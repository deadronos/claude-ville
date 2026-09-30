import { isoToScreen } from './iso.js';

export class Position {
    tileX: number;
    tileY: number;

    constructor(tileX: number, tileY: number) {
        this.tileX = tileX;
        this.tileY = tileY;
    }

    toScreen(tileWidth = 64, tileHeight = 32) {
        return isoToScreen(this.tileX, this.tileY, tileWidth, tileHeight);
    }

    distanceTo(other: Position) {
        const dx = this.tileX - other.tileX;
        const dy = this.tileY - other.tileY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    lerp(target: Position, t: number) {
        return new Position(
            this.tileX + (target.tileX - this.tileX) * t,
            this.tileY + (target.tileY - this.tileY) * t,
        );
    }
}
