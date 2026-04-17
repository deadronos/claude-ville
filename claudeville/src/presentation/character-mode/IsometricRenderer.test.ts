/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TILE_HEIGHT, TILE_WIDTH } from '../../config/constants.js';

const rendererState = vi.hoisted(() => ({
  eventHandlers: new Map<string, Function[]>(),
  unsubscribers: [] as Array<ReturnType<typeof vi.fn>>,
  cameraInstances: [] as any[],
  particleInstances: [] as any[],
  buildingRendererInstances: [] as any[],
  minimapInstances: [] as any[],
  agentSpriteInstances: [] as any[],
}));

vi.mock('../../domain/events/DomainEvent.js', () => ({
  eventBus: {
    on: vi.fn((event: string, handler: Function) => {
      const handlers = rendererState.eventHandlers.get(event) ?? [];
      handlers.push(handler);
      rendererState.eventHandlers.set(event, handlers);
      const unsubscribe = vi.fn();
      rendererState.unsubscribers.push(unsubscribe);
      return unsubscribe;
    }),
  },
}));

vi.mock('./Camera.js', () => ({
  Camera: class MockCamera {
    canvas: HTMLCanvasElement;
    x = 0;
    y = 0;
    zoom = 1.2;
    followTarget: any = null;
    attach = vi.fn();
    detach = vi.fn();
    followAgent = vi.fn((sprite: any) => {
      this.followTarget = sprite;
    });
    stopFollow = vi.fn(() => {
      this.followTarget = null;
    });
    updateFollow = vi.fn();
    screenToWorld = vi.fn((screenX: number, screenY: number) => ({ x: screenX, y: screenY }));
    screenToTile = vi.fn((screenX: number, screenY: number) => ({ tileX: Math.floor(screenX / 200), tileY: Math.floor(screenY / 200) }));
    applyTransform = vi.fn();

    constructor(canvas: HTMLCanvasElement) {
      this.canvas = canvas;
      rendererState.cameraInstances.push(this);
    }
  },
}));

vi.mock('./ParticleSystem.js', () => ({
  ParticleSystem: class MockParticleSystem {
    update = vi.fn();
    draw = vi.fn();
    clear = vi.fn();
    spawn = vi.fn();

    constructor() {
      rendererState.particleInstances.push(this);
    }
  },
}));

vi.mock('./BuildingRenderer.js', () => ({
  BuildingRenderer: class MockBuildingRenderer {
    particleSystem: any;
    hoveredBuilding: any = null;
    setBuildings = vi.fn();
    setAgentSprites = vi.fn();
    update = vi.fn();
    drawShadows = vi.fn();
    draw = vi.fn();
    drawBubbles = vi.fn();
    hitTest = vi.fn(() => null);

    constructor(particleSystem: any) {
      this.particleSystem = particleSystem;
      rendererState.buildingRendererInstances.push(this);
    }
  },
}));

vi.mock('./Minimap.js', () => ({
  Minimap: class MockMinimap {
    onNavigate: ((tileX: number, tileY: number) => void) | null = null;
    attach = vi.fn();
    detach = vi.fn();
    draw = vi.fn();

    constructor() {
      rendererState.minimapInstances.push(this);
    }
  },
}));

vi.mock('./AgentSprite.js', () => ({
  AgentSprite: class MockAgentSprite {
    agent: any;
    x: number;
    y: number;
    selected = false;
    chatPartner: any = null;
    startChat = vi.fn((partner: any) => {
      this.chatPartner = partner;
    });
    endChat = vi.fn(() => {
      this.chatPartner = null;
    });
    update = vi.fn();
    draw = vi.fn();
    hitTest = vi.fn(() => false);

    constructor(agent: any) {
      this.agent = agent;
      this.x = agent.position.tileX * 10;
      this.y = agent.position.tileY * 10;
      rendererState.agentSpriteInstances.push(this);
    }
  },
}));

import { IsometricRenderer } from './IsometricRenderer.js';

function resetRendererState() {
  rendererState.eventHandlers.clear();
  rendererState.unsubscribers = [];
  rendererState.cameraInstances = [];
  rendererState.particleInstances = [];
  rendererState.buildingRendererInstances = [];
  rendererState.minimapInstances = [];
  rendererState.agentSpriteInstances = [];
}

function makeWorld() {
  return {
    buildings: new Map([
      ['command', { type: 'command', position: { tileX: 10, tileY: 10 }, width: 2, height: 2 }],
      ['forge', { type: 'forge', position: { tileX: 16, tileY: 14 }, width: 3, height: 1 }],
    ]),
    agents: new Map([
      ['agent-1', { id: 'agent-1', name: 'Alice', position: { tileX: 5, tileY: 6 }, currentTool: null, currentToolInput: null }],
      ['agent-2', { id: 'agent-2', name: 'Bob', position: { tileX: 9, tileY: 7 }, currentTool: null, currentToolInput: null }],
    ]),
  };
}

function makeCanvas() {
  const parentNode = document.createElement('div');
  const ctx = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

  return {
    canvas: {
      width: 400,
      height: 300,
      parentNode,
      getContext: vi.fn(() => ctx),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ left: 10, top: 20 })),
    } as unknown as HTMLCanvasElement & {
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
      getBoundingClientRect: ReturnType<typeof vi.fn>;
      getContext: ReturnType<typeof vi.fn>;
      parentNode: HTMLDivElement;
    },
    ctx,
  };
}

beforeEach(() => {
  resetRendererState();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 99);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IsometricRenderer', () => {
  it('shows the renderer, wires events, handles selection, and tears everything down', () => {
    const world = makeWorld();
    const { canvas } = makeCanvas();
    const renderer = new IsometricRenderer(world as any);
    const onAgentSelect = vi.fn();
    renderer.onAgentSelect = onAgentSelect;

    expect(renderer.pathTiles.has('9,9')).toBe(true);
    expect(renderer.pathTiles.has('17,14')).toBe(true);
    expect(renderer.waterTiles.has('5,32')).toBe(true);

    renderer.show(canvas);

    const camera = rendererState.cameraInstances[0];
    const minimap = rendererState.minimapInstances[0];
    const buildingRenderer = rendererState.buildingRendererInstances[0];
    const sprites = rendererState.agentSpriteInstances;

    expect(camera.attach).toHaveBeenCalled();
    expect(buildingRenderer.setBuildings).toHaveBeenCalledWith(world.buildings);
    expect(minimap.attach).toHaveBeenCalledWith(canvas.parentNode);
    expect(renderer.agentSprites.size).toBe(2);
    expect(window.requestAnimationFrame).toHaveBeenCalled();

    minimap.onNavigate?.(2, 3);
    expect(camera.x).toBeCloseTo(-((2 - 3) * TILE_WIDTH / 2) + canvas.width / (2 * camera.zoom), 5);
    expect(camera.y).toBeCloseTo(-((2 + 3) * TILE_HEIGHT / 2) + canvas.height / (2 * camera.zoom), 5);

    const clickHandler = canvas.addEventListener.mock.calls.find(([eventName]) => eventName === 'click')?.[1];
    const hoverHandler = canvas.addEventListener.mock.calls.find(([eventName]) => eventName === 'mousemove')?.[1];
    sprites[0].hitTest.mockReturnValue(true);
    clickHandler?.({ clientX: 30, clientY: 40 });
    expect(renderer.selectedAgent).toBe(sprites[0].agent);
    expect(sprites[0].selected).toBe(true);
    expect(camera.followAgent).toHaveBeenCalledWith(sprites[0]);
    expect(onAgentSelect).toHaveBeenCalledWith(sprites[0].agent);

    sprites[0].hitTest.mockReturnValue(false);
    renderer._handleClick(0, 0);
    expect(renderer.selectedAgent).toBeNull();
    expect(camera.stopFollow).toHaveBeenCalled();
    expect(onAgentSelect).toHaveBeenLastCalledWith(null);

    buildingRenderer.hitTest.mockReturnValue(world.buildings.get('command'));
    hoverHandler?.({ clientX: 40, clientY: 60 });
    expect(buildingRenderer.hoveredBuilding).toBe(world.buildings.get('command'));

    rendererState.eventHandlers.get('agent:selected')?.[0]?.({ id: 'agent-2' });
    expect(sprites[1].selected).toBe(true);
    expect(camera.followAgent).toHaveBeenCalledWith(sprites[1]);

    renderer.hide();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(99);
    expect(camera.detach).toHaveBeenCalled();
    expect(minimap.detach).toHaveBeenCalled();
    expect(canvas.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    expect(canvas.removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(rendererState.particleInstances[0].clear).toHaveBeenCalled();
    expect(rendererState.unsubscribers.slice(-3).every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('matches chat partners, updates collaborators, and renders terrain plus overlays', () => {
    const world = makeWorld();
    const { canvas, ctx } = makeCanvas();
    const renderer = new IsometricRenderer(world as any);
    renderer.show(canvas);

    const camera = rendererState.cameraInstances[0];
    const particleSystem = rendererState.particleInstances[0];
    const buildingRenderer = rendererState.buildingRendererInstances[0];
    const minimap = rendererState.minimapInstances[0];
    const [aliceSprite, bobSprite] = rendererState.agentSpriteInstances;

    aliceSprite.agent.currentTool = 'SendMessage';
    aliceSprite.agent.currentToolInput = 'Bob';
    bobSprite.agent.currentTool = null;
    bobSprite.agent.currentToolInput = null;

    renderer._update();
    expect(camera.updateFollow).toHaveBeenCalled();
    expect(aliceSprite.startChat).toHaveBeenCalledWith(bobSprite);
    expect(aliceSprite.update).toHaveBeenCalledWith(particleSystem);
    expect(bobSprite.update).toHaveBeenCalledWith(particleSystem);
    expect(buildingRenderer.setAgentSprites).toHaveBeenCalledWith(Array.from(renderer.agentSprites.values()));
    expect(buildingRenderer.update).toHaveBeenCalled();
    expect(particleSystem.update).toHaveBeenCalled();

    aliceSprite.chatPartner = bobSprite;
    aliceSprite.agent.currentTool = null;
    renderer._updateChatMatching();
    expect(aliceSprite.endChat).toHaveBeenCalled();

    camera.screenToTile
      .mockReturnValueOnce({ tileX: 0, tileY: 0 })
      .mockReturnValueOnce({ tileX: 1, tileY: 0 })
      .mockReturnValueOnce({ tileX: 0, tileY: 1 })
      .mockReturnValueOnce({ tileX: 1, tileY: 1 });

    renderer.waterTiles.add('0,0');
    renderer.pathTiles.add('1,0');
    renderer._render();

    expect(ctx.setTransform).toHaveBeenNthCalledWith(1, 1, 0, 0, 1, 0, 0);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(camera.applyTransform).toHaveBeenCalledWith(ctx);
    expect(buildingRenderer.drawShadows).toHaveBeenCalledWith(ctx);
    expect(buildingRenderer.draw).toHaveBeenCalledWith(ctx);
    expect(particleSystem.draw).toHaveBeenCalledWith(ctx);
    expect(buildingRenderer.drawBubbles).toHaveBeenCalledWith(ctx, world);
    expect(minimap.draw).toHaveBeenCalledWith(world, camera, canvas);
    expect(aliceSprite.draw).toHaveBeenCalled();
    expect(bobSprite.draw).toHaveBeenCalled();
  });
});
