/**
 * Shared HTTP utilities for Node.js http.ServerResponse.
 * Replaces duplicated setCorsHeaders + sendJson + sendError + safeLimit in:
 *   - hubreceiver/server.ts
 *   - claudeville/server.ts
 */

import * as http from 'http';

type ServerResponse = http.ServerResponse;
type IncomingMessage = http.IncomingMessage;

/** Set permissive CORS headers (mirrors hubreceiver's version). */
function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Content-Type, Authorization');
}

/** Write a JSON response and end the request. */
function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Write an error JSON response. */
function sendError(res: ServerResponse, statusCode: number, message: string) {
  sendJson(res, statusCode, { error: message });
}

/**
 * Clamp a history-line limit to [1, 500], defaulting to 100.
 * Identical logic was copy-pasted in hubreceiver/server.ts and claudeville/server.ts.
 */
function safeLimit(limit: string | null | undefined) {
  const n = Number(limit);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
}

/**
 * Accumulate req body with an optional byte cap.
 * Resolves with { body, truncated: boolean }.
 * Rejects with a 413 if the limit is exceeded before 'end'.
 */
function readBoundedBody(req: IncomingMessage, maxBytes: number = Infinity) {
  return new Promise<{ body: string; truncated: boolean }>((resolve, reject) => {
    let body = Buffer.alloc(0);
    let truncated = false;

    req.on('data', (chunk: Buffer) => {
      if (body.length + chunk.length > maxBytes) {
        truncated = true;
        req.destroy();
        reject({ statusCode: 413, message: `body exceeds ${maxBytes} bytes` });
        return;
      }
      body = Buffer.concat([body, chunk]);
    });

    req.on('end', () => resolve({ body: body.toString('utf8'), truncated }));
    req.on('error', reject);
  });
}

export { setCorsHeaders, sendJson, sendError, safeLimit, readBoundedBody };
