/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import type { BubbleConfig } from '../types.js';
import { Accessory, Bubble, Hair, NameTag } from './AgentActor.js';
import { createPolygonGeometry, createRoundedRectGeometry } from '../utils.js';

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
});
