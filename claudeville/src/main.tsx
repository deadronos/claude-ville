// Must come first: sets window.__CLAUDEVILLE_CONFIG__ from the inlined
// build-time values when nothing else has (e.g. a production bundle served by
// static hosting, where /runtime-config.js does not exist). See
// claudeville/runtime-config.ts and docs/architecture/001-split-stack-runtime.md.
import '../runtime-config.js';

import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from './presentation/react/ErrorBoundary.js';
import { ClaudeVilleApp } from './presentation/react/ClaudeVilleApp.js';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ClaudeVille root element not found');
}

createRoot(rootElement).render(
  <ErrorBoundary>
    <ClaudeVilleApp />
  </ErrorBoundary>,
);
