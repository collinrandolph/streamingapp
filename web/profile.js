'use strict';
// Profiles: each person's list is kept on the PC under their profile (server/profiles.js). This phone links
// to one profile once, with its PIN, and gets a device code. After that the phone's list is synced to the
// PC automatically, with no PIN; the PC copy is the backup for a phone that lost its data.
// Uses the shared helpers in app.js, relay.js and settings.js (api, state, relayRequest, pcList…).

const SYNC_DELAY = 20000; // quiet time before syncing; the relay allows only a request every few seconds
const PROFILE_COLORS = ['#7AA2FF', '#6FD39B', '#F5C26B', '#FF8A8E', '#C59BFF', '#5DD3E0'];
let syncTimer = null;
let syncing = null;

function linkedProfile() {
  return state.core ? state.core.settings().profile || null : null;
}
// The PC this phone's profile lives on (not necessarily the PC used for Watch on TV).
function profilePc(p = linkedProfile()) {
  return p ? pcList().find((x) => x.id === p.pcId) || null : null;
}

// Talks to a PC's profiles: directly when this page came from that PC, otherwise over its relay.
async function profileCall(pc, op, payload = {}) {
  if (state.pc && state.pcInfo && pc && state.pcInfo.id === pc.id) {
    const res = await fetch('/api/profiles/' + op, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'The PC reported a problem.'), { status: res.status });
    return data;
  }
  if (!pc || !pc.relay) throw new Error('Scan this PC’s QR code again to use profiles.');
  const r = await relayRequest(pc, op === 'list' ? 'profiles' : 'profile-' + op, payload, 25000);
  // Helpers older than 0.4.0 don't know about profiles.
  if (r.error === 'Unknown request') throw new Error(`${pc.name} has an older PC helper. Download the latest one, close the old one and open the new one.`);
  if (!r.ok) throw Object.assign(new Error(r.error || 'The PC reported a problem.'), { status: r.status });
  return r;
}

const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase();
const avatar = (p, size = 64) => `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:${esc(p.color)}">${esc(initialOf(p.name))}</span>`;

// ---------- Who's watching? ----------

async function screenProfiles(rid) {
  renderNav(null, false);
  const pc = activePc();
  if (!pc) {
    $view.innerHTML = '<div class="bridge"><h1>Connect a PC first</h1><p>Scan your PC helper’s QR code, then choose your profile.</p><div class="stack" style="margin:20px auto 0;max-width:320px"><button class="btn-primary" data-act="set-scan">Scan the QR code</button></div></div>';
    return;
  }
  $view.innerHTML = `<div class="bridge"><h1>Who's watching?</h1><p class="loading" style="margin:16px 0">Asking ${esc(pc.name)}…</p></div>`;
  let list;
  try {
    list = (await profileCall(pc, 'list')).profiles;
  } catch (e) {
    if (rid !== state.renderId) return;
    $view.innerHTML = `<div class="bridge"><h1>Who's watching?</h1><p>${esc(e.message)}</p><div class="stack" style="margin:20px auto 0;max-width:320px"><button class="btn-secondary" data-act="prof-retry">Try again</button><a class="btn-secondary" style="display:flex;align-items:center;justify-content:center" href="#/watching">Not now</a></div></div>`;
    return;
  }
  if (rid !== state.renderId) return;
  state.profileList = list;
  const linked = linkedProfile();
  $view.innerHTML = `<div class="bridge"><h1>Who's watching?</h1>
    <p>Profiles on ${esc(pc.name)}. Each person's list is kept there as a backup and synced from their phone.</p>
    <div class="profile-grid">
      ${list.map((p) => `<button class="profile-tile" data-act="prof-pick" data-id="${esc(p.id)}">${avatar(p)}<span class="pname">${esc(p.name)}</span>${linked && linked.id === p.id ? '<span class="pnote">This phone</span>' : ''}</button>`).join('')}
      <button class="profile-tile" data-act="prof-new"><span class="avatar add" style="width:64px;height:64px">+</span><span class="pname">New profile</span></button>
    </div>
    <p style="margin-top:22px"><a href="#/watching">Not now</a></p></div>`;
}

function pinField(id, label) {
  return `<label class="lbl" for="${id}">${label}</label><input id="${id}" class="search pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="8" placeholder="4 to 8 digits" style="margin-bottom:12px">`;
}

function openPickSheet(p) {
  const empty = state.core.isEmpty();
  openSheet(`<h2>${esc(p.name)}</h2>
    <p>${empty ? 'This phone has no list yet, so your list will be restored from the PC.' : 'This phone keeps its current list and syncs it to this profile from now on.'} You only enter the PIN once.</p>
    ${pinField('prof-pin', 'PIN')}
    <p class="hint" id="prof-err" style="margin:0 0 10px;color:#FF8A8E"></p>
    <button class="btn-primary" data-act="prof-link" data-id="${esc(p.id)}">Link this phone</button>`);
  document.getElementById('prof-pin').focus();
}

function openNewSheet() {
  openSheet(`<h2>New profile</h2>
    <p>Your current list on this phone becomes this profile's list. The PIN is asked only when linking a phone.</p>
    <label class="lbl" for="prof-name">Name</label>
    <input id="prof-name" class="search" type="text" maxlength="30" autocomplete="off" placeholder="Collin" style="margin-bottom:12px">
    <span class="lbl">Colour</span>
    <div class="swatches" style="margin-bottom:14px">${PROFILE_COLORS.map((c, i) => `<button class="swatch" data-act="prof-color" data-color="${c}" style="background:${c}" aria-label="Colour ${i + 1}" aria-pressed="${i === 0}"></button>`).join('')}</div>
    ${pinField('prof-pin', 'PIN')}${pinField('prof-pin2', 'PIN again')}
    <p class="hint" id="prof-err" style="margin:0 0 10px;color:#FF8A8E"></p>
    <button class="btn-primary" data-act="prof-create">Create profile</button>`);
  document.getElementById('prof-name').focus();
}

// Saves the link on this phone and starts syncing.
function rememberLink(pc, profile, code) {
  state.core.saveSettings({ profile: { pcId: pc.id, id: profile.id, name: profile.name, color: profile.color, code, syncedAt: profile.savedAt || null, dirty: false } });
}

// ---------- Sync ----------

// Called after any change to the list: syncs a few seconds later, once the changes settle.
function markDirty() {
  const p = linkedProfile();
  if (!p) return;
  if (!p.dirty) state.core.saveSettings({ profile: { ...p, dirty: true } });
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), SYNC_DELAY);
}

// Sends this phone's list to its profile on the PC. Leaves it marked unsynced if the PC can't be reached.
async function syncNow() {
  const p = linkedProfile();
  const pc = profilePc(p);
  if (!p || !pc) return null;
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const data = await api('/export');
      const r = await profileCall(pc, 'sync', { code: p.code, data });
      const now = linkedProfile();
      state.core.saveSettings({ profile: { ...now, syncedAt: r.savedAt, dirty: false } });
      return r;
    } catch (e) {
      // 401: the PC no longer knows this phone (unlinked there, or a reset PC helper).
      if (e.status === 401) state.core.saveSettings({ profile: { ...linkedProfile(), lost: true } });
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// On start and when the app comes back to the front: send anything that didn't get through.
function resumeSync() {
  const p = linkedProfile();
  if (p && p.dirty) syncNow().catch(() => {});
}
// Sync on the way out too, rather than waiting for the timer.
document.addEventListener('visibilitychange', () => { clearTimeout(syncTimer); resumeSync(); });

// Settings › Profile.
function profileHtml() {
  const p = linkedProfile();
  const pc = profilePc(p);
  if (!p) {
    return `<div class="pad"><div class="panel" style="padding:14px">
      <p style="margin:0 0 10px">This phone isn't linked to a profile, so its list isn't backed up anywhere.</p>
      ${activePc() ? '<a class="btn-primary" style="display:flex;align-items:center;justify-content:center" href="#/profiles">Choose your profile</a>' : '<p class="hint" style="margin:0">Connect a PC first (below), then choose your profile.</p>'}
    </div></div>`;
  }
  const when = p.syncedAt ? new Date(p.syncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
  return `<div class="pad"><div class="panel" style="padding:14px">
    <div style="display:flex;align-items:center;gap:12px">${avatar(p, 44)}<span><span style="display:block;font-weight:700">${esc(p.name)}</span>
      <span class="hint" style="margin:0">on ${esc(pc ? pc.name : 'a PC that was removed')} · ${p.lost ? 'link lost' : p.dirty ? 'changes waiting to sync' : 'synced ' + esc(when)}</span></span></div>
    ${p.lost ? '<p class="hint" style="margin:10px 0 0;color:#F5C26B">The PC no longer recognises this phone. Choose your profile again to relink.</p>' : ''}
    <div class="stack" style="margin-top:12px">
      ${p.lost ? '<a class="btn-primary" style="display:flex;align-items:center;justify-content:center" href="#/profiles">Choose your profile</a>' : '<button class="btn-secondary" data-act="prof-sync">Sync now</button>'}
      <button class="btn-secondary" data-act="prof-unlink">Unlink this phone</button>
    </div>
    <details style="margin-top:10px"><summary class="hint" style="margin:0;cursor:pointer">Lost your list on this phone?</summary>
      <p class="hint" style="margin:8px 0">Replace this phone's list with the copy saved on the PC.</p>
      <button class="btn-secondary" data-act="prof-restore">Restore from the PC</button></details>
  </div></div>`;
}

// ---------- Events ----------

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act^="prof-"]');
  if (!el) return;
  const act = el.dataset.act;
  const err = (msg) => { const e = document.getElementById('prof-err'); if (e) e.textContent = msg; else toast(msg); };
  try {
    if (act === 'prof-retry') return route();
    if (act === 'prof-new') return openNewSheet();
    if (act === 'prof-pick') return openPickSheet(state.profileList.find((p) => p.id === el.dataset.id));
    if (act === 'prof-color') {
      document.querySelectorAll('[data-act="prof-color"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      return;
    }
    if (act === 'prof-create') {
      const name = document.getElementById('prof-name').value.trim();
      const pin = document.getElementById('prof-pin').value;
      if (!name) return err('Give the profile a name.');
      if (!/^\d{4,8}$/.test(pin)) return err('The PIN is 4 to 8 digits.');
      if (pin !== document.getElementById('prof-pin2').value) return err("The PINs don't match.");
      const color = (document.querySelector('[data-act="prof-color"][aria-pressed="true"]') || {}).dataset?.color;
      el.disabled = true;
      el.textContent = 'Creating…';
      const pc = activePc();
      const r = await profileCall(pc, 'create', { name, pin, color, data: await api('/export') }).finally(() => { el.disabled = false; el.textContent = 'Create profile'; });
      rememberLink(pc, r.profile, r.code);
      closeSheet();
      toast(`Created ${r.profile.name}. This phone's list is backed up on ${pc.name}.`);
      location.hash = '#/watching';
      return;
    }
    if (act === 'prof-link') {
      const pin = document.getElementById('prof-pin').value;
      if (!/^\d{4,8}$/.test(pin)) return err('The PIN is 4 to 8 digits.');
      el.disabled = true;
      el.textContent = 'Linking…';
      const pc = activePc();
      const empty = state.core.isEmpty();
      const r = await profileCall(pc, 'link', { profileId: el.dataset.id, pin, withData: empty }).catch((e) => { el.disabled = false; el.textContent = 'Link this phone'; throw e; });
      rememberLink(pc, r.profile, r.code);
      if (empty && r.data) {
        await api('/import', r.data);
        state.core.flush();
        state.status = null;
      } else if (!empty) {
        markDirty(); // the phone's list becomes the profile's
      }
      closeSheet();
      toast(empty && r.data ? `Welcome back, ${r.profile.name}. Your list is restored.` : `Linked to ${r.profile.name}.`);
      location.hash = '#/watching';
      return;
    }
    if (act === 'prof-sync') {
      el.disabled = true;
      await syncNow().finally(() => { el.disabled = false; });
      toast('Synced');
      return route();
    }
    if (act === 'prof-unlink') {
      if (!confirm('Unlink this phone? Its list stays here; it just stops syncing.')) return;
      const p = linkedProfile();
      await profileCall(profilePc(p), 'unlink', { code: p.code }).catch(() => {});
      state.core.saveSettings({ profile: null });
      toast('Unlinked');
      return route();
    }
    if (act === 'prof-restore') {
      if (!confirm("Replace this phone's list with the copy on the PC?")) return;
      const p = linkedProfile();
      const r = await profileCall(profilePc(p), 'restore', { code: p.code });
      if (!r.data) return toast('The PC has no saved list for this profile yet.');
      await api('/import', r.data);
      state.core.flush();
      state.status = null;
      toast('Restored from the PC');
      return route();
    }
  } catch (e) {
    err(e.status === 403 ? "That PIN doesn't match." : e.message);
  }
});
