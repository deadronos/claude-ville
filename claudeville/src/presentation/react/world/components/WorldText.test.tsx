/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

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
    expect(container.querySelector('meshbasicmaterial')).toBeTruthy();
  });

  it('allows callers to override the default text settings', () => {
    const { container } = render(
      <WorldText characters="abc" renderOrder={7} depthOffset={-4} fontSize={12}>
        abc
      </WorldText>,
    );

    expect(container.querySelector('group')?.getAttribute('renderorder')).toBe('7');
  });
});
