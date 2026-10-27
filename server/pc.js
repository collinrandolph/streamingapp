// Who this PC is, how a phone reaches it, and the QR link that tells the app both.
// Also the "start with Windows" switch for the packaged helper.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const { PACKAGED } = require('./config');

const VERSION = '0.3.0';
const APP_URL = process.env.APP_URL || 'https://collinrandolph.github.io/streamingapp/';
// Adapters a phone can't reach: virtual switches, VPN and Bluetooth links.
const SKIP_ADAPTER = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|Tailscale|ZeroTier|docker/i;

// A permanent random ID, made on first run, so the app recognises this PC when its address changes.
function id() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'pcId'").get();
  if (row) return JSON.parse(row.value);
  const v = crypto.randomUUID();
  db.prepare("INSERT INTO settings (key, value) VALUES ('pcId', ?)").run(JSON.stringify(v));
  return v;
}

// This PC's home-network addresses, the likeliest first: private ranges, real adapters, Wi-Fi and Ethernet before others.
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (SKIP_ADAPTER.test(name)) continue;
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal || n.address.startsWith('169.254.')) continue;
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address);
      out.push({ address: n.address, rank: (priv ? 0 : 2) + (/wi-?fi|wlan|wireless|ethernet/i.test(name) ? 0 : 1) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.address);
}

function info(port) {
  return { pc: true, id: id(), name: os.hostname(), version: VERSION, port, addrs: addresses(), packaged: PACKAGED };
}

// The link in the QR code: opens the app with everything it needs to connect to this PC.
function pairLink(port) {
  const i = info(port);
  // relay: the private channel and key for reaching this PC from anywhere (see relay.js).
  const payload = { v: 1, id: i.id, name: i.name, port, addrs: i.addrs, ver: VERSION, relay: require('./relay').pairing() };
  const d = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return APP_URL.replace(/#.*$/, '') + '#/pair?d=' + d;
}

// ---------- Start with Windows ----------

const STARTUP_DIR = process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null;
const STARTUP_FILE = STARTUP_DIR ? path.join(STARTUP_DIR, 'Streaming Tracker PC helper.cmd') : null;

// Only the packaged helper can start itself (it's one file at a fixed place); from the project, node runs it.
function startup() {
  const supported = PACKAGED && process.platform === 'win32' && !!STARTUP_FILE;
  return { supported, enabled: supported && fs.existsSync(STARTUP_FILE) };
}

function setStartup(on) {
  const s = startup();
  if (!s.supported) throw Object.assign(new Error('Start with Windows works in the downloaded PC helper.'), { status: 409 });
  if (on) {
    // Minimised, and --background so it doesn't open the Connect page at every sign-in.
    fs.writeFileSync(STARTUP_FILE, `@start "" /min "${process.execPath}" --background\r\n`);
  } else if (fs.existsSync(STARTUP_FILE)) {
    fs.unlinkSync(STARTUP_FILE);
  }
  return startup();
}

module.exports = { info, pairLink, startup, setStartup, VERSION, APP_URL };
