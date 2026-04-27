/** @vitest-environment jsdom */

import { describe, it, vi } from 'vitest';

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => children,
  DepthOfField: () => null,
  Bloom: () => null,
  Vignette: () => null,
}));

import { PostProcessing } from './PostProcessing';
import { render } from '@testing-library/react';

describe('PostProcessing', () => {
  it('should render EffectComposer', () => {
    render(<PostProcessing />);
  });
});
