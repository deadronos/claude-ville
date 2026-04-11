import { atom } from 'jotai';

// ─── Types ───────────────────────────────────────────────

export interface Session {
  sessionId: string;
  provider: string;
  project?: string;
  status: 'working' | 'idle' | 'waiting';
  model?: string;
  role?: string;
  team?: string;
  currentTool?: {
    name: string;
    input?: string;
  };
  detail?: SessionDetail;
}

export interface SessionDetail {
  messages: Array<{
    role: string;
    text: string;
    ts: number;
  }>;
  toolHistory: Array<{
    name: string;
    ts: number;
    input?: string;
  }>;
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface Settings {
  bubbleSize: 'small' | 'medium' | 'large';
  chatFontSize: number;
}

// ─── Modal atoms ─────────────────────────────────────────

export const modalOpenAtom = atom<boolean>(false);
export const modalTitleAtom = atom<string>('');
export const modalContentAtom = atom<string>('');

// ─── Core atoms ──────────────────────────────────────────

export const sessionsAtom = atom<Session[]>([]);

export const selectedAgentIdAtom = atom<string | null>(null);

export const selectedAgentAtom = atom<Session | null>((get) => {
  const id = get(selectedAgentIdAtom);
  if (!id) return null;
  return get(sessionsAtom).find((s) => s.sessionId === id) ?? null;
});

export const modeAtom = atom<'world' | 'dashboard'>('world');

export const panelOpenAtom = atom<boolean>(false);

export const toastsAtom = atom<Toast[]>([]);

export const settingsAtom = atom<Settings>({
  bubbleSize: 'medium',
  chatFontSize: 12,
});

// ─── Derived atoms ────────────────────────────────────────

export const workingAgentsAtom = atom((get) =>
  get(sessionsAtom).filter((s) => s.status === 'working')
);

export const idleAgentsAtom = atom((get) =>
  get(sessionsAtom).filter((s) => s.status === 'idle')
);

export const waitingAgentsAtom = atom((get) =>
  get(sessionsAtom).filter((s) => s.status === 'waiting')
);
