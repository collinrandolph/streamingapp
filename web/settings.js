'use strict';
// Settings (keys, your PC, backups) and the PC helper page.
// The hosted app can't send requests to the PC (it's https, the PC is plain http on your network), but it
// can go to a page there. That page does the PC-only job (Watch on TV, handing over your list) and sends
// you back to the app with the result.
// Uses the shared helpers in app.js (api, esc, renderNav, openSheet, toast, state…), loaded after this file.

function pcUrl() {
  const u = state.core ? state.core.settings().pcUrl : '';
  return u ? u.replace(/\/+$/, '') : '';
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

    <h2 class="sec" style="font-size:16px">Your PC</h2>
    <div class="pad"><div class="panel" style="padding:14px">
      ${state.pc ? '<p class="hint" style="margin:0 0 10px">You opened the app from your PC, so Watch on TV and the remote work directly.</p>' : ''}
      ${field('set-pc', 'PC address', s.pcUrl, { placeholder: 'http://192.168.0.104:8787', mb: 14 })}
      <div class="stack">
        <button class="btn-secondary" data-act="set-save-pc">Save address</button>
        ${!state.pc && s.pcUrl ? '<button class="btn-secondary" data-act="set-import-pc">Copy my list from the PC</button>' : ''}
      </div>
      <p class="hint" style="margin:10px 0 0">Needed for Watch on TV and the remote. They open a page on your PC for a moment, so the PC must be on and on the same Wi-Fi.</p>
    </div></div>

    <h2 class="sec" style="font-size:16px">Backup</h2>
    <div class="pad"><div class="panel" style="padding:14px">
      <div class="stack">
        <button class="btn-secondary" data-act="set-export">Download a backup</button>
        <label class="btn-secondary" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Restore from a backup<input type="file" accept="application/json,.json" data-restore hidden></label>
      </div>
      <p class="hint" style="margin:10px 0 0">A backup holds your services, My List, places in shows, follows and saved searches. Restoring replaces what's on this device.</p>
    </div></div>
    <p class="attrib">This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data from JustWatch.</p>`;
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
      let v = document.getElementById('set-pc').value.trim().replace(/\/+$/, '');
      if (v && !/^https?:\/\//.test(v)) v = 'http://' + v;
      if (v && !/:\d+$/.test(v.replace(/^https?:\/\//, ''))) v += ':8787';
      state.core.saveSettings({ pcUrl: v });
      toast(v ? 'PC address saved' : 'PC address removed');
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
