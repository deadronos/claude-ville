// Must come first: these variant apps reach the hub through HubDataSource,
// which reads window.__CLAUDEVILLE_CONFIG__ on construction.
import '../../runtime-config.js';

import { createRoot } from 'react-dom/client';

import { PixiVillageApp } from './PixiVillageApp.js';

createRoot(document.getElementById('root')!).render(<PixiVillageApp />);
