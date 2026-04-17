/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const textProps = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
}));

vi.mock('@react-three/drei', () => ({
  Text: (props: Record<string, unknown>) => {
    textProps.lastProps = props;
    return null;
  },
}));

import { WorldText } from './WorldText.js';

describe('WorldText', () => {
  it('preloads a broad character set and keeps text above meshes by default', () => {
    render(<WorldText fontSize={12}>Working…</WorldText>);

    expect(textProps.lastProps).not.toBeNull();
    expect(String(textProps.lastProps?.characters)).toContain('Working…');
    expect(String(textProps.lastProps?.characters)).toContain('⚡');
    expect(textProps.lastProps?.renderOrder).toBe(1000);
    expect(textProps.lastProps?.scale).toEqual([1, -1, 1]);
  });

  it('allows callers to override the default text settings', () => {
    render(
      <WorldText characters="abc" renderOrder={7} fontSize={12}>
        abc
      </WorldText>,
    );

    expect(textProps.lastProps?.characters).toBe('abc');
    expect(textProps.lastProps?.renderOrder).toBe(7);
  });
});
