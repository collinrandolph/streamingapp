// HTTP server: serves the phone web app from web/ and the JSON API under /api.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const api = require('./api');

const PORT = Number(process.env.PORT) || 8787;
const WEB = path.join(__dirname, '..', 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      // Unknown paths fall back to the app shell.
      return fs.readFile(path.join(WEB, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try {
      const body = req.method === 'POST' ? await readJson(req) : null;
      const out = await api.handle(req.method, url.pathname, url.searchParams, body);
      sendJson(res, 200, out);
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message });
    }
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Streaming tracker running:');
  console.log('  This PC:   http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log('  Your phone: http://' + n.address + ':' + PORT);
    }
  }
});
