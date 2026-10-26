#!/usr/bin/env node
// M0 Roku spike: talks to a Roku over its External Control Protocol (ECP, port 8060).
//
//   node tools/roku/roku.js find                         search the network for Rokus
//   node tools/roku/roku.js <ip> info                    model, OS version, power state
//   node tools/roku/roku.js <ip> apps                    installed apps and their IDs
//   node tools/roku/roku.js <ip> active                  the app on screen now
//   node tools/roku/roku.js <ip> launch <appId>          open an app's home screen
//   node tools/roku/roku.js <ip> launch <appId> <contentId> <mediaType>
//                                                        deep link to a title
//
// mediaType is one of: movie, episode, season, series, shortFormVideo, tvSpecial.

const http = require('http');
const dgram = require('dgram');

function request(ip, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: ip, port: 8060, method, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out after 5 s')));
    req.on('error', reject);
    req.end();
  });
}

function tag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>'));
  return m ? m[1] : '';
}

function find() {
  const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHost: 239.255.255.250:1900\r\nMan: "ssdp:discover"\r\nST: roku:ecp\r\nMX: 3\r\n\r\n');
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const seen = new Set();
  sock.on('message', (buf) => {
    const loc = (buf.toString().match(/^location:\s*(.+)$/im) || [])[1];
    if (loc && !seen.has(loc.trim())) { seen.add(loc.trim()); console.log('Roku found:', loc.trim()); }
  });
  sock.bind(() => { for (let i = 0; i < 3; i++) setTimeout(() => sock.send(msg, 1900, '239.255.255.250'), i * 500); });
  setTimeout(() => { if (!seen.size) console.log('No Roku answered within 5 s.'); sock.close(); }, 5000);
}

async function main() {
  const [first, cmd, ...rest] = process.argv.slice(2);
  if (first === 'find') return find();
  if (!first || !cmd) {
    console.log('Usage: node tools/roku/roku.js find | <ip> info | apps | active | launch <appId> [contentId mediaType]');
    process.exit(1);
  }
  const ip = first;

  if (cmd === 'info') {
    const r = await request(ip, 'GET', '/query/device-info');
    if (r.status !== 200) return console.log('HTTP', r.status, r.body);
    for (const k of ['friendly-device-name', 'model-name', 'software-version', 'power-mode', 'is-tv', 'supports-ecs-textedit']) {
      console.log(k.padEnd(24), tag(r.body, k));
    }
  } else if (cmd === 'apps') {
    const r = await request(ip, 'GET', '/query/apps');
    if (r.status !== 200) return console.log('HTTP', r.status, r.body);
    const apps = [...r.body.matchAll(/<app id="([^"]+)"[^>]*>([^<]*)<\/app>/g)];
    for (const [, id, name] of apps) console.log(id.padEnd(10), name);
  } else if (cmd === 'active') {
    const r = await request(ip, 'GET', '/query/active-app');
    const m = r.body.match(/<app id="([^"]+)"[^>]*>([^<]*)<\/app>/);
    console.log(m ? m[1] + '  ' + m[2] : 'Home screen or screensaver');
  } else if (cmd === 'launch') {
    const [appId, contentId, mediaType] = rest;
    if (!appId) return console.log('launch needs an app ID (see "apps")');
    let path = '/launch/' + encodeURIComponent(appId);
    if (contentId) path += '?contentId=' + encodeURIComponent(contentId) + '&mediaType=' + encodeURIComponent(mediaType || 'movie');
    const r = await request(ip, 'POST', path);
    console.log('POST', path, '->', 'HTTP', r.status, r.body.trim());
  } else {
    console.log('Unknown command:', cmd);
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
