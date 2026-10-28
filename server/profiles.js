// Profiles on the PC: one per person, each with a PIN and a saved copy of that person's list.
// A phone links to a profile once with the PIN and gets a long random device code; after that it syncs
// with the code alone. The phone's list is the real one; the copy here is a backup for restoring a phone
// that lost its data. TVs, calibration and the TMDb key are shared by every profile.
const crypto = require('crypto');
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    data TEXT,
    data_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profile_device (
    code_hash TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    synced_at INTEGER
  );
`);

const COLORS = ['#7AA2FF', '#6FD39B', '#F5C26B', '#FF8A8E', '#C59BFF', '#5DD3E0'];
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

function checkPin(pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) throw fail('The PIN is 4 to 8 digits.');
}

// A new device code for a profile. Only its hash is kept here; the phone keeps the code itself.
function newDevice(profileId) {
  const code = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO profile_device (code_hash, profile_id, linked_at) VALUES (?, ?, ?)').run(sha(code), profileId, Date.now());
  return code;
}

function byDevice(code) {
  const dev = code && db.prepare('SELECT * FROM profile_device WHERE code_hash = ?').get(sha(String(code)));
  const p = dev && db.prepare('SELECT * FROM profile WHERE id = ?').get(dev.profile_id);
  if (!p) throw fail('This phone is no longer linked to a profile on this PC. Link it again.', 401);
  return { dev, p };
}

const summary = (p) => ({ id: p.id, name: p.name, color: p.color, savedAt: p.data_at || null });

// Who's watching? The profiles' names and colours, nothing private.
function list() {
  return { profiles: db.prepare('SELECT * FROM profile ORDER BY created_at').all().map(summary) };
}

// A new profile, starting from the phone's current list.
function create(b) {
  const name = String(b.name || '').trim().slice(0, 30);
  if (!name) throw fail('Give the profile a name.');
  checkPin(b.pin);
  if (db.prepare('SELECT 1 FROM profile WHERE lower(name) = lower(?)').get(name)) throw fail(`There's already a profile called ${name}.`);
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const color = COLORS.includes(b.color) ? b.color : COLORS[db.prepare('SELECT COUNT(*) AS n FROM profile').get().n % COLORS.length];
  db.prepare('INSERT INTO profile (id, name, color, pin_salt, pin_hash, data, data_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, color, salt, pinHash(b.pin, salt), b.data ? JSON.stringify(b.data) : null, b.data ? Date.now() : null, Date.now());
  const p = db.prepare('SELECT * FROM profile WHERE id = ?').get(id);
  return { profile: summary(p), code: newDevice(id) };
}

// Linking a phone to an existing profile: the one time the PIN is asked. withData sends the saved list,
// for a phone that has none (restoring after it lost its data).
function link(b) {
  const p = db.prepare('SELECT * FROM profile WHERE id = ?').get(String(b.profileId || ''));
  if (!p) throw fail('That profile is gone. Pick another.', 404);
  checkPin(b.pin);
  const given = Buffer.from(pinHash(b.pin, p.pin_salt), 'hex');
  if (!crypto.timingSafeEqual(given, Buffer.from(p.pin_hash, 'hex'))) throw fail("That PIN doesn't match.", 403);
  return { profile: summary(p), code: newDevice(p.id), data: b.withData && p.data ? JSON.parse(p.data) : null };
}

// The phone's list, saved here. No PIN: the device code is the proof.
function sync(b) {
  const { dev, p } = byDevice(b.code);
  if (!b.data || b.data.app !== 'streaming-tracker') throw fail("That isn't a list.");
  const now = Date.now();
  db.prepare('UPDATE profile SET data = ?, data_at = ? WHERE id = ?').run(JSON.stringify(b.data), now, p.id);
  db.prepare('UPDATE profile_device SET synced_at = ? WHERE code_hash = ?').run(now, dev.code_hash);
  return { profile: summary({ ...p, data_at: now }), savedAt: now };
}

// The saved list, for a linked phone that needs it back.
function restore(b) {
  const { p } = byDevice(b.code);
  return { profile: summary(p), data: p.data ? JSON.parse(p.data) : null };
}

function unlink(b) {
  const { dev } = byDevice(b.code);
  db.prepare('DELETE FROM profile_device WHERE code_hash = ?').run(dev.code_hash);
  return { ok: true };
}

module.exports = { list, create, link, sync, restore, unlink, COLORS };
