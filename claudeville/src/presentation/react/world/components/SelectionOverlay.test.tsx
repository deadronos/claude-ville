/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectionOverlay } from './SelectionOverlay.js';
import type { CameraModel, ViewportSize } from '../types.js';

const frameState = vi.hoisted(() => ({
  callbacks: [] as FrameRequestCallback[],
}));

beforeEach(() => {
  frameState.callbacks.length = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    frameState.callbacks.push(callback);
    return frameState.callbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeRefs() {
  const cameraRef = {
    current: {
      targetX: 0,
      targetZ: 0,
      zoom: 1,
      minZoom: 0.5,
      maxZoom: 3,
      followAgentId: null,
      followSmoothing: 0.08,
    } as CameraModel,
  };
  const viewportRef = { current: { width: 400, height: 300 } as ViewportSize };
  const spritesRef = {
    current: new Map([['agent-1', { x: 100, y: 50, agent: { id: 'agent-1' } }]]),
  } as any;
  return { cameraRef, viewportRef, spritesRef };
}

describe('SelectionOverlay', () => {
  it('renders the badge and positions the marker imperatively', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    const marker = container.querySelector('.world-view__selected-agent-marker') as HTMLDivElement;
    expect(marker).toBeTruthy();
    expect(marker.style.visibility).toBe('visible');
    expect(marker.style.left).toBe('300px');
    expect(marker.style.top).toBe('200px');
    expect(container.querySelector('.world-view__selected-agent-label')?.textContent).toBe('Scout 7');
    expect(container.querySelector('.world-view__focus-badge')?.textContent).toBe('Following Scout 7');
    expect(cameraRef.current.followAgentId).toBe('agent-1');
  });

  it('falls back to the agent id in the badge label', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName={null}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(container.querySelector('.world-view__focus-badge')?.textContent).toBe('Following agent-1');
  });

  it('hides the marker when the sprite is not available', () => {
    const { cameraRef, viewportRef } = makeRefs();
    const spritesRef = { current: new Map() } as any;

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    const marker = container.querySelector('.world-view__selected-agent-marker') as HTMLDivElement;
    expect(marker.style.visibility).toBe('hidden');
  });

  it('renders nothing and schedules no frame while inactive', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active={false}
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(frameState.callbacks).toHaveLength(0);
  });

  it('renders nothing without a selected agent', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { container } = render(
      <SelectionOverlay
        active
        selectedAgentId={null}
        selectedAgentName={null}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(frameState.callbacks).toHaveLength(0);
  });

  it('cancels the shared frame when it unmounts', () => {
    const { cameraRef, viewportRef, spritesRef } = makeRefs();

    const { unmount } = render(
      <SelectionOverlay
        active
        selectedAgentId="agent-1"
        selectedAgentName="Scout 7"
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />,
    );

    expect(frameState.callbacks).toHaveLength(1);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
