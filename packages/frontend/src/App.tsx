import * as React from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { WorldCanvas } from './components/WorldCanvas';
import { ActivityPanel } from './components/ActivityPanel';
import { ToastContainer } from './components/Toast';
import { useHubClient } from './hub-client';
import { pixelTheme } from '@claude-ville/ui';

function AppInner() {
  useHubClient();

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
          <WorldCanvas />
        </main>
        <ActivityPanel />
      </div>
      <ToastContainer />
    </div>
  );
}

export function App() {
  return <AppInner />;
}
