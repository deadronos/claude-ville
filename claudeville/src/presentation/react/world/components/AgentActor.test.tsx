/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';

import type { BubbleConfig } from '../types.js';
import { Accessory, Bubble, Hair, NameTag } from './AgentActor.js';
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
        x: 0,
        y: 0,
        zoom: 1,
        minZoom: 0.5,
        maxZoom: 4,
        viewportWidth: 100,
        viewportHeight: 100,
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
});
