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
  it('renders local sprite text above meshes by default', () => {
    const { container } = render(<WorldText fontSize={12}>Working…</WorldText>);

    const sprite = container.querySelector('sprite');
    expect(sprite).toBeTruthy();
    expect(sprite?.getAttribute('renderorder')).toBe('1000');
    expect(container.querySelector('spritematerial')).toBeTruthy();
  });

  it('allows callers to override the default text settings', () => {
    const { container } = render(
      <WorldText characters="abc" renderOrder={7} depthOffset={-4} fontSize={12}>
        abc
      </WorldText>,
    );

    expect(container.querySelector('sprite')?.getAttribute('renderorder')).toBe('7');
  });
});
