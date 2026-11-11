// The database schema, shared by the PC server (node:sqlite) and the browser (sql.js).
// applySchema takes either database wrapper: both offer exec(sql).
const SCHEMA = `
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
  -- Episodes checked on a show watched in any order (library.any_order). assumed = counted as watched
  -- when you switched the show over, rather than tapped.
  CREATE TABLE IF NOT EXISTS episode_mark (
    tmdb_id INTEGER NOT NULL,
    s INTEGER NOT NULL,
    e INTEGER NOT NULL,
    at INTEGER NOT NULL,
    assumed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tmdb_id, s, e)
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
  -- Saved Good Stuff searches: a name and the guided flow's answers as JSON.
  CREATE TABLE IF NOT EXISTS good_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filters TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

function applySchema(db) {
  db.exec(SCHEMA);
  // Columns added after the first release. pstate = where a started show stands (watching, waiting, caught, back, done);
  // any_order = the show keeps a check per episode instead of one place.
  for (const col of ['pstate TEXT', 'any_order INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec('ALTER TABLE library ADD COLUMN ' + col); } catch (e) { /* already there */ }
  }
}

module.exports = { applySchema };
