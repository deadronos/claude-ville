import { useEffect, useMemo, useState } from 'react';

import { eventBus } from '../../domain/events/DomainEvent.js';
import { HubDataSource } from '../../infrastructure/HubDataSource.js';
import { WebSocketClient } from '../../infrastructure/WebSocketClient.js';
import { buildVillageSnapshot, type HubSession } from '../model.js';

type ConnectionState = 'connecting' | 'connected' | 'polling';

interface HubMessage {
  sessions?: HubSession[];
  type?: string;
}

export function useHubVillageData() {
  const dataSource = useMemo(() => new HubDataSource(), []);
  const wsClient = useMemo(() => new WebSocketClient(), []);
  const [sessions, setSessions] = useState<HubSession[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>('command-center');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      const nextSessions = await dataSource.getSessions();
      if (disposed) return;
      setSessions(nextSessions as HubSession[]);
      setLastUpdatedAt(Date.now());
      setConnectionState((state) => state === 'connected' ? state : 'polling');
    }

    function applyMessage(data: unknown) {
      const message = data as HubMessage;
      if (!Array.isArray(message.sessions)) return;
      setSessions(message.sessions);
      setLastUpdatedAt(Date.now());
    }

    const unsubscribers = [
      eventBus.on('ws:init', applyMessage),
      eventBus.on('ws:update', applyMessage),
      eventBus.on('ws:connected', () => {
        setConnectionState('connected');
        void poll();
      }),
      eventBus.on('ws:disconnected', () => {
        setConnectionState('polling');
      }),
    ];

    void poll();
    pollTimer = setInterval(poll, 2500);
    wsClient.connect();

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      wsClient.disconnect();
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [dataSource, wsClient]);

  const snapshot = useMemo(() => buildVillageSnapshot(sessions), [sessions]);
  const selectedAgent = selectedAgentId
    ? snapshot.agents.find((agent) => agent.id === selectedAgentId) || null
    : null;
  const selectedBuilding = selectedBuildingId
    ? snapshot.buildings.find((building) => building.id === selectedBuildingId) || null
    : null;

  return {
    snapshot,
    selectedAgent,
    selectedAgentId,
    selectedBuilding,
    selectedBuildingId,
    connectionState,
    lastUpdatedAt,
    selectAgent(agentId: string | null) {
      setSelectedAgentId(agentId);
      const agent = agentId ? snapshot.agents.find((candidate) => candidate.id === agentId) : null;
      if (agent) setSelectedBuildingId(agent.buildingId);
    },
    selectBuilding(buildingId: string | null) {
      setSelectedBuildingId(buildingId);
      setSelectedAgentId(null);
    },
  };
}
