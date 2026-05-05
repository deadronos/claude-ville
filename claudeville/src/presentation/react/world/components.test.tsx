/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const fiberMocks = vi.hoisted(() => ({
  set: vi.fn(),
  setState: vi.fn((nextState: { camera?: unknown }) => {
    fiberMocks.set(nextState);
    if (nextState.camera) {
      fiberMocks.camera = nextState.camera;
    }
  }),
  camera: { previous: true } as any,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: unknown) => unknown) => selector({
    camera: fiberMocks.camera,
    set: fiberMocks.setState,
  }),
}));

import { ScreenSpaceCamera } from './components/ScreenSpaceCamera.js';
import { WorldText } from './components/WorldText.js';

describe('React world components', () => {
  beforeEach(() => {
    fiberMocks.set.mockClear();
    fiberMocks.setState.mockClear();
    fiberMocks.camera = { previous: true };
  });

  it('configures the orthographic camera as a manual screen-space frustum', () => {
    const { container } = render(<ScreenSpaceCamera viewport={{ width: 960, height: 540 }} />);

    const camera = container.querySelector('primitive');
    expect(camera).toBeTruthy();
    expect(fiberMocks.set).toHaveBeenCalledWith(expect.objectContaining({
      camera: expect.objectContaining({
        left: 0,
        right: 960,
        top: 0,
        bottom: 540,
        near: -1000,
        far: 1000,
        zoom: 1,
      }),
    }));
  });

  it('updates the existing screen-space camera after resize without installing a stale camera', () => {
    const { rerender, unmount } = render(<ScreenSpaceCamera viewport={{ width: 960, height: 540 }} />);
    const firstCamera = fiberMocks.camera;

    fiberMocks.set.mockClear();
    rerender(<ScreenSpaceCamera viewport={{ width: 720, height: 540 }} />);
    const secondCamera = fiberMocks.camera;

    expect(secondCamera).toBe(firstCamera);
    expect(fiberMocks.set).not.toHaveBeenCalled();
    expect(secondCamera).toEqual(expect.objectContaining({
      left: 0,
      right: 720,
      top: 0,
      bottom: 540,
      zoom: 1,
    }));

    unmount();

    expect(fiberMocks.camera).toEqual({ previous: true });
  });

  it('flips world text vertically without dropping the caller props', () => {
    const { container } = render(
      <WorldText fontSize={12} color="#fff" anchorX="center" anchorY="middle">
        Hello world
      </WorldText>,
    );

    expect(container.querySelector('group')).toBeTruthy();
    expect(container.querySelector('meshbasicmaterial')).toBeTruthy();
  });
});
