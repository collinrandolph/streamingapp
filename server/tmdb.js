// TMDb client with a SQLite cache and a small concurrency limit.
// Data from TMDb; streaming availability in watch/providers comes from JustWatch.
const db = require('./db');
const config = require('./config');

const BASE = 'https://api.themoviedb.org/3';
const MAX_CONCURRENT = 6;

let active = 0;
const waiting = [];
function acquire() {
  if (active < MAX_CONCURRENT) { active += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active -= 1;
}

const readCache = db.prepare('SELECT body, fetched_at FROM cache WHERE key = ?');
const writeCache = db.prepare('INSERT OR REPLACE INTO cache (key, body, fetched_at) VALUES (?, ?, ?)');

function hasKey() {
  const c = config.load();
  return !!(c.tmdbToken || c.tmdbApiKey);
}

// pathAndQuery like '/movie/550?append_to_response=credits'; ttl in seconds.
async function get(pathAndQuery, ttl) {
  const cached = readCache.get(pathAndQuery);
  if (cached && Date.now() - cached.fetched_at < ttl * 1000) return JSON.parse(cached.body);

  const c = config.load();
  if (!c.tmdbToken && !c.tmdbApiKey) {
    const err = new Error('No TMDb key yet. Add it to config.local.json.');
    err.status = 503;
    throw err;
  }
  let url = BASE + pathAndQuery;
  const headers = { accept: 'application/json' };
  if (c.tmdbToken) headers.authorization = 'Bearer ' + c.tmdbToken;
  else url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(c.tmdbApiKey);

  await acquire();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { headers });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 1;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) {
        if (cached) return JSON.parse(cached.body);
        const err = new Error('TMDb ' + res.status + ' for ' + pathAndQuery.split('?')[0]);
        err.status = res.status === 401 ? 401 : 502;
        throw err;
      }
      const body = await res.text();
      writeCache.run(pathAndQuery, body, Date.now());
      return JSON.parse(body);
    }
    if (cached) return JSON.parse(cached.body);
    throw Object.assign(new Error('TMDb rate limit'), { status: 429 });
  } finally {
    release();
  }
}

module.exports = { get, hasKey };
