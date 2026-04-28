import { useEffect, useMemo, useState } from 'react';

import { i18n } from '../../config/i18n.js';
import { ClaudeVilleController, useClaudeVilleSnapshot } from './state/ClaudeVilleController.js';
import { WorldView } from './world/WorldView.js';
import { ActivityPanel } from './components/ActivityPanel.js';
import { DashboardView } from './components/DashboardView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Sidebar } from './components/Sidebar.js';
import { ToastViewport } from './components/ToastViewport.js';
import { WorldTimer } from './components/WorldTimer.js';
import { useWorldStore } from './world/state/useWorldStore.js';

export function ClaudeVilleApp() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const controller = useMemo(() => new ClaudeVilleController(), []);
  const snapshot = useClaudeVilleSnapshot(controller);
  const agents = Array.from(snapshot.world.agents.values());
  const buildings = Array.from(snapshot.world.buildings.values());
  const selectedAgent = snapshot.selectedAgentId
    ? snapshot.world.agents.get(snapshot.selectedAgentId) || null
    : null;
  const stats = snapshot.world.getStats();

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
    <div className="app-container">
      <Sidebar agents={agents} selectedAgentId={snapshot.selectedAgentId} onFocus={(agentId) => controller.focusAgent(agentId)} isOpen={isSidebarOpen} />

      <div className="main-wrapper">
        <header id="topbar" className="topbar">
          <div className="topbar__left">
            <button className="topbar__sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="Toggle Sidebar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <span className="topbar__logo">ClaudeVille</span>
            <span className="topbar__version">v0.1</span>
          </div>
          <div className="topbar__center">
            <div className="topbar__segmented-control">
              <button
                id="btnModeCharacter"
                type="button"
                className={`topbar__segmented-btn ${snapshot.mode === 'character' ? 'topbar__segmented-btn--active' : ''}`}
                onClick={() => controller.setMode('character')}
              >
                {i18n.t('world')}
              </button>
              <button
                id="btnModeDashboard"
                type="button"
                className={`topbar__segmented-btn ${snapshot.mode === 'dashboard' ? 'topbar__segmented-btn--active' : ''}`}
                onClick={() => controller.setMode('dashboard')}
              >
                {i18n.t('dashboard')}
              </button>
            </div>
          </div>
          <div className="topbar__right">
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
            <button id="btnSettings" type="button" className="topbar__settings-btn" title="Settings" onClick={() => controller.openSettings()}>
              ⚙
            </button>
          </div>
        </header>

        <div className="main">
          <div className="main__body">
            <div className="content">
              <WorldView
                active={snapshot.mode === 'character'}
                bubbleConfig={snapshot.bubbleConfig}
                onSelectAgent={(agentId) => controller.selectAgent(agentId)}
                onClearSelection={() => controller.clearSelection()}
              />
              <DashboardView active={snapshot.mode === 'dashboard'} agents={agents} onSelect={(agentId) => controller.selectAgent(agentId)} />
            </div>

            <ActivityPanel agent={selectedAgent} onClose={() => controller.clearSelection()} />
          </div>
        </div>
      </div>

      <SettingsModal open={snapshot.settingsOpen} controller={controller} bubbleConfig={snapshot.bubbleConfig} />
      <ToastViewport toasts={snapshot.toasts} onDismiss={(toastId) => controller.dismissToast(toastId)} />
    </div>
  );
}
