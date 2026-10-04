/**
 * The rendering half of `AgentSprite`, split out for file size. The sprite is typed
 * structurally, not imported, so the dependency is one-way; the `_draw*` members of
 * that type are called on the instance so the spies in `AgentSprite.test.ts` fire.
 */
import { AgentStatus, AgentStatusType } from '../../domain/value-objects/AgentStatus.js';
import { THEME } from '../../config/theme.js';
import { getBubbleConfig } from '../../config/bubbleConfig.js';

interface AgentSpriteRenderState {
    x: number;
    y: number;
    _zoom: number;
    agent: { name: string; status: AgentStatusType };
    chatting: boolean;
    walkFrame: number;
    statusAnim: number;
    selected: boolean;
    moving: boolean;
    facingLeft: boolean;
    chatBubbleAnim: number;
    _drawHair(ctx: CanvasRenderingContext2D, app: { hairStyle: string; hair: string }): void;
    _drawEyes(ctx: CanvasRenderingContext2D, app: { eyeStyle: string }): void;
    _drawAccessory(ctx: CanvasRenderingContext2D, app: { accessory: string }): void;
    _drawStatus(ctx: CanvasRenderingContext2D): void;
    _drawBubble(ctx: CanvasRenderingContext2D, text: string, accentColor: string): void;
    _bubblePath(ctx: CanvasRenderingContext2D, width: number): void;
    _drawChatEffect(ctx: CanvasRenderingContext2D): void;
    _drawNameTag(ctx: CanvasRenderingContext2D): void;
}

export function drawSprite(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState, zoom = 1) {
    sprite._zoom = zoom;

    ctx.save();
    ctx.translate(sprite.x, sprite.y);

    if (sprite.selected) {
        ctx.beginPath();
        ctx.ellipse(0, 16, 14, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    const scaleX = sprite.facingLeft ? -1 : 1;
    ctx.scale(scaleX, 1);

    const swing = sprite.moving ? Math.sin(sprite.walkFrame * 4) * 4 : 0;
    const app = (sprite.agent as any).appearance;

    ctx.strokeStyle = app.pants;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-3, 8);
    ctx.lineTo(-3 - swing, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, 8);
    ctx.lineTo(3 + swing, 16);
    ctx.stroke();

    ctx.fillStyle = app.shirt;
    ctx.fillRect(-5, -2, 10, 12);

    ctx.strokeStyle = app.skin;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-8 + swing, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(8 - swing, 8);
    ctx.stroke();

    ctx.fillStyle = app.skin;
    ctx.beginPath();
    ctx.arc(0, -6, 5, 0, Math.PI * 2);
    ctx.fill();

    sprite._drawHair(ctx, app);

    sprite._drawEyes(ctx, app);

    sprite._drawAccessory(ctx, app);

    ctx.restore();

    if (sprite.chatting) {
        sprite._drawChatEffect(ctx);
    }

    if (!sprite.chatting) {
        sprite._drawStatus(ctx);
    }
    sprite._drawNameTag(ctx);
}

export function drawHair(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState, app: { hairStyle: string; hair: string }) {
    ctx.fillStyle = app.hair;
    switch (app.hairStyle) {
        case 'short':
            ctx.beginPath();
            ctx.arc(0, -8, 5, Math.PI, 0);
            ctx.fill();
            break;
        case 'long':
            ctx.beginPath();
            ctx.arc(0, -8, 5, Math.PI, 0);
            ctx.fill();
            ctx.fillRect(-5, -8, 2, 8);
            ctx.fillRect(3, -8, 2, 8);
            break;
        case 'spiky':
            ctx.beginPath();
            ctx.moveTo(-4, -8);
            ctx.lineTo(-2, -14);
            ctx.lineTo(0, -9);
            ctx.lineTo(2, -14);
            ctx.lineTo(4, -8);
            ctx.fill();
            break;
        case 'mohawk':
            ctx.fillRect(-1, -14, 2, 6);
            break;
        case 'bald':
            break;
    }
}

export function drawEyes(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState, app: { eyeStyle: string }) {
    ctx.fillStyle = '#000';
    switch (app.eyeStyle) {
        case 'normal':
            ctx.fillRect(-3, -7, 2, 2);
            ctx.fillRect(1, -7, 2, 2);
            break;
        case 'happy':
            ctx.beginPath();
            ctx.arc(-2, -6, 1.5, 0, Math.PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(2, -6, 1.5, 0, Math.PI);
            ctx.stroke();
            break;
        case 'determined':
            ctx.fillRect(-3, -7, 2, 1.5);
            ctx.fillRect(1, -7, 2, 1.5);
            break;
        case 'sleepy':
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-3, -6);
            ctx.lineTo(-1, -6);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(1, -6);
            ctx.lineTo(3, -6);
            ctx.stroke();
            break;
    }
}

export function drawAccessory(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState, app: { accessory: string }) {
    switch (app.accessory) {
        case 'crown':
            ctx.fillStyle = '#ffd700';
            ctx.beginPath();
            ctx.moveTo(-4, -12);
            ctx.lineTo(-4, -15);
            ctx.lineTo(-2, -13);
            ctx.lineTo(0, -16);
            ctx.lineTo(2, -13);
            ctx.lineTo(4, -15);
            ctx.lineTo(4, -12);
            ctx.closePath();
            ctx.fill();
            break;
        case 'glasses':
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.rect(-4, -8, 3, 3);
            ctx.rect(1, -8, 3, 3);
            ctx.moveTo(-1, -6.5);
            ctx.lineTo(1, -6.5);
            ctx.stroke();
            break;
        case 'headphones':
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, -7, 6, Math.PI, 0);
            ctx.stroke();
            ctx.fillStyle = '#555';
            ctx.fillRect(-7, -7, 3, 4);
            ctx.fillRect(4, -7, 3, 4);
            break;
        case 'hat':
            ctx.fillStyle = '#8b4513';
            ctx.fillRect(-6, -12, 12, 2);
            ctx.fillRect(-3, -16, 6, 4);
            break;
    }
}

export function drawStatus(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState) {
    const agent = sprite.agent;
    const t = sprite.statusAnim;
    const bubble = (agent as any).bubbleText;
    const s = 1 / (sprite._zoom || 1);

    if (agent.status === AgentStatus.WORKING || (agent.status === AgentStatus.WAITING && bubble)) {
        sprite._drawBubble(ctx, bubble || '...', agent.status === AgentStatus.WORKING ? THEME.working : '#f97316');
    } else if (agent.status === AgentStatus.IDLE) {
        ctx.save();
        ctx.translate(sprite.x, sprite.y);
        ctx.scale(s, s);
        ctx.fillStyle = THEME.idle;
        ctx.textAlign = 'center';
        const offsetY = Math.sin(t * 1.5) * 4;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2);
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('z', 10, -22 + offsetY);
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('z', 16, -32 + offsetY);
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('Z', 22, -44 + offsetY);
        ctx.globalAlpha = 1;
        ctx.restore();
    } else if (agent.status === AgentStatus.WAITING) {
        ctx.save();
        ctx.translate(sprite.x, sprite.y);
        ctx.scale(s, s);
        ctx.translate(0, -36);
        ctx.fillStyle = 'rgba(26, 26, 46, 0.9)';
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 1.5;
        sprite._bubblePath(ctx, 36);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#eee';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        const dots = '.'.repeat(1 + Math.floor(t * 2) % 3);
        ctx.fillText(dots, 0, 3);
        ctx.restore();
    }
}

export function drawBubble(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState, text: string, accentColor: string) {
    ctx.save();
    const s = 1 / (sprite._zoom || 1);
    const cfg = getBubbleConfig();

    ctx.translate(sprite.x, sprite.y);
    ctx.scale(s, s);

    ctx.font = `bold ${cfg.statusFontSize}px sans-serif`;
    const maxWidth = cfg.statusMaxWidth;
    let displayText = text;
    while (displayText.length > 0 && ctx.measureText(displayText).width > maxWidth) {
        displayText = displayText.substring(0, displayText.length - 1);
    }
    if (displayText.length < text.length) {
        displayText = displayText.substring(0, displayText.length - 1) + '…';
    }
    const textWidth = ctx.measureText(displayText).width;
    const bubbleW = textWidth + cfg.statusPaddingH;
    const bubbleH = cfg.statusBubbleH;
    const radius = 6;

    ctx.translate(0, -38);

    const halfW = bubbleW / 2;
    ctx.fillStyle = 'rgba(26, 26, 46, 0.92)';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-halfW + radius, -bubbleH / 2);
    ctx.lineTo(halfW - radius, -bubbleH / 2);
    ctx.quadraticCurveTo(halfW, -bubbleH / 2, halfW, -bubbleH / 2 + radius);
    ctx.lineTo(halfW, bubbleH / 2 - radius);
    ctx.quadraticCurveTo(halfW, bubbleH / 2, halfW - radius, bubbleH / 2);
    ctx.lineTo(4, bubbleH / 2);
    ctx.lineTo(0, bubbleH / 2 + 7);
    ctx.lineTo(-4, bubbleH / 2);
    ctx.lineTo(-halfW + radius, bubbleH / 2);
    ctx.quadraticCurveTo(-halfW, bubbleH / 2, -halfW, bubbleH / 2 - radius);
    ctx.lineTo(-halfW, -bubbleH / 2 + radius);
    ctx.quadraticCurveTo(-halfW, -bubbleH / 2, -halfW + radius, -bubbleH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#eee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, 0, 0, maxWidth);

    ctx.restore();
}

export function bubblePath(ctx: CanvasRenderingContext2D, width: number) {
    const hw = width / 2;
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(-hw, -10);
    ctx.lineTo(hw, -10);
    ctx.quadraticCurveTo(hw + r, -10, hw + r, -10 + r);
    ctx.lineTo(hw + r, 4);
    ctx.quadraticCurveTo(hw + r, 8, hw, 8);
    ctx.lineTo(3, 8);
    ctx.lineTo(0, 14);
    ctx.lineTo(-3, 8);
    ctx.lineTo(-hw, 8);
    ctx.quadraticCurveTo(-hw - r, 8, -hw - r, 4);
    ctx.lineTo(-hw - r, -10 + r);
    ctx.quadraticCurveTo(-hw - r, -10, -hw, -10);
    ctx.closePath();
}

export function drawChatEffect(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState) {
    ctx.save();
    const s = 1 / (sprite._zoom || 1);
    const cfg = getBubbleConfig();
    ctx.translate(sprite.x, sprite.y);
    ctx.scale(s, s);

    const t = sprite.chatBubbleAnim;

    const phase = Math.floor(t * 1.5) % 3;
    const bubbleY = -38;

    ctx.fillStyle = 'rgba(26, 26, 46, 0.92)';
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, bubbleY, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(26, 26, 46, 0.92)';
    ctx.beginPath();
    ctx.moveTo(-3, bubbleY + 12);
    ctx.lineTo(0, bubbleY + 18);
    ctx.lineTo(3, bubbleY + 12);
    ctx.fill();

    ctx.fillStyle = '#4ade80';
    ctx.font = `bold ${cfg.chatFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const dots = ['.', '..', '...'][phase];
    ctx.fillText(dots, 0, bubbleY - 1);

    const floatY = -56 + Math.sin(t * 2) * 4;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3);
    ctx.font = `${cfg.chatFontSize + 1}px sans-serif`;
    const emojis = ['\u{1F4AC}', '\u{1F4AD}', '✨'];
    ctx.fillText(emojis[Math.floor(t) % emojis.length], 0, floatY);
    ctx.globalAlpha = 1;

    ctx.restore();
}

export function drawNameTag(ctx: CanvasRenderingContext2D, sprite: AgentSpriteRenderState) {
    ctx.save();
    const s = 1 / (sprite._zoom || 1);
    ctx.translate(sprite.x, sprite.y);
    ctx.scale(s, s);
    ctx.translate(0, 24);
    const name = sprite.agent.name;
    ctx.font = 'bold 10px sans-serif';
    const w = ctx.measureText(name).width + 10;
    ctx.fillStyle = 'rgba(232, 212, 77, 0.92)';
    const h = 16, r = 4;
    ctx.beginPath();
    ctx.moveTo(-w/2 + r, -h/2);
    ctx.lineTo(w/2 - r, -h/2);
    ctx.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
    ctx.lineTo(w/2, h/2 - r);
    ctx.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
    ctx.lineTo(-w/2 + r, h/2);
    ctx.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
    ctx.lineTo(-w/2, -h/2 + r);
    ctx.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 0, 1);
    ctx.restore();
}
