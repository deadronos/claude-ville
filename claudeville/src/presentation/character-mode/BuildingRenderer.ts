import { TILE_WIDTH, TILE_HEIGHT } from '../../config/constants.js';
import { THEME } from '../../config/theme.js';
import { BUILDING_STYLES } from '../../config/buildingStyles.js';

export class BuildingRenderer {
    particleSystem: any;
    buildings: any[];
    hoveredBuilding: any;
    torchFrame: number;
    agentSprites: any[];
    roofAlpha: Map<any, number>;

    constructor(particleSystem) {
        this.particleSystem = particleSystem;
        this.buildings = [];
        this.hoveredBuilding = null;
        this.torchFrame = 0;
        this.agentSprites = [];
        this.roofAlpha = new Map(); // Roof transparency per building (1=roof visible, 0=interior visible)
    }

    setBuildings(buildings) {
        this.buildings = Array.from(buildings.values());
    }

    setAgentSprites(sprites) {
        this.agentSprites = sprites;
    }

    update() {
        this.torchFrame += 0.08;

        // Update roof transparency (Sims-style effect)
        for (const b of this.buildings) {
            const center = this._getBuildingCenter(b);
            const halfW = b.width * TILE_WIDTH / 4;
            const style = BUILDING_STYLES[b.type];
            if (!style) continue;

            // Check if any agent is near the building
            let agentNear = false;
            for (const sprite of this.agentSprites) {
                const dx = sprite.x - center.x;
                const dy = sprite.y - center.y;
                if (Math.abs(dx) < halfW + 15 && dy > -style.wallHeight - 10 && dy < 20) {
                    agentNear = true;
                    break;
                }
            }

            const current = this.roofAlpha.get(b) ?? 1;
            const target = agentNear ? 0 : 1;
            const speed = 0.06;
            const next = current + (target - current) * speed;
            this.roofAlpha.set(b, next);

            this._spawnTorchParticles(b);
            if (b.type === 'forge') {
                this._spawnSmokeParticles(b);
            }
            if (b.type === 'mine') {
                if (Math.random() < 0.02) {
                    this.particleSystem.spawn('sparkle', center.x, center.y - 20, 1);
                }
            }
        }
    }

    _getBuildingCenter(building) {
        const cx = building.position.tileX + building.width / 2;
        const cy = building.position.tileY + building.height / 2;
        return {
            x: (cx - cy) * TILE_WIDTH / 2,
            y: (cx + cy) * TILE_HEIGHT / 2,
        };
    }

    _spawnTorchParticles(building) {
        if (Math.random() > 0.15) return;
        const center = this._getBuildingCenter(building);
        const style = BUILDING_STYLES[building.type];
        if (!style) return;
        const halfW = building.width * TILE_WIDTH / 4;
        this.particleSystem.spawn('torch', center.x - halfW - 5, center.y - style.wallHeight + 10, 1);
        this.particleSystem.spawn('torch', center.x + halfW + 5, center.y - style.wallHeight + 10, 1);
    }

    _spawnSmokeParticles(building) {
        if (Math.random() > 0.08) return;
        const center = this._getBuildingCenter(building);
        this.particleSystem.spawn('smoke', center.x + 15, center.y - 55, 1);
    }

    drawShadows(ctx) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        for (const b of this.buildings) {
            const center = this._getBuildingCenter(b);
            const style = BUILDING_STYLES[b.type];
            if (!style) continue;
            const halfW = b.width * TILE_WIDTH / 4;
            const halfH = b.height * TILE_HEIGHT / 4;
            ctx.beginPath();
            ctx.ellipse(center.x + 8, center.y + 6, halfW + 5, halfH + 3, 0.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    draw(ctx) {
        for (const b of this.buildings) {
            this._drawBuilding(ctx, b);
        }
    }

    _drawBuilding(ctx, building) {
        const style = BUILDING_STYLES[building.type];
        if (!style) return;
        const center = this._getBuildingCenter(building);
        const halfW = building.width * TILE_WIDTH / 4;
        const halfH = building.height * TILE_HEIGHT / 4;
        const alpha = this.roofAlpha.get(building) ?? 1;

        ctx.save();
        ctx.translate(center.x, center.y);

        // Foundation (isometric diamond)
        ctx.fillStyle = '#3a3025';
        ctx.beginPath();
        ctx.moveTo(0, -halfH);
        ctx.lineTo(halfW, 0);
        ctx.lineTo(0, halfH);
        ctx.lineTo(-halfW, 0);
        ctx.closePath();
        ctx.fill();

        const wh = style.wallHeight;

        // === 1. Back wall (always visible - provides depth when agents enter) ===
        ctx.fillStyle = this._lighten(style.wallColor, -15);
        // Back wall left (top→left)
        ctx.beginPath();
        ctx.moveTo(-halfW, 0);
        ctx.lineTo(-halfW, -wh);
        ctx.lineTo(0, -wh - halfH);
        ctx.lineTo(0, -halfH);
        ctx.closePath();
        ctx.fill();
        // Back wall right (top→right)
        ctx.fillStyle = this._lighten(style.wallColor, -5);
        ctx.beginPath();
        ctx.moveTo(halfW, 0);
        ctx.lineTo(halfW, -wh);
        ctx.lineTo(0, -wh - halfH);
        ctx.lineTo(0, -halfH);
        ctx.closePath();
        ctx.fill();

        // === 2. Interior floor + furniture (visible when roof opens) ===
        if (alpha < 0.95) {
            ctx.save();
            ctx.globalAlpha = 1 - alpha;
            this._drawInterior(ctx, building, halfW, halfH, style);
            ctx.restore();
        }

        // === 3. Front wall (fades out when agents approach) ===
        ctx.save();
        ctx.globalAlpha = alpha;
        // Front wall left (left→bottom)
        ctx.fillStyle = style.wallColor;
        ctx.beginPath();
        ctx.moveTo(-halfW, 0);
        ctx.lineTo(0, halfH);
        ctx.lineTo(0, halfH - wh);
        ctx.lineTo(-halfW, -wh);
        ctx.closePath();
        ctx.fill();
        // Front wall right (bottom→right)
        ctx.fillStyle = this._lighten(style.wallColor, 20);
        ctx.beginPath();
        ctx.moveTo(0, halfH);
        ctx.lineTo(halfW, 0);
        ctx.lineTo(halfW, -wh);
        ctx.lineTo(0, halfH - wh);
        ctx.closePath();
        ctx.fill();

        // Front wall windows
        this._drawFrontWindows(ctx, halfW, halfH, wh, style);
        ctx.restore();

        // === 4. Roof (fades out when agents approach) ===
        if (alpha > 0.05) {
            ctx.save();
            ctx.globalAlpha = alpha;
            if (style.roundRoof) {
                this._drawRoundRoof(ctx, halfW, halfH, style);
            } else {
                this._drawTriangleRoof(ctx, halfW, halfH, style);
            }
            ctx.restore();
        }

        // Back wall windows (always visible)
        this._drawWindows(ctx, halfW, style);

        // Building-specific decorations
        this._drawDecorations(ctx, building, halfW, halfH, style);

        // Torches on both sides
        this._drawTorch(ctx, -halfW - 5, -style.wallHeight + 10);
        this._drawTorch(ctx, halfW + 5, -style.wallHeight + 10);

        // Label
        const isHovered = this.hoveredBuilding === building;
        ctx.font = isHovered ? 'bold 9px sans-serif' : '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isHovered ? THEME.text : THEME.textSecondary;
        ctx.fillText(building.label, 0, halfH + 14);

        ctx.restore();
    }

    _drawInterior(ctx, building, halfW, halfH, style) {
        // Interior floor (bright tone)
        ctx.fillStyle = this._lighten(style.wallColor, 40);
        ctx.beginPath();
        ctx.moveTo(0, -halfH);
        ctx.lineTo(halfW - 2, 0);
        ctx.lineTo(0, halfH - 2);
        ctx.lineTo(-halfW + 2, 0);
        ctx.closePath();
        ctx.fill();

        // Floor grid pattern
        ctx.strokeStyle = this._lighten(style.wallColor, 25);
        ctx.lineWidth = 0.5;
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(i * (halfW / 3), -halfH + Math.abs(i) * (halfH / 3));
            ctx.lineTo(i * (halfW / 3), halfH - Math.abs(i) * (halfH / 3));
            ctx.stroke();
        }

        // Building-specific interior furniture
        switch (building.type) {
            case 'command':
                // Central table
                ctx.fillStyle = '#6b4a2a';
                ctx.fillRect(-10, -4, 20, 8);
                // Monitors
                ctx.fillStyle = '#1a3a5a';
                ctx.fillRect(-7, -3, 6, 5);
                ctx.fillRect(1, -3, 6, 5);
                // Screen glow
                ctx.fillStyle = 'rgba(74, 158, 255, 0.6)';
                ctx.fillRect(-6, -2, 4, 3);
                ctx.fillRect(2, -2, 4, 3);
                break;
            case 'forge':
                // Furnace
                ctx.fillStyle = '#5a3a2a';
                ctx.fillRect(-8, -6, 8, 8);
                ctx.fillStyle = '#ff4400';
                ctx.fillRect(-7, -4, 6, 4);
                // Workbench
                ctx.fillStyle = '#7a5a3a';
                ctx.fillRect(2, -3, 10, 6);
                break;
            case 'mine':
                // Ore pile
                ctx.fillStyle = '#8a7a5a';
                ctx.beginPath();
                ctx.arc(-5, 0, 5, 0, Math.PI * 2);
                ctx.fill();
                // Sparkling ores
                ctx.fillStyle = '#ffd700';
                ctx.fillRect(-7, -2, 2, 2);
                ctx.fillStyle = '#00ffff';
                ctx.fillRect(-3, 1, 2, 2);
                // Rails
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(3, -halfH + 5);
                ctx.lineTo(3, halfH - 5);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(7, -halfH + 5);
                ctx.lineTo(7, halfH - 5);
                ctx.stroke();
                break;
            case 'taskboard':
                // Kanban board
                ctx.fillStyle = '#eee';
                ctx.fillRect(-10, -6, 20, 10);
                ctx.strokeStyle = '#999';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(-10, -6, 20, 10);
                // Column dividers
                ctx.beginPath();
                ctx.moveTo(-3, -6);
                ctx.lineTo(-3, 4);
                ctx.moveTo(4, -6);
                ctx.lineTo(4, 4);
                ctx.stroke();
                // Post-it notes
                ctx.fillStyle = '#ff6b6b';
                ctx.fillRect(-8, -4, 4, 3);
                ctx.fillStyle = '#ffd43b';
                ctx.fillRect(-1, -3, 4, 3);
                ctx.fillStyle = '#51cf66';
                ctx.fillRect(5, -4, 4, 3);
                break;
            case 'chathall':
                // Round table
                ctx.fillStyle = '#6b5a4a';
                ctx.beginPath();
                ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2);
                ctx.fill();
                // Chairs
                ctx.fillStyle = '#8b6a4a';
                ctx.beginPath();
                ctx.arc(-10, -2, 3, 0, Math.PI * 2);
                ctx.arc(10, -2, 3, 0, Math.PI * 2);
                ctx.arc(0, 6, 3, 0, Math.PI * 2);
                ctx.arc(0, -7, 3, 0, Math.PI * 2);
                ctx.fill();
                break;
        }
    }

    _drawTriangleRoof(ctx, halfW, halfH, style) {
        const wh = style.wallHeight;
        const ov = 5; // Eave overhang
        const peakY = -wh - halfH - 12; // Roof peak

        // Eave corners (wall top diamond + overhang)
        const left  = { x: -halfW - ov, y: -wh };
        const back  = { x: 0,           y: -halfH - wh - ov };
        const right = { x:  halfW + ov, y: -wh };
        const front = { x: 0,           y:  halfH - wh + ov };

        // 1) Back left face (darkest - behind everything, drawn first)
        ctx.fillStyle = this._lighten(style.roofColor, -15);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(back.x, back.y);
        ctx.lineTo(0, peakY);
        ctx.closePath();
        ctx.fill();

        // 2) Back right face
        ctx.fillStyle = this._lighten(style.roofColor, -5);
        ctx.beginPath();
        ctx.moveTo(back.x, back.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(0, peakY);
        ctx.closePath();
        ctx.fill();

        // 3) Front left face (visible to viewer)
        ctx.fillStyle = style.roofColor;
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(front.x, front.y);
        ctx.lineTo(0, peakY);
        ctx.closePath();
        ctx.fill();

        // 4) Front right face (brightest - most visible)
        ctx.fillStyle = this._lighten(style.roofColor, 20);
        ctx.beginPath();
        ctx.moveTo(front.x, front.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(0, peakY);
        ctx.closePath();
        ctx.fill();

        // Roof ridge line
        ctx.strokeStyle = this._lighten(style.roofColor, -25);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(0, peakY);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(front.x, front.y);
        ctx.lineTo(0, peakY);
        ctx.stroke();
    }

    _drawRoundRoof(ctx, halfW, halfH, style) {
        const wh = style.wallHeight;
        const ov = 5;

        // Roof base (wall top diamond + overhang)
        ctx.fillStyle = this._lighten(style.roofColor, -15);
        ctx.beginPath();
        ctx.moveTo(-halfW - ov, -wh);
        ctx.lineTo(0, -halfH - wh - ov);
        ctx.lineTo(halfW + ov, -wh);
        ctx.lineTo(0, halfH - wh + ov);
        ctx.closePath();
        ctx.fill();

        // Dome body
        ctx.fillStyle = style.roofColor;
        ctx.beginPath();
        ctx.ellipse(0, -wh, halfW + ov, halfH + 14, 0, Math.PI, 0);
        ctx.fill();

        // Dome highlight
        ctx.fillStyle = this._lighten(style.roofColor, 20);
        ctx.beginPath();
        ctx.ellipse(0, -wh, halfW * 0.65, halfH + 6, 0, Math.PI, 0);
        ctx.fill();
    }

    _drawFrontWindows(ctx, halfW, halfH, wh, style) {
        const glow = style.windowGlow ? 'rgba(255, 200, 50, 0.7)' : 'rgba(100, 150, 200, 0.5)';
        ctx.fillStyle = glow;
        // Front wall left window
        const lx = -halfW / 2;
        const ly = -wh / 2;
        ctx.fillRect(lx - 3, ly - 2, 5, 5);
        // Front wall right window
        const rx = halfW / 2;
        ctx.fillRect(rx - 3, ly - 2, 5, 5);
        // Door (front wall bottom center)
        ctx.fillStyle = this._lighten(style.wallColor, -20);
        ctx.fillRect(-3, halfH - wh / 3 - 2, 6, wh / 3);
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(1, halfH - wh / 5, 1.5, 1.5); // Door handle
    }

    _drawWindows(ctx, halfW, style) {
        const windowY = -style.wallHeight / 2 - 2;
        // Left wall windows
        ctx.fillStyle = style.windowGlow ? 'rgba(255, 200, 50, 0.7)' : 'rgba(100, 150, 200, 0.5)';
        ctx.fillRect(-halfW + 6, windowY - 4, 5, 6);
        ctx.fillRect(-halfW + 16, windowY - 4, 5, 6);
        // Right wall windows
        ctx.fillRect(halfW - 11, windowY - 4, 5, 6);
        if (style.windowGlow) {
            ctx.fillStyle = 'rgba(255, 200, 50, 0.15)';
            ctx.beginPath();
            ctx.arc(-halfW + 8, windowY, 8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _drawDecorations(ctx, building, halfW, halfH, style) {
        switch (building.type) {
            case 'command':
                // Antenna
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(0, -style.wallHeight - halfH - 12);
                ctx.lineTo(0, -style.wallHeight - halfH - 28);
                ctx.stroke();
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(0, -style.wallHeight - halfH - 28, 2, 0, Math.PI * 2);
                ctx.fill();
                // Flag
                ctx.fillStyle = style.accentColor;
                ctx.beginPath();
                ctx.moveTo(halfW + 8, -style.wallHeight - 5);
                ctx.lineTo(halfW + 8, -style.wallHeight - 20);
                ctx.lineTo(halfW + 18, -style.wallHeight - 15);
                ctx.lineTo(halfW + 8, -style.wallHeight - 10);
                ctx.fill();
                break;
            case 'forge':
                // Chimney
                ctx.fillStyle = '#4a4a4a';
                ctx.fillRect(12, -style.wallHeight - halfH - 20, 8, 18);
                ctx.fillStyle = '#555';
                ctx.fillRect(10, -style.wallHeight - halfH - 22, 12, 3);
                // Anvil
                ctx.fillStyle = '#555';
                ctx.fillRect(-8, -2, 10, 4);
                ctx.fillRect(-10, -4, 14, 2);
                break;
            case 'mine':
                // Mine entrance
                ctx.fillStyle = '#2a2015';
                ctx.beginPath();
                ctx.arc(0, 0, 10, Math.PI, 0);
                ctx.fill();
                ctx.fillStyle = '#1a1005';
                ctx.fillRect(-8, -3, 16, 5);
                // Pickaxe
                ctx.strokeStyle = '#8b4513';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(halfW - 5, -8);
                ctx.lineTo(halfW + 5, -18);
                ctx.stroke();
                ctx.fillStyle = '#888';
                ctx.beginPath();
                ctx.moveTo(halfW + 3, -18);
                ctx.lineTo(halfW + 8, -20);
                ctx.lineTo(halfW + 7, -16);
                ctx.closePath();
                ctx.fill();
                // Gem sparkles
                if (Math.sin(this.torchFrame * 3) > 0.5) {
                    ctx.fillStyle = '#00ffff';
                    ctx.fillRect(-6, -1, 2, 2);
                    ctx.fillStyle = '#ff00ff';
                    ctx.fillRect(3, -2, 2, 2);
                }
                break;
            case 'taskboard': {
                // Post-it notes
                const postItColors = ['#ff6b6b', '#4a9eff', '#51cf66', '#ffd43b', '#cc5de8'];
                for (let i = 0; i < 5; i++) {
                    ctx.fillStyle = postItColors[i];
                    const px = -12 + (i % 3) * 9;
                    const py = -style.wallHeight / 2 - 8 + Math.floor(i / 3) * 9;
                    ctx.fillRect(px, py, 7, 7);
                }
                break;
            }
            case 'chathall':
                // Speech bubble decoration
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.beginPath();
                ctx.ellipse(halfW - 5, -style.wallHeight - 8, 8, 6, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#333';
                ctx.font = '6px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('...', halfW - 5, -style.wallHeight - 6);
                break;
        }
    }

    _drawTorch(ctx, x, y) {
        // Torch pole
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(x - 1, y, 2, 10);
        // Flame
        const flicker = Math.sin(this.torchFrame * 6 + x) * 2;
        ctx.fillStyle = '#ff6b00';
        ctx.beginPath();
        ctx.ellipse(x, y - 2, 3, 5 + flicker, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.ellipse(x, y - 1, 1.5, 3 + flicker * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Glow
        ctx.fillStyle = 'rgba(255, 150, 0, 0.08)';
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
    }

    _lighten(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const clamp = v => Math.max(0, Math.min(255, v));
        const r = clamp((num >> 16) + amount);
        const g = clamp(((num >> 8) & 0xff) + amount);
        const b = clamp((num & 0xff) + amount);
        return `rgb(${r},${g},${b})`;
    }

    drawBubbles(ctx, world) {
        for (const b of this.buildings) {
            const agentsInBuilding = [];
            for (const agent of world.agents.values()) {
                if (b.containsPoint(agent.position.tileX, agent.position.tileY)) {
                    agentsInBuilding.push(agent);
                }
            }
            if (agentsInBuilding.length > 0) {
                const center = this._getBuildingCenter(b);
                const style = BUILDING_STYLES[b.type];
                if (!style) continue;
                const text = `${agentsInBuilding.length} agent${agentsInBuilding.length > 1 ? 's' : ''}`;
                ctx.save();
                ctx.font = '7px sans-serif';
                const tw = ctx.measureText(text).width + 8;
                const bx = center.x;
                const by = center.y - style.wallHeight - 30;
                ctx.fillStyle = 'rgba(74, 158, 255, 0.85)';
                ctx.beginPath();
                ctx.moveTo(bx - tw / 2, by - 6);
                ctx.lineTo(bx + tw / 2, by - 6);
                ctx.quadraticCurveTo(bx + tw / 2 + 3, by - 6, bx + tw / 2 + 3, by - 3);
                ctx.lineTo(bx + tw / 2 + 3, by + 3);
                ctx.quadraticCurveTo(bx + tw / 2 + 3, by + 6, bx + tw / 2, by + 6);
                ctx.lineTo(bx + 3, by + 6);
                ctx.lineTo(bx, by + 10);
                ctx.lineTo(bx - 3, by + 6);
                ctx.lineTo(bx - tw / 2, by + 6);
                ctx.quadraticCurveTo(bx - tw / 2 - 3, by + 6, bx - tw / 2 - 3, by + 3);
                ctx.lineTo(bx - tw / 2 - 3, by - 3);
                ctx.quadraticCurveTo(bx - tw / 2 - 3, by - 6, bx - tw / 2, by - 6);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, bx, by);
                ctx.restore();
            }
        }
    }

    hitTest(screenX, screenY) {
        for (const b of this.buildings) {
            const center = this._getBuildingCenter(b);
            const style = BUILDING_STYLES[b.type];
            if (!style) continue;
            const halfW = b.width * TILE_WIDTH / 4;
            if (Math.abs(screenX - center.x) < halfW && screenY > center.y - style.wallHeight - 20 && screenY < center.y + 10) {
                return b;
            }
        }
        return null;
    }
}
