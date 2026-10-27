// Lets the app reach this PC from anywhere, not just your Wi-Fi. Both sides use a private channel on
// ntfy.sh (a free public relay, no account) as a go-between: the app posts a request, this PC is
// listening, does it, and posts the answer. The PC only makes outgoing connections, so nothing changes on
// your router. The channel name and an encryption key are made here once and reach the phone in the QR
// code; every message is encrypted (AES-GCM), so ntfy.sh only ever sees scrambled text.
const crypto = require('crypto');
const db = require('./db');
const roku = require('./roku');

const SERVER = process.env.RELAY_SERVER || 'https://ntfy.sh';
const HEARTBEAT = 10 * 60 * 1000; // "I'm here" this often; the app counts a PC as online for 15 minutes after
const MAX_AGE = 2 * 60 * 1000; // ignore requests older than this, so a PC coming online never acts on old taps

const subtle = globalThis.crypto.subtle;
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

// This PC's channel and key, made on first run.
function creds() {
  let c = getSetting('relay');
  if (!c) {
    c = { server: SERVER, topic: 'st-' + crypto.randomBytes(18).toString('base64url'), key: crypto.randomBytes(32).toString('base64url') };
    setSetting('relay', c);
  }
  return c;
}

let cryptoKey = null;
async function key() {
  if (!cryptoKey) cryptoKey = await subtle.importKey('raw', unb64(creds().key), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return cryptoKey;
}
async function seal(obj) {
  const iv = crypto.randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await key(), Buffer.from(JSON.stringify(obj)));
  return b64(Buffer.concat([iv, Buffer.from(ct)]));
}
async function unseal(text) {
  try {
    const raw = unb64(text);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, await key(), raw.subarray(12));
    return JSON.parse(Buffer.from(pt).toString());
  } catch (e) {
    return null; // not ours, or tampered with
  }
}

async function publish(obj) {
  const c = creds();
  const res = await fetch(`${c.server}/${c.topic}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', Firebase: 'no' },
    body: await seal({ ...obj, from: 'pc', at: Date.now() })
  });
  if (!res.ok) throw new Error('relay ' + res.status);
}

let info = () => ({});
const state = { connected: false, lastHeartbeat: 0, lastRequest: 0 };

function tvSummary() {
  const s = roku.status();
  return { tv: s.device ? s.device.name : null, calibrated: !!s.calibration };
}

async function heartbeat() {
  // The dev server restarts on every save; don't let that use up the relay's daily allowance.
  const last = getSetting('relayHeartbeat') || 0;
  if (Date.now() - last < HEARTBEAT - 60000) return;
  try {
    const i = info();
    await publish({ t: 'here', name: i.name, ver: i.version, ...tvSummary() });
    setSetting('relayHeartbeat', Date.now());
    state.lastHeartbeat = Date.now();
  } catch (e) { /* tried again at the next interval */ }
}

const seen = new Set();
async function handle(msg) {
  if (!msg || msg.from !== 'app' || !msg.id || seen.has(msg.id)) return;
  seen.add(msg.id);
  if (seen.size > 200) seen.delete(seen.values().next().value);
  if (Date.now() - (msg.at || 0) > MAX_AGE) return;
  state.lastRequest = Date.now();
  const reply = (fields) => publish({ t: msg.t + '-reply', re: msg.id, ...fields }).catch(() => {});
  const i = info();
  if (msg.t === 'ping') return reply({ ok: true, name: i.name, ver: i.version, ...tvSummary() });
  // The keys saved on this PC (Connect page or config.local.json), so a paired phone needn't type them.
  // Only phones with this channel's key can ask, and the answer is encrypted like everything else.
  if (msg.t === 'keys') {
    const c = require('./config').load();
    if (!c.tmdbToken) return reply({ ok: false, error: `No TMDb key is saved on ${i.name}. Add one on its Connect page.` });
    return reply({ ok: true, tmdbToken: c.tmdbToken, omdbKey: c.omdbKey || '' });
  }
  if (msg.t === 'tv') {
    const s = roku.status();
    if (!s.device) return reply({ ok: false, error: `No TV is set up on ${i.name} yet. Open the remote on the PC to connect one.` });
    if (!s.calibration) return reply({ ok: false, error: `The TV's search path isn't calibrated on ${i.name} yet.` });
    // Answer straight away, then press: the presses take about 8 seconds.
    await reply({ ok: true, tv: s.device.name });
    try { await roku.openBySearch({ title: String(msg.title || '').slice(0, 60) }); } catch (e) { publish({ t: 'tv-failed', re: msg.id, error: e.message }).catch(() => {}); }
    return;
  }
  reply({ ok: false, error: 'Unknown request' });
}

// Listen on the channel for as long as the helper runs, reconnecting after drops.
async function listen() {
  let wait = 5000;
  for (;;) {
    try {
      const c = creds();
      const res = await fetch(`${c.server}/${c.topic}/json`);
      if (!res.ok) throw new Error('relay ' + res.status);
      state.connected = true;
      wait = 5000;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let n;
        while ((n = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, n).trim();
          buf = buf.slice(n + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.event === 'message') handle(await unseal(ev.message));
        }
      }
    } catch (e) { /* network hiccup: try again */ }
    state.connected = false;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 60000);
  }
}

// infoFn: who this PC is (pc.info), passed in to avoid a require loop.
function start(infoFn) {
  info = infoFn;
  creds();
  listen();
  heartbeat();
  setInterval(heartbeat, HEARTBEAT).unref();
}

// What the QR code carries so the app can use the same channel.
function pairing() {
  const c = creds();
  return { s: c.server, t: c.topic, k: c.key };
}

module.exports = { start, pairing, state };
