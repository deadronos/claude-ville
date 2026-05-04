import { useMemo, useState } from 'react';

import { PixiVillageCanvas } from './components/PixiVillageCanvas.js';
import { useHubVillageData } from './hooks/useHubVillageData.js';
import type { VillageAgent, VillageStatus } from './model.js';
import '../../css/pixivillage.css';

const statusOrder: VillageStatus[] = ['running', 'waiting', 'idle', 'error'];

export function PixiVillageApp() {
  const {
    snapshot,
    selectedAgent,
    selectedAgentId,
    selectedBuilding,
    selectedBuildingId,
    connectionState,
    lastUpdatedAt,
    selectAgent,
    selectBuilding,
  } = useHubVillageData();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<VillageStatus | null>(null);
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return snapshot.agents.filter((agent) => {
      if (statusFilter && agent.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        agent.name,
        agent.provider,
        agent.model,
        agent.currentTask,
        agent.projectName,
        agent.buildingId,
      ].join(' ').toLowerCase().includes(normalized);
    });
  }, [snapshot.agents, query, statusFilter]);
  const inspectorAgent = selectedAgent
    || (selectedBuilding ? selectedBuilding.agents[0] || null : snapshot.agents[0] || null);
  const inspectorHeading = selectedAgent
    ? 'Selected Session'
    : selectedBuilding
      ? 'Selected Building'
      : 'Live Session';

  return (
    <div className="pixi-village">
      <header className="pixi-village__topbar">
        <div className="pixi-village__brand">
          <span className="pixi-village__mark" aria-hidden="true" />
          <span>
            <strong>ClaudeVille Pixi Village</strong>
            <small>Alternative live session map</small>
          </span>
        </div>
        <div className="pixi-village__status-chips">
          {statusOrder.map((status) => (
            <button
              key={status}
              className={`pixi-village__chip pixi-village__chip--${status} ${statusFilter === status ? 'is-active' : ''}`}
              type="button"
              onClick={() => setStatusFilter(statusFilter === status ? null : status)}
            >
              <span />
              {snapshot.counts[status]} {status}
            </button>
          ))}
        </div>
        <div className="pixi-village__connection">
          <small>Data stream</small>
          <strong>{connectionState === 'connected' ? 'WebSocket live' : 'Polling fallback'}</strong>
        </div>
      </header>

      <main className="pixi-village__main">
        <aside className="pixi-village__sidebar">
          <div className="pixi-village__panel-head">
            <h1>Sessions</h1>
            <span>{snapshot.counts.total}</span>
          </div>
          <input
            className="pixi-village__search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search provider, task, model..."
            aria-label="Search sessions"
          />
          <div className="pixi-village__agent-list">
            {filteredAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                selected={selectedAgentId === agent.id}
                onSelect={() => selectAgent(agent.id)}
              />
            ))}
            {filteredAgents.length === 0 ? <p className="pixi-village__empty">No sessions match this view.</p> : null}
          </div>
        </aside>

        <PixiVillageCanvas
          buildings={snapshot.buildings}
          selectedBuildingId={selectedBuildingId}
          onSelectBuilding={selectBuilding}
        />

        <aside className="pixi-village__inspector">
          <div className="pixi-village__panel-head">
            <h2>{inspectorHeading}</h2>
            <span>{new Date(lastUpdatedAt).toLocaleTimeString([], { hour12: false })}</span>
          </div>

          {inspectorAgent ? (
            <>
              <section className="pixi-village__selected">
                <span className={`pixi-village__avatar pixi-village__avatar--${inspectorAgent.status}`} />
                <span>
                  <strong>{inspectorAgent.name}</strong>
                  <small>{inspectorAgent.provider} · {inspectorAgent.model}</small>
                </span>
                <StatusPill status={inspectorAgent.status} />
              </section>
              <section className="pixi-village__detail">
                <h3>Current task</h3>
                <p>{inspectorAgent.currentTask}</p>
              </section>
              <section className="pixi-village__metrics">
                <Metric label="Tokens" value={formatNumber(inspectorAgent.tokensTotal)} />
                <Metric label="Messages" value={String(inspectorAgent.messageCount)} />
                <Metric label="Cost" value={`$${inspectorAgent.estimatedCost.toFixed(3)}`} />
                <Metric label="Building" value={selectedBuilding?.name || inspectorAgent.buildingId} />
              </section>
            </>
          ) : selectedBuilding ? (
            <p className="pixi-village__empty">{selectedBuilding.name} has no live sessions.</p>
          ) : (
            <p className="pixi-village__empty">Waiting for hub sessions.</p>
          )}

          <section className="pixi-village__building-list">
            <h3>Buildings</h3>
            {snapshot.buildings.map((building) => (
              <button
                key={building.id}
                type="button"
                className={selectedBuildingId === building.id ? 'is-selected' : ''}
                onClick={() => selectBuilding(building.id)}
              >
                <span>{building.name}</span>
                <StatusPill status={building.status} count={building.agentCount} />
              </button>
            ))}
          </section>
        </aside>
      </main>

      <footer className="pixi-village__footer">
        <span>Hub: existing ClaudeVille collector → hubreceiver → frontend stream</span>
        <span>View: PixiJS village renderer</span>
      </footer>
    </div>
  );
}

function AgentRow({ agent, selected, onSelect }: { agent: VillageAgent; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`pixi-village__agent ${selected ? 'is-selected' : ''}`} type="button" onClick={onSelect}>
      <span className={`pixi-village__avatar pixi-village__avatar--${agent.status}`} />
      <span>
        <strong>{agent.name}</strong>
        <small>{agent.currentTask}</small>
      </span>
      <StatusPill status={agent.status} />
    </button>
  );
}

function StatusPill({ status, count }: { status: VillageStatus; count?: number }) {
  return <span className={`pixi-village__pill pixi-village__pill--${status}`}>{count ?? ''} {status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pixi-village__metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}
