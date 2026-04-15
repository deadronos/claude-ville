/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStatus } from '../../domain/value-objects/AgentStatus.js';
import { AgentSprite } from './AgentSprite.js';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Alice',
    status: AgentStatus.WORKING,
    targetBuildingType: 'command',
    currentTool: null,
    currentToolInput: null,
    bubbleText: 'Working hard',
    appearance: {
      shirt: '#336699',
      pants: '#224466',
      skin: '#f1c27d',
      hair: '#222222',
      hairStyle: 'short',
      eyeStyle: 'normal',
      accessory: 'crown',
    },
    position: {
      toScreen: () => ({ x: 10, y: 20 }),
    },
    ...overrides,
  };
}

function makeContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentSprite', () => {
  it('picks targets, moves toward chat partners, and starts or ends chats', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const particleSystem = { spawn: vi.fn() };
    const sprite = new AgentSprite(makeAgent());
    const partner = new AgentSprite(makeAgent({
      id: 'agent-2',
      name: 'Bob',
      position: { toScreen: () => ({ x: 40, y: 20 }) },
    }));

    expect(sprite.moving).toBe(true);
    expect(sprite.targetX).not.toBe(sprite.x);
    expect(sprite.targetY).not.toBe(sprite.y);

    sprite.startChat(partner);
    expect(sprite.chatPartner).toBe(partner);
    expect(sprite.chatting).toBe(false);

    sprite.x = 18;
    sprite.y = 20;
    partner.x = 40;
    partner.y = 20;
    sprite.update(particleSystem as any);
    expect(sprite.chatting).toBe(true);
    expect(sprite.moving).toBe(false);
    expect(partner.chatting).toBe(true);
    expect(partner.chatPartner).toBe(sprite);

    sprite.endChat();
    expect(sprite.chatPartner).toBeNull();
    expect(sprite.chatting).toBe(false);

    sprite.moving = true;
    sprite.x = 0;
    sprite.y = 0;
    sprite.targetX = 30;
    sprite.targetY = 0;
    sprite.update(particleSystem as any);
    expect(sprite.x).toBeGreaterThan(0);
    expect(sprite.walkFrame).toBeGreaterThan(0);
    expect(particleSystem.spawn).toHaveBeenCalledWith('footstep', expect.any(Number), expect.any(Number), 1);
  });

  it('re-picks targets when waiting expires and stops when it reaches its destination', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const sprite = new AgentSprite(makeAgent({ status: AgentStatus.IDLE, targetBuildingType: null }));
    const pickTargetSpy = vi.spyOn(sprite, '_pickTarget');

    sprite.waitTimer = 1;
    sprite.update(null);
    expect(pickTargetSpy).toHaveBeenCalled();

    sprite.waitTimer = 0;
    sprite.moving = true;
    sprite.targetX = sprite.x + 1;
    sprite.targetY = sprite.y + 1;
    sprite.update(null);
    expect(sprite.moving).toBe(false);
    expect(sprite.waitTimer).toBeGreaterThan(0);

    sprite.waitTimer = 0;
    sprite.moving = false;
    sprite.update(null);
    expect(pickTargetSpy).toHaveBeenCalledTimes(2);
  });

  it('draws appearance variants, status bubbles, chat effects, and name tags', () => {
    const sprite = new AgentSprite(makeAgent());
    const ctx = makeContext();

    sprite._drawHair(ctx, { hair: '#111', hairStyle: 'short' });
    sprite._drawHair(ctx, { hair: '#111', hairStyle: 'long' });
    sprite._drawHair(ctx, { hair: '#111', hairStyle: 'spiky' });
    sprite._drawHair(ctx, { hair: '#111', hairStyle: 'mohawk' });
    sprite._drawHair(ctx, { hair: '#111', hairStyle: 'bald' });

    sprite._drawEyes(ctx, { eyeStyle: 'normal' });
    sprite._drawEyes(ctx, { eyeStyle: 'happy' });
    sprite._drawEyes(ctx, { eyeStyle: 'determined' });
    sprite._drawEyes(ctx, { eyeStyle: 'sleepy' });

    sprite._drawAccessory(ctx, { accessory: 'crown' });
    sprite._drawAccessory(ctx, { accessory: 'glasses' });
    sprite._drawAccessory(ctx, { accessory: 'headphones' });
    sprite._drawAccessory(ctx, { accessory: 'hat' });

    sprite._zoom = 2;
    sprite.agent.status = AgentStatus.WORKING;
    sprite.agent.bubbleText = 'This status message is intentionally a bit too wide for the bubble';
    sprite._drawStatus(ctx);

    sprite.agent.status = AgentStatus.IDLE;
    sprite._drawStatus(ctx);

    sprite.agent.status = AgentStatus.WAITING;
    sprite.agent.bubbleText = '';
    sprite._drawStatus(ctx);

    sprite.chatting = true;
    sprite.chatBubbleAnim = 2;
    sprite._drawChatEffect(ctx);
    sprite._drawNameTag(ctx);
    expect(ctx.fillText).toHaveBeenCalled();

    const statusSpy = vi.spyOn(sprite, '_drawStatus');
    const chatSpy = vi.spyOn(sprite, '_drawChatEffect');
    const nameSpy = vi.spyOn(sprite, '_drawNameTag');
    sprite.selected = true;
    sprite.chatting = false;
    sprite.draw(ctx, 1.5);
    expect(statusSpy).toHaveBeenCalled();
    expect(nameSpy).toHaveBeenCalled();

    sprite.chatting = true;
    sprite.draw(ctx, 1);
    expect(chatSpy).toHaveBeenCalled();
    expect(sprite.hitTest(sprite.x, sprite.y)).toBe(true);
    expect(sprite.hitTest(sprite.x + 50, sprite.y + 50)).toBe(false);
  });
});
