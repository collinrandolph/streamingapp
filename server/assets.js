// The files the PC serves: the app (web/), the shared data code (/core/) and the Connect page.
// From the project they're read from disk; in the packaged PC helper they're built into the .exe.
const fs = require('fs');
const path = require('path');
const { ROOT, PACKAGED } = require('./config');

const sea = PACKAGED ? require('node:sea') : null;

// name: 'web/app.js', 'core/api.js' or 'connect.html'. Returns a Buffer, or null if there's no such file.
function read(name) {
  if (!/^[a-z0-9_.\-/]+$/i.test(name) || name.includes('..')) return null;
  if (sea) {
    try { return Buffer.from(sea.getAsset(name)); } catch (e) { return null; }
  }
  const file = name.startsWith('core/') ? path.join(ROOT, 'server', name.slice(5))
    : name === 'connect.html' ? path.join(ROOT, 'server', 'connect.html')
    : path.join(ROOT, name);
  try { return fs.readFileSync(file); } catch (e) { return null; }
}

module.exports = { read };
