import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { buildRuntimeConfig } from '../runtime-config.shared.js';
import { MIME_TYPES } from '../shared/mime-types.js';
import { setCorsHeaders, sendError } from '../shared/http-utils.js';
import { boundPort, type HttpRequest, type HttpResponse } from './server-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILT_FRONTEND_DIR = path.join(__dirname, '..', 'dist', 'frontend');
const STATIC_DIR = fs.existsSync(path.join(BUILT_FRONTEND_DIR, 'index.html')) ? BUILT_FRONTEND_DIR : __dirname;

export function parseRequestUrl(req: HttpRequest) {
  const host = req.headers.host && /^[A-Za-z0-9.:[\]-]+$/.test(req.headers.host)
    ? req.headers.host
    : `localhost:${boundPort}`;
  return new URL(req.url ?? '/', `http://${host}`);
}

// ─── Static file serving ─────────────────────────────────────

export function handleStaticFile(req: HttpRequest, res: HttpResponse) {
  try {
    const reqUrl = req.url ?? '/';
    let filePath = path.join(STATIC_DIR, reqUrl === '/' ? 'index.html' : reqUrl);

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(STATIC_DIR)) {
      return sendError(res, 403, 'Forbidden');
    }

    filePath = resolvedPath.split('?')[0];

    if (!fs.existsSync(filePath)) {
      return sendError(res, 404, 'Not Found');
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      if (!fs.existsSync(filePath)) {
        return sendError(res, 404, 'Not Found');
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext as keyof typeof MIME_TYPES] || 'application/octet-stream';
    const isText = contentType.includes('text') ||
                   contentType.includes('javascript') ||
                   contentType.includes('json') ||
                   contentType.includes('svg');

    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath, isText ? { encoding: 'utf-8' } : undefined);
    stream.pipe(res);
    stream.on('error', (err: Error) => {
      console.error('file stream error:', err.message);
      if (!res.headersSent) {
        sendError(res, 500, 'Internal Server Error');
      }
    });
  } catch (err: unknown) {
    console.error('static file serving failed:', err instanceof Error ? err.message : String(err));
    if (!res.headersSent) {
      sendError(res, 500, 'Internal Server Error');
    }
  }
}

export function handleRuntimeConfig(req: HttpRequest, res: HttpResponse) {
  // The legacy server is itself the hub, so when no HUB_HTTP_URL env override
  // is set, expose this server's own origin. This keeps `/runtime-config.js`
  // working out of the box even after the shared default moved to the
  // split-stack hubreceiver port (3030).
  const legacyBase = `http://localhost:${boundPort}`;
  const env = {
    ...process.env,
    HUB_HTTP_URL: process.env.HUB_HTTP_URL || process.env.HUB_URL || legacyBase,
  };
  const runtimeConfig = buildRuntimeConfig(env);
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`window.__CLAUDEVILLE_CONFIG__ = ${JSON.stringify(runtimeConfig)};\n`);
}
