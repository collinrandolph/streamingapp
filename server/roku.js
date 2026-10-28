// Roku control over ECP (port 8060): a phone remote, and a search path you record once with the
// calibration wizard and the app replays to bring up a title's search results on the TV.
// With no Roku set up, everything is a dry run: presses are logged here instead of sent.
const http = require('http');
const dgram = require('dgram');
const db = require('./db');

const KEYS = new Set(['Home', 'Rev', 'Fwd', 'Play', 'Select', 'Left', 'Right', 'Down', 'Up', 'Back', 'InstantReplay', 'Info', 'Backspace', 'Search', 'Enter']);
const MOVES = { Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
const OPPOSITE = { Up: 'Down', Down: 'Up', Left: 'Right', Right: 'Left' };
// Waits used when replaying the recorded path, in ms. Generous: menus on older Rokus load slowly.
const WAIT = { press: 150, afterHome: 1800, afterStep: 500, afterOpenSearch: 1500 };
// The on-screen keyboard is assumed to be a grid of these characters in order, filled row by row.
const GRID_CHARS = 'abcdefghijklmnopqrstuvwxyz1234567890';

// ---------- Settings and log ----------

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}
function setSetting(key, value) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}
const device = () => getSetting('roku');
const calibration = () => getSetting('rokuCalibration');

const log = []; // recent presses, newest last
function note(entry) {
  log.push({ at: Date.now(), ...entry });
  if (log.length > 300) log.shift();
}

// ---------- ECP ----------

function request(ip, method, path, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: ip, port: 8060, method, path, timeout }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer within ' + timeout / 1000 + ' s')));
    req.on('error', reject);
    req.end();
  });
}
const tag = (xml, name) => (xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>')) || [])[1] || '';

async function deviceInfo(ip) {
  const r = await request(ip, 'GET', '/query/device-info');
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  return {
    ip,
    name: tag(r.body, 'user-device-name') || tag(r.body, 'friendly-device-name') || 'Roku',
    model: tag(r.body, 'model-name'),
    version: tag(r.body, 'software-version'),
    power: tag(r.body, 'power-mode')
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One press: sent to the TV, or only logged in a dry run.
async function send(path, label, opts = {}) {
  const d = device();
  if (!d || opts.dry) { note({ key: label, dry: true }); return; }
  try {
    const r = await request(d.ip, 'POST', path, 3000);
    // 403 means the Roku refused: "Control by mobile apps" is off or limited.
    if (r.status === 403) throw Object.assign(new Error('The Roku refused the press. On the TV, go to Settings › System › Advanced system settings › Control by mobile apps › Network access and choose Default (or Permissive if Default still refuses).'), { status: 409 });
    if (r.status >= 400) throw Object.assign(new Error('The Roku answered HTTP ' + r.status), { status: 502 });
    note({ key: label });
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error("Couldn't reach the Roku at " + d.ip + ' (' + e.message + ').'), { status: 502 });
  }
}

// ---------- Handlers ----------

function status() {
  const d = device();
  const c = calibration();
  return {
    device: d,
    dryRun: !d,
    calibration: c ? { savedAt: c.savedAt, version: c.version, typeMode: c.type.mode, stale: !!(d && c.version && d.version && c.version !== d.version) } : null,
    lastTest: lastTestSummary(c),
    log: log.slice(-40)
  };
}

async function setup(b) {
  if (b.op === 'clear') { setSetting('roku', null); return status(); }
  const ip = String(b.ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw Object.assign(new Error('Enter the IP address shown in Settings › Network › About, like 192.168.0.42.'), { status: 400 });
  let info;
  try { info = await deviceInfo(ip); } catch (e) {
    throw Object.assign(new Error("Couldn't reach a Roku at " + ip + ' (' + e.message + '). Check the address and that the TV is on.'), { status: 400 });
  }
  setSetting('roku', info);
  return status();
}

// Ask the network which Rokus are there (SSDP), then read each one's name.
function find() {
  return new Promise((resolve) => {
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHost: 239.255.255.250:1900\r\nMan: "ssdp:discover"\r\nST: roku:ecp\r\nMX: 3\r\n\r\n');
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const ips = new Set();
    sock.on('message', (buf) => {
      const loc = (buf.toString().match(/^location:\s*http:\/\/([\d.]+):8060/im) || [])[1];
      if (loc) ips.add(loc);
    });
    sock.on('error', () => {});
    sock.bind(() => { for (let i = 0; i < 3; i++) setTimeout(() => sock.send(msg, 1900, '239.255.255.250'), i * 400); });
    setTimeout(async () => {
      try { sock.close(); } catch (e) { /* already closed */ }
      const found = await Promise.all([...ips].map((ip) => deviceInfo(ip).catch(() => ({ ip, name: 'Roku' }))));
      resolve({ found });
    }, 3500);
  });
}

async function key(b) {
  if (!KEYS.has(b.key)) throw Object.assign(new Error('Unknown key'), { status: 400 });
  await send('/keypress/' + b.key, b.key);
  return { dry: !device() };
}

// Typed text goes letter by letter as Lit_ presses; it only lands while an on-screen keyboard is showing.
async function text(b) {
  const t = String(b.text || '').slice(0, 80);
  for (const ch of t) await send('/keypress/Lit_' + encodeURIComponent(ch), 'Lit_' + ch);
  return { dry: !device() };
}

// ---------- Calibration ----------

// Down, Down, Up becomes Down: neighbouring opposite presses cancel.
function tidy(keys) {
  const out = [];
  for (const k of keys) {
    if (out.length && OPPOSITE[k] && out[out.length - 1] === OPPOSITE[k]) out.pop();
    else out.push(k);
  }
  return out;
}
// Pushing against a menu edge: extra presses do nothing, so pad them and the path works from any start.
function padEdges(keys, extra = 6) {
  const out = [];
  keys.forEach((k, i) => {
    out.push(k);
    if (MOVES[k] && keys[i + 1] !== k) for (let n = 0; n < extra; n++) out.push(k);
  });
  return out;
}

// From arrow moves recorded while spelling the calibration word, work out the keyboard grid:
// how many columns, and where the cursor starts. Tries each width and keeps the one that fits every move.
function inferGrid(word, segments) {
  const w = word.toLowerCase();
  const net = (keys) => keys.reduce(([x, y], k) => (MOVES[k] ? [x + MOVES[k][0], y + MOVES[k][1]] : [x, y]), [0, 0]);
  const moves = segments.map(net);
  const fits = [];
  for (let cols = 3; cols <= 13; cols++) {
    const pos = (ch) => { const i = GRID_CHARS.indexOf(ch); return [i % cols, Math.floor(i / cols)]; };
    const first = pos(w[0]);
    const start = [first[0] - moves[0][0], first[1] - moves[0][1]];
    if (start[0] < 0 || start[0] >= cols || start[1] < 0) continue;
    let ok = true;
    for (let k = 1; k < w.length && ok; k++) {
      const a = pos(w[k - 1]); const b = pos(w[k]);
      ok = moves[k] && moves[k][0] === b[0] - a[0] && moves[k][1] === b[1] - a[1];
    }
    if (ok) fits.push({ cols, start });
  }
  if (!fits.length) return { ok: false, error: "The moves don't match an alphabetical keyboard grid. Typed letters will be needed instead." };
  return { ok: true, cols: fits[0].cols, start: fits[0].start, ambiguous: fits.length > 1 };
}

// rec: what the wizard recorded per step. Returns the tidied path that replay uses.
function buildCalibration(rec) {
  const steps = ['topbar', 'search'];
  for (const s of steps) if (!Array.isArray(rec[s])) throw Object.assign(new Error('Missing step: ' + s), { status: 400 });
  const cal = {
    topbar: padEdges(tidy(rec.topbar)),
    search: tidy(rec.search),
    type: { mode: 'text' }
  };
  if (rec.type && rec.type.mode === 'grid') {
    const g = inferGrid(rec.type.word || 'dune', rec.type.segments || []);
    if (!g.ok) throw Object.assign(new Error(g.error), { status: 400 });
    cal.type = { mode: 'grid', cols: g.cols, start: g.start, ambiguous: g.ambiguous };
  }
  return cal;
}

// Arrow presses that spell text on the grid keyboard. Characters not on it (spaces, punctuation) are skipped.
function gridPresses(t, type) {
  const presses = [];
  let [x, y] = type.start;
  for (const ch of t.toLowerCase()) {
    const i = GRID_CHARS.indexOf(ch);
    if (i < 0) continue;
    const tx = i % type.cols; const ty = Math.floor(i / type.cols);
    while (y < ty) { presses.push('Down'); y++; }
    while (y > ty) { presses.push('Up'); y--; }
    while (x < tx) { presses.push('Right'); x++; }
    while (x > tx) { presses.push('Left'); x--; }
    presses.push('Select');
  }
  return presses;
}

// The sequence that gets a title's search results on screen, as [key or text, wait after] pairs.
// It stops once the title is typed: Roku sometimes shows a suggestion bar above the results, so the
// first result isn't always in the same place, and you pick the title with the remote.
function plan(cal, title) {
  const seq = [];
  const add = (keys, after) => keys.forEach((k, i) => seq.push([k, i === keys.length - 1 ? after : WAIT.press]));
  add(['Home'], WAIT.afterHome);
  add(cal.topbar, WAIT.afterStep);
  add(cal.search, WAIT.afterOpenSearch);
  // No clearing first: Roku empties the search box itself when Search opens, and Backspace on an
  // empty box only plays an error beep (seen on Roku OS 16.0.4).
  if (cal.type.mode === 'grid') add(gridPresses(title, cal.type), 0);
  else add([...title].map((ch) => 'Lit_' + ch), 0);
  return seq;
}

async function runPlan(seq, dry) {
  for (const [k, after] of seq) {
    const path = k.startsWith('Lit_') ? '/keypress/Lit_' + encodeURIComponent(k.slice(4)) : '/keypress/' + k;
    await send(path, k, { dry });
    if (!dry && after) await sleep(after);
  }
}

// The wizard's most recent test run, kept on the server so Save still works if the phone loses its progress.
function lastTestSummary(c) {
  const t = getSetting('rokuLastTest');
  if (!t || (c && c.savedAt >= t.at)) return null;
  return { title: t.title, at: t.at };
}

function saveCalibration(b) {
  let rec = b.rec;
  if (!rec && b.useLastTest) {
    const t = getSetting('rokuLastTest');
    if (!t) throw Object.assign(new Error('No test run to save. Run the calibration again.'), { status: 409 });
    rec = t.rec;
  }
  const cal = buildCalibration(rec || {});
  const d = device();
  setSetting('rokuCalibration', { ...cal, version: d ? d.version : null, savedAt: Date.now() });
  return { calibration: calibration(), status: status() };
}

// Test or use the search path. b.rec: an unsaved recording to try (the wizard's test run); otherwise the saved one.
// One Watch on TV at a time: two people's presses must never mix on the TV.
let busy = false;

// Is the TV mid-request, or playing something? Asked before sending, so the app can offer to interrupt.
// The home screen, search and Roku's title pages all count as not playing.
async function tvState() {
  if (busy) return { busy: true };
  const d = device();
  if (!d) return {};
  try {
    const [a, m] = await Promise.all([request(d.ip, 'GET', '/query/active-app', 2500), request(d.ip, 'GET', '/query/media-player', 2500)]);
    const app = (a.body.match(/<app[^>]*>([^<]*)<\/app>/) || [])[1] || '';
    const onHome = /type="home"/.test(a.body) || app === 'Roku' || /<screensaver/.test(a.body);
    const state = (m.body.match(/<player[^>]*state="([^"]+)"/) || [])[1] || '';
    return { playing: !onHome && state === 'play', app };
  } catch (e) {
    return {}; // can't tell: don't block
  }
}

// force: send even if something's playing (the person said Interrupt).
async function openBySearch(b) {
  const title = String(b.title || '').trim().slice(0, 60);
  if (!title) throw Object.assign(new Error('Which title?'), { status: 400 });
  const cal = b.rec ? buildCalibration(b.rec) : calibration();
  if (!cal) throw Object.assign(new Error('Calibrate the search path first.'), { status: 409 });
  if (busy) throw Object.assign(new Error('The TV is busy with another request. Try again in a few seconds.'), { status: 409, busy: true });
  if (!b.force && !b.rec && device()) {
    const st = await tvState();
    if (st.playing) throw Object.assign(new Error(`${st.app || 'Something'} is playing on ${device().name}.`), { status: 409, playing: true, app: st.app });
  }
  if (b.rec) setSetting('rokuLastTest', { rec: b.rec, title, at: Date.now() });
  const seq = plan(cal, title);
  const dry = !device();
  busy = true;
  try { await runPlan(seq, dry); } finally { busy = false; }
  return { dry, presses: seq.length, sequence: seq.map(([k]) => k), calibration: cal };
}

function clearLog() { log.length = 0; return status(); }
function clearCalibration() { setSetting('rokuCalibration', null); return status(); }

module.exports = { status, setup, find, deviceInfo, key, text, saveCalibration, openBySearch, tvState, clearLog, clearCalibration, calibration, inferGrid, gridPresses };
