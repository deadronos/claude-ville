import * as React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { modeAtom, workingAgentsAtom, idleAgentsAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { Badge } from '@claude-ville/ui/src/components/badge';
import { Button } from '@claude-ville/ui/src/components/button';

export function TopBar() {
  const [mode, setMode] = useAtom(modeAtom);
  const workingAgents = useAtomValue(workingAgentsAtom);
  const idleAgents = useAtomValue(idleAgentsAtom);
  const [time, setTime] = React.useState('00:00:00');

  React.useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        [now.getHours(), now.getMinutes(), now.getSeconds()]
          .map(n => String(n).padStart(2, '0'))
          .join(':')
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      style={{
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${pixelTheme.spacing.md}`,
        backgroundColor: pixelTheme.colors.surface,
        borderBottom: `1px solid ${pixelTheme.colors.border}`,
        flexShrink: 0,
        gap: pixelTheme.spacing.lg,
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm }}>
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.base,
            color: pixelTheme.colors.accent,
          }}
        >
          ClaudeVille
        </span>
        <span
          style={{
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.border,
          }}
        >
          v0.1
        </span>
      </div>

      {/* Center: Stats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.lg, flex: 1, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.xs }}>
          <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.border }}>
            TIME
          </span>
          <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.sm, color: pixelTheme.colors.text }}>
            {time}
          </span>
        </div>
        <div style={{ display: 'flex', gap: pixelTheme.spacing.sm }}>
          <Badge variant="working" size="sm">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: pixelTheme.colors.working, display: 'inline-block' }} />
            {workingAgents.length} WORKING
          </Badge>
          <Badge variant="idle" size="sm">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: pixelTheme.colors.idle, display: 'inline-block' }} />
            {idleAgents.length} IDLE
          </Badge>
        </div>
      </div>

      {/* Right: Mode toggle + Settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: pixelTheme.spacing.sm }}>
        <Button
          size="sm"
          variant={mode === 'world' ? 'accent' : 'default'}
          onClick={() => setMode('world')}
        >
          WORLD
        </Button>
        <Button
          size="sm"
          variant={mode === 'dashboard' ? 'accent' : 'default'}
          onClick={() => setMode('dashboard')}
        >
          DASHBOARD
        </Button>
        <Button size="sm" variant="ghost" title="Settings">
          ⚙
        </Button>
      </div>
    </header>
  );
}