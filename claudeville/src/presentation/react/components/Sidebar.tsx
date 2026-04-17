import { useMemo } from 'react';

import { i18n } from '../../../config/i18n.js';
import {
  getProviderIcon,
  groupByProject,
  shortModel,
  shortProjectName,
} from '../../shared/dashboardViewModel.js';
import { useStableProjectColors } from '../hooks/useStableProjectColors.js';

export function Sidebar({ agents, selectedAgentId, onFocus }: { agents: any[]; selectedAgentId: string | null; onFocus: (agentId: string) => void; }) {
  const groups = useMemo(() => groupByProject(agents), [agents]);
  const projectKeys = useMemo(() => Array.from(groups.keys()), [groups]);
  const colors = useStableProjectColors(projectKeys);

  return (
    <aside id="sidebar" className="sidebar">
      <div className="sidebar__header">
        <span data-i18n="agents" className="sidebar__title">{i18n.t('agents')}</span>
        <span id="agentCount" className="sidebar__count">{agents.length}</span>
      </div>
      <div id="agentList" className="sidebar__list">
        {projectKeys.map((projectPath) => {
          const groupAgents = groups.get(projectPath) || [];
          const accentIndex = colors.get(projectPath) ?? 0;

          return (
            <div key={projectPath} className={`sidebar__project-group project-accent--${accentIndex}`}>
              <div className="sidebar__project-header">
                <span className="sidebar__project-dot" />
                <span className="sidebar__project-name">{shortProjectName(projectPath, i18n.t('unknownProject'))}</span>
                <span className="sidebar__project-count">{groupAgents.length}</span>
              </div>
              {groupAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`sidebar__agent ${selectedAgentId === agent.id ? 'sidebar__agent--selected' : ''}`}
                  onClick={() => onFocus(agent.id)}
                >
                  <span className={`sidebar__agent-dot sidebar__agent-dot--${agent.status}`} />
                  <div className="sidebar__agent-info">
                    <span className="sidebar__agent-name">{agent.name}</span>
                    <span className="sidebar__agent-model">
                      <span className={`provider-icon provider-icon--${agent.provider || 'unknown'}`}>
                        {getProviderIcon(agent.provider)}
                      </span>{' '}
                      {shortModel(agent.model)}
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
