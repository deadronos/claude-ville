/**
 * The simulation half of the sprite model: state, movement, chat pairing and hit
 * testing. The rendering half lives in `./agentSpriteRender.js`; the draw methods
 * below are one-line wrappers that forward to it, so they stay spy-able.
 */
import { Agent } from '../../domain/entities/Agent.js';
import { Position } from '../../domain/value-objects/Position.js';
import { AgentStatus } from '../../domain/value-objects/AgentStatus.js';
import { TILE_WIDTH, TILE_HEIGHT } from '../../config/constants.js';
import { BUILDING_DEFS } from '../../config/buildings.js';
import {
    drawSprite,
    drawHair,
    drawEyes,
    drawAccessory,
    drawStatus,
    drawBubble,
    bubblePath,
    drawChatEffect,
    drawNameTag,
} from './agentSpriteRender.js';

export class AgentSprite {
    agent: Agent;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    moving: boolean;
    facingLeft: boolean;
    walkFrame: number;
    waitTimer: number;
    selected: boolean;
    statusAnim: number;
    _lastBuildingType: string | null;
    chatPartner: AgentSprite | null;
    chatting: boolean;
    chatTimer: number;
    chatBubbleAnim: number;
    _zoom!: number;

    constructor(agent: Agent) {
        this.agent = agent;
        this.x = 0;
        this.y = 0;
        this.targetX = 0;
        this.targetY = 0;
        this.moving = false;
        this.facingLeft = false;
        this.walkFrame = 0;
        this.waitTimer = 0;
        this.selected = false;
        this.statusAnim = 0;
        this._lastBuildingType = null;

        this.chatPartner = null;
        this.chatting = false;
        this.chatTimer = 0;
        this.chatBubbleAnim = 0;

        const screen = agent.position.toScreen(TILE_WIDTH, TILE_HEIGHT);
        this.x = screen.x;
        this.y = screen.y;

        this._pickTarget();
    }

    _pickTarget() {
        if (this.chatPartner) {
            this.targetX = this.chatPartner.x + (this.x < this.chatPartner.x ? -25 : 25);
            this.targetY = this.chatPartner.y;
            this.moving = true;
            this.waitTimer = 0;
            return;
        }

        const isWorking = this.agent.status === AgentStatus.WORKING;
        const buildingType = isWorking ? (this.agent as any).targetBuildingType : null;
        let building = null;

        if (buildingType) {
            building = BUILDING_DEFS.find(b => b.type === buildingType);
        }

        if (!building) {
            if (Math.random() < 0.7) {
                building = BUILDING_DEFS[Math.floor(Math.random() * BUILDING_DEFS.length)];
            } else {
                const tx = 10 + Math.random() * 20;
                const ty = 10 + Math.random() * 20;
                const target = new Position(tx, ty);
                const screen = target.toScreen(TILE_WIDTH, TILE_HEIGHT);
                this.targetX = screen.x;
                this.targetY = screen.y;
                this.moving = true;
                this.waitTimer = 0;
                return;
            }
        }

        const tx = building.x + 0.3 * building.width + Math.random() * 0.4 * building.width;
        const ty = building.y + 0.3 * building.height + Math.random() * 0.4 * building.height;
        const target = new Position(tx, ty);
        const screen = target.toScreen(TILE_WIDTH, TILE_HEIGHT);
        this.targetX = screen.x;
        this.targetY = screen.y;
        this.moving = true;
        this.waitTimer = 0;
    }

    update(particleSystem: { spawn(type: string, x: number, y: number, count?: number): void } | null) {
        this.statusAnim += 0.05;

        if (this.chatting) {
            this.chatBubbleAnim += 0.06;
            if (this.chatPartner) {
                this.facingLeft = this.chatPartner.x < this.x;
            }
            return;
        }

        if (this.chatPartner) {
            const cpDx = this.chatPartner.x - this.x;
            const cpDy = this.chatPartner.y - this.y;
            const cpDist = Math.sqrt(cpDx * cpDx + cpDy * cpDy);
            if (cpDist < 35) {
                this.chatting = true;
                this.chatBubbleAnim = 0;
                this.moving = false;
                this.walkFrame = 0;
                this.facingLeft = cpDx < 0;
                if (!this.chatPartner.chatting) {
                    this.chatPartner.chatPartner = this;
                    this.chatPartner.chatting = true;
                    this.chatPartner.chatBubbleAnim = 0;
                    this.chatPartner.moving = false;
                    this.chatPartner.walkFrame = 0;
                    this.chatPartner.facingLeft = cpDx > 0;
                }
                return;
            }
            this.targetX = this.chatPartner.x + (this.x < this.chatPartner.x ? -25 : 25);
            this.targetY = this.chatPartner.y;
        }

        if (this.agent.status === AgentStatus.WORKING && !this.chatPartner) {
            const curBuilding = (this.agent as any).targetBuildingType;
            if (curBuilding && curBuilding !== this._lastBuildingType) {
                this._lastBuildingType = curBuilding;
                this._pickTarget();
            }
        } else if (!this.chatPartner) {
            this._lastBuildingType = null;
        }

        if (this.waitTimer > 0) {
            this.waitTimer--;
            if (this.waitTimer <= 0) {
                this._pickTarget();
            }
            return;
        }

        if (!this.moving) {
            this._pickTarget();
            return;
        }

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 2) {
            this.moving = false;
            this.waitTimer = this.chatPartner ? 10 : 60 + Math.floor(Math.random() * 180);
            this.walkFrame = 0;
            return;
        }

        const speed = this.chatPartner ? 2.5 : 1.5;
        this.x += (dx / dist) * speed;
        this.y += (dy / dist) * speed;
        this.walkFrame += 0.15;
        this.facingLeft = dx < 0;

        if (particleSystem && Math.random() < 0.3) {
            particleSystem.spawn('footstep', this.x, this.y + 16, 1);
        }
    }

    startChat(partnerSprite: AgentSprite) {
        this.chatPartner = partnerSprite;
        this.chatting = false;
        this.chatBubbleAnim = 0;
        this._pickTarget();
    }

    endChat() {
        this.chatPartner = null;
        this.chatting = false;
        this.chatBubbleAnim = 0;
        this._pickTarget();
    }

    draw(ctx: CanvasRenderingContext2D, zoom = 1) {
        drawSprite(ctx, this, zoom);
    }

    _drawHair(ctx: CanvasRenderingContext2D, app: { hairStyle: string; hair: string }) {
        drawHair(ctx, this, app);
    }

    _drawEyes(ctx: CanvasRenderingContext2D, app: { eyeStyle: string }) {
        drawEyes(ctx, this, app);
    }

    _drawAccessory(ctx: CanvasRenderingContext2D, app: { accessory: string }) {
        drawAccessory(ctx, this, app);
    }

    _drawStatus(ctx: CanvasRenderingContext2D) {
        drawStatus(ctx, this);
    }

    _drawBubble(ctx: CanvasRenderingContext2D, text: string, accentColor: string) {
        drawBubble(ctx, this, text, accentColor);
    }

    _bubblePath(ctx: CanvasRenderingContext2D, width: number) {
        bubblePath(ctx, width);
    }

    _drawChatEffect(ctx: CanvasRenderingContext2D) {
        drawChatEffect(ctx, this);
    }

    _drawNameTag(ctx: CanvasRenderingContext2D) {
        drawNameTag(ctx, this);
    }

    hitTest(screenX: number, screenY: number) {
        const dx = screenX - this.x;
        const dy = screenY - this.y;
        return Math.abs(dx) < 12 && dy > -20 && dy < 20;
    }
}