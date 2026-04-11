import * as React from 'react';
import { useAtomValue } from 'jotai';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { WorldCanvas } from './components/WorldCanvas';
import { Dashboard } from './components/Dashboard';
import { ActivityPanel } from './components/ActivityPanel';
import { ToastContainer } from './components/Toast';
import { Modal } from './components/Modal';
import { useHubClient } from './hub-client';
import { modeAtom } from './store';
import { pixelTheme } from '@claude-ville/ui';

function AppInner() {
  useHubClient();
  const mode = useAtomValue(modeAtom);

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
          {mode === 'world' ? <WorldCanvas /> : <Dashboard />}
        </main>
        <ActivityPanel />
      </div>
      <ToastContainer />
      <Modal />
    </div>
  );
}

export function App() {
  return <AppInner />;
}
