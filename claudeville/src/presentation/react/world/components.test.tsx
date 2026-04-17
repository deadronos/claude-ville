/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const dreiMocks = vi.hoisted(() => ({
  OrthographicCamera: vi.fn(() => null),
  Text: vi.fn(() => null),
}));

vi.mock('@react-three/drei', () => dreiMocks);

import { ScreenSpaceCamera } from './components/ScreenSpaceCamera.js';
import { WorldText } from './components/WorldText.js';

describe('React world components', () => {
  beforeEach(() => {
    dreiMocks.OrthographicCamera.mockClear();
    dreiMocks.Text.mockClear();
  });

  it('configures the orthographic camera as a manual screen-space frustum', () => {
    render(<ScreenSpaceCamera viewport={{ width: 960, height: 540 }} />);

    expect(dreiMocks.OrthographicCamera).toHaveBeenCalledTimes(1);
    const orthographicCameraCalls = dreiMocks.OrthographicCamera.mock.calls as unknown as Array<[Record<string, unknown>] | []>;
    const orthographicCameraProps = orthographicCameraCalls[0]?.[0];
    expect(orthographicCameraProps).toEqual(expect.objectContaining({
      makeDefault: true,
      manual: true,
      left: 0,
      right: 960,
      top: 0,
      bottom: 540,
      near: -1000,
      far: 1000,
      position: [0, 0, 100],
      zoom: 1,
    }));
  });

  it('flips world text vertically without dropping the caller props', () => {
    render(
      <WorldText fontSize={12} color="#fff" anchorX="center" anchorY="middle">
        Hello world
      </WorldText>,
    );

    expect(dreiMocks.Text).toHaveBeenCalledTimes(1);
    const textCalls = dreiMocks.Text.mock.calls as unknown as Array<[Record<string, unknown>] | []>;
    const textProps = textCalls[0]?.[0];
    expect(textProps).toEqual(expect.objectContaining({
      fontSize: 12,
      color: '#fff',
      anchorX: 'center',
      anchorY: 'middle',
      scale: [1, -1, 1],
      children: 'Hello world',
    }));
  });
});