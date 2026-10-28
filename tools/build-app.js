'use strict';
// Assembles app-build/, the files packed into the Android app: web/ plus the shared code from server/ at
// core/ (the same layout as the hosted app), with roku.js so the phone can drive the TV itself, and sql.js
// bundled so the app starts without fetching it.
// Usage: node tools/build-app.js   (BUILD_NUMBER sets the build the app reports, for update checks)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app-build');
const CORE = ['api', 'tmdb', 'tracking', 'good', 'wikidata', 'schema', 'roku'];
const SQLJS = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'web'), OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'core'));
  for (const m of CORE) fs.copyFileSync(path.join(ROOT, 'server', m + '.js'), path.join(OUT, 'core', m + '.js'));
  fs.mkdirSync(path.join(OUT, 'vendor', 'sql.js'), { recursive: true });
  for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) {
    const res = await fetch(SQLJS + f);
    if (!res.ok) throw new Error(`Couldn't download ${f}: HTTP ${res.status}`);
    fs.writeFileSync(path.join(OUT, 'vendor', 'sql.js', f), Buffer.from(await res.arrayBuffer()));
  }
  const build = Number(process.env.BUILD_NUMBER) || 0;
  fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ build }));
  console.log(`Assembled app-build/ (build ${build})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
