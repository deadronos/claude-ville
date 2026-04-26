import { WorldScene } from './WorldScene';
import { render } from '@testing-library/react';

describe('WorldScene ECS integration', () => {
  it('should render with ECS entities', () => {
    const mockProps = {
      viewport: { width: 800, height: 600 },
      sprites: [],
      cameraRef: { current: { x: 0, y: 0, zoom: 1, minZoom: 0.5, maxZoom: 3, followAgentId: null, followSmoothing: 0.1 } },
      roofAlphaRef: { current: new Map() },
      bubbleConfig: { textScale: 1, statusFontSize: 12, statusMaxWidth: 200, statusBubbleH: 30, statusPaddingH: 16, chatFontSize: 10 },
      buildings: [],
      selectedAgentId: null,
      hoveredBuildingId: null,
      onSelectAgent: () => {},
      onHoverBuilding: () => {},
      interactionRef: { current: { moved: false } },
    };
    render(<WorldScene {...mockProps} />);
  });
});