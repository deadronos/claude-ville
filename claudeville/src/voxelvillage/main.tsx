// Must come first: this app reaches the hub through HubDataSource, which reads
// window.__CLAUDEVILLE_CONFIG__ on construction.
import '../../runtime-config.js';

import { createRoot } from 'react-dom/client';

import { VoxelVillageApp } from './VoxelVillageApp.js';

createRoot(document.getElementById('root')!).render(<VoxelVillageApp />);
