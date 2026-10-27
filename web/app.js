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
  tracked: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  services: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  good: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'
};
const TABS = [['watching', 'Watching'], ['mylist', 'My List'], ['tracked', 'Tracked'], ['services', 'Services'], ['good', 'Good Stuff']];

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

async function openTrackSheet() {
  const t = state.title;
  const o = await api('/track/' + t.kind + '/' + t.id);
  state.trackItems = o.items;
  openSheet(`<h2>Track ${esc(t.name)}</h2>
    <p>New titles from what you tick appear in Updates on Watching. Franchise, ${t.kind === 'tv' ? 'creator' : 'director'} and top cast start ticked.</p>
    <div class="panel">${o.items.map((it, i) => `<button class="item" data-act="track-tick" data-i="${i}" role="checkbox" aria-checked="${it.on}"><span class="l"><span class="t">${esc(it.label)}</span><span class="s">${esc(it.role)}</span></span><span class="box">${it.on ? '✓' : ''}</span></button>`).join('')}</div>
    <div class="stack" style="margin-top:14px"><button class="btn-primary" data-act="track-save">${o.tracked ? 'Save' : 'Start tracking'}</button>${o.tracked ? '<button class="btn-secondary" data-act="track-stop">Stop tracking</button>' : ''}</div>`);
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
      ${data.rows.map((r) => `<h2 class="sec" style="font-size:16px">${esc(r.title)}</h2><div class="hs">${r.items.map((t) => card(t, { badge: svcBadge })).join('')}</div>`).join('')}
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
      box.innerHTML = hasSeasons ? '' : `<p class="empty">${f.hasRules ? 'Nothing new from what you track in the last 90 days.' : 'Track a title or follow a person, franchise or studio, and their new releases appear here. New seasons of shows you\'re caught up on show up here too.'}</p>`;
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
  const seg = (t) => {
    const opts = t.kind === 'tv' ? [['none', 'Not started'], ['active', t.group === 'caught' ? 'Caught up' : 'Watching'], ['finished', 'Finished']] : [['none', 'Not started'], ['finished', 'Finished']];
    return `<div class="seg" role="group" aria-label="Status of ${esc(t.name)}">${opts.map(([k, l]) => `<button data-act="set-status" data-kind="${t.kind}" data-id="${t.id}" data-status="${k}" aria-pressed="${t.status === k}">${l}</button>`).join('')}</div>`;
  };
  $view.innerHTML = header('My List') + `<p class="hint">Watching: episodes left, aired or dated. Caught up: you've seen everything aired and the next season isn't out. Finished: done for good.</p>` +
    (data.groups.length ? data.groups.map((g) => `<h2 class="sec" style="font-size:16px">${esc(g.label)} <span class="count">${g.items.length}</span></h2>
      <div class="pad">${g.items.map((t) => `<div style="background:var(--surface);border-radius:12px;padding:10px;margin-bottom:10px">
        <a href="#/title/${t.kind}/${t.id}" style="display:flex;gap:12px;align-items:center;color:inherit" class="${t.faded ? 'faded' : ''}">
          <span class="thumb" style="width:40px;flex:0 0 40px;aspect-ratio:2/3;border-radius:6px;overflow:hidden;background:var(--surface-2);${t.faded ? 'opacity:.45;filter:grayscale(1)' : ''}">${t.poster ? `<img src="${img(t.poster, 'w92')}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</span>
          <span style="display:flex;flex-direction:column;gap:4px;min-width:0"><span style="font-size:15px;font-weight:600">${esc(t.name)}</span><span style="font-size:12px;color:var(--muted)">${t.kind === 'tv' ? 'Series' : 'Movie'}${t.year ? ' · ' + esc(t.year) : ''}</span>${t.progress ? `<span style="font-size:12.5px;color:var(--text-2)">${esc(t.progress)}</span>` : ''}${badgeHtml(t.badge, t.more)}</span>
        </a><div class="row-actions">${seg(t)}<button class="link-btn" data-act="remove-list" data-kind="${t.kind}" data-id="${t.id}" data-name="${esc(t.name)}" aria-label="Remove ${esc(t.name)} from My List">Remove</button></div></div>`).join('')}</div>`).join('')
      : '<p class="empty">Nothing here yet. Add titles from a service page or search.</p>');
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

async function screenTracked(rid) {
  renderNav('tracked', true);
  $view.innerHTML = header('Tracked') + '<p class="loading">Loading…</p>';
  const d = await api('/tracked');
  if (rid !== state.renderId) return;
  const followHref = (f) => `#/${f.type}/${f.id}`;
  $view.innerHTML = header('Tracked') + `
    <p class="hint">What feeds Updates on Watching. Open a title to change its rules.</p>
    <h2 class="sec" style="font-size:16px">Titles <span class="count">${d.titles.length}</span></h2>
    ${d.titles.length ? `<div class="pad">${d.titles.map((t) => `<a class="row-card" href="#/tracked/${t.kind}/${t.id}"><span class="thumb">${t.poster ? `<img src="${img(t.poster, 'w185')}" alt="" loading="lazy">` : ''}</span><span class="body"><span class="title">${esc(t.name)}</span><span class="line">${esc(t.line)}</span></span><span style="color:var(--accent);font-size:18px">›</span></a>`).join('')}</div>`
      : '<p class="empty">No tracked titles yet. Open a title you loved and turn on Track.</p>'}
    <h2 class="sec" style="font-size:16px">Following <span class="count">${d.follows.length}</span></h2>
    ${d.follows.length ? `<div class="pad"><div class="panel">${d.follows.map((f) => `<a class="item" href="${followHref(f)}"><span style="display:flex;align-items:center;gap:12px;min-width:0">${f.image ? `<img src="${img(f.image, 'w92')}" alt="" style="width:36px;height:36px;border-radius:${f.type === 'person' ? '18px' : '6px'};object-fit:${f.type === 'studio' ? 'contain' : 'cover'};background:var(--surface-2);flex:none">` : ''}<span class="l"><span class="t">${esc(f.name)}</span><span class="s">${FOLLOW_KIND[f.type]}</span></span></span><span style="color:var(--accent);font-size:18px">›</span></a>`).join('')}</div></div>`
      : '<p class="empty">Follow a person, franchise or studio from its page.</p>'}`;
}

async function screenTrackedTitle(rid, kind, id) {
  renderNav('tracked', true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const m = await api('/tracked/' + kind + '/' + id);
  if (rid !== state.renderId) return;
  $view.innerHTML = `<a class="back" href="#/tracked">‹ Tracked</a>
    <div class="pad" style="display:flex;gap:14px;align-items:center;margin:4px 0 6px">
      ${m.poster ? `<img src="${img(m.poster, 'w185')}" alt="" style="width:56px;border-radius:8px">` : ''}
      <span><span style="display:block;font-size:22px;font-weight:700;line-height:1.2">${esc(m.name)}</span><a href="#/title/${m.kind}/${m.id}" style="font-size:13px">Open title page ›</a></span>
    </div>
    <p class="hint">Each rule's switch decides whether its new titles come to Updates. The posters are everything it covers, newest first.</p>
    ${m.rules.map((r) => `<div class="rule panel"><button class="item" data-act="rule-toggle" data-kind="${m.kind}" data-id="${m.id}" data-type="${r.type}" data-target="${r.target}" role="switch" aria-checked="${r.enabled}"><span class="l"><span class="t">${esc(r.label)}</span><span class="s">${esc(r.role)}</span></span><span class="sw" aria-checked="${r.enabled}"></span></button></div>
      <div class="hs rule-results">${r.results.length ? r.results.map((t) => card(t)).join('') : '<p class="empty" style="margin:0">No released titles.</p>'}</div>`).join('')}
    <div class="pad" style="margin:18px 0"><button class="btn-secondary" data-act="track-stop" data-kind="${m.kind}" data-id="${m.id}">Stop tracking</button></div>`;
}

// Good Stuff filters are remembered on this device only.
function loadGoodFilters() {
  try { return JSON.parse(localStorage.getItem('good') || 'null') || {}; } catch (e) { return {}; }
}
function saveGoodFilters() {
  try { localStorage.setItem('good', JSON.stringify(state.good)); } catch (e) { /* not saved */ }
}
const DECADES = [['', 'Any decade'], ['2020', '2020s'], ['2010', '2010s'], ['2000', '2000s'], ['1990', '1990s'], ['1980', '1980s'], ['1970', '1970s'], ['older', 'Before 1970']];

async function screenGood(rid) {
  renderNav('good', true);
  if (!state.good) state.good = { genre: '', decade: '', person: null, studio: null, rentals: false, ...loadGoodFilters() };
  $view.innerHTML = header('Good Stuff') + `
    <p class="hint">Well reviewed by your thresholds, or notable for awards, cult status or trending. Titles on My List are left out.</p>
    <div id="good-filters"></div>
    <div class="pad" style="margin:14px 0 4px"><button class="btn-primary" data-act="pick3">Pick 3 for me</button></div>
    <div id="pick3"></div>
    <div id="good-results"><p class="loading">Finding good stuff…</p></div>`;
  return loadGood(rid);
}

function goodFiltersHtml(genres) {
  const g = state.good;
  const chip = (act, val, label, on) => `<button class="chip" data-act="${act}" data-val="${esc(val)}" aria-pressed="${on}">${esc(label)}</button>`;
  const pickChip = (type, label) => {
    const v = g[type];
    return v ? `<button class="chip" data-act="good-clear" data-type="${type}" aria-pressed="true">${esc(v.name)} ✕</button>`
      : `<button class="chip" data-act="good-find" data-type="${type}" aria-pressed="false">+ ${label}</button>`;
  };
  return `<div class="chips" style="margin-bottom:8px">${chip('good-genre', '', 'Any genre', !g.genre)}${genres.map((x) => chip('good-genre', x.name, x.name, g.genre === x.name)).join('')}</div>
    <div class="chips" style="margin-bottom:8px">${DECADES.map(([v, l]) => chip('good-decade', v, l, (g.decade || '') === v)).join('')}</div>
    <div class="chips">${pickChip('person', 'Person')}${pickChip('studio', 'Studio')}${chip('good-rentals', '', 'Include rentals', !!g.rentals)}<button class="chip" data-act="good-thresholds" aria-pressed="false">Thresholds</button></div>`;
}

async function loadGood(rid) {
  const g = state.good;
  const box = document.getElementById('good-results');
  box.innerHTML = '<p class="loading">Finding good stuff…</p>';
  document.getElementById('pick3').innerHTML = '';
  const qs = new URLSearchParams();
  if (g.genre) qs.set('genre', g.genre);
  if (g.decade) qs.set('decade', g.decade);
  if (g.person) qs.set('person', g.person.id);
  if (g.studio) qs.set('studio', g.studio.id);
  if (g.rentals) qs.set('rentals', '1');
  try {
    const d = await api('/good?' + qs);
    if (rid !== state.renderId) return;
    state.goodItems = d.items;
    state.goodSettings = d.settings;
    document.getElementById('good-filters').innerHTML = goodFiltersHtml(d.genres);
    box.innerHTML = d.items.length
      ? `<h2 class="sec" style="font-size:16px">Results <span class="count">${d.items.length}</span></h2><div class="grid">${d.items.map((t) => card({ ...t, sub: t.reason })).join('')}</div>`
      : '<p class="empty" style="margin-top:12px">Nothing matches these filters. Try fewer filters, include rentals, or lower your thresholds.</p>';
  } catch (e) { if (rid === state.renderId) box.innerHTML = errorHtml(e); }
}

function renderPick3() {
  const items = [...(state.goodItems || [])];
  const box = document.getElementById('pick3');
  if (!items.length) { box.innerHTML = '<p class="empty">Nothing to pick from with these filters.</p>'; return; }
  const picks = [];
  while (picks.length < 3 && items.length) picks.push(items.splice(Math.floor(Math.random() * items.length), 1)[0]);
  box.innerHTML = `<div class="pick3"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="margin:0;font-size:16px">Your three</h2><button class="chip" data-act="pick3">Re-roll</button></div>
    <div class="grid" style="padding:0">${picks.map((t) => card({ ...t, sub: t.reason })).join('')}</div></div>`;
}

function openThresholds() {
  const s = state.goodSettings;
  const field = (k, label, step, disabled) => `<label class="lbl" for="th-${k}">${label}</label><input id="th-${k}" class="search" type="number" inputmode="decimal" step="${step}" value="${s[k]}" ${disabled ? 'disabled' : ''} style="margin-bottom:12px">`;
  openSheet(`<h2>Well-reviewed thresholds</h2>
    <p>A title counts as well reviewed if it clears any one of these. Notable titles (awards, cult status, trending) get in regardless.</p>
    ${field('minTmdb', 'TMDb rating at least', '0.1')}${field('minVotes', 'with at least this many TMDb votes', '50')}
    ${field('minRt', 'Rotten Tomatoes at least (%)', '1', !s.hasOmdb)}${field('minMc', 'Metacritic at least', '1', !s.hasOmdb)}
    ${s.hasOmdb ? '' : '<p>Rotten Tomatoes and Metacritic need a free OMDb key in config.local.json as "omdbKey".</p>'}
    <button class="btn-primary" data-act="thresholds-save">Save</button>`);
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
    out.innerHTML = data.results.length ? `<div class="grid" style="margin-top:12px">${data.results.map((t) => card(t)).join('')}</div>` : '<p class="empty" style="margin-top:12px">No matches.</p>';
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
  let statusLabel, statusVal;
  if (!e) { statusLabel = '+ My List'; statusVal = 'add'; }
  else if (isTv && status === 'none') { statusLabel = 'Start Watching?'; statusVal = 'active'; }
  else if (status === 'finished') { statusLabel = 'Watch again?'; statusVal = 'again'; }
  else { statusLabel = 'Finished?'; statusVal = 'finished'; }
  const ratingsTop = !e || status === 'none';
  const chips = [
    t.collection ? `<a class="link-chip" href="#/collection/${t.collection.id}"><span class="k">Part of</span>${esc(t.collection.name)}<span class="go">›</span></a>` : '',
    t.studio ? `<a class="link-chip" href="#/studio/${t.studio.id}"><span class="k">Studio</span>${esc(t.studio.name)}<span class="go">›</span></a>` : ''
  ].join('');

  let nextHtml = '';
  if (isTv) {
    const n = t.next;
    const line = status === 'active' || status === 'finished' ? t.progress.line : `Starts at S${n.s}E${n.e} · ${n.unwatched} episodes aired`;
    nextHtml = `<h2 class="sec" style="font-size:16px;margin-bottom:4px">Episodes</h2>
      <p class="hint" style="margin-top:0;font-size:14px;color:var(--text-2)">${esc(line)}</p>
      <div class="chips" id="season-chips">${t.seasons.map((s) => `<button class="chip" data-act="season" data-n="${s.n}" aria-pressed="false">Season ${s.n}</button>`).join('')}</div>
      <p class="hint" style="margin-top:10px">Tap an episode to mark it and everything before it watched. Tap a watched one to un-mark it and everything after.</p>
      <div class="pad"><div class="panel" id="episodes"><p class="loading" style="margin:14px">Loading episodes…</p></div></div>`;
  }

  $view.innerHTML = `
    <div class="hero">${t.backdrop ? `<img src="${img(t.backdrop, 'w780')}" alt="">` : ''}<div class="shade"></div>
      <button class="back-dot" data-act="back" aria-label="Back">‹</button></div>
    <div class="t-head">
      <h1>${esc(t.name)}</h1>
      <p class="d">${esc(t.details)}${t.network ? ' · ' + esc(t.network) : ''}</p>
      <div class="badges">${t.badges.map((b) => `<span class="badge ${b.logo ? '' : 'plain'} ${b.mine ? 'mine' : ''}">${b.logo ? `<img src="${img(b.logo, 'w45')}" alt="">` : ''}${esc(b.label)}</span>`).join('')}</div>
      ${chips ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${chips}</div>` : ''}
      ${ratingsTop ? ratingsHtml(t) : ''}
    </div>
    ${t.overview ? `<p class="overview clamp" data-act="expand">${esc(t.overview)}</p>` : ''}
    <div class="pad" style="margin-top:14px">
      <button class="btn-secondary" data-act="title-status" data-val="${statusVal}">${statusLabel}</button>
      ${e ? `<button class="link-btn" style="margin-top:6px" data-act="remove-list" data-kind="${t.kind}" data-id="${t.id}" data-name="${esc(t.name)}">Remove from My List</button>` : ''}
      <p style="margin:8px 0 0;font-size:12px;color:var(--muted)">Play on TV comes after the Roku launch test.</p>
      <div class="panel" style="margin-top:12px"><button class="item" data-act="track-open" aria-label="Track ${esc(t.name)}"><span class="l"><span class="t">Track</span><span class="s">${t.tracked ? 'On · related new titles come to Updates' : 'Get updates on related titles'}</span></span><span class="sw" aria-checked="${t.tracked}"></span></button></div>
    </div>
    ${nextHtml}
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
    if (p0 === 'tracked' && p1 && p2) return await screenTrackedTitle(rid, p1, p2);
    if (p0 === 'tracked') return await screenTracked(rid);
    if (p0 === 'good') return await screenGood(rid);
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

    if (act === 'track-open') return openTrackSheet();
    if (act === 'track-tick') {
      const it = state.trackItems[Number(el.dataset.i)];
      it.on = !it.on;
      el.setAttribute('aria-checked', String(it.on));
      el.querySelector('.box').textContent = it.on ? '✓' : '';
      return;
    }
    if (act === 'track-save') {
      const t = state.title;
      await api('/track', { kind: t.kind, id: t.id, name: t.name, poster: t.poster, year: t.year, items: state.trackItems });
      toast(`Tracking ${t.name}`);
      return route();
    }
    if (act === 'track-stop') {
      const t = el.dataset.kind ? { kind: el.dataset.kind, id: el.dataset.id } : state.title;
      await api('/track', { kind: t.kind, id: t.id, op: 'stop' });
      toast('Stopped tracking');
      if (location.hash.startsWith('#/tracked/')) { location.hash = '#/tracked'; return; }
      return route();
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

    if (act === 'good-genre' || act === 'good-decade' || act === 'good-rentals' || act === 'good-clear') {
      const g = state.good;
      if (act === 'good-genre') g.genre = el.dataset.val;
      if (act === 'good-decade') g.decade = el.dataset.val;
      if (act === 'good-rentals') g.rentals = !g.rentals;
      if (act === 'good-clear') g[el.dataset.type] = null;
      saveGoodFilters();
      return loadGood(state.renderId);
    }
    if (act === 'good-find') {
      const type = el.dataset.type;
      openSheet(`<h2>Filter by ${type === 'person' ? 'a person' : 'a studio'}</h2>
        <p>${type === 'person' ? 'Anyone in the cast or crew.' : 'Any studio or production company.'}</p>
        <input class="search" type="search" data-find="${type === 'person' ? 'person' : 'company'}" placeholder="${type === 'person' ? 'Greta Gerwig, Pedro Pascal…' : 'A24, Pixar, Ghibli…'}" autofocus>
        <div id="find-results" class="panel" style="margin-top:10px"></div>`);
      $sheet.querySelector('input').focus();
      return;
    }
    if (act === 'good-pick') {
      state.good[el.dataset.type] = { id: Number(el.dataset.id), name: el.dataset.name };
      saveGoodFilters();
      closeSheet();
      return loadGood(state.renderId);
    }
    if (act === 'pick3') return renderPick3();
    if (act === 'good-thresholds') return openThresholds();
    if (act === 'thresholds-save') {
      const body = {};
      for (const k of ['minTmdb', 'minVotes', 'minRt', 'minMc']) { const i = document.getElementById('th-' + k); if (i && !i.disabled) body[k] = i.value; }
      await api('/good/settings', body);
      closeSheet();
      toast('Thresholds saved');
      return loadGood(state.renderId);
    }
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

    if (act === 'set-status') {
      await api('/library', { kind: el.dataset.kind, id: el.dataset.id, status: el.dataset.status });
      return route();
    }

    if (act === 'title-status') {
      const t = state.title;
      const v = el.dataset.val;
      const base = { kind: t.kind, id: t.id, name: t.name, poster: t.poster, year: t.year };
      if (v === 'add') { await api('/library', { ...base, op: 'add' }); toast('Added to My List'); }
      else if (v === 'active') await api('/library', { ...base, status: 'active' });
      else if (v === 'finished') { await api('/library', { ...base, status: 'finished' }); toast('Marked finished'); }
      else if (v === 'again') await api('/library', t.kind === 'tv' ? { ...base, status: 'active', s: 1, e: 1 } : { ...base, status: 'none' });
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
  if (el.dataset.find) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const out = document.getElementById('find-results');
      const q = el.value;
      if (!q.trim()) { out.innerHTML = ''; return; }
      try {
        const r = await api('/find/' + el.dataset.find + '?q=' + encodeURIComponent(q));
        if (el.value !== q) return;
        const type = el.dataset.find === 'person' ? 'person' : 'studio';
        out.innerHTML = r.results.map((x) => `<button class="item" data-act="good-pick" data-type="${type}" data-id="${x.id}" data-name="${esc(x.name)}"><span class="l"><span class="t">${esc(x.name)}</span><span class="s">${esc(x.sub)}</span></span></button>`).join('') || '<p class="empty" style="padding:12px 0">No matches.</p>';
      } catch (e) { out.innerHTML = errorHtml(e); }
    }, 300);
  }
  if (el.dataset.filter === 'others') {
    const q = el.value.trim().toLowerCase();
    document.querySelectorAll('#others [data-name]').forEach((row) => { row.hidden = q && !row.dataset.name.includes(q); });
  }
});

window.addEventListener('hashchange', route);
route();
