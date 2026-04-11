// packages/frontend/src/components/Dashboard/Dashboard.tsx

import * as React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { sessionsAtom, selectedAgentIdAtom, panelOpenAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { AgentCard } from './AgentCard';

const PROJECT_COLORS = [
  '#e8d44d', '#4ade80', '#60a5fa', '#f97316', '#a78bfa',
  '#f472b6', '#34d399', '#fb923c', '#818cf8', '#22d3ee',
];

function groupByProject(sessions: ReturnType<typeof useAtomValue<typeof sessionsAtom>>) {
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = s.project || '_unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return groups;
}

export function Dashboard() {
  const sessions = useAtomValue(sessionsAtom);
  const [, setSelectedAgentId] = useAtom(selectedAgentIdAtom as any);
  const [, setPanelOpen] = useAtom(panelOpenAtom as any);
  const groups = React.useMemo(() => groupByProject(sessions), [sessions]);
  const projectColors = React.useMemo(() => {
    const m = new Map<string, string>();
    let idx = 0;
    for (const key of groups.keys()) {
      m.set(key, PROJECT_COLORS[idx % PROJECT_COLORS.length]);
      idx++;
    }
    return m;
  }, [groups]);

  const handleAgentSelect = (agent: typeof sessions[0]) => {
    setSelectedAgentId(agent.sessionId);
    setPanelOpen(true);
  };

  if (sessions.length === 0) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: pixelTheme.spacing.md }}>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '24px', color: pixelTheme.colors.border }}>~</span>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.border }}>NO ACTIVE AGENTS</span>
        <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>Start a Claude Code session to see agents here</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: pixelTheme.spacing.md }}>
      {Array.from(groups.entries()).map(([projectPath, agents]) => {
        const color = projectColors.get(projectPath)!;
        const projectName = projectPath === '_unknown' ? 'Unknown Project'
          : projectPath.includes('/Users/') ? '~/' + projectPath.split('/').slice(2).join('/').split('/').slice(-1)[0]
          : projectPath.split('/').pop() || projectPath;

        return (
          <div key={projectPath} style={{ marginBottom: pixelTheme.spacing.lg }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm, marginBottom: pixelTheme.spacing.sm, borderLeft: `3px solid ${color}`, paddingLeft: pixelTheme.spacing.sm }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text }}>{projectName}</span>
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: '8px', color: pixelTheme.colors.border }}>{agents.length} AGENTS</span>
            </div>

            {/* Agent grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: pixelTheme.spacing.sm }}>
              <AnimatePresence>
                {agents.map(agent => (
                  <AgentCard
                    key={agent.sessionId}
                    agent={agent}
                    projectColor={color}
                    onSelect={handleAgentSelect}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}
