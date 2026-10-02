// Must come first: assigns window.__CLAUDEVILLE_CONFIG__ when nothing else set
// it. Any config read happens later, on first use, so this just has to run
// first. See claudeville/runtime-config.ts.
import '../../runtime-config.js';

import { createRoot } from 'react-dom/client';

import { PixiVillageApp } from './PixiVillageApp.js';

createRoot(document.getElementById('root')!).render(<PixiVillageApp />);
