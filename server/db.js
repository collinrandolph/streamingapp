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
`);

module.exports = db;
