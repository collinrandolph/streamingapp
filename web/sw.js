// Service worker: keeps the app's own files on the device so it opens without a connection.
// App files: network first (so updates arrive), falling back to the stored copy offline.
// sql.js and posters: stored copy first, since they don't change.
// TMDb and Wikidata data aren't handled here; the app's data code caches those itself.
const VERSION = 'v5';
const SHELL = `shell-${VERSION}`;
const STATIC = 'static-v1';
const POSTERS = 'posters-v1';
const POSTER_LIMIT = 500;
const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
const FILES = [
  './', 'index.html', 'app.css', 'app.js', 'core.js', 'settings.js', 'profile.js', 'relay.js', 'good.js', 'remote.js', 'manifest.webmanifest', 'icon.svg', 'tmdb-logo.svg',
  'core/schema.js', 'core/tmdb.js', 'core/wikidata.js', 'core/tracking.js', 'core/good.js', 'core/api.js'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(FILES);
    await (await caches.open(STATIC)).addAll([SQLJS + 'sql-wasm.js', SQLJS + 'sql-wasm.wasm']);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, STATIC, POSTERS].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html'));
  }
}

async function cacheFirst(req, name, limit) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await cache.put(req, res.clone());
    if (limit) {
      const keys = await cache.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(k);
    }
  }
  return res;
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && !url.pathname.includes('/api/')) return ev.respondWith(networkFirst(req));
  if (url.href.startsWith(SQLJS) || url.href.startsWith('https://cdn.jsdelivr.net/npm/jsqr@')) return ev.respondWith(cacheFirst(req, STATIC));
  if (url.hostname === 'image.tmdb.org') return ev.respondWith(cacheFirst(req, POSTERS, POSTER_LIMIT));
});
