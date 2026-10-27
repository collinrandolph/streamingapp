'use strict';
// Settings (keys, your PC, backups) and the PC helper page.
// The hosted app can't send requests to the PC (it's https, the PC is plain http on your network), but it
// can go to a page there. That page does the PC-only job (Watch on TV, handing over your list) and sends
// you back to the app with the result.
// Uses the shared helpers in app.js (api, esc, renderNav, openSheet, toast, state…), loaded after this file.

const HELPER_DOWNLOAD = 'https://github.com/collinrandolph/streamingapp/releases/download/pc-helper/StreamingTracker-PC.exe';

// ---------- Your PCs ----------
// The app keeps a list of PCs (added by scanning a PC helper's QR code) and uses one at a time.
// Each: { id, name, port, addrs: [every address the PC reported], addr: the one in use, ver, seenAt }.

function pcList() {
  return state.core ? state.core.settings().pcs || [] : [];
}
function activePc() {
  const s = state.core ? state.core.settings() : {};
  return (s.pcs || []).find((p) => p.id === s.activePc) || null;
}
function pcUrl() {
  const p = activePc();
  if (p) return `http://${p.addr}:${p.port}`;
  const u = state.core ? state.core.settings().pcUrl : ''; // an address typed in before PCs had a list
  return u ? u.replace(/\/+$/, '') : '';
}

// Adds a PC or refreshes one the app already knows (same ID), and makes it the one in use.
function rememberPc(info) {
  const pcs = pcList().filter((p) => p.id !== info.id);
  const old = pcList().find((p) => p.id === info.id);
  const addrs = (info.addrs || []).filter((a) => /^[\d.]+$/.test(a));
  const addr = old && addrs.includes(old.addr) ? old.addr : addrs[0];
  // relay: the PC's private channel and key from its QR code (see relay.js). Kept if this update has none,
  // as when the PC itself served the page.
  const r = info.relay;
  const relay = r && /^https:\/\//.test(r.s) && /^[\w-]{10,}$/.test(r.t) && /^[\w-]{40,}$/.test(r.k) ? { s: r.s, t: r.t, k: r.k } : (old && old.relay) || null;
  const pc = { id: String(info.id), name: String(info.name || 'PC').slice(0, 60), port: Number(info.port) || 8787, addrs, addr, ver: info.ver || info.version || '', relay, seenAt: Date.now() };
  state.core.saveSettings({ pcs: [pc, ...pcs], activePc: pc.id });
  return pc;
}

// #/pair?d=…, opened by scanning a PC helper's QR code.
function screenPair() {
  renderNav(null, false);
  let pc;
  try {
    const d = new URLSearchParams(location.hash.split('?')[1] || '').get('d') || '';
    const info = JSON.parse(decodeURIComponent(escape(atob(d.replace(/-/g, '+').replace(/_/g, '/')))));
    if (info.v !== 1 || !info.id || !Array.isArray(info.addrs) || !info.addrs.length) throw new Error('bad');
    pc = rememberPc(info);
  } catch (e) {
    $view.innerHTML = `<div class="bridge"><h1>That QR code didn't work</h1><p>Open the Connect page in the PC helper and scan it again.</p><p style="margin-top:18px"><a href="#/watching">Back to the app</a></p></div>`;
    return;
  }
  // Clear the link's data out of history; the PC is saved.
  history.replaceState(null, '', location.href.split('#')[0] + '#/pair-done');
  const empty = state.core.isEmpty();
  $view.innerHTML = `<div class="bridge">
    <h1>Connected to ${esc(pc.name)}</h1>
    <p>${pc.relay
      ? 'Watch on TV now goes through this PC from anywhere, over the internet. The PC needs to be on with the helper running; your phone can be on any network.'
      : `Watch on TV now goes through this PC at ${esc(pc.addr)}. It needs to be on, with the helper running, and your phone on the same Wi-Fi.`}</p>
    <div class="stack" style="margin:22px auto 0;max-width:320px">
      <button class="${empty ? 'btn-primary' : 'btn-secondary'}" data-act="set-import-pc">Copy my list from this PC</button>
      <a class="${empty ? 'btn-secondary' : 'btn-primary'}" style="display:flex;align-items:center;justify-content:center" href="#/watching">${empty ? 'Skip' : 'Done'}</a>
    </div>
    <p class="hint" id="pair-keys" style="margin-top:16px"></p>
    ${pc.addrs.length > 1 ? `<p class="hint" style="margin-top:8px">This PC has ${pc.addrs.length} addresses. If Watch on TV can't reach it, pick another in Settings.</p>` : ''}
  </div>`;
  // The PC's key is the one to use: take it, replacing any key typed in on this phone.
  if (pc.relay) {
    const note = document.getElementById('pair-keys');
    note.textContent = 'Getting the TMDb key from ' + pc.name + '…';
    fetchKeysFromPc(pc).then((msg) => { note.textContent = msg; }, (e) => { note.textContent = e.message; });
  }
}

// Asks a PC for its TMDb (and OMDb) keys over the encrypted relay and saves them on this device.
async function fetchKeysFromPc(pc) {
  const r = await relayRequest(pc, 'keys', {}, 10000);
  if (!r.ok) throw new Error(r.error || 'The PC has no TMDb key yet.');
  const s = state.core.settings();
  state.core.saveSettings({ tmdbToken: r.tmdbToken, omdbKey: s.omdbKey || r.omdbKey || '' });
  state.status = null;
  return 'Got the TMDb key from ' + pc.name + ' ✓';
}

// ---------- Talking to the PC from the hosted app ----------

// A round trip: this page goes to the PC's helper page, which does the job and sends you back here with the
// result in the link (#/bridge-done). Pop-ups would be lighter, but an app on the home screen loses the
// link back to a pop-up, so it couldn't hear the answer.
function goToBridge(op, params = {}) {
  const base = pcUrl();
  if (!base) throw Object.assign(new Error("Add your PC's address in Settings first."), { status: 409 });
  const back = location.href.split('#')[0];
  const qs = new URLSearchParams({ op, back, to: location.hash || '#/watching', ...params });
  location.href = base + '/#/bridge?' + qs;
}

// Back from the PC: act on the result, then return to where you were (replacing this link in history,
// so the data it carried doesn't linger).
async function screenBridgeDone() {
  renderNav(null, false);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const to = q.get('to') || '#/watching';
  try {
    if (q.get('ok') !== '1') throw new Error(q.get('error') || 'Your PC reported a problem.');
    if (q.get('op') === 'tv') {
      toast(`${q.get('title') || 'The title'} is going to your TV. Pick it from the search results with your remote.`);
    } else if (q.get('op') === 'export') {
      const payload = JSON.parse(decodeURIComponent(escape(atob(q.get('data').replace(/-/g, '+').replace(/_/g, '/')))));
      const set = state.core.settings();
      if (payload.keys && payload.keys.tmdbToken && !set.tmdbToken) state.core.saveSettings({ tmdbToken: payload.keys.tmdbToken, omdbKey: set.omdbKey || payload.keys.omdbKey || '' });
      state.status = null;
      await importBackup(payload.data, 'Copied from your PC');
    }
  } catch (e) {
    toast(e.message);
  }
  location.replace(location.href.split('#')[0] + to);
}

// ---------- The helper page, on the PC ----------

async function screenBridge() {
  renderNav(null, false);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const op = q.get('op');
  const back = q.get('back');
  const to = q.get('to') || '#/watching';
  const show = (title, text) => { $view.innerHTML = `<div class="bridge"><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`; };
  // Only send results back to an address that looks like the app, never to anywhere a link might point.
  const safeBack = back && /^https?:\/\//.test(back) ? back : null;
  const reply = (fields) => {
    if (!safeBack) return;
    const qs = new URLSearchParams({ op, to, ...fields });
    location.replace(safeBack + '#/bridge-done?' + qs);
  };
  try {
    if (op === 'tv') {
      const title = q.get('title') || '';
      show('Sending to your TV…', title);
      const s = await pcApi('/roku');
      if (!s.device) throw new Error('No TV is set up on your PC yet. Open the remote on the PC to connect one.');
      if (!s.calibration) throw new Error("The search path isn't calibrated yet. Open the remote on the PC and calibrate it.");
      // Send the presses without waiting for them (about 8 seconds), so you're back in the app right away.
      // keepalive lets the request finish after this page has gone.
      fetch('/api/roku/open-search', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
      await new Promise((r) => setTimeout(r, 400));
      if (!safeBack) return show('Sent to your TV', 'Pick the title from the search results with your remote.');
      reply({ ok: '1', title });
    } else if (op === 'export') {
      show('Copying your list…', 'From this PC to the app.');
      const [data, keys] = await Promise.all([pcApi('/export'), pcApi('/keys').catch(() => ({}))]);
      const packed = btoa(unescape(encodeURIComponent(JSON.stringify({ data, keys })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      reply({ ok: '1', data: packed });
    } else {
      throw new Error('Unknown request.');
    }
  } catch (e) {
    if (safeBack) return reply({ ok: '0', error: e.message });
    show("That didn't work", e.message);
  }
}

// ---------- Settings screen ----------

async function screenSettings(rid) {
  renderNav(null, true);
  const s = state.core.settings();
  const field = (id, label, value, opts = {}) => `<label class="lbl" for="${id}">${label}</label>
    <input id="${id}" class="search" ${opts.type ? `type="${opts.type}"` : 'type="text"'} autocomplete="off" spellcheck="false" value="${esc(value || '')}" placeholder="${esc(opts.placeholder || '')}" style="margin-bottom:${opts.mb || 12}px">`;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 4px;font-size:26px">Settings</h1>
      <p class="hint" style="margin:0 0 6px">Everything here, and your list, is stored on this device only.</p></div>

    <h2 class="sec" style="font-size:16px">Keys</h2>
    <div class="pad"><div class="panel" style="padding:14px">
      ${field('set-tmdb', 'TMDb API Read Access Token', s.tmdbToken, { type: 'password', placeholder: 'eyJhbGci…' })}
      ${field('set-omdb', 'OMDb key (optional, adds Rotten Tomatoes and Metacritic)', s.omdbKey, { type: 'password', mb: 14 })}
      <button class="btn-primary" data-act="set-save-keys">Save keys</button>
      <p class="hint" style="margin:10px 0 0">Get a TMDb token free at themoviedb.org › Settings › API. Opening the app once from your PC's address copies the PC's keys here.</p>
    </div></div>

    <h2 class="sec" style="font-size:16px">Your PCs</h2>
    ${pcsHtml()}

    <h2 class="sec" style="font-size:16px">Backup</h2>
    <div class="pad"><div class="panel" style="padding:14px">
      <div class="stack">
        <button class="btn-secondary" data-act="set-export">Download a backup</button>
        <label class="btn-secondary" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restore from a backup<input type="file" accept="application/json,.json" data-restore hidden></label>
      </div>
      <p class="hint" style="margin:10px 0 0">A backup holds your services, My List, places in shows, follows and saved searches. Restoring replaces what's on this device.</p>
    </div></div>
    <p class="attrib">This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data from JustWatch.</p>`;
  // Fill in each PC's online status from its relay channel.
  for (const p of pcList()) {
    if (!p.relay) continue;
    relayStatus(p).then((st) => {
      const el = document.querySelector(`[data-pc-status="${CSS.escape(p.id)}"]`);
      if (!el || rid !== state.renderId) return;
      el.textContent = st.online ? `Online from anywhere · ${seenAgo(st.seen)}${st.tv ? ' · TV: ' + st.tv : ''}` : `Offline over the internet (${seenAgo(st.seen)}). Same Wi-Fi still works if it's on.`;
      el.classList.toggle('online', st.online);
    });
  }
}

// The PC list: which one is in use, its address, and how to add another.
function pcsHtml() {
  const pcs = pcList();
  const active = activePc();
  const legacy = !pcs.length && state.core.settings().pcUrl;
  const rows = pcs.map((p) => `<div class="item" style="flex-wrap:wrap">
      <span class="l"><span class="t">${esc(p.name)}${p.id === (active && active.id) ? ' <span class="pc-on">In use</span>' : ''}</span>
        <span class="s">${p.addrs.length > 1
          ? `<select class="pc-addr" data-pc="${esc(p.id)}" aria-label="Address for ${esc(p.name)}">${p.addrs.map((a) => `<option ${a === p.addr ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>:${p.port}`
          : `${esc(p.addr)}:${p.port}`}${p.ver ? ' · helper ' + esc(p.ver) : ''}</span>
        <span class="s pc-status" data-pc-status="${esc(p.id)}">${p.relay ? 'Checking…' : 'Same Wi-Fi only. Scan its QR code again to reach it from anywhere.'}</span></span>
      <span style="display:flex;gap:4px">${p.id === (active && active.id) ? '' : `<button class="chip" data-act="set-pc-use" data-pc="${esc(p.id)}">Use</button>`}<button class="link-btn" data-act="set-pc-forget" data-pc="${esc(p.id)}" data-name="${esc(p.name)}">Forget</button></span>
    </div>`).join('');
  return `<div class="pad"><div class="panel">
      ${rows || (legacy ? `<div class="item"><span class="l"><span class="t">PC at ${esc(legacy.replace(/^https?:\/\//, ''))}</span><span class="s">Added by address. Scan its QR code to name it and keep it up to date.</span></span></div>` : '<div class="item"><span class="l"><span class="t">No PC yet</span><span class="s">Watch on TV and the remote work through a PC running the helper.</span></span></div>')}
    </div>
    ${active || legacy ? `<div class="stack" style="margin-top:10px">${state.pc ? '' : '<button class="btn-secondary" data-act="set-import-pc">Copy my list from the PC in use</button>'}${active && active.relay && !state.pc ? '<button class="btn-secondary" data-act="set-pc-keys">Get the TMDb key from the PC in use</button>' : ''}</div>` : ''}
    <div class="panel" style="padding:14px;margin-top:10px">
      <p style="margin:0 0 8px;font-weight:600">Add a PC</p>
      <ol class="pc-steps">
        <li>On the PC, <a href="${HELPER_DOWNLOAD}">download the PC helper</a> (StreamingTracker-PC.exe) and run it. Windows may warn that it's from an unknown publisher: choose More info › Run anyway.</li>
        <li>It opens a Connect page with a QR code. Scan it with your phone's camera.</li>
      </ol>
      <details style="margin-top:8px"><summary class="hint" style="margin:0;cursor:pointer">Or enter an address</summary>
        <div style="margin-top:10px">${'<label class="lbl" for="set-pc">PC address</label><input id="set-pc" class="search" type="text" autocomplete="off" placeholder="192.168.0.104:8787" style="margin-bottom:10px">'}
        <button class="btn-secondary" data-act="set-save-pc">Use this address</button></div>
      </details>
    </div></div>`;
}

async function importBackup(data, label) {
  const r = await api('/import', data);
  state.core.flush();
  state.status = null;
  const n = r.imported;
  toast(`${label}: ${n.library} titles, ${n.services} services, ${n.follow} follows`);
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act^="set-"]');
  if (!el) return;
  const act = el.dataset.act;
  try {
    if (act === 'set-save-keys') {
      state.core.saveSettings({ tmdbToken: document.getElementById('set-tmdb').value.trim(), omdbKey: document.getElementById('set-omdb').value.trim() });
      state.status = null;
      return toast('Keys saved');
    }
    if (act === 'set-save-pc') {
      // Typed in by hand: becomes a list entry named after its address until its QR code is scanned.
      const m = document.getElementById('set-pc').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').match(/^([\d.]+)(?::(\d+))?$/);
      if (!m) return toast('Enter an address like 192.168.0.104:8787');
      rememberPc({ id: 'addr-' + m[1], name: 'PC at ' + m[1], port: Number(m[2]) || 8787, addrs: [m[1]] });
      toast('PC address saved');
      return route();
    }
    if (act === 'set-pc-keys') {
      el.disabled = true;
      try { toast(await fetchKeysFromPc(activePc())); } finally { el.disabled = false; }
      return route();
    }
    if (act === 'set-pc-use') {
      state.core.saveSettings({ activePc: el.dataset.pc });
      toast('Using ' + (activePc() || {}).name);
      return route();
    }
    if (act === 'set-pc-forget') {
      if (!confirm(`Forget ${el.dataset.name}?`)) return;
      const rest = pcList().filter((p) => p.id !== el.dataset.pc);
      const s = state.core.settings();
      state.core.saveSettings({ pcs: rest, activePc: s.activePc === el.dataset.pc ? (rest[0] && rest[0].id) || null : s.activePc });
      return route();
    }
    if (act === 'set-import-pc') {
      if (!confirm('Replace the list on this device with the one on your PC?')) return;
      return goToBridge('export');
    }
    if (act === 'set-export') {
      const data = await api('/export');
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'streaming-tracker-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return toast('Backup downloaded');
    }
  } catch (e) {
    toast(e.message);
  }
});

document.addEventListener('change', (ev) => {
  const sel = ev.target.closest('.pc-addr');
  if (!sel) return;
  state.core.saveSettings({ pcs: pcList().map((p) => (p.id === sel.dataset.pc ? { ...p, addr: sel.value } : p)) });
  toast('Address updated');
});

document.addEventListener('change', async (ev) => {
  const input = ev.target.closest('[data-restore]');
  if (!input || !input.files[0]) return;
  try {
    const data = JSON.parse(await input.files[0].text());
    if (!confirm('Replace the list on this device with this backup?')) return;
    await importBackup(data, 'Restored');
  } catch (e) {
    toast(e instanceof SyntaxError ? "That file isn't a backup." : e.message);
  } finally {
    input.value = '';
  }
});
