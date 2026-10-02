// Must come first: assigns window.__CLAUDEVILLE_CONFIG__ from the inlined
// build-time values when nothing else set it (a production bundle served by
// static hosting, where /runtime-config.js does not exist). Any config read
// happens later, on first use, so this just has to run first.
// See claudeville/runtime-config.ts and docs/architecture/001-split-stack-runtime.md.
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
