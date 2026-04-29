/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const fiberMocks = vi.hoisted(() => ({
  set: vi.fn(),
  camera: { previous: true },
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: unknown) => unknown) => selector({
    camera: fiberMocks.camera,
    set: fiberMocks.set,
  }),
}));

import { ScreenSpaceCamera } from './components/ScreenSpaceCamera.js';
import { WorldText } from './components/WorldText.js';

describe('React world components', () => {
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

  it('flips world text vertically without dropping the caller props', () => {
    const { container } = render(
      <WorldText fontSize={12} color="#fff" anchorX="center" anchorY="middle">
        Hello world
      </WorldText>,
    );

    expect(container.querySelector('sprite')).toBeTruthy();
    expect(container.querySelector('spritematerial')).toBeTruthy();
  });
});
