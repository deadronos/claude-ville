// packages/frontend/src/hooks/useActivityPanel.ts

import { useState, useEffect, useRef } from 'react';
import type { Session } from '../store';

interface SessionDetail {
  messages: Array<{ role: string; text: string; ts: number }>;
  toolHistory: Array<{ name: string; ts: number; input?: string }>;
}

export function useActivityPanel(agent: Session | null) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!agent) {
      setDetail(null);
      setCurrentTool(null);
      return;
    }

    const sessionId = agent.sessionId;
    setCurrentTool(agent.currentTool?.name || null);

    async function fetchDetail() {
      try {
        const params = new URLSearchParams({
          sessionId: sessionId,
          project: agent.project || '',
          provider: agent.provider || 'claude',
        });
        const resp = await fetch(`/api/session-detail?${params}`);
        if (!resp.ok) return;
        const data = await resp.json();
        setDetail(data);
        if (data.messages?.length) {
          const lastMsg = data.messages[data.messages.length - 1];
          setCurrentTool(lastMsg?.role || null);
        }
      } catch {
        // ignore network errors
      }
    }

    fetchDetail();
    const timer = setInterval(fetchDetail, 2000);

    return () => clearInterval(timer);
  }, [agent]);

  return { detail, currentTool };
}
