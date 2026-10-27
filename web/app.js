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

function toast(text) {
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, 3200);
}

function openSheet(html) {
  $sheet.innerHTML = `<button class="scrim" data-act="close-sheet" aria-label="Close"></button><div class="sheet" role="dialog">${html}<button class="btn-secondary" style="margin-top:14px;background:none;color:var(--muted)" data-act="close-sheet">Done</button></div>`;
  $sheet.hidden = false;
}
function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; }

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
    <p class="empty">New titles from what you track will appear here. Tracking arrives in the next version.</p>`;
}

async function screenMyList(rid) {
  renderNav('mylist', true);
  $view.innerHTML = header('My List') + '<p class="loading">Loading…</p>';
  const data = await api('/mylist');
  if (rid !== state.renderId) return;
  const seg = (t) => {
    const opts = t.kind === 'tv' ? [['active', 'Active'], ['none', 'No status'], ['finished', 'Finished']] : [['none', 'Not watched'], ['finished', 'Finished']];
    return `<div class="seg" role="group" aria-label="Status of ${esc(t.name)}">${opts.map(([k, l]) => `<button data-act="set-status" data-kind="${t.kind}" data-id="${t.id}" data-status="${k}" aria-pressed="${t.status === k}">${l}</button>`).join('')}</div>`;
  };
  $view.innerHTML = header('My List') + `<p class="hint">Active first, then no status, then Finished.</p>` +
    (data.groups.length ? data.groups.map((g) => `<h2 class="sec" style="font-size:16px">${esc(g.label)} <span class="count">${g.items.length}</span></h2>
      <div class="pad">${g.items.map((t) => `<div style="background:var(--surface);border-radius:12px;padding:10px;margin-bottom:10px">
        <a href="#/title/${t.kind}/${t.id}" style="display:flex;gap:12px;align-items:center;color:inherit" class="${t.faded ? 'faded' : ''}">
          <span class="thumb" style="width:40px;flex:0 0 40px;aspect-ratio:2/3;border-radius:6px;overflow:hidden;background:var(--surface-2);${t.faded ? 'opacity:.45;filter:grayscale(1)' : ''}">${t.poster ? `<img src="${img(t.poster, 'w92')}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</span>
          <span style="display:flex;flex-direction:column;gap:4px;min-width:0"><span style="font-size:15px;font-weight:600">${esc(t.name)}</span><span style="font-size:12px;color:var(--muted)">${t.kind === 'tv' ? 'Series' : 'Movie'}${t.year ? ' · ' + esc(t.year) : ''}</span>${badgeHtml(t.badge, t.more)}</span>
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

function screenPlaceholder(tab, title, text) {
  renderNav(tab, true);
  $view.innerHTML = header(title) + `<p class="empty" style="margin-top:12px">${esc(text)}</p>`;
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
    const line = n.aired ? `S${n.s}E${n.e} · ${n.unwatched} unwatched` : (t.nextAir ? `You're caught up · next episode airs ${t.nextAir.date}` : "You're caught up");
    nextHtml = `<h2 class="sec" style="font-size:16px;margin-bottom:4px">Next up</h2>
      <p class="hint" style="margin-top:0;font-size:14px;color:var(--text-2)">${esc(line)}</p>
      <div class="chips" id="season-chips">${t.seasons.map((s) => `<button class="chip" data-act="season" data-n="${s.n}" aria-pressed="false">Season ${s.n}</button>`).join('')}</div>
      <p class="hint" style="margin-top:10px">Tap an episode to make it Next up. Earlier episodes count as watched.</p>
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
      return `<button class="ep ${cls}" data-act="set-next" data-s="${n}" data-e="${ep.e}" ${ep.aired ? '' : 'disabled'}>
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
    <p class="hint" style="margin-top:12px">Follow arrives with tracking in the next version.</p>
    ${gridSection('Movies', p.movies)}${gridSection('Shows', p.shows)}`;
}

async function screenCollection(rid, id) {
  renderNav(null, true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const c = await api('/collection/' + id);
  if (rid !== state.renderId) return;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 4px;font-size:26px">${esc(c.name)}</h1><p style="margin:0;font-size:13px;color:var(--text-2)">Collection · ${c.items.length} films in release order</p><p style="margin:4px 0 0;font-size:12px;color:var(--muted)">Source: TMDb collection</p></div>
    ${gridSection('Films', c.items)}`;
}

async function screenStudio(rid, id) {
  renderNav(null, true);
  $view.innerHTML = '<p class="loading">Loading…</p>';
  const s = await api('/studio/' + id);
  if (rid !== state.renderId) return;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 4px;font-size:26px">${esc(s.name)}</h1><p style="margin:0;font-size:13px;color:var(--text-2)">Studio · newest first</p><p style="margin:4px 0 0;font-size:12px;color:var(--muted)">Source: TMDb production companies</p></div>
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
    if (p0 === 'tracked') return screenPlaceholder('tracked', 'Tracked', 'Tracking titles, people, franchises and studios arrives in the next version.');
    if (p0 === 'good') return screenPlaceholder('good', 'Good Stuff', 'Curated picks with Pick 3 arrive in the next version, once ratings and awards data are connected.');
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
    if (act === 'close-sheet') return closeSheet();
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

    if (act === 'set-next') {
      const t = state.title;
      await api('/library', { kind: t.kind, id: t.id, name: t.name, poster: t.poster, year: t.year, s: el.dataset.s, e: el.dataset.e });
      toast('Next up: S' + el.dataset.s + 'E' + el.dataset.e);
      return route();
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
