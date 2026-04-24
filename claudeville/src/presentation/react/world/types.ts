import type { MutableRefObject } from 'react';

import type { AgentSprite } from '../../character-mode/AgentSprite.js';
import type { BuildingStyle } from '../../../config/buildingStyles.js';

export type { BuildingStyle };

export type BubbleConfig = {
  textScale: number;
  statusFontSize: number;
  statusMaxWidth: number;
  statusBubbleH: number;
  statusPaddingH: number;
  chatFontSize: number;
};

export type CameraModel = {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  followAgentId: string | null;
  followSmoothing: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export type TerrainTileModel = {
  key: string;
  x: number;
  y: number;
  color: string;
  water: boolean;
};

export type InteractionModel = {
  dragging: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  camStartX: number;
  camStartY: number;
};

export type WorldViewProps = {
  active: boolean;
  agents: any[];
  buildings: any[];
  selectedAgentId: string | null;
  selectedAgentName: string | null;
  bubbleConfig: BubbleConfig;
  onSelectAgent: (agentId: string) => void;
  onClearSelection: () => void;
};

export type WorldSceneProps = {
  viewport: ViewportSize;
  sprites: AgentSprite[];
  cameraRef: MutableRefObject<CameraModel>;
  roofAlphaRef: MutableRefObject<Map<string, number>>;
  bubbleConfig: BubbleConfig;
  buildings: any[];
  selectedAgentId: string | null;
  hoveredBuildingId: string | null;
  onSelectAgent: (agentId: string) => void;
  onHoverBuilding: (buildingId: string | null) => void;
  interactionRef: MutableRefObject<{ moved: boolean }>;
};
