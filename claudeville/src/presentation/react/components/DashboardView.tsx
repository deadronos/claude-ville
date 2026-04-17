import { useMemo, useState } from 'react';

import { i18n } from '../../../config/i18n.js';
import {
  getProviderLabel,
  getToolCategory,
  getToolIcon,
  groupByProject,
  shortModel,
  shortProjectName,
  shortToolName,
  truncateProjectPath,
  truncateText,
} from '../../shared/dashboardViewModel.js';
import { AvatarPreview } from './AvatarPreview.js';
import { useDashboardDetails } from '../hooks/useDashboardDetails.js';
import { useStableProjectColors } from '../hooks/useStableProjectColors.js';

const STATUS_ORDER: Record<string, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
};

export function DashboardView({ active, agents, onSelect }: { active: boolean; agents: any[]; onSelect: (agentId: string) => void; }) {
  const details = useDashboardDetails(agents, active);
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupByProject(agents), [agents]);
  const projectKeys = useMemo(() => Array.from(groups.keys()), [groups]);
  const colors = useStableProjectColors(projectKeys);

  if (!active) {
    return null;
  }

  return (
    <div id="dashboardMode" className="content__dashboard">
      {agents.length === 0 ? (
        <div id="dashboardEmpty" className="dashboard__empty dashboard__empty--visible">
          <span className="dashboard__empty-icon">~</span>
          <span data-i18n="noActiveAgents" className="dashboard__empty-text">{i18n.t('noActiveAgents')}</span>
          <span data-i18n="noActiveAgentsSub" className="dashboard__empty-sub">{i18n.t('noActiveAgentsSub')}</span>
        </div>
      ) : (
        <div id="dashboardGrid" className="dashboard__grid">
          {projectKeys.map((projectPath) => {
            const groupAgents = [...(groups.get(projectPath) || [])].sort((left, right) => {
              return (STATUS_ORDER[left.status] ?? 3) - (STATUS_ORDER[right.status] ?? 3);
            });
            const accentIndex = colors.get(projectPath) ?? 0;

            return (
              <div key={projectPath} className={`dashboard__section project-accent--${accentIndex}`} data-project={projectPath}>
                <div className="dashboard__section-header">
                  <span className="dashboard__section-dot" />
                  <span className="dashboard__section-name">{shortProjectName(projectPath, i18n.t('unknownProject'))}</span>
                  <span className="dashboard__section-path">{truncateProjectPath(projectPath)}</span>
                  <span className="dashboard__section-count">{i18n.t('nAgents', groupAgents.length)}</span>
                </div>
                <div className="dashboard__section-grid">
                  {groupAgents.map((agent) => {
                    const toolHistory = details[agent.id]?.toolHistory || [];
                    const contextPercent = agent.usage?.contextPercent ?? 0;
                    const providerLabel = getProviderLabel(agent.provider);
                    const isOpen = !!openCards[agent.id];

                    return (
                      <div key={agent.id} className={`dash-card dash-card--${agent.status}`} onClick={() => onSelect(agent.id)}>
                        <div className="dash-card__header">
                          <AvatarPreview agent={agent} />
                          <div className="dash-card__info">
                            <div className="dash-card__name">{agent.name}</div>
                            <div className="dash-card__meta">
                              <span className={`dash-card__provider-badge provider-badge--${agent.provider || 'unknown'}`}>
                                {providerLabel}
                              </span>
                              <span className="dash-card__model">{shortModel(agent.model)}</span>
                              <span className="dash-card__role">{agent.role || ''}</span>
                            </div>
                            <div className="dash-card__context-bar-wrap" data-context-pct={contextPercent}>
                              <div
                                className="dash-card__context-bar"
                                ref={(node) => {
                                  if (!node) {
                                    return;
                                  }
                                  node.style.width = contextPercent > 0 ? `${contextPercent}%` : '0';
                                  node.style.opacity = contextPercent > 0 ? '1' : '0';
                                }}
                              />
                            </div>
                          </div>
                          <div className={`dash-card__status dash-card__status--${agent.status}`}>
                            <span className="dash-card__status-dot" />
                            <span className="dash-card__status-label">
                              {i18n.t(agent.status === 'working' ? 'statusWorking' : agent.status === 'waiting' ? 'statusWaiting' : 'statusIdle')}
                            </span>
                          </div>
                        </div>

                        <div className="dash-card__activity">
                          <div className={`dash-card__current-tool ${agent.currentTool ? '' : 'dash-card__current-tool--idle'}`}>
                            <span className="dash-card__tool-icon">{agent.currentTool ? getToolIcon(agent.currentTool) : agent.status === 'idle' ? '💤' : '⏳'}</span>
                            <div className="dash-card__tool-info">
                              <div className="dash-card__tool-name">
                                {agent.currentTool || (agent.status === 'idle' ? i18n.t('statusIdle') : `${i18n.t('statusWaiting')}...`)}
                              </div>
                              <div className="dash-card__tool-detail">{agent.currentToolInput || ''}</div>
                            </div>
                          </div>
                          {agent.lastMessage ? <div className="dash-card__message">“{agent.lastMessage}”</div> : null}
                        </div>

                        <div
                          className="dash-card__tools-header"
                          data-agent-id={agent.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenCards((current) => ({ ...current, [agent.id]: !current[agent.id] }));
                          }}
                        >
                          <span className="dash-card__tools-title">{i18n.t('toolHistory')}</span>
                          <span className="dash-card__tool-count-badge">{toolHistory.length}</span>
                          <span className={`dash-card__tools-chevron ${isOpen ? 'dash-card__tools-chevron--open' : ''}`}>▶</span>
                        </div>

                        <div className={`dash-card__tools ${isOpen ? 'dash-card__tools--open' : ''}`} id={`card-tools-${agent.id}`}>
                          <div className="dash-card__tool-list">
                            {toolHistory.length === 0 ? (
                              <div className="dash-card__loading">{i18n.t('noToolUsage')}</div>
                            ) : (
                              [...toolHistory].reverse().map((tool, index) => {
                                const category = getToolCategory(tool.tool);
                                return (
                                  <div key={`${agent.id}-${tool.tool}-${index}`} className="dash-card__tool-item">
                                    <span className={`dash-card__tool-item-icon tool-cat--${category}`}>{getToolIcon(tool.tool)}</span>
                                    <span className={`dash-card__tool-item-name tool-cat--${category}`}>{shortToolName(tool.tool)}</span>
                                    <span className="dash-card__tool-item-detail">{truncateText(tool.detail, 60)}</span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
