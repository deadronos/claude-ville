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

module.exports = { setCorsHeaders, sendJson, sendError, safeLimit };
