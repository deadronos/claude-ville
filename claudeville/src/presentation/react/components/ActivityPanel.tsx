import { i18n } from '../../../config/i18n.js';
import { formatCost, formatNumber, getToolIcon, shortModel, shortProjectName, shortToolName, truncateText } from '../../shared/dashboardViewModel.js';
import { useSessionDetail } from '../hooks/useSessionDetail.js';
import { AvatarPreview } from './AvatarPreview.js';

export function ActivityPanel({ agent, onClose }: { agent: any | null; onClose: () => void }) {
  const detail = useSessionDetail(agent, !!agent, 2000);
  if (!agent) {
    return null;
  }

  const contextPercent = agent?.usage?.contextPercent ?? 0;
  const contextClass = contextPercent >= 90
    ? 'activity-panel__context-progress activity-panel__context-progress--danger'
    : contextPercent >= 70
      ? 'activity-panel__context-progress activity-panel__context-progress--warning'
      : 'activity-panel__context-progress';

  const statusLabel = agent
    ? agent.status === 'working'
      ? i18n.t('statusWorking')
      : agent.status === 'waiting'
        ? i18n.t('statusWaiting')
        : i18n.t('statusIdle')
    : 'No selection';

  const toolHistory = [...detail.toolHistory].reverse();
  const messages = [...detail.messages].reverse();

  return (
    <aside id="activityPanel" className="activity-panel" data-state="selected">
      <div className="activity-panel__header">
        <div className="activity-panel__header-copy">
          <span className="activity-panel__eyebrow">SELECTED AGENT</span>
          <span className="activity-panel__header-title">{agent ? 'Inspection panel' : 'Waiting for a live selection'}</span>
        </div>
        {agent ? <button id="panelClose" className="activity-panel__close" type="button" onClick={onClose}>Clear</button> : null}
      </div>

      <div className="activity-panel__hero">
        <AvatarPreview agent={agent} className="activity-panel__avatar" />
        <div className="activity-panel__hero-copy">
          <div className="activity-panel__hero-row">
            <span id="panelAgentName" className="activity-panel__name">{agent.name}</span>
            <span id="panelAgentStatus" className={`activity-panel__status activity-panel__status--${agent.status}`}>
              {statusLabel}
            </span>
          </div>
          <div className="activity-panel__hero-badges">
            <span id="panelProvider" className={`activity-panel__chip activity-panel__chip--provider provider-badge--${agent.provider || 'unknown'}`}>{agent.provider || 'claude'}</span>
            <span id="panelModel" className="activity-panel__chip activity-panel__chip--model">{shortModel(agent.model)}</span>
            <span className="activity-panel__chip activity-panel__chip--project">{shortProjectName(agent.projectPath, i18n.t('unknownProject'))}</span>
          </div>
          <div className="activity-panel__meta">
            <div className="activity-panel__meta-row">
              <span className="activity-panel__label">{i18n.t('role')}</span>
              <span id="panelRole" className="activity-panel__value">{agent.role || 'general'}</span>
            </div>
            <div className="activity-panel__meta-row">
              <span className="activity-panel__label">{i18n.t('team')}</span>
              <span id="panelTeam" className="activity-panel__value">{agent.teamName || '-'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="activity-panel__metrics">
        <div className="activity-panel__metric">
          <span className="activity-panel__metric-label">Context</span>
          <span className="activity-panel__metric-value">{contextPercent}%</span>
          <progress className={contextClass} max={100} value={contextPercent} />
        </div>
        <div className="activity-panel__metric">
          <span className="activity-panel__metric-label">Input tokens</span>
          <span className="activity-panel__metric-value">{formatNumber(agent.tokens?.input || 0)}</span>
        </div>
        <div className="activity-panel__metric">
          <span className="activity-panel__metric-label">Output tokens</span>
          <span className="activity-panel__metric-value">{formatNumber(agent.tokens?.output || 0)}</span>
        </div>
        <div className="activity-panel__metric">
          <span className="activity-panel__metric-label">Est. cost</span>
          <span className="activity-panel__metric-value">{formatCost(agent.cost || 0)}</span>
        </div>
      </div>

      <div className="activity-panel__section">
        <div className="activity-panel__section-head">
          <div className="activity-panel__section-title">Current tool</div>
          <div className="activity-panel__section-pill">{detail.messages.length} messages tracked</div>
        </div>
        <div id="panelCurrentTool" className={`activity-panel__current-tool ${agent.currentTool ? '' : 'activity-panel__current-tool--idle'}`}>
          <span className="activity-panel__tool-icon">{agent.currentTool ? getToolIcon(agent.currentTool) : agent.status === 'idle' ? '💤' : '⏳'}</span>
          <div className="activity-panel__tool-detail">
            <span className="activity-panel__tool-name">{agent.currentTool || (agent.status === 'idle' ? 'Idle' : 'Waiting...')}</span>
            <span className="activity-panel__tool-input">{agent.currentToolInput || 'No tool input captured yet'}</span>
          </div>
        </div>
        {agent.lastMessage ? <div className="activity-panel__signal">{agent.lastMessage}</div> : null}
      </div>

      <div className="activity-panel__section activity-panel__section--grow">
        <div className="activity-panel__section-title">Tool history</div>
        <div id="panelToolHistory" className="activity-panel__tool-history">
          {toolHistory.length === 0 ? (
            <div className="activity-panel__empty">No tool usage</div>
          ) : (
            toolHistory.map((tool, index) => (
              <div key={`${agent.id}-tool-${index}`} className="activity-panel__tool-item">
                <span className="activity-panel__tool-item-icon">{getToolIcon(tool.tool)}</span>
                <div className="activity-panel__tool-item-copy">
                  <span className="activity-panel__tool-item-name">{shortToolName(tool.tool)}</span>
                  <span className="activity-panel__tool-item-detail">{truncateText(tool.detail, 96)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="activity-panel__section activity-panel__section--grow">
        <div className="activity-panel__section-title">Messages</div>
        <div id="panelMessages" className="activity-panel__messages">
          {messages.length === 0 ? (
            <div className="activity-panel__empty">No messages</div>
          ) : (
            messages.map((message, index) => (
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
