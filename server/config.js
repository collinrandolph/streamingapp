// Reads secrets from config.local.json (git-ignored) or environment variables.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'config.local.json');

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
    dataDir: path.join(ROOT, 'data')
  };
}

module.exports = { load, ROOT };
