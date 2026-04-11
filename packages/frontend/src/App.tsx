import * as React from 'react';
import { pixelTheme } from '@claude-ville/ui';

export function App() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: pixelTheme.colors.background,
      }}
    >
      {/* TopBar placeholder */}
      <div
        style={{
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${pixelTheme.spacing.md}`,
          backgroundColor: pixelTheme.colors.surface,
          borderBottom: `1px solid ${pixelTheme.colors.border}`,
          fontFamily: pixelTheme.fontFamily.pixel,
          fontSize: pixelTheme.fontSize.base,
          color: pixelTheme.colors.accent,
        }}
      >
        ClaudeVille v0.1
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar placeholder */}
        <div
          style={{
            width: '240px',
            backgroundColor: pixelTheme.colors.surface,
            borderRight: `1px solid ${pixelTheme.colors.border}`,
            fontFamily: pixelTheme.fontFamily.pixel,
            fontSize: pixelTheme.fontSize.xs,
            color: pixelTheme.colors.border,
            padding: pixelTheme.spacing.md,
          }}
        >
          SIDEBAR
        </div>
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: pixelTheme.colors.border,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.sm,
            }}
          >
            CANVAS LOADING...
          </div>
        </main>
      </div>
    </div>
  );
}
