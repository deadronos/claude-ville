import { i18n } from '../../../config/i18n.js';
import { formatCost, formatNumber, getToolIcon, shortModel, shortToolName, truncateText } from '../../shared/dashboardViewModel.js';
import { useSessionDetail } from '../hooks/useSessionDetail.js';

export function ActivityPanel({ agent, onClose }: { agent: any | null; onClose: () => void }) {
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
            <div
              className={contextClass}
              ref={(node) => {
                if (!node) {
                  return;
                }
                node.style.width = contextPercent > 0 ? `${contextPercent}%` : '0';
                node.style.opacity = contextPercent > 0 ? '1' : '0';
              }}
            />
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
                <span className="activity-panel__tool-item-detail">{truncateText(tool.detail, 45)}</span>
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
