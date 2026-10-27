'use strict';
// Phone web app: hash routes, rendered as HTML strings, one delegated click handler.

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $sheet = document.getElementById('sheet');
const IMG = 'https://image.tmdb.org/t/p/';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const img = (p, size) => (p ? IMG + size + p : '');
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');

async function api(path, body) {
  const res = await fetch('/api' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed (' + res.status + ')'), { status: res.status });
  return data;
}

// ---------- State ----------

const state = {
  status: null,
  setup: JSON.parse(sessionStorage.getItem('setup') || 'null'), // { queue: [families], idx, firstRun }
  selected: null, // families picked on the setup screen
  updates: {}, // Updates entries by "kind:id", for the Manage updates sheet
  renderId: 0
};
function saveSetup() {
  if (state.setup) sessionStorage.setItem('setup', JSON.stringify(state.setup));
  else sessionStorage.removeItem('setup');
}

// ---------- Shared pieces ----------

function badgeHtml(b, more) {
  if (!b) return '';
  const logo = b.logo ? `<img src="${img(b.logo, 'w45')}" alt="">` : '';
  return `<div class="badges"><span class="badge ${b.logo ? '' : 'plain'} ${b.mine ? 'mine' : ''}">${logo}${esc(b.label)}</span>${more > 0 ? `<span class="more">+${more}</span>` : ''}</div>`;
}

function addBtn(t) {
  return `<button class="add ${t.onList ? 'on' : ''}" data-act="toggle-list" data-kind="${t.kind}" data-id="${t.id}" data-name="${esc(t.name)}" data-poster="${esc(t.poster || '')}" data-year="${esc(t.year || '')}" aria-label="${t.onList ? 'Remove ' + esc(t.name) + ' from My List' : 'Add ' + esc(t.name) + ' to My List'}">${t.onList ? '✓' : '+'}</button>`;
}

function card(t, opts = {}) {
  const poster = t.poster ? `<img src="${img(t.poster, 'w342')}" alt="" loading="lazy">` : `<span class="ph">${esc(t.name)}</span>`;
  return `<div class="card ${t.faded ? 'faded' : ''}">
    <a class="poster" href="#/title/${t.kind}/${t.id}" aria-label="${esc(t.name)}">${poster}</a>
    ${opts.noAdd ? '' : addBtn(t)}
    <div class="meta"><div class="name">${esc(t.name)}</div><div class="sub">${esc(t.sub || t.year || '')}</div></div>
    ${opts.badge ? badgeHtml(opts.badge, 0) : badgeHtml(t.badge, t.more)}
  </div>`;
}

function rowCard(t, line, extra) {
  const thumb = t.poster ? `<img src="${img(t.poster, 'w185')}" alt="" loading="lazy">` : '';
  return `<a class="row-card ${t.faded ? 'faded' : ''}" href="#/title/${t.kind}/${t.id}">
    <span class="thumb">${thumb}</span>
    <span class="body"><span class="title">${esc(t.name)}</span><span class="line">${esc(line || '')}</span>${badgeHtml(t.badge, 0)}${extra || ''}</span>
  </a>`;
}

const ICONS = {
  watching: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 8.5v5l4-2.5z"/><path d="M8 21h8"/></svg>',
  mylist: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  following: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  services: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  good: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'
};
const TABS = [['watching', 'Watching'], ['mylist', 'My List'], ['following', 'Following'], ['services', 'Services'], ['good', 'Good Stuff']];

function renderNav(current, show) {
  $nav.hidden = !show;
  $view.classList.toggle('no-nav', !show);
  if (!show) return;
  $nav.innerHTML = TABS.map(([k, label]) => `<a href="#/${k}" ${current === k ? 'aria-current="page"' : ''}>${ICONS[k]}<span>${label}</span></a>`).join('');
}

function header(title) {
  return `<div class="top"><h1>${esc(title)}</h1><a class="icon-btn" href="#/search" aria-label="Search all titles">${ICONS.search}</a></div>`;
}

// undo: optional function; shows an Undo button and keeps the toast up longer.
function toast(text, undo) {
  state.undo = undo || null;
  $toast.innerHTML = `<span>${esc(text)}</span>${undo ? '<button class="toast-undo" data-act="undo">Undo</button>' : ''}`;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; state.undo = null; }, undo ? 6000 : 3200);
}

function openSheet(html) {
  $sheet.innerHTML = `<button class="scrim" data-act="close-sheet" aria-label="Close"></button><div class="sheet" role="dialog">${html}<button class="btn-secondary" style="margin-top:14px;background:none;color:var(--muted)" data-act="close-sheet">Done</button></div>`;
  $sheet.hidden = false;
}
function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; }

function followBtn(type, x) {
  return `<button class="btn-outline follow" style="width:auto;min-height:40px;padding:0 18px" data-act="follow-toggle" data-type="${type}" data-id="${x.id}" data-name="${esc(x.name)}" data-image="${esc(x.photo || x.poster || x.logo || '')}" aria-pressed="${x.following}">${x.following ? '✓ Following' : 'Follow'}</button>`;
}
const FOLLOW_KIND = { person: 'Person', collection: 'Franchise', studio: 'Studio' };

// One Updates entry: the title, its single reason, and what you can do with it.
function updateRow(u) {
  state.updates[u.kind + ':' + u.id] = u;
  const data = `data-kind="${u.kind}" data-id="${u.id}" data-name="${esc(u.name)}" data-poster="${esc(u.poster || '')}" data-year="${esc(u.year || '')}"`;
  return `<div class="upd">${rowCard(u, u.sub, `<span class="reason">${esc(u.reason)}</span>`)}
    <div class="row-actions"><button class="chip" data-act="upd-add" ${data}>+ My List</button><button class="chip" data-act="upd-dismiss" ${data}>Dismiss</button><button class="chip" data-act="upd-manage" data-key="${u.kind}:${u.id}">Manage updates</button></div></div>`;
}

function openManageSheet(u) {
  state.refreshOnClose = true;
  openSheet(`<h2>Manage updates</h2>
    <p>Every rule that brought ${esc(u.name)} here. Turning one off stops all its updates.</p>
    <div class="panel">${u.reasons.map((r) => r.rule
      ? `<button class="item" data-act="rule-toggle" data-kind="${r.rule.kind}" data-id="${r.rule.id}" data-type="${r.rule.type}" data-target="${r.rule.target}" role="switch" aria-checked="true"><span class="l"><span class="t">${esc(r.label)}</span><span class="s">Tracking rule</span></span><span class="sw" aria-checked="true"></span></button>`
      : `<button class="item" data-act="follow-toggle" data-type="${r.follow.type}" data-id="${r.follow.id}" data-name="${esc(r.follow.name)}" role="switch" aria-checked="true"><span class="l"><span class="t">${esc(r.label)}</span><span class="s">Following · ${FOLLOW_KIND[r.follow.type]}</span></span><span class="sw" aria-checked="true"></span></button>`).join('')}</div>`);
}

function errorHtml(e) {
  if (e.status === 503) {
    return `<div class="error"><strong>No TMDb key yet.</strong><br>Create a free account at themoviedb.org, request an API key under Settings › API, then save the API Read Access Token in <code>config.local.json</code> in the project folder as <code>{"tmdbToken": "…"}</code>, then reload this page.</div>`;
  }
  if (e.status === 401) return `<div class="error"><strong>TMDb rejected the key.</strong> Check the token in config.local.json.</div>`;
  return `<div class="error">${esc(e.message)}</div>`;
}

// ---------- Screens ----------

async function screenSetup(rid) {
  renderNav(null, false);
  const firstRun = !state.status.services.length;
  $view.innerHTML = '<p class="loading">Loading services…</p>';
  const list = await api('/providers');
  if (rid !== state.renderId) return;
  if (!state.selected) state.selected = new Set(list.filter((p) => p.selected).map((p) => p.family));
  const giants = list.filter((p) => p.giant);
  const others = list.filter((p) => !p.giant);
  const tile = (p) => {
    const on = state.selected.has(p.family);
    return `<button class="tile" data-act="pick-service" data-family="${esc(p.family)}" aria-pressed="${on}">
      ${p.logo ? `<img src="${img(p.logo, 'w92')}" alt="">` : ''}<span><span class="nm">${esc(p.name)}</span><br><span class="st">${on ? '✓ Added' : 'Tap to add'}</span></span></button>`;
  };
  const otherRow = (p) => {
    const on = state.selected.has(p.family);
    return `<button class="item" data-act="pick-service" data-family="${esc(p.family)}" data-name="${esc(p.name.toLowerCase())}" aria-pressed="${on}">
      <span style="display:flex;align-items:center;gap:10px">${p.logo ? `<img class="svc-logo" style="width:32px;height:32px;flex-basis:32px" src="${img(p.logo, 'w92')}" alt="">` : ''}<span class="t">${esc(p.name)}</span></span>
      <span class="s" style="color:${on ? 'var(--accent)' : 'var(--muted)'};font-weight:600">${on ? '✓ Added' : 'Add'}</span></button>`;
  };
  $view.innerHTML = `
    <div style="padding:28px 16px 8px">
      <p class="kicker">${firstRun ? 'Setup · step 1 of 2' : 'Services'}</p>
      <h1 style="margin:0;font-size:26px">Add your services</h1>
      <p style="margin:8px 0 16px;color:var(--muted);line-height:1.45">Pick the services you pay for. ${firstRun ? "Next, you'll fill each one with what you're watching, want to watch, or have watched." : ''}</p>
    </div>
    <div class="tiles">${giants.map(tile).join('')}</div>
    <h2 class="sec" style="font-size:16px">More apps and channels</h2>
    <div class="pad" style="margin-bottom:10px"><label class="lbl" for="svc-filter">Filter</label><input id="svc-filter" class="search" type="search" placeholder="Tubi, PBS, Criterion…" data-filter="others"></div>
    <div class="pad"><div class="panel" id="others">${others.map(otherRow).join('')}</div></div>
    <p class="attrib">Service list and availability from JustWatch, via TMDb.</p>
    <div class="footer-bar">
      <button class="skip" data-act="${firstRun ? 'setup-skip' : 'setup-cancel'}">${firstRun ? 'Skip setup' : 'Cancel'}</button>
      <button class="btn-primary" data-act="${firstRun ? 'setup-continue' : 'setup-done'}">${firstRun ? 'Continue' : 'Save'}</button>
    </div>`;
}

async function screenService(rid, fam) {
  const inSetup = state.setup && state.setup.queue[state.setup.idx] === fam;
  renderNav('services', !inSetup);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const data = await api('/service/' + encodeURIComponent(fam));
  if (rid !== state.renderId) return;
  const s = data.service;
  const svcBadge = { label: s.name, logo: s.logo, mine: true };
  const q = state.setup ? state.setup : null;
  const hasNext = inSetup && q.idx < q.queue.length - 1;
  $view.innerHTML = `
    ${inSetup ? '' : '<a class="back" href="#/services">‹ Services</a>'}
    <div style="padding:${inSetup ? '24px' : '4px'} 16px 0">
      ${inSetup ? `<p class="kicker">Setup · service ${q.idx + 1} of ${q.queue.length}</p>` : ''}
      <div style="display:flex;align-items:center;gap:12px">${s.logo ? `<img class="svc-logo" src="${img(s.logo, 'w92')}" alt="">` : ''}<h1 style="margin:0;font-size:24px">What's on ${esc(s.name)}</h1></div>
      <p style="margin:8px 0 12px;color:var(--muted);font-size:13px">Tap + to add a title to My List.</p>
      <label class="lbl" for="svc-search">Search ${esc(s.name)}</label>
      <input id="svc-search" class="search" type="search" placeholder="Titles on ${esc(s.name)}" data-search="service" data-family="${esc(fam)}">
    </div>
    <div id="svc-results"></div>
    <div id="svc-rows">
      ${data.rows.map((r) => `<h2 class="sec" style="font-size:18px;margin-bottom:4px">${esc(r.title)}</h2>
        ${[['Shows', r.shows], ['Movies', r.movies]].filter(([, list]) => list.length).map(([label, list]) => `<h3 class="sub-sec">${label}</h3><div class="hs">${list.map((t) => card(t, { badge: svcBadge })).join('')}</div>`).join('')}`).join('')}
    </div>
    ${inSetup ? `<div class="footer-bar"><button class="skip" data-act="setup-skip">Skip setup</button><button class="btn-primary" data-act="setup-next">${hasNext ? 'Next: ' + esc(nameOf(q.queue[q.idx + 1])) : 'Finish setup'}</button></div>` : ''}`;
}
function nameOf(fam) {
  const s = state.status.services.find((x) => x.family === fam);
  return s ? s.name : fam;
}

async function screenWatching(rid) {
  renderNav('watching', true);
  $view.innerHTML = header('Watching') + '<p class="loading">Loading…</p>';
  const w = await api('/watching');
  if (rid !== state.renderId) return;
  $view.innerHTML = header('Watching') + `
    <h2 class="sec">Shows</h2>
    ${w.shows.length ? `<div class="pad">${w.shows.map((s) => rowCard(s, 'Next up · ' + s.next, `<span class="line" style="font-size:12px;color:var(--muted)">${s.unwatched} unwatched episode${s.unwatched === 1 ? '' : 's'}</span>`)).join('')}</div>` : '<p class="empty">Nothing unwatched. Set a show to Active and pick your episode on its page.</p>'}
    <h2 class="sec">Movies</h2>
    ${w.movies.length ? `<div class="hs">${w.movies.map((m) => card({ ...m, onList: true }, { noAdd: true })).join('')}</div>` : '<p class="empty">No unwatched movies from My List are on your services.</p>'}
    <h2 class="sec" style="margin-bottom:4px">Coming soon</h2>
    <p class="hint" style="margin-top:0">Episodes of your active shows in the next 10 days</p>
    ${w.coming.length ? `<div class="pad"><div class="panel">${w.coming.map((c) => `<a class="item" href="#/title/${c.kind}/${c.id}"><span class="l"><span class="t">${esc(c.name)}</span><span class="s">${esc(c.line)}</span></span>${badgeHtml(c.badge, 0)}</a>`).join('')}</div></div>` : '<p class="empty">Nothing scheduled in the next 10 days.</p>'}
    <div style="margin:28px 16px 0;border-top:1px solid var(--line)"></div>
    <h2 class="sec">Updates</h2>
    ${w.updates.length ? `<h3 class="sub-sec">New seasons</h3><div class="pad"><div class="panel">${w.updates.map((u) => `<a class="item" href="#/title/${u.kind}/${u.id}"><span class="l"><span class="t">${esc(u.name)}</span><span class="s">${esc(u.line)}</span></span>${badgeHtml(u.badge, 0)}</a>`).join('')}</div></div>` : ''}
    <div id="updates"><p class="loading">Checking what you track…</p></div>`;
  loadUpdates(rid, w.updates.length > 0);
}

async function loadUpdates(rid, hasSeasons) {
  const box = document.getElementById('updates');
  try {
    const f = await api('/updates');
    if (rid !== state.renderId) return;
    state.updates = {};
    if (!f.groups.length) {
      box.innerHTML = hasSeasons ? '' : `<p class="empty">${f.hasRules ? 'Nothing new from what you follow in the last 90 days.' : 'Follow a person, franchise or studio from its page, and their new releases appear here. New seasons of shows you\'re caught up on show up here too.'}</p>`;
      return;
    }
    box.innerHTML = f.groups.map((g) => `<h3 class="sub-sec">${esc(g.label)} <span class="count">${g.items.length}</span></h3><div class="pad">${g.items.map(updateRow).join('')}</div>`).join('');
  } catch (e) { box.innerHTML = errorHtml(e); }
}

async function screenMyList(rid) {
  renderNav('mylist', true);
  $view.innerHTML = header('My List') + '<p class="loading">Loading…</p>';
  const data = await api('/mylist');
  if (rid !== state.renderId) return;
  state.listItems = {};
  $view.innerHTML = header('My List') + `<p class="hint">Open a title to set your place. Watching: episodes left to watch, aired or announced. Caught up: you've seen everything there is, and the show continues.</p>` +
    (data.groups.length ? data.groups.map((g) => {
      const open = !collapsedGroups().includes(g.key);
      return `<h2 class="sec acc"><button class="acc-btn" data-act="list-acc" data-key="${g.key}" aria-expanded="${open}" aria-controls="grp-${g.key}"><span>${esc(g.label)} <span class="count">${g.items.length}</span></span><span class="chev" aria-hidden="true">›</span></button></h2>
      <div class="pad" id="grp-${g.key}" ${open ? '' : 'hidden'}>${g.items.map((t) => {
        state.listItems[t.kind + ':' + t.id] = t;
        return `<div class="list-row">
        <a href="#/title/${t.kind}/${t.id}" class="list-main ${t.faded ? 'faded' : ''}">
          <span class="thumb">${t.poster ? `<img src="${img(t.poster, 'w92')}" alt="">` : ''}</span>
          <span class="body"><span class="title">${esc(t.name)}</span><span class="meta">${t.kind === 'tv' ? 'Series' : 'Movie'}${t.year ? ' · ' + esc(t.year) : ''}</span>${t.progress ? `<span class="line">${esc(t.progress)}</span>` : ''}${badgeHtml(t.badge, t.more)}</span>
        </a><button class="more-btn" data-act="row-menu" data-key="${t.kind}:${t.id}" aria-label="More for ${esc(t.name)}">⋯</button></div>`;
      }).join('')}</div>`;
    }).join('')
      : '<p class="empty">Nothing here yet. Add titles from a service page or search.</p>');
}

// Which My List groups you've folded away, remembered on this device.
function collapsedGroups() {
  try { return JSON.parse(localStorage.getItem('listCollapsed') || '[]'); } catch (e) { return []; }
}
function setCollapsed(key, folded) {
  const list = collapsedGroups().filter((k) => k !== key);
  if (folded) list.push(key);
  try { localStorage.setItem('listCollapsed', JSON.stringify(list)); } catch (e) { /* not remembered */ }
}

// The buttons a title gets, from its state. You set your place on the title page; the app works out the rest.
function statusActions(kind, status, pstate) {
  const remove = { op: 'remove', label: 'Remove' };
  const pause = { op: 'pause', label: 'Pause' };
  if (!status) return { main: { op: 'add', label: '+ My List' }, quiet: [] };
  if (status === 'paused') return { main: { op: 'resume', label: 'Resume' }, quiet: [remove] };
  if (kind === 'movie') {
    return status === 'finished' ? { main: { op: 'rewatch', label: 'Watch again' }, quiet: [remove] } : { main: { op: 'watched', label: 'Watched it' }, quiet: [pause, remove] };
  }
  if (status === 'none') return { main: { op: 'start', label: 'Start watching' }, quiet: [remove] };
  if (status === 'finished') return { main: { op: 'rewatch', label: 'Rewatch' }, quiet: [remove] };
  if (pstate === 'caught') return { main: { op: 'rewatch', label: 'Rewatch' }, quiet: [pause, remove] };
  if (pstate === 'waiting') return { main: null, quiet: [pause, remove] }; // nothing to mark until more episodes air
  return { main: { op: 'allwatched', label: 'Mark all watched' }, quiet: [pause, remove] };
}

function opButton(a, t, cls) {
  return `<button class="${cls}" data-act="lib-op" data-op="${a.op}" data-kind="${t.kind}" data-id="${t.id}" data-name="${esc(t.name)}" data-poster="${esc(t.poster || '')}" data-year="${esc(t.year || '')}" data-place="${esc(t.place || '')}">${esc(a.label)}</button>`;
}

async function screenServices(rid) {
  renderNav('services', true);
  const st = state.status;
  $view.innerHTML = header('Services') + `
    <p class="hint">Open a service to browse it and add titles.</p>
    <div class="pad"><div class="panel">${st.services.map((s) => `<a class="item" href="#/service/${encodeURIComponent(s.family)}"><span style="display:flex;align-items:center;gap:12px">${s.logo ? `<img class="svc-logo" src="${img(s.logo, 'w92')}" alt="">` : ''}<span class="t">${esc(s.name)}</span></span><span style="color:var(--accent);font-size:18px">›</span></a>`).join('') || '<p class="empty" style="padding:14px">No services yet.</p>'}</div></div>
    <div class="pad" style="margin-top:12px"><a class="btn-outline" style="display:flex;align-items:center;justify-content:center;border-style:dashed" href="#/setup">Add or remove services</a></div>
    <p class="attrib">This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data from JustWatch.</p>`;
}

// Following: the people, franchises and studios whose new titles come to Updates.
async function screenFollowing(rid) {
  renderNav('following', true);
  $view.innerHTML = header('Following') + '<p class="loading">Loading…</p>';
  const d = await api('/tracked');
  if (rid !== state.renderId) return;
  const groups = [['person', 'People'], ['collection', 'Franchises'], ['studio', 'Studios']]
    .map(([type, label]) => [label, d.follows.filter((f) => f.type === type)]).filter(([, list]) => list.length);
  const row = (f) => `<a class="item" href="#/${f.type}/${f.id}"><span style="display:flex;align-items:center;gap:12px;min-width:0">${f.image ? `<img src="${img(f.image, 'w92')}" alt="" style="width:40px;height:40px;border-radius:${f.type === 'person' ? '20px' : '6px'};object-fit:${f.type === 'studio' ? 'contain' : 'cover'};background:${f.type === 'studio' ? '#fff' : 'var(--surface-2)'};flex:none">` : ''}<span class="l"><span class="t">${esc(f.name)}</span><span class="s">${FOLLOW_KIND[f.type]}</span></span></span><span style="color:var(--accent);font-size:18px">›</span></a>`;
  $view.innerHTML = header('Following') + `<p class="hint">New releases from everyone and everything here come to Updates on Watching. Open one to unfollow.</p>` +
    (groups.length ? groups.map(([label, list]) => `<h2 class="sec" style="font-size:16px">${label} <span class="count">${list.length}</span></h2><div class="pad"><div class="panel">${list.map(row).join('')}</div></div>`).join('')
      : '<p class="empty">Follow a person, franchise or studio from its page. Search finds them too.</p>');
}

async function screenSearch(rid) {
  renderNav(null, true);
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 12px;font-size:24px">Search all titles</h1>
    <label class="lbl" for="all-search">Title</label>
    <input id="all-search" class="search" type="search" placeholder="Shows and movies on any service" data-search="all" autofocus></div>
    <div id="all-results" style="margin-top:14px"></div>`;
  const input = document.getElementById('all-search');
  if (state.lastSearch) { input.value = state.lastSearch; runSearch(input); }
  input.focus();
}

async function runSearch(input) {
  const q = input.value;
  const fam = input.dataset.search === 'service' ? input.dataset.family : '';
  if (input.dataset.search === 'all') state.lastSearch = q;
  const out = document.getElementById(fam ? 'svc-results' : 'all-results');
  const rows = document.getElementById('svc-rows');
  if (!q.trim()) { out.innerHTML = ''; if (rows) rows.hidden = false; return; }
  if (rows) rows.hidden = true;
  out.innerHTML = '<p class="loading">Searching…</p>';
  try {
    const data = await api('/search?q=' + encodeURIComponent(q) + (fam ? '&service=' + encodeURIComponent(fam) : ''));
    if (input.value !== q) return;
    if (fam) {
      out.innerHTML = data.results.length ? `<div class="grid" style="margin-top:12px">${data.results.map((t) => card(t)).join('')}</div>` : '<p class="empty" style="margin-top:12px">No matches.</p>';
      return;
    }
    const titles = data.results.length ? `<h3 class="sub-sec">Titles</h3><div class="grid">${data.results.map((t) => card(t)).join('')}</div>` : '';
    const people = data.people.length ? `<h3 class="sub-sec">People</h3><div class="people">${data.people.map((p) => `<a class="person" href="#/person/${p.id}"><span class="face">${p.photo ? `<img src="${img(p.photo, 'w185')}" alt="" loading="lazy">` : esc(initials(p.name))}</span><span class="n">${esc(p.name)}</span><span class="r">${esc(p.known)}</span></a>`).join('')}</div>` : '';
    const cols = data.collections.length ? `<h3 class="sub-sec">Collections</h3><div class="hs">${data.collections.map((c) => `<div class="card"><a class="poster" href="#/collection/${c.id}" aria-label="${esc(c.name)}">${c.poster ? `<img src="${img(c.poster, 'w342')}" alt="" loading="lazy">` : `<span class="ph">${esc(c.name)}</span>`}</a><div class="meta"><div class="name">${esc(c.name)}</div><div class="sub">Collection</div></div></div>`).join('')}</div>` : '';
    const studios = data.studios.length ? `<h3 class="sub-sec">Studios</h3><div class="pad"><div class="panel">${data.studios.map((s) => `<a class="item" href="#/studio/${s.id}"><span style="display:flex;align-items:center;gap:12px;min-width:0">${s.logo ? `<img src="${img(s.logo, 'w92')}" alt="" style="width:44px;height:28px;object-fit:contain;background:#fff;border-radius:4px;padding:2px;flex:none">` : '<span style="width:44px;flex:none"></span>'}<span class="l"><span class="t">${esc(s.name)}</span><span class="s">Studio${s.country ? ' · ' + esc(s.country) : ''}</span></span></span><span style="color:var(--accent);font-size:18px">›</span></a>`).join('')}</div></div>` : '';
    // An exact name match ("A24", "Pixar", "Zendaya") moves its section above the titles.
    const exact = (list) => list.some((x) => x.name.toLowerCase() === q.trim().toLowerCase());
    // A title with that exact name still wins ("Dune" the film over a company called Dune).
    const first = exact(data.results) ? [] : exact(data.studios) ? [studios] : exact(data.collections) ? [cols] : data.personFirst || exact(data.people) ? [people] : [];
    const parts = [...first, ...[titles, people, cols, studios].filter((p) => !first.includes(p))];
    out.innerHTML = parts.join('') || '<p class="empty" style="margin-top:12px">No matches.</p>';
  } catch (e) { out.innerHTML = errorHtml(e); }
}

function ratingsHtml(t) {
  return `<div class="ratings">
    <div class="nums">
      <div><p class="v">${t.rating || '—'}</p><p class="k">TMDb</p></div>
      <div><p class="v">${t.votes ? t.votes.toLocaleString() : '—'}</p><p class="k">TMDb votes</p></div>
      <div><p class="v">—</p><p class="k">Rotten Tomatoes</p></div>
    </div>
    <p style="margin:10px 0 0;font-size:12px;color:var(--muted)">IMDb, Rotten Tomatoes, Metacritic and awards arrive with OMDb and Wikidata.</p>
  </div>`;
}

async function screenTitle(rid, kind, id) {
  renderNav(null, true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const t = await api('/title/' + kind + '/' + id);
  if (rid !== state.renderId) return;
  state.title = t;
  const e = t.entry;
  const status = e ? e.status : null;
  const isTv = kind === 'tv';
  const actions = statusActions(kind, status, isTv && t.progress ? t.progress.state : null);
  const opT = { ...t, place: isTv && e && status !== 'none' ? `S${t.next.s}E${t.next.e}` : '' };
  const ratingsTop = !e || status === 'none';
  const chips = [
    t.collection ? `<a class="link-chip" href="#/collection/${t.collection.id}"><span class="k">Part of</span>${esc(t.collection.name)}<span class="go">›</span></a>` : '',
    t.studio ? `<a class="link-chip" href="#/studio/${t.studio.id}"><span class="k">Studio</span>${esc(t.studio.name)}<span class="go">›</span></a>` : ''
  ].join('');

  let nextHtml = '';
  if (isTv) {
    const n = t.next;
    const line = status === 'paused' ? `Paused at S${n.s}E${n.e}`
      : status === 'active' || status === 'finished' ? `${t.progress.label} · ${t.progress.line}`
      : `${n.unwatched} episodes aired. Start watching, or tap the episode you're up to.`;
    nextHtml = `<h2 class="sec" style="font-size:16px;margin-bottom:4px">Episodes</h2>
      <p class="hint" style="margin-top:0;font-size:14px;color:var(--text-2)">${esc(line)}</p>
      <div class="chips" id="season-chips">${t.seasons.map((s) => `<button class="chip" data-act="season" data-n="${s.n}" aria-pressed="false">Season ${s.n}</button>`).join('')}</div>
      <p class="hint" style="margin-top:10px">Tap an episode to mark it and everything before it watched. Tap a watched one to un-mark it and everything after.</p>
      <div class="pad"><div class="panel" id="episodes"><p class="loading" style="margin:14px">Loading episodes…</p></div></div>`;
  }

  // Title, details and services sit on the header image; episodes come straight after the buttons.
  $view.innerHTML = `
    <div class="hero">${t.backdrop ? `<img src="${img(t.backdrop, 'w780')}" alt="">` : ''}<div class="shade"></div>
      <button class="back-dot" data-act="back" aria-label="Back">‹</button>
      <div class="hero-text">
        <h1>${esc(t.name)}</h1>
        <p class="d">${esc(t.details)}${t.network ? ' · ' + esc(t.network) : ''}</p>
        <div class="badges">${t.badges.map((b) => `<span class="badge ${b.logo ? '' : 'plain'} ${b.mine ? 'mine' : ''}">${b.logo ? `<img src="${img(b.logo, 'w45')}" alt="">` : ''}${esc(b.label)}</span>`).join('')}</div>
      </div></div>
    <div class="pad" style="margin-top:14px">
      ${actions.main ? opButton(actions.main, opT, 'btn-secondary') : ''}
      ${actions.quiet.length ? `<div class="quiet-row">${actions.quiet.map((a) => opButton(a, opT, 'link-btn')).join('<span aria-hidden="true">·</span>')}</div>` : ''}
      <p style="margin:8px 0 0;font-size:12px;color:var(--muted)">Play on TV comes after the Roku launch test.</p>
    </div>
    ${nextHtml}
    ${t.overview ? `<p class="overview clamp" data-act="expand" style="margin-top:18px">${esc(t.overview)}</p>` : ''}
    ${chips ? `<div class="pad" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${chips}</div>` : ''}
    ${ratingsTop ? `<div class="pad">${ratingsHtml(t)}</div>` : ''}
    ${t.credits.length ? `<h2 class="sec" style="font-size:16px">Cast and crew</h2><div class="people">${t.credits.map((p) => `<a class="person" href="#/person/${p.id}"><span class="face">${p.photo ? `<img src="${img(p.photo, 'w185')}" alt="" loading="lazy">` : esc(initials(p.name))}</span><span class="n">${esc(p.name)}</span><span class="r">${esc(p.role)}</span></a>`).join('')}</div>` : ''}
    <h2 class="sec" style="font-size:16px">Where to watch</h2>
    <div class="pad">
      ${t.where.length ? `<div class="panel">${t.where.map((w) => `<div class="item"><span class="l"><span class="t">${esc(w.kind)}</span><span class="s">${esc(w.sub)}</span></span><span class="badge ${w.logo ? '' : 'plain'} ${w.mine ? 'mine' : ''}">${w.logo ? `<img src="${img(w.logo, 'w45')}" alt="">` : ''}${esc(w.label)}</span></div>`).join('')}</div>` : '<p class="empty" style="margin:0">Not available to watch in the US right now.</p>'}
      ${t.showWill ? '<button class="btn-outline" style="margin-top:12px" data-act="will">Will I Be Able to Stream This?</button>' : ''}
      <p style="margin:10px 0 0;font-size:11.5px;color:var(--muted)">Availability from JustWatch, via TMDb.</p>
    </div>
    ${ratingsTop ? '' : `<h2 class="sec" style="font-size:16px">Ratings</h2><div class="pad">${ratingsHtml(t)}</div>`}`;
  if (isTv && t.seasons.length) {
    const start = t.seasons.find((s) => s.n === t.next.s) ? t.next.s : t.seasons[0].n;
    loadSeason(rid, start);
  }
}

async function loadSeason(rid, n) {
  const t = state.title;
  document.querySelectorAll('#season-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.n) === n)));
  // Bring the chosen season's chip into view in the scrolling row (only sideways, so the page doesn't jump).
  const row = document.getElementById('season-chips');
  const chip = row && row.querySelector(`.chip[data-n="${n}"]`);
  if (chip) row.scrollLeft = chip.offsetLeft - row.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
  const box = document.getElementById('episodes');
  box.innerHTML = '<p class="loading" style="margin:14px">Loading episodes…</p>';
  try {
    const s = await api('/title/tv/' + t.id + '/season/' + n);
    if (rid !== state.renderId) return;
    const nx = t.next;
    box.innerHTML = s.episodes.map((ep) => {
      const before = n < nx.s || (n === nx.s && ep.e < nx.e);
      const isNext = n === nx.s && ep.e === nx.e;
      let cls = '', sub, glyph = '';
      if (!ep.aired) sub = ep.date ? 'Airs ' + ep.date : 'Date TBA';
      else if (before) { cls = 'watched'; sub = 'Watched'; glyph = '✓'; }
      else if (isNext) { cls = 'next'; sub = 'Next up'; }
      else sub = 'Unwatched';
      return `<button class="ep ${cls}" data-act="mark-ep" data-s="${n}" data-e="${ep.e}" data-watched="${before}" ${ep.aired ? '' : 'disabled'}>
        <span class="dot">${glyph}</span><span class="l" style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="t" style="font-size:14px;font-weight:600">${ep.e}. ${esc(ep.name || 'Episode ' + ep.e)}</span><span class="s" style="font-size:12px;color:var(--muted)">${esc(sub)}</span></span></button>`;
    }).join('') || '<p class="empty" style="margin:14px">No episodes listed.</p>';
  } catch (e) { box.innerHTML = errorHtml(e); }
}

function gridSection(title, items) {
  if (!items.length) return '';
  return `<h2 class="sec" style="font-size:16px">${esc(title)} <span class="count">${items.length}</span></h2><div class="grid">${items.map((t) => card(t)).join('')}</div>`;
}

async function screenPerson(rid, id) {
  renderNav(null, true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const p = await api('/person/' + id);
  if (rid !== state.renderId) return;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad" style="display:flex;align-items:center;gap:14px;margin-top:4px">
      <span class="person" style="flex:0 0 72px;width:72px;padding:0"><span class="face" style="width:72px;height:72px;border-radius:36px">${p.photo ? `<img src="${img(p.photo, 'w185')}" alt="">` : esc(initials(p.name))}</span></span>
      <span><span style="display:block;font-size:24px;font-weight:700;line-height:1.2">${esc(p.name)}</span><span style="font-size:13px;color:var(--text-2)">${esc(p.known || '')}</span></span>
    </div>
    <div class="pad" style="margin:12px 0 2px">${followBtn('person', p)}</div>
    <p class="hint">Following adds their new titles to Updates.</p>
    ${gridSection('Movies', p.movies)}${gridSection('Shows', p.shows)}`;
}

async function screenCollection(rid, id) {
  renderNav(null, true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const c = await api('/collection/' + id);
  if (rid !== state.renderId) return;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 4px;font-size:26px">${esc(c.name)}</h1><p style="margin:0;font-size:13px;color:var(--text-2)">Collection · ${c.items.length} films in release order</p><p style="margin:4px 0 0;font-size:12px;color:var(--muted)">Source: TMDb collection</p><div style="margin-top:12px">${followBtn('collection', c)}</div></div>
    ${gridSection('Films', c.items)}`;
}

async function screenStudio(rid, id) {
  renderNav(null, true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const s = await api('/studio/' + id);
  if (rid !== state.renderId) return;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 4px;font-size:26px">${esc(s.name)}</h1><p style="margin:0;font-size:13px;color:var(--text-2)">Studio · newest first</p><p style="margin:4px 0 0;font-size:12px;color:var(--muted)">Source: TMDb production companies</p><div style="margin-top:12px">${followBtn('studio', s)}</div></div>
    ${gridSection('Movies', s.movies)}${gridSection('Shows', s.shows)}`;
}

// ---------- Router ----------

async function route() {
  closeSheet();
  const rid = ++state.renderId;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (!state.status) state.status = await api('/status');
    if (!state.status.hasKey) {
      renderNav(null, false);
      $view.innerHTML = '<div style="padding:28px 16px 0"><h1 style="margin:0;font-size:26px">Streaming Tracker</h1></div>' + errorHtml({ status: 503 });
      return;
    }
    const [p0, p1, p2] = parts;
    if (!p0) {
      location.replace(state.status.services.length ? '#/watching' : '#/setup');
      return;
    }
    // Only jump to the top when moving to a new screen, not when re-rendering the same one.
    if (location.hash !== state.lastHash) window.scrollTo(0, 0);
    state.lastHash = location.hash;
    const keepY = window.scrollY;
    requestAnimationFrame(() => { if (location.hash === state.lastHash && keepY) window.scrollTo(0, keepY); });
    if (p0 === 'setup') return await screenSetup(rid);
    if (p0 === 'service' && p1) return await screenService(rid, decodeURIComponent(p1));
    if (p0 === 'watching') return await screenWatching(rid);
    if (p0 === 'mylist') return await screenMyList(rid);
    if (p0 === 'services') return await screenServices(rid);
    if (p0 === 'following') return await screenFollowing(rid);
    if (p0 === 'tracked') { location.replace('#/following'); return; }
    if (p0 === 'good' && p1 === 'step' && p2) return await screenGoodStep(rid, p2);
    if (p0 === 'good' && p1 === 'results') return await screenGoodResults(rid);
    if (p0 === 'good') { goodStart(); return; }
    if (p0 === 'search') return await screenSearch(rid);
    if (p0 === 'title' && p1 && p2) return await screenTitle(rid, p1, p2);
    if (p0 === 'person' && p1) return await screenPerson(rid, p1);
    if (p0 === 'collection' && p1) return await screenCollection(rid, p1);
    if (p0 === 'studio' && p1) return await screenStudio(rid, p1);
    location.replace('#/watching');
  } catch (e) {
    if (rid === state.renderId) $view.innerHTML = errorHtml(e);
  }
}

// ---------- Actions ----------

async function finishSetup() {
  state.setup = null;
  saveSetup();
  location.hash = '#/watching';
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  try {
    if (act === 'close-sheet') {
      closeSheet();
      if (state.refreshOnClose) { state.refreshOnClose = false; route(); }
      return;
    }

    if (act === 'rule-toggle') {
      const on = el.getAttribute('aria-checked') !== 'true';
      await api('/rule', { kind: el.dataset.kind, id: el.dataset.id, type: el.dataset.type, target: el.dataset.target, enabled: on });
      el.setAttribute('aria-checked', String(on));
      el.querySelector('.sw').setAttribute('aria-checked', String(on));
      return;
    }
    if (act === 'follow-toggle') {
      const isSwitch = el.getAttribute('role') === 'switch';
      const on = (isSwitch ? el.getAttribute('aria-checked') : el.getAttribute('aria-pressed')) !== 'true';
      await api('/follow', { type: el.dataset.type, id: el.dataset.id, name: el.dataset.name, image: el.dataset.image || null, on });
      if (isSwitch) { el.setAttribute('aria-checked', String(on)); el.querySelector('.sw').setAttribute('aria-checked', String(on)); return; }
      el.setAttribute('aria-pressed', String(on));
      el.textContent = on ? '✓ Following' : 'Follow';
      return toast(on ? `Following ${el.dataset.name}. New titles will come to Updates.` : `Stopped following ${el.dataset.name}`);
    }
    if (act === 'upd-add' || act === 'upd-dismiss') {
      const d = el.dataset;
      if (act === 'upd-add') await api('/library', { op: 'add', kind: d.kind, id: d.id, name: d.name, poster: d.poster || null, year: d.year });
      else await api('/updates/dismiss', { kind: d.kind, id: d.id });
      el.closest('.upd').remove();
      return toast(act === 'upd-add' ? `Added ${d.name} to My List` : `Dismissed ${d.name}`);
    }
    if (act === 'upd-manage') return openManageSheet(state.updates[el.dataset.key]);

    if (act === 'back') return history.length > 1 ? history.back() : (location.hash = '#/watching');
    if (act === 'expand') return el.classList.toggle('clamp');

    if (act === 'toggle-list') {
      ev.preventDefault();
      const on = el.classList.contains('on');
      await api('/library', { op: on ? 'remove' : 'add', kind: el.dataset.kind, id: el.dataset.id, name: el.dataset.name, poster: el.dataset.poster || null, year: el.dataset.year });
      el.classList.toggle('on', !on);
      el.textContent = on ? '+' : '✓';
      el.setAttribute('aria-label', (on ? 'Add ' : 'Remove ') + el.dataset.name + (on ? ' to My List' : ' from My List'));
      return toast(on ? 'Removed from My List' : 'Added to My List');
    }

    if (act === 'pick-service') {
      const fam = el.dataset.family;
      if (state.selected.has(fam)) state.selected.delete(fam); else state.selected.add(fam);
      const on = state.selected.has(fam);
      el.setAttribute('aria-pressed', String(on));
      const st = el.querySelector('.st') || el.querySelector('.s');
      if (st) { st.textContent = on ? '✓ Added' : (el.classList.contains('tile') ? 'Tap to add' : 'Add'); st.style.color = on ? 'var(--accent)' : 'var(--muted)'; }
      return;
    }
    if (act === 'setup-continue' || act === 'setup-done') {
      if (!state.selected.size) return toast('Pick at least one service.');
      const res = await api('/services', { families: [...state.selected] });
      state.status.services = res.services;
      state.selected = null;
      if (act === 'setup-done') { location.hash = '#/services'; return; }
      state.setup = { queue: res.services.map((s) => s.family), idx: 0 };
      saveSetup();
      location.hash = '#/service/' + encodeURIComponent(state.setup.queue[0]);
      return;
    }
    if (act === 'setup-cancel') { state.selected = null; location.hash = '#/services'; return; }
    if (act === 'setup-skip') {
      if (state.selected && state.selected.size) {
        const res = await api('/services', { families: [...state.selected] });
        state.status.services = res.services;
      }
      state.selected = null;
      return finishSetup();
    }
    if (act === 'setup-next') {
      const q = state.setup;
      if (q.idx < q.queue.length - 1) {
        q.idx += 1;
        saveSetup();
        location.hash = '#/service/' + encodeURIComponent(q.queue[q.idx]);
      } else finishSetup();
      return;
    }

    if (act === 'remove-list') {
      await api('/library', { op: 'remove', kind: el.dataset.kind, id: el.dataset.id });
      toast('Removed ' + el.dataset.name + ' from My List');
      return route();
    }

    if (act === 'list-acc') {
      const open = el.getAttribute('aria-expanded') !== 'true';
      el.setAttribute('aria-expanded', String(open));
      document.getElementById('grp-' + el.dataset.key).hidden = !open;
      setCollapsed(el.dataset.key, !open);
      return;
    }

    if (act === 'row-menu') {
      const t = state.listItems[el.dataset.key];
      const a = statusActions(t.kind, t.status, t.pstate);
      // Starting a show happens on its title page, so the menu leaves Start watching out.
      const ops = [a.main, ...a.quiet].filter((x) => x && x.op !== 'start');
      return openSheet(`<h2>${esc(t.name)}</h2><p>${esc(t.progress || (t.kind === 'tv' ? 'Series' : 'Movie'))}</p>
        <div class="stack">${ops.map((x) => opButton(x, t, 'btn-secondary')).join('')}<a class="btn-secondary" href="#/title/${t.kind}/${t.id}">Open title page</a></div>`);
    }

    if (act === 'lib-op') {
      const d = el.dataset;
      const base = { kind: d.kind, id: d.id, name: d.name, poster: d.poster || null, year: d.year };
      if (d.op === 'remove') {
        return openSheet(`<h2>Remove ${esc(d.name)}?</h2>
          <p>${d.place ? `Your place (${esc(d.place)}) will be lost. ` : ''}It also leaves Watching and Coming soon. Pause keeps it instead.</p>
          <div class="stack"><button class="btn-primary" style="background:#E5484D;color:#fff" data-act="remove-list" data-kind="${d.kind}" data-id="${d.id}" data-name="${esc(d.name)}">Remove from My List</button></div>`);
      }
      const res = await api('/library', d.op === 'allwatched' ? { ...base, through: 'all' } : { ...base, op: d.op });
      closeSheet();
      const prev = res.prev;
      const undo = async () => {
        await api('/library', prev ? { ...base, status: prev.status, s: prev.s, e: prev.e } : { ...base, op: 'remove' });
        route();
      };
      const MSG = { add: 'Added to My List', start: 'Started at S1E1', allwatched: 'Marked every aired episode watched', pause: 'Paused', resume: 'Resumed', rewatch: 'Starting again from the beginning', watched: 'Marked watched' };
      let msg = `${d.name}: ${MSG[d.op]}`;
      if (res.autoFinished) msg = `${d.name} is finished. Moved to Finished.`;
      else if (d.op === 'allwatched' && res.progress) msg += `. ${res.progress.label} · ${res.progress.line}`;
      toast(msg, d.op === 'add' ? null : undo);
      return route();
    }

    if (act === 'season') return loadSeason(state.renderId, Number(el.dataset.n));

    if (act === 'mark-ep') {
      const t = state.title;
      const base = { kind: t.kind, id: t.id, name: t.name, poster: t.poster, year: t.year };
      const s = Number(el.dataset.s), e = Number(el.dataset.e);
      const res = el.dataset.watched === 'true'
        ? await api('/library', { ...base, status: 'active', s, e })
        : await api('/library', { ...base, through: { s, e } });
      const prev = res.prev;
      const undo = async () => {
        await api('/library', prev ? { ...base, status: prev.status, s: prev.s, e: prev.e } : { ...base, op: 'remove' });
        route();
      };
      let msg = el.dataset.watched === 'true' ? `Un-marked from S${s}E${e} on` : `Watched through S${s}E${e}`;
      if (res.autoFinished) msg = `${t.name} is finished. Moved to Finished.`;
      else if (res.progress && res.progress.state !== 'watching') msg += '. ' + res.progress.line;
      toast(msg, undo);
      return route();
    }

    if (act === 'undo') {
      const fn = state.undo;
      $toast.hidden = true;
      state.undo = null;
      if (fn) await fn();
      return;
    }

    if (act === 'will') {
      const t = state.title;
      return openSheet(`<h2>Will I be able to stream this?</h2>
        <p>No service has announced ${esc(t.name)} yet. These open in your browser.</p>
        <div class="stack">
          <a class="btn-secondary" href="${esc(t.willSearch)}" target="_blank" rel="noopener">Search for a streaming date</a>
          ${t.justwatch ? `<a class="btn-secondary" href="${esc(t.justwatch)}" target="_blank" rel="noopener">Check the TMDb watch page</a>` : ''}
        </div>`);
    }
  } catch (e) {
    toast(e.message);
  }
});

let searchTimer;
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.search) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(el), 350);
  }
  if (el.dataset.filter === 'others') {
    const q = el.value.trim().toLowerCase();
    document.querySelectorAll('#others [data-name]').forEach((row) => { row.hidden = q && !row.dataset.name.includes(q); });
  }
});

window.addEventListener('hashchange', route);
route();
