import * as http from 'http';

import { adapters } from './adapters/index.js';

export type HttpRequest = http.IncomingMessage;
export type HttpResponse = http.ServerResponse;

// Claude adapter (teams/tasks are Claude-only)
export const claudeAdapter = adapters.find((a: { provider: string }) => a.provider === 'claude');

// ─── Config ────────────────────────────────────────────────
export const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
export let boundPort = PORT;
export function setBoundPort(port: number) {
  boundPort = port;
}
export const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
