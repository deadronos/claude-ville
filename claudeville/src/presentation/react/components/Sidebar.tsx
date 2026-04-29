import { useMemo } from 'react';

import { i18n } from '../../../config/i18n.js';
import {
  getProviderIcon,
  groupByProject,
  shortModel,
  shortProjectName,
} from '../../shared/dashboardViewModel.js';
import { useStableProjectColors } from '../hooks/useStableProjectColors.js';
import { GradientAvatar } from './GradientAvatar.js';

export function Sidebar({ agents, selectedAgentId, onFocus, isOpen = true }: { agents: any[]; selectedAgentId: string | null; onFocus: (agentId: string) => void; isOpen?: boolean }) {
  const groups = useMemo(() => groupByProject(agents), [agents]);
  const projectKeys = useMemo(() => Array.from(groups.keys()), [groups]);
  const colors = useStableProjectColors(projectKeys);

  return (
    <aside id="sidebar" className={`sidebar ${!isOpen ? 'sidebar--closed' : ''}`} aria-label={i18n.t('agentList')}>
      <div className="sidebar__header">
        <h2 data-i18n="agents" className="sidebar__title">{i18n.t('agents')}</h2>
        <span id="agentCount" className="sidebar__count tabular-nums" aria-label={i18n.t('totalAgents')}>{agents.length}</span>
      </div>
      <div id="agentList" className="sidebar__list" role="list">
        {projectKeys.map((projectPath) => {
          const groupAgents = groups.get(projectPath) || [];
          const accentIndex = colors.get(projectPath) ?? 0;

          return (
            <div key={projectPath} className={`sidebar__project-group project-accent--${accentIndex}`} role="group" aria-labelledby={`sidebar-project-${projectPath}`}>
              <div className="sidebar__project-header" id={`sidebar-project-${projectPath}`}>
                <span className="sidebar__project-dot" aria-hidden="true" />
                <span className="sidebar__project-name">{shortProjectName(projectPath, i18n.t('unknownProject'))}</span>
                <span className="sidebar__project-count tabular-nums">{groupAgents.length}</span>
              </div>
              {groupAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`sidebar__agent ${selectedAgentId === agent.id ? 'sidebar__agent--selected' : ''}`}
                  data-session-id={agent.id}
                  data-status={agent.status}
                  data-provider={agent.provider || 'unknown'}
                  onClick={() => onFocus(agent.id)}
                  aria-label={`${i18n.t('focusAgent')}: ${agent.name}`}
                >
                  <div style={{ position: 'relative' }}>
                    <GradientAvatar id={agent.id} size={28} />
                    <span className={`sidebar__agent-dot sidebar__agent-dot--${agent.status}`} style={{ position: 'absolute', bottom: -2, right: -2, border: '2px solid #171717' }} />
                  </div>
                  <div className="sidebar__agent-info">
                    <span className="sidebar__agent-name">{agent.name}</span>
                    <span className="sidebar__agent-model">
                      <span className={`provider-icon provider-icon--${agent.provider || 'unknown'}`} aria-hidden="true">
                        {getProviderIcon(agent.provider)}
                      </span>{' '}
                      <span className="tabular-nums">{shortModel(agent.model)}</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
