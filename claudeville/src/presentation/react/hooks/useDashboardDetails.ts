import { useEffect, useMemo, useState } from 'react';

import { getHubApiUrl } from '../../../config/runtime.js';

type DashboardDetailState = Record<string, { toolHistory: any[] }>;

export function useDashboardDetails(agents: any[], enabled: boolean) {
  const [details, setDetails] = useState<DashboardDetailState>({});
  const agentRequests = useMemo(
    () => agents.map((agent) => ({
      id: agent.id,
      project: agent.projectPath || '',
      provider: agent.provider || 'claude',
    })),
    [agents],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const fetchAll = async () => {
      const entries = await Promise.allSettled(
        agentRequests.map(async (agent) => {
          const url = getHubApiUrl('/api/session-detail', {
            sessionId: agent.id,
            project: agent.project,
            provider: agent.provider,
          });
          const response = await fetch(url);
          if (!response.ok) {
            return [agent.id, { toolHistory: [] }] as const;
          }
          const data = await response.json();
          return [agent.id, { toolHistory: data.toolHistory || [] }] as const;
        }),
      );

      if (cancelled) {
        return;
      }

      const next: DashboardDetailState = {};
      for (const result of entries) {
        if (result.status === 'fulfilled') {
          const [agentId, value] = result.value;
          next[agentId] = value;
        }
      }
      setDetails(next);
    };

    void fetchAll();
    const timer = window.setInterval(() => {
      void fetchAll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentRequests, enabled]);

  return details;
}
