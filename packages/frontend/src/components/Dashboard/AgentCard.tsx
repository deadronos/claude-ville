// packages/frontend/src/components/Dashboard/AgentCard.tsx

import * as React from 'react';
import { motion } from 'framer-motion';
import type { Session } from '../../store';
import { AvatarCanvas } from './AvatarCanvas';
import { pixelTheme } from '@claude-ville/ui';

const PROVIDER_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  claude:   { label: 'Claude',   color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  codex:    { label: 'Codex',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  gemini:   { label: 'Gemini',   color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  openclaw: { label: 'OpenClaw', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  copilot:  { label: 'Copilot',  color: '#22d3ee', bg: 'rgba(34,211,238,0.15)' },
};

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📁',
  Bash: '⚡', Task: '📋', WebSearch: '🌐', SendMessage: '💬',
};

const PROJECT_COLORS = [
  '#e8d44d', '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#f472b6', '#34d399', '#fb923c', '#818cf8', '#22d3ee',
];

interface Props {
  agent: Session;
  projectColor: string;
  toolHistory?: Array<{ tool: string; detail?: string }>;
  onSelect: (agent: Session) => void;
}

export function AgentCard({ agent, projectColor, toolHistory = [], onSelect }: Props) {
  const badge = PROVIDER_BADGES[agent.provider] || PROVIDER_BADGES.claude;
  const statusColor = agent.status === 'working' ? pixelTheme.colors.working
    : agent.status === 'idle' ? pixelTheme.colors.idle
    : pixelTheme.colors.warning;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={() => onSelect(agent)}
      style={{
        backgroundColor: pixelTheme.colors.surface,
        border: `1px solid ${pixelTheme.colors.border}`,
        borderTop: `2px solid ${statusColor}`,
        cursor: 'pointer',
        padding: pixelTheme.spacing.sm,
        borderRadius: '2px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm, marginBottom: pixelTheme.spacing.sm }}>
        <AvatarCanvas agent={agent as unknown as Parameters<typeof AvatarCanvas>[0]['agent']} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.project || agent.provider}
          </div>
          <div style={{ display: 'flex', gap: pixelTheme.spacing.xs, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: badge.color, background: badge.bg, padding: '1px 4px' }}>{badge.label}</span>
            <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>{(agent.model || '').replace('claude-', '').replace(/-2025\d+/, '')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor, display: 'inline-block' }} />
          <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: statusColor }}>{agent.status?.toUpperCase()}</span>
        </div>
      </div>

      {/* Current Tool */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.xs, marginBottom: pixelTheme.spacing.xs }}>
        <span style={{ fontSize: '12px' }}>{agent.currentTool ? (TOOL_ICONS[agent.currentTool.name] || '🔧') : '💤'}</span>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text }}>
          {agent.currentTool?.name || (agent.status === 'idle' ? 'Idle' : 'Waiting')}
        </span>
      </div>

      {/* Tool History */}
      {toolHistory.length > 0 && (
        <div>
          <div style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border, marginBottom: '4px' }}>TOOLS</div>
          {toolHistory.slice(-3).reverse().map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '10px' }}>{TOOL_ICONS[t.tool] || '🔧'}</span>
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.tool}
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
