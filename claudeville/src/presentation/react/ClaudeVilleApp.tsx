import { useEffect, useMemo, useRef, useState } from 'react';

import { AvatarCanvas } from '../dashboard-mode/AvatarCanvas.js';
import { getNameMode } from '../../config/agentNames.js';
import { getBubbleConfig } from '../../config/bubbleConfig.js';
import { getHubApiUrl } from '../../config/runtime.js';
import { i18n } from '../../config/i18n.js';
import { ClaudeVilleController, useClaudeVilleSnapshot } from './state/ClaudeVilleController.js';
import type { ToastItem } from './state/ClaudeVilleController.js';
import { WorldView } from './world/WorldView.js';

const PROVIDER_BADGES: Record<string, { label: string }> = {
  claude: { label: 'Claude' },
  codex: { label: 'Codex' },
  gemini: { label: 'Gemini' },
  openclaw: { label: 'OpenClaw' },
  copilot: { label: 'Copilot' },
  vscode: { label: 'VS Code' },
};

const PROVIDER_ICONS: Record<string, string> = {
  claude: 'C',
  codex: 'X',
  gemini: 'G',
  openclaw: 'O',
  copilot: 'P',
  vscode: 'V',
};

const PROJECT_COLORS = [
  '#e8d44d', '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#f472b6', '#34d399', '#fb923c', '#818cf8', '#22d3ee',
];

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Grep: '🔍',
  Glob: '📁',
  Bash: '⚡',
  Task: '📋',
  TaskCreate: '📋',
  TaskUpdate: '📋',
  TaskList: '📋',
  WebSearch: '🌐',
  WebFetch: '🌐',
  SendMessage: '💬',
  TeamCreate: '👥',
  NotebookEdit: '📓',
  EnterPlanMode: '📐',
  ExitPlanMode: '📐',
  AskUserQuestion: '❓',
};

const TOOL_CATEGORIES: Record<string, string> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'search',
  WebFetch: 'search',
  Edit: 'write',
  Write: 'write',
  NotebookEdit: 'write',
  Bash: 'exec',
  Task: 'task',
  TaskCreate: 'task',
  TaskUpdate: 'task',
  TaskList: 'task',
  SendMessage: 'task',
  TeamCreate: 'task',
};

const TEXT_SIZE_PRESETS = [
  { key: 'small', labelKey: 'bubbleSmall', textScale: 0.8, statusFontSize: 10, maxWidth: 160, bubbleH: 22, paddingH: 18 },
  { key: 'medium', labelKey: 'bubbleMedium', textScale: 1.0, statusFontSize: 14, maxWidth: 260, bubbleH: 28, paddingH: 24 },
  { key: 'large', labelKey: 'bubbleLarge', textScale: 1.25, statusFontSize: 20, maxWidth: 360, bubbleH: 38, paddingH: 32 },
  { key: 'xlarge', labelKey: 'bubbleExtraLarge', textScale: 1.5, statusFontSize: 28, maxWidth: 480, bubbleH: 52, paddingH: 44 },
];

function groupByProject(agents: any[]) {
  const groups = new Map<string, any[]>();
  for (const agent of agents) {
    const key = agent.projectPath || '_unknown';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(agent);
  }
  return groups;
}

function shortProjectName(path: string) {
  if (!path || path === '_unknown') {
    return i18n.t('unknownProject');
  }

  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  const last = parts[parts.length - 1] || path;
  if (parts.length <= 2 && parts[0] === 'Users') {
    return '~';
  }
  return last;
}

function truncateProjectPath(path: string) {
  if (!path || path === '_unknown') {
    return '';
  }

  const home = '/Users/';
  if (path.startsWith(home)) {
    const afterHome = path.slice(home.length);
    const slashIndex = afterHome.indexOf('/');
    if (slashIndex >= 0) {
      return `~/${afterHome.slice(slashIndex + 1)}`;
    }
  }

  return path;
}

function shortModel(model: string) {
  if (!model) {
    return '';
  }

  return model
    .replace('claude-', '')
    .replace(/-\d{8}$/, '')
    .replace(/-2025\d+/, '');
}

function getToolIcon(tool?: string | null) {
  if (!tool) {
    return '❓';
  }
  if (tool.startsWith('mcp__playwright__')) {
    return '🎭';
  }
  if (tool.startsWith('mcp__')) {
    return '🔌';
  }
  return TOOL_ICONS[tool] || '🔧';
}

function getToolCategory(tool?: string | null) {
  if (!tool) {
    return 'other';
  }
  if (tool.startsWith('mcp__')) {
    return 'exec';
  }
  return TOOL_CATEGORIES[tool] || 'other';
}

function shortToolName(name?: string | null) {
  if (!name) {
    return '';
  }
  return name.replace('mcp__playwright__', 'pw:').replace('mcp__', '');
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatCost(value: number) {
  if (!Number.isFinite(value)) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function useStableProjectColors(keys: string[]) {
  const colorMapRef = useRef(new Map<string, number>());

  for (const key of keys) {
    if (!colorMapRef.current.has(key)) {
      colorMapRef.current.set(key, colorMapRef.current.size % PROJECT_COLORS.length);
    }
  }

  return colorMapRef.current;
}

function useWorldTimer(startTime: number) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const totalSeconds = Math.floor((Date.now() - startTime) / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function useSessionDetail(agent: any | null, enabled: boolean, intervalMs: number) {
  const [detail, setDetail] = useState<{ toolHistory: any[]; messages: any[] }>({
    toolHistory: [],
    messages: [],
  });
  const agentId = agent?.id;
  const agentProject = agent?.projectPath || '';
  const agentProvider = agent?.provider || 'claude';

  useEffect(() => {
    if (!enabled || !agentId) {
      setDetail({ toolHistory: [], messages: [] });
      return;
    }

    let cancelled = false;

    const fetchDetail = async () => {
      try {
        const url = getHubApiUrl('/api/session-detail', {
          sessionId: agentId,
          project: agentProject,
          provider: agentProvider,
        });
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (!cancelled) {
          setDetail({
            toolHistory: data.toolHistory || [],
            messages: data.messages || [],
          });
        }
      } catch {
        // Ignore network hiccups; polling will try again.
      }
    };

    void fetchDetail();
    const timer = window.setInterval(() => {
      void fetchDetail();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentId, agentProject, agentProvider, enabled, intervalMs]);

  return detail;
}

function useDashboardDetails(agents: any[], enabled: boolean) {
  const [details, setDetails] = useState<Record<string, { toolHistory: any[] }>>({});
  const agentRequests = useMemo(
    () => agents.map((agent) => ({
      id: agent.id,
      project: agent.projectPath || '',
      provider: agent.provider || 'claude',
    })),
    [agents],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const fetchAll = async () => {
      const entries = await Promise.allSettled(
        agentRequests.map(async (agent) => {
          const url = getHubApiUrl('/api/session-detail', {
            sessionId: agent.id,
            project: agent.project,
            provider: agent.provider,
          });
          const response = await fetch(url);
          if (!response.ok) {
            return [agent.id, { toolHistory: [] }] as const;
          }
          const data = await response.json();
          return [agent.id, { toolHistory: data.toolHistory || [] }] as const;
        }),
      );

      if (cancelled) {
        return;
      }

      const next: Record<string, { toolHistory: any[] }> = {};
      for (const result of entries) {
        if (result.status === 'fulfilled') {
          const [agentId, value] = result.value;
          next[agentId] = value;
        }
      }
      setDetails(next);
    };

    void fetchAll();
    const timer = window.setInterval(() => {
      void fetchAll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentRequests, enabled]);

  return details;
}

function AvatarPreview({ agent }: { agent: any }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    container.innerHTML = '';
    const avatar = new AvatarCanvas(agent);
    container.appendChild(avatar.canvas);

    return () => {
      container.innerHTML = '';
    };
  }, [agent]);

  return <div ref={ref} className="dash-card__avatar" />;
}

function Sidebar({ agents, selectedAgentId, onToggle }: { agents: any[]; selectedAgentId: string | null; onToggle: (agentId: string) => void }) {
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
                <span className="sidebar__project-name">{shortProjectName(projectPath)}</span>
                <span className="sidebar__project-count">{groupAgents.length}</span>
              </div>
              {groupAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`sidebar__agent ${selectedAgentId === agent.id ? 'sidebar__agent--selected' : ''}`}
                  onClick={() => onToggle(agent.id)}
                >
                  <span className={`sidebar__agent-dot sidebar__agent-dot--${agent.status}`} />
                  <div className="sidebar__agent-info">
                    <span className="sidebar__agent-name">{agent.name}</span>
                    <span className="sidebar__agent-model">
                      <span className={`provider-icon provider-icon--${agent.provider || 'unknown'}`}>
                        {PROVIDER_ICONS[agent.provider] || '?'}
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

function DashboardView({ active, agents, onSelect }: { active: boolean; agents: any[]; onSelect: (agentId: string) => void }) {
  const details = useDashboardDetails(agents, active);
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupByProject(agents), [agents]);
  const projectKeys = useMemo(() => Array.from(groups.keys()), [groups]);
  const colors = useStableProjectColors(projectKeys);

  const statusOrder: Record<string, number> = {
    working: 0,
    waiting: 1,
    idle: 2,
  };

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
              return (statusOrder[left.status] ?? 3) - (statusOrder[right.status] ?? 3);
            });
            const accentIndex = colors.get(projectPath) ?? 0;

            return (
              <div key={projectPath} className={`dashboard__section project-accent--${accentIndex}`} data-project={projectPath}>
                <div className="dashboard__section-header">
                  <span className="dashboard__section-dot" />
                  <span className="dashboard__section-name">{shortProjectName(projectPath)}</span>
                  <span className="dashboard__section-path">{truncateProjectPath(projectPath)}</span>
                  <span className="dashboard__section-count">{i18n.t('nAgents', groupAgents.length)}</span>
                </div>
                <div className="dashboard__section-grid">
                  {groupAgents.map((agent) => {
                    const toolHistory = details[agent.id]?.toolHistory || [];
                    const contextPercent = agent.usage?.contextPercent ?? 0;
                    const providerBadge = PROVIDER_BADGES[agent.provider] || { label: agent.provider || 'Unknown' };
                    const isOpen = !!openCards[agent.id];

                    return (
                      <div key={agent.id} className={`dash-card dash-card--${agent.status}`}>
                        <div className="dash-card__header">
                          <AvatarPreview agent={agent} />
                          <div className="dash-card__info">
                            <div className="dash-card__name">{agent.name}</div>
                            <div className="dash-card__meta">
                              <span className={`dash-card__provider-badge provider-badge--${agent.provider || 'unknown'}`}>
                                {providerBadge.label}
                              </span>
                              <span className="dash-card__model">{shortModel(agent.model)}</span>
                              <span className="dash-card__role">{agent.role || ''}</span>
                            </div>
                            <div className="dash-card__context-bar-wrap">
                              <progress className="dash-card__context-progress" max={100} value={contextPercent} />
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
                          <button type="button" className={`dash-card__current-tool ${agent.currentTool ? '' : 'dash-card__current-tool--idle'}`} onClick={() => onSelect(agent.id)}>
                            <span className="dash-card__tool-icon">{agent.currentTool ? getToolIcon(agent.currentTool) : agent.status === 'idle' ? '💤' : '⏳'}</span>
                            <div className="dash-card__tool-info">
                              <div className="dash-card__tool-name">
                                {agent.currentTool || (agent.status === 'idle' ? i18n.t('statusIdle') : `${i18n.t('statusWaiting')}...`)}
                              </div>
                              <div className="dash-card__tool-detail">{agent.currentToolInput || ''}</div>
                            </div>
                          </button>
                          {agent.lastMessage ? <div className="dash-card__message">“{agent.lastMessage}”</div> : null}
                        </div>

                        <div
                          className="dash-card__tools-header"
                          data-agent-id={agent.id}
                          onClick={() => setOpenCards((current) => ({ ...current, [agent.id]: !current[agent.id] }))}
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
                                    <span className="dash-card__tool-item-detail">{tool.detail ? truncate(tool.detail, 60) : ''}</span>
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

function ActivityPanel({ agent, onClose }: { agent: any | null; onClose: () => void }) {
  const detail = useSessionDetail(agent, !!agent, 2000);
  if (!agent) {
    return null;
  }

  const contextPercent = agent.usage?.contextPercent ?? 0;
  const contextClass = contextPercent >= 90
    ? 'activity-panel__context-bar activity-panel__context-bar--danger'
    : contextPercent >= 70
      ? 'activity-panel__context-bar activity-panel__context-bar--warning'
      : 'activity-panel__context-bar';

  return (
    <aside id="activityPanel" className="activity-panel">
      <div className="activity-panel__header">
        <div className="activity-panel__agent-info">
          <span id="panelAgentName" className="activity-panel__name">{agent.name}</span>
          <span id="panelAgentStatus" className={`activity-panel__status activity-panel__status--${agent.status}`}>
            {agent.status.toUpperCase()}
          </span>
        </div>
        <button id="panelClose" className="activity-panel__close" type="button" onClick={onClose}>X</button>
      </div>

      <div className="activity-panel__meta">
        <div className="activity-panel__meta-row">
          <span className="activity-panel__label">{i18n.t('model')}</span>
          <span id="panelModel" className="activity-panel__value">{shortModel(agent.model)}</span>
        </div>
        <div className="activity-panel__meta-row">
          <span className="activity-panel__label">Provider</span>
          <span id="panelProvider" className="activity-panel__value">{agent.provider || 'claude'}</span>
        </div>
        <div className="activity-panel__meta-row">
          <span className="activity-panel__label">{i18n.t('role')}</span>
          <span id="panelRole" className="activity-panel__value">{agent.role || 'general'}</span>
        </div>
        <div className="activity-panel__meta-row">
          <span className="activity-panel__label">{i18n.t('team')}</span>
          <span id="panelTeam" className="activity-panel__value">{agent.teamName || '-'}</span>
        </div>
      </div>

      <div className="activity-panel__section">
        <div className="activity-panel__section-title">Current Tool</div>
        <div id="panelCurrentTool" className={`activity-panel__current-tool ${agent.currentTool ? '' : 'activity-panel__current-tool--idle'}`}>
          <span className="activity-panel__tool-icon">{agent.currentTool ? getToolIcon(agent.currentTool) : agent.status === 'idle' ? '💤' : '⏳'}</span>
          <div className="activity-panel__tool-detail">
            <span className="activity-panel__tool-name">{agent.currentTool || (agent.status === 'idle' ? 'Idle' : 'Waiting...')}</span>
            <span className="activity-panel__tool-input">{agent.currentToolInput || ''}</span>
          </div>
        </div>
      </div>

      <div className="activity-panel__section">
        <div className="activity-panel__section-title">Token Usage</div>
        <div className="activity-panel__token-usage">
          <div className="activity-panel__token-row">
            <span className="activity-panel__token-label">Context</span>
            <span className="activity-panel__token-value">{contextPercent}%</span>
          </div>
          <div className="activity-panel__context-bar-wrap">
            <progress className={contextClass.replace('activity-panel__context-bar', 'activity-panel__context-progress')} max={100} value={contextPercent} />
          </div>
          <div className="activity-panel__token-grid">
            <div className="activity-panel__token-cell">
              <span className="activity-panel__token-cell-label">Input</span>
              <span className="activity-panel__token-cell-value">{formatNumber(agent.tokens?.input || 0)}</span>
            </div>
            <div className="activity-panel__token-cell">
              <span className="activity-panel__token-cell-label">Output</span>
              <span className="activity-panel__token-cell-value">{formatNumber(agent.tokens?.output || 0)}</span>
            </div>
            <div className="activity-panel__token-cell">
              <span className="activity-panel__token-cell-label">Messages</span>
              <span className="activity-panel__token-cell-value">{detail.messages.length}</span>
            </div>
            <div className="activity-panel__token-cell">
              <span className="activity-panel__token-cell-label">Est. cost</span>
              <span className="activity-panel__token-cell-value">{formatCost(agent.cost || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="activity-panel__section activity-panel__section--grow">
        <div className="activity-panel__section-title">Tool History</div>
        <div id="panelToolHistory" className="activity-panel__tool-history">
          {detail.toolHistory.length === 0 ? (
            <div className="activity-panel__empty">No tool usage</div>
          ) : (
            [...detail.toolHistory].reverse().map((tool, index) => (
              <div key={`${agent.id}-tool-${index}`} className="activity-panel__tool-item">
                <span className="activity-panel__tool-item-icon">{getToolIcon(tool.tool)}</span>
                <span className="activity-panel__tool-item-name">{shortToolName(tool.tool)}</span>
                <span className="activity-panel__tool-item-detail">{tool.detail ? truncate(tool.detail, 45) : ''}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="activity-panel__section">
        <div className="activity-panel__section-title">Messages</div>
        <div id="panelMessages" className="activity-panel__messages">
          {detail.messages.length === 0 ? (
            <div className="activity-panel__empty">No messages</div>
          ) : (
            [...detail.messages].reverse().map((message, index) => (
              <div key={`${agent.id}-message-${index}`} className={`activity-panel__msg activity-panel__msg--${message.role === 'assistant' ? 'assistant' : 'user'}`}>
                <div className="activity-panel__msg-role">{message.role}</div>
                <div>{message.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function SettingsModal({ open, controller, bubbleConfig }: { open: boolean; controller: ClaudeVilleController; bubbleConfig: ReturnType<typeof getBubbleConfig> }) {
  const initialScale = TEXT_SIZE_PRESETS.find((preset) => preset.textScale === bubbleConfig.textScale)?.key
    || (bubbleConfig.textScale < 0.9 ? 'small' : bubbleConfig.textScale < 1.1 ? 'medium' : bubbleConfig.textScale < 1.4 ? 'large' : 'xlarge');

  const [nameMode, setLocalNameMode] = useState(getNameMode());
  const [sizeKey, setSizeKey] = useState(initialScale);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLocalNameMode(getNameMode());
    setSizeKey(initialScale);
  }, [open, initialScale]);

  if (!open) {
    return null;
  }

  const preset = TEXT_SIZE_PRESETS.find((item) => item.key === sizeKey) || TEXT_SIZE_PRESETS[1];

  return (
    <div id="modalOverlay" className="modal-overlay" onClick={() => controller.closeSettings()}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <span id="modalTitle" className="modal__title">{i18n.t('settingsTitle')}</span>
          <button id="modalClose" type="button" className="modal__close" onClick={() => controller.closeSettings()}>X</button>
        </div>
        <div id="modalContent" className="modal__content">
          <div className="settings-form">
            <div className="settings-row">
              <span className="settings-label">{i18n.t('nameMode')}</span>
              <div className="settings-lang-btns">
                {['autodetected', 'pooled'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`settings-lang-btn ${nameMode === mode ? 'settings-lang-btn--active' : ''}`}
                    onClick={() => setLocalNameMode(mode)}
                  >
                    {i18n.t(mode === 'pooled' ? 'pooledRandomNames' : 'autodetectedNames')}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-note">{i18n.t('providerNameModeNote')}</div>
            <div className="settings-divider" />
            <div className="settings-row">
              <span className="settings-label">{i18n.t('textSize')}</span>
              <div className="settings-lang-btns">
                {TEXT_SIZE_PRESETS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`settings-lang-btn ${sizeKey === entry.key ? 'settings-lang-btn--active' : ''}`}
                    onClick={() => setSizeKey(entry.key)}
                  >
                    {i18n.t(entry.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-lang-btns">
                <button type="button" className="settings-lang-btn" onClick={() => controller.closeSettings()}>Cancel</button>
                <button
                  type="button"
                  className="settings-lang-btn settings-lang-btn--active"
                  onClick={() => controller.saveSettings(nameMode, preset.textScale, {
                    statusFontSize: preset.statusFontSize,
                    statusMaxWidth: preset.maxWidth,
                    statusBubbleH: preset.bubbleH,
                    statusPaddingH: preset.paddingH,
                    chatFontSize: preset.statusFontSize,
                  })}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (toastId: string) => void }) {
  return (
    <div id="toastContainer" className="toast-container">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast toast--${toast.tone}`} onClick={() => onDismiss(toast.id)}>
          {toast.message}
        </button>
      ))}
    </div>
  );
}

export function ClaudeVilleApp() {
  const controller = useMemo(() => new ClaudeVilleController(), []);
  const snapshot = useClaudeVilleSnapshot(controller);
  const stats = snapshot.world.getStats();
  const runtime = useWorldTimer(snapshot.world.startTime);

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
            <span id="statTime" className="topbar__stat-value">{runtime}</span>
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
          <Sidebar agents={snapshot.agents} selectedAgentId={snapshot.selectedAgentId} onToggle={(agentId) => controller.toggleAgent(agentId)} />

          <div className="content">
            {snapshot.mode === 'character' ? (
              <WorldView
                agents={snapshot.agents}
                buildings={snapshot.buildings}
                selectedAgentId={snapshot.selectedAgentId}
                bubbleConfig={snapshot.bubbleConfig}
                onSelectAgent={(agentId) => controller.selectAgent(agentId)}
                onClearSelection={() => controller.clearSelection()}
              />
            ) : null}
            <DashboardView active={snapshot.mode === 'dashboard'} agents={snapshot.agents} onSelect={(agentId) => controller.selectAgent(agentId)} />
          </div>

          <ActivityPanel agent={snapshot.selectedAgent} onClose={() => controller.clearSelection()} />
        </div>
      </div>

      <SettingsModal open={snapshot.settingsOpen} controller={controller} bubbleConfig={snapshot.bubbleConfig} />
      <ToastViewport toasts={snapshot.toasts} onDismiss={(toastId) => controller.dismissToast(toastId)} />
    </>
  );
}
