import { useEffect, useState } from 'react';

import { fetchSessionDetail } from '../../../infrastructure/sessionDetailApi.js';

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
      // Ignore network hiccups; polling will try again.
      const data = await fetchSessionDetail(agentId, agentProject, agentProvider);
      if (!cancelled && data) {
        setDetail(data);
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
