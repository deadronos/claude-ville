/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';

import type { BubbleConfig } from '../types.js';
import { AgentActor, Accessory, Bubble, Hair, NameTag } from './AgentActor.js';
import { AgentStatus } from '../../../../domain/value-objects/AgentStatus.js';
import { useInverseZoom } from '../hooks/useInverseZoom.js';
import { createPolygonGeometry, createRoundedRectGeometry } from '../utils.js';

const frameCallbacks = vi.hoisted(() => ({
  current: [] as Array<() => void>,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: () => void) => {
    frameCallbacks.current.push(callback);
  },
}));

vi.mock('../utils.js', () => ({
  createPolygonGeometry: vi.fn(() => ({ type: 'polygon-geometry' })),
  createRoundedRectGeometry: vi.fn(() => ({ type: 'rounded-rect-geometry' })),
}));

vi.mock('./WorldText.js', () => ({
  WorldText: ({ children }: { children: string }) => <span>{children}</span>,
}));

const bubbleConfig: BubbleConfig = {
  textScale: 1,
  statusFontSize: 14,
  statusMaxWidth: 260,
  statusBubbleH: 28,
  statusPaddingH: 24,
  chatFontSize: 14,
};

const interactionRef = {
  current: {
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    camStartX: 0,
    camStartZ: 0,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  frameCallbacks.current = [];
});

describe('AgentActor geometry creation', () => {
  it('reuses bubble geometry while dimensions are stable', () => {
    const { rerender } = render(<Bubble text="working" accentColor="#4ade80" bubbleConfig={bubbleConfig} inverseZoom={1} />);

    rerender(<Bubble text="working" accentColor="#4ade80" bubbleConfig={bubbleConfig} inverseZoom={1} />);

    expect(createRoundedRectGeometry).toHaveBeenCalledTimes(1);
  });

  it('reuses nametag and accessory polygon geometries while props are stable', () => {
    const { rerender } = render(
      <>
        <NameTag name="Agent One" inverseZoom={1} />
        <Hair style="spiky" color="#222222" />
        <Accessory type="crown" />
      </>,
    );

    rerender(
      <>
        <NameTag name="Agent One" inverseZoom={1} />
        <Hair style="spiky" color="#222222" />
        <Accessory type="crown" />
      </>,
    );

    expect(createRoundedRectGeometry).toHaveBeenCalledTimes(1);
    expect(createPolygonGeometry).toHaveBeenCalledTimes(2);
  });

  it('updates inverse zoom from the camera during frame updates', () => {
    const cameraRef = {
      current: {
        targetX: 0,
        targetZ: 0,
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 4,
        followAgentId: null,
        followSmoothing: 0,
      },
    };
    const { result } = renderHook(() => useInverseZoom(cameraRef));
    expect(result.current).toBe(1);

    act(() => {
      cameraRef.current.zoom = 2;
      frameCallbacks.current.forEach((callback) => callback());
    });

    expect(result.current).toBe(0.5);
  });

  it('keeps speech and name text mounted while the UI visibility toggles', () => {
    const entity = {
      x: 12,
      y: 18,
      moving: false,
      walkFrame: 0,
      facingLeft: false,
      chatting: false,
      id: 'agent-1',
      name: 'Agent One',
      status: AgentStatus.WAITING,
      bubbleText: null,
      appearance: {
        pants: '#111111',
        shirt: '#222222',
        skin: '#f5d0a0',
        hairStyle: 'bald',
        hair: '#333333',
        eyeStyle: 'default',
        accessory: 'none',
      },
    } as any;

    const cameraRef = {
      current: {
        x: 0,
        y: 0,
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 4,
        followAgentId: null,
        followSmoothing: 0,
      },
    };

    const { rerender } = render(
      <AgentActor
        entity={entity}
        selected={false}
        showUi={false}
        cameraRef={cameraRef as any}
        bubbleConfig={bubbleConfig}
        onSelect={() => {}}
        interactionRef={interactionRef}
      />,
    );

    expect(createRoundedRectGeometry).toHaveBeenCalled();
    expect(document.body.textContent).toContain('...');
    expect(document.body.textContent).toContain('Agent One');

    rerender(
      <AgentActor
        entity={entity}
        selected={false}
        showUi={true}
        cameraRef={cameraRef as any}
        bubbleConfig={bubbleConfig}
        onSelect={() => {}}
        interactionRef={interactionRef}
      />,
    );

    expect(document.body.textContent).toContain('...');
    expect(document.body.textContent).toContain('Agent One');
  });

  it('does not select the agent after the pointer moved during a drag', () => {
    const onSelect = vi.fn();
    const movedInteractionRef = {
      current: {
        ...interactionRef.current,
        moved: true,
      },
    };
    const entity = {
      x: 12,
      y: 18,
      moving: false,
      walkFrame: 0,
      facingLeft: false,
      chatting: false,
      id: 'agent-1',
      name: 'Agent One',
      status: AgentStatus.IDLE,
      bubbleText: null,
      appearance: {
        pants: '#111111',
        shirt: '#222222',
        skin: '#f5d0a0',
        hairStyle: 'bald',
        hair: '#333333',
        eyeStyle: 'default',
        accessory: 'none',
      },
    } as any;
    const cameraRef = {
      current: {
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 4,
        followAgentId: null,
        followSmoothing: 0,
      },
    };

    const { container } = render(
      <AgentActor
        entity={entity}
        selected={false}
        showUi={true}
        cameraRef={cameraRef as any}
        bubbleConfig={bubbleConfig}
        onSelect={onSelect}
        interactionRef={movedInteractionRef}
      />,
    );

    container.querySelector('group')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
