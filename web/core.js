'use strict';
// Runs the app's data code (the same api.js, tmdb.js, tracking.js, good.js and wikidata.js the PC uses)
// inside the browser, so the app works with the PC off. SQLite comes from sql.js; your data and the API
// cache are kept on this device in IndexedDB. In the browser the Roku goes through the PC (see web/app.js);
// in the Android app this page runs roku.js too and reaches the TV itself.

// The Android app (Capacitor) can make plain-http requests on the Wi-Fi, which a web page can't.
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const SQLJS = NATIVE ? 'vendor/sql.js/' : 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
const CORE_MODULES = ['schema', 'tmdb', 'wikidata', 'tracking', 'good', 'api', ...(NATIVE ? ['roku'] : [])];
const CACHE_MAX_AGE = 30 * 864e5; // API responses older than this are dropped at start-up
const SETTINGS_KEY = 'trackerSettings';

// ---------- Settings (stand-in for server/config.js) ----------

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* not saved */ }
  return next;
}

// ---------- IndexedDB ----------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('streaming-tracker', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('cache');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbReq(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load " + src + '. Check your connection.'));
    document.head.appendChild(s);
  });
}

// ---------- Database (stand-in for server/db.js) ----------

// Gives sql.js the slice of node:sqlite's DatabaseSync API the shared code uses: exec, and prepare().get/all/run.
// The API cache lives in a Map backed by its own IndexedDB store, so big responses never rewrite the main file.
function makeDb(sql, cache, idb) {
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  };
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const bytes = sql.export();
    idb.transaction('kv', 'readwrite').objectStore('kv').put(bytes, 'db');
  };
  const args = (p) => p.map((v) => (v === undefined ? null : v));

  const db = {
    exec(text) { sql.exec(text); persist(); },
    prepare(text) {
      const t = text.trim();
      if (t === 'SELECT body, fetched_at FROM cache WHERE key = ?') {
        return { get: (key) => cache.get(key) };
      }
      if (t === 'INSERT OR REPLACE INTO cache (key, body, fetched_at) VALUES (?, ?, ?)') {
        return {
          run: (key, body, at) => {
            const row = { body, fetched_at: at };
            cache.set(key, row);
            idb.transaction('cache', 'readwrite').objectStore('cache').put(row, key);
            return { changes: 1 };
          }
        };
      }
      return {
        get(...p) {
          const st = sql.prepare(t);
          try { st.bind(args(p)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
        },
        all(...p) {
          const st = sql.prepare(t);
          const rows = [];
          try { st.bind(args(p)); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
          return rows;
        },
        run(...p) {
          sql.run(t, args(p));
          const changes = sql.getRowsModified();
          const id = sql.exec('SELECT last_insert_rowid()')[0].values[0][0];
          persist();
          return { changes, lastInsertRowid: id };
        }
      };
    },
    flush
  };
  return db;
}

// ---------- Module loader ----------

// The shared files are CommonJS; this gives them require() for each other plus the browser stand-ins.
function makeRequire(sources, shims) {
  const done = {};
  const req = (name) => {
    const key = name.replace(/^\.\//, '').replace(/\.js$/, '');
    if (key in shims) return shims[key];
    if (key in done) return done[key].exports;
    if (!(key in sources)) throw new Error('Module not available in the browser: ' + name);
    const module = { exports: {} };
    done[key] = module;
    new Function('require', 'module', 'exports', sources[key] + '\n//# sourceURL=core/' + key + '.js')(req, module, module.exports);
    return module.exports;
  };
  return req;
}

// The Roku is reached through the PC, never from the browser's copy of the code.
const rokuShim = new Proxy({}, {
  get: () => () => { throw Object.assign(new Error('Watch on TV goes through your PC.'), { status: 409 }); }
});

// In the Android app: the slice of node's http that roku.js uses, sent through Capacitor's native HTTP.
const nativeHttp = {
  request(o, onResponse) {
    const handlers = {};
    let done = false;
    const finish = (fn) => { if (!done) { done = true; fn(); } };
    const req = {
      on(ev, fn) { handlers[ev] = fn; return req; },
      destroy(err) { finish(() => handlers.error && handlers.error(err)); },
      end() {
        setTimeout(() => { if (!done && handlers.timeout) handlers.timeout(); }, (o.timeout || 4000) + 500);
        Capacitor.nativePromise('CapacitorHttp', 'request', {
          url: `http://${o.host}:${o.port}${o.path}`, method: o.method, headers: {}, responseType: 'text',
          connectTimeout: o.timeout || 4000, readTimeout: o.timeout || 4000
        }).then((r) => finish(() => {
          const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
          const res = { statusCode: r.status, on(ev, fn) { if (ev === 'data') fn(body); if (ev === 'end') fn(); return res; } };
          onResponse(res);
        }), (e) => finish(() => handlers.error && handlers.error(new Error(e.message || 'no answer'))));
      }
    };
    return req;
  }
};

// ---------- Boot ----------

async function bootCore() {
  const [idb] = await Promise.all([idbOpen(), window.initSqlJs ? null : loadScript(SQLJS + 'sql-wasm.js')]);
  const [SQL, bytes, cacheRows, cacheKeys, sources] = await Promise.all([
    window.initSqlJs({ locateFile: (f) => SQLJS + f }),
    idbReq(idb.transaction('kv').objectStore('kv').get('db')),
    idbReq(idb.transaction('cache').objectStore('cache').getAll()),
    idbReq(idb.transaction('cache').objectStore('cache').getAllKeys()),
    Promise.all(CORE_MODULES.map((m) => fetch('core/' + m + '.js').then((r) => {
      if (!r.ok) throw new Error("Couldn't load the app's data code (" + m + ').');
      return r.text();
    })))
  ]);
  const sql = bytes ? new SQL.Database(bytes) : new SQL.Database();

  // Load the cache, dropping anything too old to be worth keeping.
  const cache = new Map();
  const stale = [];
  cacheKeys.forEach((k, i) => {
    if (Date.now() - cacheRows[i].fetched_at > CACHE_MAX_AGE) stale.push(k);
    else cache.set(k, cacheRows[i]);
  });
  if (stale.length) {
    const store = idb.transaction('cache', 'readwrite').objectStore('cache');
    stale.forEach((k) => store.delete(k));
  }

  const db = makeDb(sql, cache, idb);
  const config = {
    load: () => {
      const s = loadSettings();
      return { tmdbToken: s.tmdbToken || '', tmdbApiKey: '', omdbKey: s.omdbKey || '', region: s.region || 'US', dataDir: null };
    }
  };
  const src = Object.fromEntries(CORE_MODULES.map((m, i) => [m, sources[i]]));
  const shims = NATIVE ? { db, config, http: nativeHttp, dgram: {} } : { db, config, roku: rokuShim };
  const require = makeRequire(src, shims);
  require('schema').applySchema(db);
  if (NATIVE) {
    // The web view can't send UDP, so the Wi-Fi search for Rokus is done natively (RokuFindPlugin.java).
    const roku = require('roku');
    roku.find = async () => {
      const r = await Capacitor.nativePromise('RokuFind', 'find', {});
      return { found: await Promise.all((r.ips || []).map((ip) => roku.deviceInfo(ip).catch(() => ({ ip, name: 'Roku' })))) };
    };
  }
  const api = require('api');

  // Write pending changes before the page goes to the background or closes.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') db.flush(); });
  window.addEventListener('pagehide', () => db.flush());

  return {
    handle: api.handle,
    flush: db.flush,
    isEmpty: () => !db.prepare('SELECT 1 FROM library LIMIT 1').get() && !db.prepare('SELECT 1 FROM services LIMIT 1').get(),
    settings: loadSettings,
    saveSettings
  };
}
