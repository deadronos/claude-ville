/**
 * Shared HTTP utilities for Node.js http.ServerResponse.
 * Replaces duplicated setCorsHeaders + sendJson + sendError + safeLimit in:
 *   - hubreceiver/server.ts
 *   - claudeville/server.ts
 */

const http = require('http');

/** Set permissive CORS headers (mirrors hubreceiver's version). */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Content-Type, Authorization');
}

/** Write a JSON response and end the request. */
function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Write an error JSON response. */
function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

/**
 * Clamp a history-line limit to [1, 500], defaulting to 100.
 * Identical logic was copy-pasted in hubreceiver/server.ts and claudeville/server.ts.
 */
function safeLimit(limit) {
  const n = Number(limit);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
}

/**
 * Accumulate req body with an optional byte cap.
 * Resolves with { body, truncated: boolean }.
 * Rejects with a 413 if the limit is exceeded before 'end'.
 */
function readBoundedBody(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    let body = Buffer.alloc(0);
    let truncated = false;

    req.on('data', (chunk) => {
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

module.exports = { setCorsHeaders, sendJson, sendError, safeLimit, readBoundedBody };
