/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { INSTANCED_TERRAIN_VERTEX_SHADER, InstancedTerrain } from './InstancedTerrain.js';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

describe('InstancedTerrain', () => {
  it('keeps instanced tiles in the mesh model-view transform path', () => {
    expect(INSTANCED_TERRAIN_VERTEX_SHADER).toContain('instanceMatrix * transformed');
    expect(INSTANCED_TERRAIN_VERTEX_SHADER).toContain('projectionMatrix * modelViewMatrix * transformed');
  });

  it('should render without crashing', () => {
    render(<InstancedTerrain buildings={[]} />);
  });
});