import { createRoot } from 'react-dom/client';

import { ClaudeVilleApp } from './presentation/react/ClaudeVilleApp.js';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ClaudeVille root element not found');
}

createRoot(rootElement).render(
  <ClaudeVilleApp />,
);
