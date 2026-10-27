#!/usr/bin/env node
// Builds the PC helper as one Windows program, dist/StreamingTracker-PC.exe, with Node's single-executable
// support: the server code is bundled into one script, the app's files are added as assets, and the result
// is injected into a copy of node.exe with postject (Node's official tool, fetched by npx).
//
//   node tools/build-exe.js
//
// Needs Node 24 on Windows, and internet access the first time (for npx postject).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SERVER = path.join(ROOT, 'server');
const EXE = path.join(DIST, 'StreamingTracker-PC.exe');
const MODULES = ['index', 'api', 'assets', 'config', 'db', 'schema', 'tmdb', 'tracking', 'good', 'wikidata', 'roku', 'pc', 'relay'];
const CORE = ['api', 'tmdb', 'tracking', 'good', 'wikidata', 'schema'];
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. One script: each server module wrapped in a function, with a require() that finds the others and
//    hands everything else (node:sqlite, http, …) to Node.
const parts = MODULES.map((m) => {
  const src = fs.readFileSync(path.join(SERVER, m + '.js'), 'utf8').replace(/^#!.*\n/, '');
  return `${JSON.stringify(m)}: function (require, module, exports, __filename, __dirname) {\n${src}\n}`;
});
const bundle = `'use strict';
const __defs = {
${parts.join(',\n')}
};
const __done = {};
function __require(name) {
  const key = name.replace(/^\\.\\//, '').replace(/\\.js$/, '');
  if (!(key in __defs)) return require(name);
  if (__done[key]) return __done[key].exports;
  const module = { exports: {} };
  __done[key] = module;
  __defs[key](__require, module, module.exports, key + '.js', '.');
  return module.exports;
}
__require('index');
`;
fs.writeFileSync(path.join(DIST, 'bundle.js'), bundle);

// 2. Assets: the app (web/), the shared data code (core/) and the Connect page, read with node:sea.getAsset.
const assets = { 'connect.html': path.join(SERVER, 'connect.html') };
for (const f of fs.readdirSync(path.join(ROOT, 'web'))) {
  const full = path.join(ROOT, 'web', f);
  if (fs.statSync(full).isFile()) assets['web/' + f] = full;
}
for (const m of CORE) assets[`core/${m}.js`] = path.join(SERVER, m + '.js');

fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify({
  main: path.join(DIST, 'bundle.js'),
  output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets
}, null, 2));

// 3. The blob, a copy of node.exe, and the injection.
execFileSync(process.execPath, ['--experimental-sea-config', path.join(DIST, 'sea-config.json')], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, EXE);
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'postject@1.0.0-alpha.6', EXE, 'NODE_SEA_BLOB', path.join(DIST, 'sea-prep.blob'), '--sentinel-fuse', FUSE],
  { stdio: 'inherit', shell: process.platform === 'win32' });

for (const f of ['bundle.js', 'sea-config.json', 'sea-prep.blob']) fs.rmSync(path.join(DIST, f));
console.log(`\nBuilt ${path.relative(ROOT, EXE)} (${(fs.statSync(EXE).size / 1048576).toFixed(0)} MB, ${Object.keys(assets).length} files inside)`);
