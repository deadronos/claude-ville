import * as React from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { pixelTheme } from '@claude-ville/ui';

function AppInner() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: pixelTheme.colors.background,
      }}
    >
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
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

export function App() {
  return <AppInner />;
}
