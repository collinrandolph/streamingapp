// SQLite storage: an API response cache plus your personal data.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const { dataDir } = config.load();
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS services (
    family TEXT PRIMARY KEY,
    provider_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    logo TEXT
  );
  CREATE TABLE IF NOT EXISTS library (
    kind TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    poster TEXT,
    year TEXT,
    status TEXT NOT NULL DEFAULT 'none',
    tracked INTEGER NOT NULL DEFAULT 0,
    next_s INTEGER NOT NULL DEFAULT 1,
    next_e INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (kind, tmdb_id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  -- Titles you track, and the rules (people, franchise, studio) each one feeds into Updates.
  CREATE TABLE IF NOT EXISTS tracked_title (
    kind TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    poster TEXT,
    year TEXT,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (kind, tmdb_id)
  );
  CREATE TABLE IF NOT EXISTS track_rule (
    kind TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    role TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (kind, tmdb_id, target_type, target_id)
  );
  -- People, franchises and studios you follow directly from their pages.
  CREATE TABLE IF NOT EXISTS follow (
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    image TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (target_type, target_id)
  );
  -- Titles that have shown up in Updates: when first seen, and whether you dismissed them.
  CREATE TABLE IF NOT EXISTS update_seen (
    kind TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    first_seen INTEGER NOT NULL,
    dismissed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, tmdb_id)
  );
`);

// Columns added after the first release. pstate = where an Active show stands (watching, airing, between, done).
for (const col of ['pstate TEXT']) {
  try { db.exec('ALTER TABLE library ADD COLUMN ' + col); } catch (e) { /* already there */ }
}

module.exports = db;
