import { useEffect, useState } from 'react';

import { getHubApiUrl } from '../../../config/runtime.js';

type SessionDetailState = {
  toolHistory: any[];
  messages: any[];
};

export function useSessionDetail(agent: any | null, enabled: boolean, intervalMs: number) {
  const [detail, setDetail] = useState<SessionDetailState>({
    toolHistory: [],
    messages: [],
  });
  const agentId = agent?.id;
  const agentProject = agent?.projectPath || '';
  const agentProvider = agent?.provider || 'claude';

  useEffect(() => {
    if (!enabled || !agentId) {
      setDetail({ toolHistory: [], messages: [] });
      return;
    }

    let cancelled = false;

    const fetchDetail = async () => {
      try {
        const url = getHubApiUrl('/api/session-detail', {
          sessionId: agentId,
          project: agentProject,
          provider: agentProvider,
        });
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (!cancelled) {
          setDetail({
            toolHistory: data.toolHistory || [],
            messages: data.messages || [],
          });
        }
      } catch {
        // Ignore network hiccups; polling will try again.
      }
    };

    void fetchDetail();
    const timer = window.setInterval(() => {
      void fetchDetail();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentId, agentProject, agentProvider, enabled, intervalMs]);

  return detail;
}
