import { useEffect, useMemo } from 'react';

import { i18n } from '../../config/i18n.js';
import { shortProjectName } from '../shared/dashboardViewModel.js';
import { ClaudeVilleController, useClaudeVilleSnapshot } from './state/ClaudeVilleController.js';
import { WorldView } from './world/WorldView.js';
import { ActivityPanel } from './components/ActivityPanel.js';
import { DashboardView } from './components/DashboardView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Sidebar } from './components/Sidebar.js';
import { ToastViewport } from './components/ToastViewport.js';
import { WorldTimer } from './components/WorldTimer.js';

export function ClaudeVilleApp() {
  const controller = useMemo(() => new ClaudeVilleController(), []);
  const snapshot = useClaudeVilleSnapshot(controller);
  const agents = snapshot.agents;
  const buildings = snapshot.buildings;
  const selectedAgent = snapshot.selectedAgentId
    ? snapshot.selectedAgent || snapshot.world.agents.get(snapshot.selectedAgentId) || null
    : null;
  const stats = snapshot.world.getStats();
  const projectCount = new Set(agents.map((agent) => agent.projectPath || '_unknown')).size;
  const activeAgents = stats.working + stats.waiting;
  const accountTier = snapshot.usage?.account?.subscriptionType
    ? String(snapshot.usage.account.subscriptionType).toUpperCase()
    : 'LIVE';
  const quota = snapshot.usage?.quota?.fiveHour;
  const quotaSummary = quota
    ? `${quota.used}/${quota.used + quota.remaining} used`
    : agents.length > 0
      ? 'Hub sync connected'
      : 'Waiting for live sessions';
  const focusLabel = selectedAgent ? selectedAgent.name : 'World overview';
  const focusMeta = selectedAgent
    ? shortProjectName(selectedAgent.projectPath, i18n.t('unknownProject'))
    : `${projectCount} ${projectCount === 1 ? 'project' : 'projects'} tracked`;

  useEffect(() => {
    void controller.boot().catch((error) => {
      // Error state is exposed through the controller snapshot.
      console.error('[ClaudeVille] boot failed', error);
    });

    return () => {
      controller.dispose();
    };
  }, [controller]);

  if (snapshot.bootError) {
    return (
      <div className="boot-error">
        <div>BOOT FAILED</div>
        <div className="boot-error__detail">{snapshot.bootError.message}</div>
      </div>
    );
  }

  return (
    <div className="root-shell app-shell">
      <header id="topbar" className="topbar">
        <div className="topbar__brand">
          <span className="topbar__eyebrow">CLAUDEVILLE CONTROL</span>
          <div className="topbar__brand-row">
            <span className="topbar__logo">ClaudeVille</span>
            <span className="topbar__version">v0.1</span>
          </div>
          <span className="topbar__tagline">
            {agents.length > 0
              ? `${agents.length} live sessions across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`
              : 'Persistent world view for live coding sessions'}
          </span>
        </div>

        <div className="topbar__summary">
          <div className="topbar__summary-items">
            <div className="topbar__summary-item topbar__summary-item--time">
              <span data-i18n="time" className="topbar__metric-label">{i18n.t('time')}</span>
              <WorldTimer startTime={snapshot.world.startTime} />
            </div>
            <div className="topbar__summary-item">
              <span className="topbar__metric-label">Focus</span>
              <span className="topbar__summary-value">{focusLabel}</span>
              <span className="topbar__summary-meta">{focusMeta}</span>
            </div>
            <div className="topbar__summary-item">
              <span className="topbar__metric-label">Plan</span>
              <span className="topbar__summary-value">{accountTier}</span>
              <span className="topbar__summary-meta">{quotaSummary}</span>
            </div>
          </div>
          <div className="topbar__badges">
            <span className="topbar__badge topbar__badge--working">
              <span className="topbar__badge-dot" />
              <span id="badgeWorking">{stats.working}</span> <span data-i18n="working">{i18n.t('working')}</span>
            </span>
            <span className="topbar__badge topbar__badge--idle">
              <span className="topbar__badge-dot" />
              <span id="badgeIdle">{stats.idle}</span> <span data-i18n="idle">{i18n.t('idle')}</span>
            </span>
            <span className="topbar__badge topbar__badge--waiting">
              <span className="topbar__badge-dot" />
              <span id="badgeWaiting">{stats.waiting}</span> <span data-i18n="waiting">{i18n.t('waiting')}</span>
            </span>
            <span className="topbar__badge topbar__badge--active">{activeAgents} active</span>
          </div>
        </div>

        <div className="topbar__actions">
          <div className="topbar__mode-group">
          <button
            id="btnModeCharacter"
            type="button"
            data-i18n="world"
            className={`topbar__mode-btn ${snapshot.mode === 'character' ? 'topbar__mode-btn--active' : ''}`}
            onClick={() => controller.setMode('character')}
          >
            {i18n.t('world')}
          </button>
          <button
            id="btnModeDashboard"
            type="button"
            data-i18n="dashboard"
            className={`topbar__mode-btn ${snapshot.mode === 'dashboard' ? 'topbar__mode-btn--active' : ''}`}
            onClick={() => controller.setMode('dashboard')}
          >
            {i18n.t('dashboard')}
          </button>
          </div>
          <button id="btnSettings" type="button" className="topbar__settings-btn" title="Settings" onClick={() => controller.openSettings()}>
            <span className="topbar__settings-icon" aria-hidden="true">⚙</span>
            <span className="topbar__settings-label">{i18n.t('settings')}</span>
          </button>
        </div>
      </header>

      <div className="main">
        <div className={`main__body ${selectedAgent ? '' : 'main__body--no-inspector'}`}>
          <Sidebar agents={agents} selectedAgentId={snapshot.selectedAgentId} onFocus={(agentId) => controller.focusAgent(agentId)} />

          <div className="content">
            {snapshot.mode === 'character' ? (
              <div className="content__hud" aria-hidden="true">
                <div className="content__hud-card">
                  <span className="content__hud-eyebrow">WORLD SPACE</span>
                  <span className="content__hud-title">{selectedAgent ? selectedAgent.name : 'Operational map'}</span>
                  <span className="content__hud-subtitle">
                    {selectedAgent
                      ? `${selectedAgent.provider || 'claude'} session in ${shortProjectName(selectedAgent.projectPath, i18n.t('unknownProject'))}`
                      : `${agents.length} sessions across ${buildings.length} buildings`}
                  </span>
                </div>
              </div>
            ) : null}
            <WorldView
              active={snapshot.mode === 'character'}
              bubbleConfig={snapshot.bubbleConfig}
              onSelectAgent={(agentId) => controller.selectAgent(agentId)}
              onClearSelection={() => controller.clearSelection()}
            />
            <DashboardView active={snapshot.mode === 'dashboard'} agents={agents} onSelect={(agentId) => controller.selectAgent(agentId)} />
          </div>

          {selectedAgent ? <ActivityPanel agent={selectedAgent} onClose={() => controller.clearSelection()} /> : null}
        </div>
      </div>

      <SettingsModal open={snapshot.settingsOpen} controller={controller} bubbleConfig={snapshot.bubbleConfig} />
      <ToastViewport toasts={snapshot.toasts} onDismiss={(toastId) => controller.dismissToast(toastId)} />
    </div>
  );
}
