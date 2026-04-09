require('../load-local-env');

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.FRONTEND_PORT || 3001);
const STATIC_DIR = path.join(__dirname, '..', 'claudeville');
const HUB_HTTP_URL = process.env.HUB_HTTP_URL || process.env.HUB_URL || 'http://localhost:3030';
const HUB_WS_URL = process.env.HUB_WS_URL || HUB_HTTP_URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendError(res, statusCode, message) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: message }));
}

function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  setCorsHeaders(res);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath, contentType.startsWith('text') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('svg')
    ? { encoding: 'utf-8' }
    : undefined).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/runtime-config.js') {
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(`window.__CLAUDEVILLE_CONFIG__ = {\n  hubHttpUrl: ${JSON.stringify(HUB_HTTP_URL)},\n  hubWsUrl: ${JSON.stringify(HUB_WS_URL)}\n};\n`);
    return;
  }

  let filePath = path.join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(STATIC_DIR)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  filePath = resolvedPath.split('?')[0];
  if (!fs.existsSync(filePath)) {
    sendError(res, 404, 'Not Found');
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, 'Not Found');
      return;
    }
  }

  serveFile(req, res, filePath);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`frontend listening on http://localhost:${PORT}`);
});
