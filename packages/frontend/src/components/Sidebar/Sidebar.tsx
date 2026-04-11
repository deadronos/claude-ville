import * as React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { sessionsAtom, selectedAgentIdAtom, panelOpenAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';

export function Sidebar() {
  const sessions = useAtomValue(sessionsAtom);
  const [selectedAgentId, setSelectedAgentId] = useAtom(selectedAgentIdAtom);
  const [, setPanelOpen] = useAtom(panelOpenAtom);

  const handleAgentClick = (sessionId: string) => {
    const isDeselecting = sessionId === selectedAgentId;
    setSelectedAgentId(isDeselecting ? null : sessionId);
    setPanelOpen(!isDeselecting);
  };

  return (
    <aside
      style={{
        width: '240px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: pixelTheme.colors.surface,
        borderRight: `1px solid ${pixelTheme.colors.border}`,
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
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.text,
          }}
        >
          AGENTS
        </span>
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.accent,
          }}
        >
          {sessions.length}
        </span>
      </div>

      {/* Agent list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: pixelTheme.spacing.xs }}>
        {sessions.length === 0 ? (
          <div
            style={{
              padding: pixelTheme.spacing.md,
              textAlign: 'center',
              color: pixelTheme.colors.border,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.xs,
            }}
          >
            NO AGENTS
          </div>
        ) : (
          sessions.map(session => {
            const isSelected = session.sessionId === selectedAgentId;
            return (
              <div
                key={session.sessionId}
                onClick={() => handleAgentClick(session.sessionId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: pixelTheme.spacing.sm,
                  padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.sm}`,
                  marginBottom: pixelTheme.spacing.xs,
                  backgroundColor: isSelected ? pixelTheme.colors.surfaceAlt : 'transparent',
                  border: `1px solid ${isSelected ? pixelTheme.colors.accent : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s, border-color 0.15s',
                }}
              >
                {/* Status dot */}
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor:
                      session.status === 'working'
                        ? pixelTheme.colors.working
                        : session.status === 'idle'
                        ? pixelTheme.colors.idle
                        : pixelTheme.colors.warning,
                    flexShrink: 0,
                  }}
                />
                {/* Agent info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: pixelTheme.fontFamily.pixel,
                      fontSize: pixelTheme.fontSize.xs,
                      color: isSelected ? pixelTheme.colors.accent : pixelTheme.colors.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {session.project || session.provider}
                  </div>
                  <div
                    style={{
                      fontFamily: pixelTheme.fontFamily.pixel,
                      fontSize: '8px',
                      color: pixelTheme.colors.border,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {session.provider}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}