import type { Session, SessionDetail } from '../../store';

export interface VizPlugin {
  /** Unique identifier for this plugin */
  id: string;
  /** Human-readable name */
  name: string;
  /** Initialize the plugin with a container HTMLElement */
  init(container: HTMLElement): void;
  /** Called when session data is updated */
  onSessionUpdate(sessions: Session[]): void;
  /** Called when an agent is selected */
  onAgentSelected(agentId: string | null): void;
  /** Destroy the plugin and clean up */
  destroy(): void;
}

export interface AgentAppearance {
  id: string;
  name: string;
  status: 'working' | 'idle' | 'waiting';
  model?: string;
  provider?: string;
  currentTool?: { name: string; detail?: string };
  appearance: {
    colors: { primary: string; secondary: string; accent: string };
    sprite: string;
  };
  position?: { x: number; y: number };
  projectPath?: string;
}
