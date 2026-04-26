/** @vitest-environment jsdom */

import { describe, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { InstancedTerrain } from './InstancedTerrain.js';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

describe('InstancedTerrain', () => {
  it('should render without crashing', () => {
    render(<InstancedTerrain buildings={[]} />);
  });
});