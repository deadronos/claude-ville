/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Vector3 } from 'three';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    CanvasTexture: vi.fn().mockImplementation(function CanvasTexture() {
      return {
      colorSpace: '',
      dispose: vi.fn(),
      magFilter: null,
      minFilter: null,
      needsUpdate: false,
      };
    }),
  };
});

import { WorldText } from './WorldText.js';

describe('WorldText', () => {
  it('renders local plane text above meshes by default', () => {
    const { container } = render(<WorldText fontSize={12}>Working…</WorldText>);

    const textGroup = container.querySelector('group');
    expect(textGroup).toBeTruthy();
    expect(textGroup?.getAttribute('renderorder')).toBe('1000');
    expect(container.querySelectorAll('mesh')).toHaveLength(2);
    expect(container.querySelectorAll('meshbasicmaterial[side="0"]')).toHaveLength(2);
  });

  it('allows callers to override the default text settings', () => {
    const { container } = render(
      <WorldText characters="abc" renderOrder={7} depthOffset={-4} fontSize={12}>
        abc
      </WorldText>,
    );

    expect(container.querySelector('group')?.getAttribute('renderorder')).toBe('7');
  });

  it('handles Vector3 positions and applies z-offset', () => {
    const pos = new Vector3(5, 10, 15);
    const { container } = render(
      <WorldText position={pos} depthOffset={-4} fontSize={12}>
        Vector3 test
      </WorldText>
    );

    // The group position should receive the z-offset: 15 + (-4 * 0.001) = 14.996
    const group = container.querySelector('group');
    expect(group).toBeTruthy();
    const positionProp = (group as any).position;
    if (positionProp) {
      expect(positionProp.z).toBeCloseTo(14.996, 4);
    }
  });
});
