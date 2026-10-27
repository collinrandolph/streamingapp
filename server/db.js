// SQLite storage on the PC: an API response cache plus your personal data.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { applySchema } = require('./schema');

const { dataDir } = config.load();
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
applySchema(db);

module.exports = db;
