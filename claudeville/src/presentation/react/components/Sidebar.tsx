import { useMemo, useState } from 'react';

import { i18n } from '../../../config/i18n.js';
import {
  getProviderIcon,
  groupByProject,
  shortModel,
  shortProjectName,
  truncateProjectPath,
} from '../../shared/dashboardViewModel.js';
import { useStableProjectColors } from '../hooks/useStableProjectColors.js';
import { AvatarPreview } from './AvatarPreview.js';

export function Sidebar({ agents, selectedAgentId, onFocus }: { agents: any[]; selectedAgentId: string | null; onFocus: (agentId: string) => void; }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupByProject(agents), [agents]);
  const projectKeys = useMemo(() => Array.from(groups.keys()), [groups]);
  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return groups;
    }

    const next = new Map<string, any[]>();
    for (const [projectPath, groupAgents] of groups) {
      const matches = groupAgents.filter((agent) => {
        return [
          agent.name,
          agent.model,
          agent.role,
          agent.provider,
          agent.projectPath,
          agent.currentTool,
          agent.currentToolInput,
          agent.lastMessage,
        ].some((value) => typeof value === 'string' && value.toLowerCase().includes(term));
      });

      if (matches.length > 0) {
        next.set(projectPath, matches);
      }
    }

    return next;
  }, [groups, query]);
  const filteredProjectKeys = useMemo(() => Array.from(filteredGroups.keys()), [filteredGroups]);
  const colors = useStableProjectColors(projectKeys);
  const totals = useMemo(() => {
    return agents.reduce((result, agent) => {
      if (agent.status === 'working') {
        result.working += 1;
      } else if (agent.status === 'waiting') {
        result.waiting += 1;
      } else {
        result.idle += 1;
      }
      return result;
    }, { working: 0, waiting: 0, idle: 0 });
  }, [agents]);

  return (
    <aside id="sidebar" className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__header-copy">
          <span className="sidebar__eyebrow">OPERATOR ROSTER</span>
          <span data-i18n="agents" className="sidebar__title">{i18n.t('agents')}</span>
        </div>
        <span id="agentCount" className="sidebar__count">{agents.length}</span>
      </div>
      <div className="sidebar__controls">
        <label className="sidebar__search" htmlFor="sidebarSearch">
          <span className="sidebar__search-icon" aria-hidden="true">⌕</span>
          <input
            id="sidebarSearch"
            className="sidebar__search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents, tools, or projects"
          />
        </label>
        <div className="sidebar__summary" aria-label="Agent status summary">
          <span>{totals.working} {i18n.t('statusWorking')}</span>
          <span>{totals.waiting} {i18n.t('statusWaiting')}</span>
          <span>{totals.idle} {i18n.t('statusIdle')}</span>
        </div>
      </div>
      <div id="agentList" className="sidebar__list">
        {filteredProjectKeys.length === 0 ? (
          <div className="sidebar__empty">
            <span className="sidebar__empty-title">No matching agents</span>
            <span className="sidebar__empty-copy">Try a different search term or clear the filter to see the full roster.</span>
          </div>
        ) : filteredProjectKeys.map((projectPath) => {
          const groupAgents = filteredGroups.get(projectPath) || [];
          const accentIndex = colors.get(projectPath) ?? 0;

          return (
            <div key={projectPath} className={`sidebar__project-group project-accent--${accentIndex}`}>
              <div className="sidebar__project-header">
                <span className="sidebar__project-dot" />
                <div className="sidebar__project-copy">
                  <span className="sidebar__project-name">{shortProjectName(projectPath, i18n.t('unknownProject'))}</span>
                  {projectPath !== '_unknown' ? <span className="sidebar__project-path">{truncateProjectPath(projectPath)}</span> : null}
                </div>
                <span className="sidebar__project-count">{groupAgents.length}</span>
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
                >
                  <AvatarPreview agent={agent} className="sidebar__agent-avatar" />
                  <div className="sidebar__agent-info">
                    <div className="sidebar__agent-topline">
                      <span className="sidebar__agent-name">{agent.name}</span>
                      <span className={`sidebar__agent-status sidebar__agent-status--${agent.status}`}>
                        {agent.status === 'working'
                          ? i18n.t('statusWorking')
                          : agent.status === 'waiting'
                            ? i18n.t('statusWaiting')
                            : i18n.t('statusIdle')}
                      </span>
                    </div>
                    <span className="sidebar__agent-model">
                      <span className={`provider-icon provider-icon--${agent.provider || 'unknown'}`}>
                        {getProviderIcon(agent.provider)}
                      </span>
                      <span>{shortModel(agent.model) || agent.provider || 'unknown'}</span>
                      {agent.role ? <span className="sidebar__agent-role">{agent.role}</span> : null}
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
