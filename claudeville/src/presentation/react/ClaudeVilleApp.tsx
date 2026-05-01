import { useEffect, useMemo, useState } from 'react';

import { i18n } from '../../config/i18n.js';
import { ClaudeVilleController, useClaudeVilleSnapshot } from './state/ClaudeVilleController.js';
import { WorldView } from './world/WorldView.js';
import { ActivityPanel } from './components/ActivityPanel.js';
import { DashboardView } from './components/DashboardView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Sidebar } from './components/Sidebar.js';
import { ToastViewport } from './components/ToastViewport.js';

export function ClaudeVilleApp() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const controller = useMemo(() => new ClaudeVilleController(), []);
  const snapshot = useClaudeVilleSnapshot(controller);
  // Agents are already cached in the controller; snapshot.agents is stable
  const agents = snapshot.agents;
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
            <div className="topbar__segmented-control" role="tablist" aria-label={i18n.t('viewMode')}>
              <button
                id="btnModeCharacter"
                type="button"
                role="tab"
                aria-selected={snapshot.mode === 'character' ? 'true' : 'false'}
                className={`topbar__segmented-btn ${snapshot.mode === 'character' ? 'topbar__segmented-btn--active' : ''}`}
                onClick={() => controller.setMode('character')}
              >
                {i18n.t('world')}
              </button>
              <button
                id="btnModeDashboard"
                type="button"
                role="tab"
                aria-selected={snapshot.mode === 'dashboard' ? 'true' : 'false'}
                className={`topbar__segmented-btn ${snapshot.mode === 'dashboard' ? 'topbar__segmented-btn--active' : ''}`}
                onClick={() => controller.setMode('dashboard')}
              >
                {i18n.t('dashboard')}
              </button>
            </div>
          </div>
          <div className="topbar__right">
            <div className="topbar__badges" role="status" aria-label={i18n.t('agentStats')}>
              <span className="topbar__badge topbar__badge--working" title={i18n.t('working')}>
                <span className="topbar__badge-dot" aria-hidden="true" />
                <span id="badgeWorking" className="tabular-nums">{stats.working}</span> <span data-i18n="working" className="topbar__stat-label-text">{i18n.t('working')}</span>
              </span>
              <span className="topbar__badge topbar__badge--idle" title={i18n.t('idle')}>
                <span className="topbar__badge-dot" aria-hidden="true" />
                <span id="badgeIdle" className="tabular-nums">{stats.idle}</span> <span data-i18n="idle" className="topbar__stat-label-text">{i18n.t('idle')}</span>
              </span>
              <span className="topbar__badge topbar__badge--waiting" title={i18n.t('waiting')}>
                <span className="topbar__badge-dot" aria-hidden="true" />
                <span id="badgeWaiting" className="tabular-nums">{stats.waiting}</span> <span data-i18n="waiting" className="topbar__stat-label-text">{i18n.t('waiting')}</span>
              </span>
            </div>
            <button id="btnSettings" type="button" className="topbar__settings-btn" aria-label={i18n.t('settings')} title={i18n.t('settings')} onClick={() => controller.openSettings()}>
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
