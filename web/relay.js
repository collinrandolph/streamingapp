'use strict';
// The app's side of the relay (see server/relay.js): reaching your PC from anywhere through its private,
// encrypted ntfy.sh channel, whose name and key came in the PC's QR code. The same-Wi-Fi page round trip
// (settings.js) stays as the fallback, and is the only way for a PC added by typing its address.

const RELAY_ONLINE = 15 * 60 * 1000; // a PC that said "I'm here" this recently counts as online
const relayStatusCache = new Map();
const relayCryptoKeys = new Map();

const RELAY_PART = 2400; // compressed characters per message: ntfy allows about 4 KB, encryption adds a third

function b64uEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function relayZip(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return b64uEncode(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function relayUnzip(z) {
  const stream = new Blob([b64uDecode(z)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
const b64uDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function relayKey(r) {
  if (!relayCryptoKeys.has(r.k)) relayCryptoKeys.set(r.k, crypto.subtle.importKey('raw', b64uDecode(r.k), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return relayCryptoKeys.get(r.k);
}
async function relaySeal(r, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await relayKey(r), new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64uEncode(out);
}
async function relayUnseal(r, text) {
  try {
    const raw = b64uDecode(text);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await relayKey(r), raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) {
    return null;
  }
}

// Reads ntfy's newline-separated JSON events from a fetch response, decrypting messages as they arrive.
async function relayRead(r, res, onMessage) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim();
      buf = buf.slice(n + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.event === 'open') onMessage({ open: true });
      if (ev.event === 'message') onMessage(await relayUnseal(r, ev.message));
    }
  }
}

// Has the PC said it's here lately? Only reads the channel's stored messages, so it sends nothing.
async function relayStatus(pc) {
  if (!pc || !pc.relay) return { available: false };
  const hit = relayStatusCache.get(pc.id);
  if (hit && Date.now() - hit.checked < 60000) return hit;
  const r = pc.relay;
  let latest = null;
  try {
    const res = await fetch(`${r.s}/${r.t}/json?poll=1&since=15m`);
    if (res.ok) {
      await relayRead(r, res, (m) => {
        if (m && m.from === 'pc' && (m.t === 'here' || m.t === 'ping-reply') && (!latest || m.at > latest.at)) latest = m;
      });
    }
  } catch (e) { /* offline: treat the PC as unreachable */ }
  const status = { available: true, online: !!latest && Date.now() - latest.at < RELAY_ONLINE, seen: latest && latest.at, tv: latest && latest.tv, calibrated: latest && latest.calibrated, checked: Date.now() };
  relayStatusCache.set(pc.id, status);
  return status;
}

// ntfy briefly refuses bursts of messages (and refusals arrive as network errors), so try a few times.
async function relayPost(r, headers, body) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${r.s}/${r.t}`, { method: 'POST', headers, body });
      if (res.ok) return res;
      if (i >= 2) throw new Error('relay ' + res.status);
    } catch (e) {
      if (i >= 2) throw e;
    }
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
}

// Sends one request to the PC and waits for its answer. Listens first, so the answer can't be missed.
function relayRequest(pc, t, data = {}, timeout = 8000) {
  const r = pc.relay;
  const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const ctrl = new AbortController();
  return new Promise((resolve, reject) => {
    const fail = (msg, code) => { ctrl.abort(); reject(Object.assign(new Error(msg), { code })); };
    const timer = setTimeout(() => fail(`${pc.name} didn't answer over the internet.`, 'timeout'), timeout);
    let sent = false;
    const replyParts = new Map();
    fetch(`${r.s}/${r.t}/json`, { signal: ctrl.signal }).then((res) => {
      if (!res.ok) throw Object.assign(new Error('relay ' + res.status), { busy: res.status === 429 });
      return relayRead(r, res, async (m) => {
        if (m && m.open && !sent) {
          sent = true;
          // Cache: no, so a PC that's off never picks this up later.
          // ...o first, so a field called id in the payload can't replace the request's id.
          const post = async (o) => relayPost(r, { Cache: 'no', Firebase: 'no' }, await relaySeal(r, { ...o, t, id, from: 'app', at: Date.now() }));
          try {
            if (data.data === undefined) await post(data);
            else {
              // A list doesn't fit in one message: gzip it and send numbered parts.
              const { data: payload, ...rest } = data;
              const z = await relayZip(payload);
              const parts = Math.max(1, Math.ceil(z.length / RELAY_PART));
              for (let i = 0; i < parts; i++) await post({ ...rest, part: i, parts, z: z.slice(i * RELAY_PART, (i + 1) * RELAY_PART) });
            }
          } catch (e) { fail("Couldn't reach the relay.", 'network'); }
        }
        if (m && m.from === 'pc' && m.re === id) {
          let whole = m;
          if (m.parts !== undefined) {
            replyParts.set(m.part, m);
            if (replyParts.size < m.parts) return;
            const first = replyParts.get(0);
            const z = [...Array(m.parts).keys()].map((i) => replyParts.get(i).z).join('');
            const { part, parts, z: _z, ...rest } = first;
            whole = { ...rest, data: await relayUnzip(z) };
          }
          clearTimeout(timer);
          ctrl.abort();
          relayStatusCache.delete(pc.id);
          resolve(whole);
        }
      });
    }).catch((e) => {
      if (e.name === 'AbortError') return;
      clearTimeout(timer);
      fail(e.busy ? 'The relay is busy for a minute. Try again shortly.' : "Couldn't reach the relay. Check your connection.", 'network');
    });
  });
}

function seenAgo(at) {
  if (!at) return 'not seen in the last 15 minutes';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'seen just now' : `seen ${m} min ago`;
}
