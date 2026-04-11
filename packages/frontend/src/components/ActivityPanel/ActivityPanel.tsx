import * as React from 'react';
import { useAtomValue } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { selectedAgentAtom, panelOpenAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { useActivityPanel } from '../../hooks/useActivityPanel';

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📁',
  Bash: '⚡', Task: '📋', WebSearch: '🌐', SendMessage: '💬',
};

export function ActivityPanel() {
  const agent = useAtomValue(selectedAgentAtom);
  const isOpen = useAtomValue(panelOpenAtom);
  const { detail, currentTool } = useActivityPanel(agent);

  return (
    <AnimatePresence>
      {isOpen && agent && (
        <motion.aside
          key="activity-panel"
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{
            width: '320px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: pixelTheme.colors.surface,
            borderLeft: `1px solid ${pixelTheme.colors.border}`,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.md}`,
              borderBottom: `1px solid ${pixelTheme.colors.border}`,
            }}
          >
            <div>
              <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text }}>
                {agent.project || agent.provider}
              </div>
              <div style={{
                fontFamily: pixelTheme.fontFamily.pixel,
                fontSize: pixelTheme.fontSize.xs,
                color: agent.status === 'working' ? pixelTheme.colors.working
                  : agent.status === 'idle' ? pixelTheme.colors.idle
                  : pixelTheme.colors.warning,
              }}>
                {agent.status?.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Meta */}
          <div style={{ padding: pixelTheme.spacing.sm, borderBottom: `1px solid ${pixelTheme.colors.border}` }}>
            {[
              ['MODEL', (agent.model || '').replace('claude-', '').replace(/-2025\d+/, '')],
              ['PROVIDER', agent.provider || 'claude'],
              ['ROLE', agent.role || 'general'],
              ['TEAM', agent.team || '-'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: pixelTheme.spacing.xs }}>
                <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>{label}</span>
                <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Current Tool */}
          <div style={{ padding: pixelTheme.spacing.sm, borderBottom: `1px solid ${pixelTheme.colors.border}` }}>
            <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: pixelTheme.spacing.xs }}>CURRENT TOOL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm }}>
              <span style={{ fontSize: '16px' }}>{currentTool ? (TOOL_ICONS[currentTool] || '🔧') : '💤'}</span>
              <div>
                <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>
                  {currentTool || (agent.status === 'idle' ? 'Idle' : 'Waiting...')}
                </div>
                {agent.currentTool?.input && (
                  <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.currentTool.input}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tool History */}
          <div style={{ flex: 1, overflowY: 'auto', padding: pixelTheme.spacing.sm }}>
            <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: pixelTheme.spacing.xs }}>TOOL HISTORY</div>
            {detail?.toolHistory?.length ? (
              [...detail.toolHistory].reverse().map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.xs, marginBottom: pixelTheme.spacing.xs }}>
                  <span style={{ fontSize: '12px' }}>{TOOL_ICONS[t.name] || '🔧'}</span>
                  <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>{t.name}</span>
                </div>
              ))
            ) : (
              <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>No tool usage</div>
            )}
          </div>

          {/* Messages */}
          <div style={{ maxHeight: '200px', overflowY: 'auto', padding: pixelTheme.spacing.sm, borderTop: `1px solid ${pixelTheme.colors.border}` }}>
            <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: pixelTheme.spacing.xs }}>MESSAGES</div>
            {detail?.messages?.length ? (
              [...detail.messages].reverse().slice(0, 10).map((m, i) => (
                <div key={i} style={{ marginBottom: pixelTheme.spacing.sm }}>
                  <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: m.role === 'assistant' ? pixelTheme.colors.accent : pixelTheme.colors.warning }}>{m.role}</div>
                  <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>{m.text?.substring(0, 100)}</div>
                </div>
              ))
            ) : (
              <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>No messages</div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}