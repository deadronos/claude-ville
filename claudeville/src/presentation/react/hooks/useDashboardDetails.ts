import { useEffect, useMemo, useState } from 'react';

import type { SessionDetailData } from '../../../infrastructure/sessionDetailApi.js';
import { fetchSessionDetail } from '../../../infrastructure/sessionDetailApi.js';
import type { AgentDetailRef } from '../../shared/dashboardViewModel.js';

type DashboardDetailState = Record<string, Pick<SessionDetailData, 'toolHistory'>>;

export function useDashboardDetails(agents: readonly AgentDetailRef[], enabled: boolean) {
  const [details, setDetails] = useState<DashboardDetailState>({});
  const agentRequests = useMemo(
    () => agents.map((agent) => ({
      id: agent.id,
      project: agent.project || '',
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
          const data = await fetchSessionDetail(agent.id, agent.project, agent.provider);
          return [agent.id, { toolHistory: data?.toolHistory ?? [] }] as const;
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
