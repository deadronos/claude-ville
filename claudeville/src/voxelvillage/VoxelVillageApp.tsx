import { useMemo, useState } from 'react';

import { i18n } from '../config/i18n.js';
import { getBubbleConfig, updateBubbleConfig } from '../config/bubbleConfig.js';
import { useHubVillageData } from '../pixivillage/hooks/useHubVillageData.js';
import { TEXT_SIZE_PRESETS, getTextSizePresetKey } from '../presentation/shared/textSizePresets.js';
import type { VillageAgent, VillageStatus } from '../pixivillage/model.js';
import { VoxelVillageScene } from './components/VoxelVillageScene.js';
import { buildVoxelVillageSnapshotFromVillage } from './model.js';
import '../../css/voxelvillage.css';

const statusOrder: VillageStatus[] = ['running', 'waiting', 'idle', 'error'];

export function VoxelVillageApp() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    snapshot: hubSnapshot,
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
  const [textSizeKey, setTextSizeKey] = useState(() => getTextSizePresetKey(getBubbleConfig().textScale));
  const snapshot = useMemo(() => buildVoxelVillageSnapshotFromVillage(hubSnapshot), [hubSnapshot]);
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return snapshot.agents.filter((agent) => !normalized || [
      agent.name,
      agent.provider,
      agent.model,
      agent.currentTask,
      agent.projectName,
      agent.buildingId,
    ].join(' ').toLowerCase().includes(normalized));
  }, [snapshot.agents, query]);
  const inspectorAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId)
    || snapshot.agents.find((agent) => agent.id === selectedAgent?.id)
    || filteredAgents[0]
    || null;
  const inspectorBuilding = snapshot.buildings.find((building) => building.id === selectedBuildingId)
    || snapshot.buildings.find((building) => building.id === selectedBuilding?.id)
    || null;
  const textSizePreset = TEXT_SIZE_PRESETS.find((preset) => preset.key === textSizeKey) || TEXT_SIZE_PRESETS[1];

  function openSettings() {
    setTextSizeKey(getTextSizePresetKey(getBubbleConfig().textScale));
    setSettingsOpen(true);
  }

  function applySettings() {
    updateBubbleConfig({
      textScale: textSizePreset.textScale,
      statusFontSize: textSizePreset.statusFontSize,
      statusMaxWidth: textSizePreset.maxWidth,
      statusBubbleH: textSizePreset.bubbleH,
      statusPaddingH: textSizePreset.paddingH,
      chatFontSize: textSizePreset.statusFontSize,
      chatMaxWidth: textSizePreset.maxWidth,
    });
    setSettingsOpen(false);
  }

  return (
    <div className="voxel-village">
      <header className="voxel-village__topbar">
        <div className="voxel-village__brand">
          <span className="voxel-village__mark" aria-hidden="true" />
          <span>
            <strong>ClaudeVille Voxel Village</strong>
            <small>live session world</small>
          </span>
        </div>
        <div className="voxel-village__status-strip">
          {statusOrder.map((status) => (
            <span key={status} className={`voxel-village__status voxel-village__status--${status}`}>
              {snapshot.counts[status]} {status}
            </span>
          ))}
        </div>
        <div className="voxel-village__connection">
          <small>Data stream</small>
          <strong>{connectionState === 'connected' ? 'WebSocket live' : 'Polling fallback'}</strong>
        </div>
        <button
          type="button"
          className="voxel-village__settings-btn"
          aria-label={i18n.t('settings')}
          title={i18n.t('settings')}
          onClick={openSettings}
        >
          ⚙
        </button>
      </header>

      <main className="voxel-village__main">
        <aside className="voxel-village__sidebar">
          <div className="voxel-village__panel-head">
            <h1>Sessions</h1>
            <span>{snapshot.counts.total}</span>
          </div>
          <input
            className="voxel-village__search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions..."
            aria-label="Search sessions"
          />
          <div className="voxel-village__agent-list">
            {filteredAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                selected={selectedAgentId === agent.id}
                onSelect={() => selectAgent(agent.id)}
              />
            ))}
            {filteredAgents.length === 0 ? <p className="voxel-village__empty">No sessions match this view.</p> : null}
          </div>
        </aside>

        <VoxelVillageScene
          snapshot={snapshot}
          selectedAgentId={selectedAgentId}
          selectedBuildingId={selectedBuildingId}
          onSelectAgent={selectAgent}
          onSelectBuilding={selectBuilding}
        />

        <aside className="voxel-village__inspector">
          <div className="voxel-village__panel-head">
            <h2>{inspectorAgent ? 'Selected Agent' : 'Village'}</h2>
            <span>{new Date(lastUpdatedAt).toLocaleTimeString([], { hour12: false })}</span>
          </div>
          {inspectorAgent ? (
            <>
              <section className="voxel-village__selected">
                <span className={`voxel-village__avatar voxel-village__avatar--${inspectorAgent.status}`} />
                <span>
                  <strong>{inspectorAgent.name}</strong>
                  <small>{inspectorAgent.provider} · {inspectorAgent.model}</small>
                </span>
              </section>
              <section className="voxel-village__detail">
                <h3>World text</h3>
                <p>{inspectorAgent.currentTask}</p>
              </section>
              <section className="voxel-village__metrics">
                <Metric label="Tokens" value={formatNumber(inspectorAgent.tokensTotal)} />
                <Metric label="Messages" value={String(inspectorAgent.messageCount)} />
                <Metric label="Building" value={inspectorBuilding?.name || inspectorAgent.buildingId} />
              </section>
            </>
          ) : (
            <p className="voxel-village__empty">Waiting for hub sessions.</p>
          )}
        </aside>
      </main>

      {settingsOpen ? (
        <div className="voxel-village__modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="voxel-village__modal" onClick={(event) => event.stopPropagation()}>
            <div className="voxel-village__modal-header">
              <strong>{i18n.t('settingsTitle')}</strong>
              <button type="button" className="voxel-village__modal-close" onClick={() => setSettingsOpen(false)}>X</button>
            </div>
            <div className="voxel-village__modal-body">
              <div className="voxel-village__settings-row">
                <span>{i18n.t('textSize')}</span>
                <div className="voxel-village__settings-options">
                  {TEXT_SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className={`voxel-village__settings-option ${textSizeKey === preset.key ? 'is-active' : ''}`}
                      onClick={() => setTextSizeKey(preset.key)}
                    >
                      {i18n.t(preset.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="voxel-village__settings-actions">
                <button type="button" className="voxel-village__settings-option" onClick={() => setSettingsOpen(false)}>Cancel</button>
                <button type="button" className="voxel-village__settings-option is-active" onClick={applySettings}>Apply</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgentRow({ agent, selected, onSelect }: { agent: VillageAgent; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`voxel-village__agent ${selected ? 'is-selected' : ''}`} type="button" onClick={onSelect}>
      <span className={`voxel-village__avatar voxel-village__avatar--${agent.status}`} />
      <span>
        <strong>{agent.name}</strong>
        <small>{agent.currentTask}</small>
      </span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="voxel-village__metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}
