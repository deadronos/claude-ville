import { useEffect, useMemo } from 'react';

import { i18n } from '../../config/i18n.js';
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
  const agents = Array.from(snapshot.world.agents.values());
  const buildings = Array.from(snapshot.world.buildings.values());
  const selectedAgent = snapshot.selectedAgentId
    ? snapshot.world.agents.get(snapshot.selectedAgentId) || null
    : null;
  const stats = snapshot.world.getStats();

  useEffect(() => {
    void controller.boot().catch(() => {
      // Error state is exposed through the controller snapshot.
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
    <>
      <header id="topbar" className="topbar">
        <div className="topbar__left">
          <span className="topbar__logo">ClaudeVille</span>
          <span className="topbar__version">v0.1</span>
        </div>
        <div className="topbar__center">
          <div className="topbar__stat">
            <span data-i18n="time" className="topbar__stat-label">{i18n.t('time')}</span>
            <WorldTimer startTime={snapshot.world.startTime} />
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
          </div>
        </div>
        <div className="topbar__right">
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
          <button id="btnSettings" type="button" className="topbar__settings-btn" title="Settings" onClick={() => controller.openSettings()}>
            ⚙
          </button>
        </div>
      </header>

      <div className="main">
        <div className="main__body">
          <Sidebar agents={agents} selectedAgentId={snapshot.selectedAgentId} onFocus={(agentId) => controller.focusAgent(agentId)} />

          <div className="content">
            <WorldView
              active={snapshot.mode === 'character'}
              agents={agents}
              buildings={buildings}
              selectedAgentId={snapshot.selectedAgentId}
              selectedAgentName={selectedAgent?.name || null}
              bubbleConfig={snapshot.bubbleConfig}
              onSelectAgent={(agentId) => controller.selectAgent(agentId)}
              onClearSelection={() => controller.clearSelection()}
            />
            <DashboardView active={snapshot.mode === 'dashboard'} agents={agents} onSelect={(agentId) => controller.selectAgent(agentId)} />
          </div>

          <ActivityPanel agent={selectedAgent} onClose={() => controller.clearSelection()} />
        </div>
      </div>

      <SettingsModal open={snapshot.settingsOpen} controller={controller} bubbleConfig={snapshot.bubbleConfig} />
      <ToastViewport toasts={snapshot.toasts} onDismiss={(toastId) => controller.dismissToast(toastId)} />
    </>
  );
}
