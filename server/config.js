// Reads secrets from config.local.json (git-ignored) or environment variables.
// Run from the project, everything lives in the project folder. Run as the packaged PC helper
// (StreamingTracker-PC.exe), data and config live in %AppData%\StreamingTracker instead.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGED = (() => { try { return require('node:sea').isSea(); } catch (e) { return false; } })();
const ROOT = PACKAGED ? null : path.join(__dirname, '..');
const DATA = PACKAGED
  ? path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'StreamingTracker')
  : path.join(ROOT, 'data');
const FILE = PACKAGED ? path.join(DATA, 'config.local.json') : path.join(ROOT, 'config.local.json');

function load() {
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('config.local.json could not be read:', e.message);
  }
  return {
    tmdbToken: process.env.TMDB_TOKEN || local.tmdbToken || '',
    tmdbApiKey: process.env.TMDB_API_KEY || local.tmdbApiKey || '',
    omdbKey: process.env.OMDB_KEY || local.omdbKey || '',
    region: local.region || 'US',
    dataDir: DATA
  };
}

// Saves keys entered on the Connect page into config.local.json, keeping anything else already there.
function saveKeys(patch) {
  let local = {};
  try { local = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* new file */ }
  for (const k of ['tmdbToken', 'omdbKey']) if (typeof patch[k] === 'string') local[k] = patch[k].trim();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(local, null, 2) + '\n');
  return load();
}

module.exports = { load, saveKeys, ROOT, PACKAGED, CONFIG_FILE: FILE };
