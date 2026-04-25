import '../load-local-env.js';

import { createCollectorRuntime } from './index.js';

const runtime = createCollectorRuntime();
runtime.attachSignalHandlers();
void runtime.main().catch((error) => {
  console.error('[collector] fatal error:', error);
  process.exit(1);
});
