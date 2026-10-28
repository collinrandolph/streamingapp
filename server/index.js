// HTTP server: the PC helper. Serves the web app (web/), the shared data code (/core/), the Connect page
// with the QR code (/connect), and the PC-only API: the Roku, your list for copying to the phone, the keys.
// Packaged as StreamingTracker-PC.exe it opens the Connect page on start (unless started with --background).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');
const api = require('./api');
const config = require('./config');
const assets = require('./assets');
const pc = require('./pc');
const relay = require('./relay');

const PORT = Number(process.env.PORT) || 8787;
const BACKGROUND = process.argv.includes('--background');
// The data code the browser runs too; served at /core/ (GitHub Pages gets the same files there).
const CORE_FILES = ['api.js', 'tmdb.js', 'tracking.js', 'good.js', 'wikidata.js', 'schema.js'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

// What the Connect page shows about the saved keys: set or not, a recognisable hint, and when it was saved.
function keyStatus(c) {
  const t = c.tmdbToken || '';
  let savedAt = null;
  try { savedAt = fs.statSync(config.CONFIG_FILE).mtimeMs; } catch (e) { /* no file yet */ }
  return { tmdb: !!t, omdb: !!c.omdbKey, hint: t ? t.slice(0, 6) + '…' + t.slice(-4) : '', savedAt };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendFile(res, name, buf) {
  res.writeHead(200, { 'content-type': TYPES[path.extname(name)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(buf);
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
  const buf = assets.read('web/' + rel);
  if (buf) return sendFile(res, rel, buf);
  // Unknown paths fall back to the app shell.
  const html = assets.read('web/index.html');
  if (!html) { res.writeHead(404); return res.end('Not found'); }
  sendFile(res, 'index.html', html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Who this PC is and how to reach it; also lets a page tell it was served by the PC.
  if (url.pathname === '/api/ping') return sendJson(res, 200, pc.info(PORT));
  // The Connect page and its data: the QR link and the start-with-Windows switch.
  if (url.pathname === '/connect') return sendFile(res, 'connect.html', assets.read('connect.html'));
  if (url.pathname === '/api/connect') {
    const c = config.load();
    return sendJson(res, 200, { ...pc.info(PORT), link: pc.pairLink(PORT), app: pc.APP_URL, startup: pc.startup(), relay: relay.state.connected, keys: keyStatus(c) });
  }
  // Keys are typed in on the PC itself (the Connect page); other devices on the network can't change them.
  if (url.pathname === '/api/keys' && req.method === 'POST') {
    if (!/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '')) return sendJson(res, 403, { error: 'Keys can only be changed on the PC itself.' });
    try {
      const c = config.saveKeys(await readJson(req));
      return sendJson(res, 200, keyStatus(c));
    } catch (e) { return sendJson(res, e.status || 500, { error: e.message }); }
  }
  if (url.pathname === '/api/startup' && req.method === 'POST') {
    try { return sendJson(res, 200, pc.setStartup(!!(await readJson(req)).on)); } catch (e) { return sendJson(res, e.status || 500, { error: e.message }); }
  }
  // The app keeps its own copy of the keys; opened from the PC, it takes them from config.local.json.
  if (url.pathname === '/api/keys') {
    const c = config.load();
    return sendJson(res, 200, { tmdbToken: c.tmdbToken || '', omdbKey: c.omdbKey || '' });
  }
  const core = url.pathname.match(/^\/core\/([a-z]+\.js)$/);
  if (core && CORE_FILES.includes(core[1])) {
    const buf = assets.read('core/' + core[1]);
    if (!buf) { res.writeHead(404); return res.end(); }
    return sendFile(res, core[1], buf);
  }
  const prof = url.pathname.match(/^\/api\/profiles\/(list|create|link|sync|restore|unlink)$/);
  if (prof) {
    try {
      const P = require('./profiles');
      return sendJson(res, 200, prof[1] === 'list' ? P.list() : P[prof[1]](await readJson(req)));
    } catch (e) { return sendJson(res, e.status || 500, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      const body = req.method === 'POST' ? await readJson(req) : null;
      const out = await api.handle(req.method, url.pathname, url.searchParams, body);
      sendJson(res, 200, out);
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message, playing: e.playing, busy: e.busy, app: e.app });
    }
    return;
  }
  serveStatic(res, url.pathname);
});

function openConnectPage() {
  if (process.platform === 'win32') exec(`start "" "http://localhost:${PORT}/connect"`);
}

server.on('error', (e) => {
  // Already running (say, started with Windows): just show its Connect page and step aside.
  if (e.code === 'EADDRINUSE') {
    console.log('The PC helper is already running on port ' + PORT + '.');
    if (config.PACKAGED && !BACKGROUND) openConnectPage();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw e;
});

server.listen(PORT, '0.0.0.0', () => {
  const i = pc.info(PORT);
  relay.start(() => pc.info(PORT));
  console.log(`Streaming Tracker PC helper ${pc.VERSION} on ${i.name}`);
  console.log('  Connect a phone: http://localhost:' + PORT + '/connect');
  for (const a of i.addrs) console.log('  On your Wi-Fi:   http://' + a + ':' + PORT);
  if (config.PACKAGED) console.log('  Data: ' + config.load().dataDir + '\n  Keep this window open while you use Watch on TV. Close it to stop the helper.');
  if (config.PACKAGED && !BACKGROUND) openConnectPage();
});
