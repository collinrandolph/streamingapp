'use strict';
// Good Stuff: a guided search, one question per page, then results with Pick 3 and saved searches.
// Uses the shared helpers in app.js (api, esc, card, renderNav, openSheet, toast, state…), loaded after this file.

const GOOD_KEY = 'goodStuff'; // this tab's answers survive a reload; each visit to the tab starts fresh
const YEAR_MIN = 1920;
const YEAR_NOW = new Date().getFullYear();
const YEAR_PRESETS = [
  ['any', 'Any time'], ['new', 'New'], ['last5', 'Last 5 years'], ['2010s', '2010s'], ['2000s', '2000s'],
  ['1990s', '90s'], ['1980s', '80s'], ['classics', 'Classics']
];

function goodDefaults() {
  return {
    kinds: ['movie', 'tv'], genres: [], keywords: [], leave: ['kids'],
    years: { preset: 'any' }, services: null, // null = all your services
    min: 7.5, awards: true, cult: true, trending: true
  };
}

function gs() {
  if (!state.gs) {
    try { state.gs = JSON.parse(sessionStorage.getItem(GOOD_KEY) || 'null'); } catch (e) { state.gs = null; }
    if (!state.gs) state.gs = { answers: goodDefaults(), profile: null };
  }
  return state.gs;
}
function saveGs() {
  try { sessionStorage.setItem(GOOD_KEY, JSON.stringify(state.gs)); } catch (e) { /* kept in memory only */ }
}

// Opening the tab always starts the guide from the top with fresh answers.
function goodStart() {
  state.gs = { answers: goodDefaults(), profile: null };
  saveGs();
  location.replace('#/good/step/kinds');
}

// Step 2b appears only when a chosen genre has sub-genres.
function goodSteps(a) {
  const steps = ['kinds', 'genres'];
  if ((state.goodGenres || []).some((g) => a.genres.includes(g.name) && g.keywords.length)) steps.push('keywords');
  return steps.concat(['years', 'services', 'quality']);
}

function yearRange(y) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return iso(d); };
  const decade = (start) => ({ from: start + '-01-01', to: (start + 9) + '-12-31' });
  switch (y.preset) {
    case 'new': return { from: iso(new Date(Date.now() - 365 * 864e5)), to: iso(new Date()) };
    case 'last5': return { from: yearsAgo(5), to: iso(new Date()) };
    case '2010s': return decade(2010);
    case '2000s': return decade(2000);
    case '1990s': return decade(1990);
    case '1980s': return decade(1980);
    case 'classics': return { to: '1979-12-31' };
    case 'custom': return { from: y.from + '-01-01', to: y.to + '-12-31' };
    default: return {};
  }
}
// The slider positions a preset stands for.
function yearSpan(y) {
  const r = yearRange(y);
  return { from: r.from ? Number(r.from.slice(0, 4)) : YEAR_MIN, to: r.to ? Number(r.to.slice(0, 4)) : YEAR_NOW };
}
function yearLabel(y) {
  if (y.preset === 'custom') return y.from === y.to ? String(y.from) : `${y.from}–${y.to}`;
  if (y.preset === 'new') return 'New (last 12 months)';
  if (y.preset === 'classics') return 'Classics (before 1980)';
  return (YEAR_PRESETS.find(([k]) => k === y.preset) || [, 'Any time'])[1];
}

function myServiceList() { return state.status.services; }
function chosenServices(a) { return a.services || myServiceList().map((s) => s.family); }

async function loadGoodBasics() {
  if (!state.goodGenres) state.goodGenres = await api('/good/genres');
  if (!state.goodSettings) state.goodSettings = await api('/good/settings');
  if (!state.goodProfiles) state.goodProfiles = await api('/good/profiles');
}

// ---------- Steps ----------

const STEP_TEXT = {
  kinds: ['Movies or shows?', 'Pick one, or keep both.'],
  genres: ['What are you in the mood for?', 'Pick any number. Leave them all off for any genre.'],
  keywords: ['Narrow it down?', 'Optional. TMDb tags these unevenly, so each one you pick thins the results.'],
  years: ['From when?', 'Tap a range, then fine-tune with the sliders.'],
  services: ['Where?', 'Your services. Turn off any you don\'t feel like using tonight.'],
  quality: ['How good?', 'A title gets in if it clears your rating, or matches anything switched on below.']
};

function choice(act, val, label, on, extra) {
  return `<button class="choice" data-act="${act}" data-val="${esc(val)}" aria-pressed="${on}">${extra || ''}<span>${esc(label)}</span></button>`;
}

function stepBody(step, a) {
  if (step === 'kinds') {
    const profiles = state.goodProfiles || [];
    return `${profiles.length ? `<h3 class="sub-sec" style="margin-left:0">Your searches</h3><div class="chips" style="padding:0;flex-wrap:wrap;margin-bottom:6px">${profiles.map((p) => `<button class="chip" data-act="gs-profile" data-id="${p.id}">${esc(p.name)}</button>`).join('')}<button class="chip" data-act="gs-profiles-manage" style="border-style:dashed">Edit saved</button></div><h3 class="sub-sec" style="margin-left:0">Or start a new search</h3>` : ''}
      <div class="choices two">${choice('gs-kind', 'movie', 'Movies', a.kinds.includes('movie'))}${choice('gs-kind', 'tv', 'Shows', a.kinds.includes('tv'))}</div>`;
  }
  if (step === 'genres') {
    return `<div class="choices">${state.goodGenres.map((g) => choice('gs-genre', g.name, g.name, a.genres.includes(g.name))).join('')}</div>
      <h3 class="sub-sec" style="margin:18px 0 8px">Leave out</h3>
      <div class="choices">${choice('gs-leave', 'kids', 'Kids & family', a.leave.includes('kids'))}${choice('gs-leave', 'animation', 'Animation', a.leave.includes('animation'))}</div>`;
  }
  if (step === 'keywords') {
    return state.goodGenres.filter((g) => a.genres.includes(g.name) && g.keywords.length).map((g) => `<h3 class="sub-sec" style="margin:14px 0 8px">${esc(g.name)}</h3>
      <div class="choices">${g.keywords.map((k) => choice('gs-keyword', k.ids.join(','), k.label, k.ids.every((id) => a.keywords.includes(id)))).join('')}</div>`).join('');
  }
  if (step === 'years') {
    const span = yearSpan(a.years);
    return `<div class="choices">${YEAR_PRESETS.map(([k, l]) => choice('gs-year', k, l, a.years.preset === k)).join('')}</div>
      <p class="year-label" id="year-label">${esc(yearLabel(a.years))}</p>
      <label class="lbl" for="year-from">From <span id="year-from-v">${span.from}</span></label>
      <input id="year-from" class="range" type="range" min="${YEAR_MIN}" max="${YEAR_NOW}" value="${span.from}" data-gs-range="from">
      <label class="lbl" for="year-to" style="margin-top:12px">To <span id="year-to-v">${span.to}</span></label>
      <input id="year-to" class="range" type="range" min="${YEAR_MIN}" max="${YEAR_NOW}" value="${span.to}" data-gs-range="to">`;
  }
  if (step === 'services') {
    const on = chosenServices(a);
    const rentals = !!state.goodSettings.rentals;
    return `<div class="choices">${myServiceList().map((s) => choice('gs-service', s.family, s.name, on.includes(s.family), s.logo ? `<img src="${img(s.logo, 'w92')}" alt="">` : '')).join('')}</div>
      <div class="panel" style="margin-top:16px"><button class="item" data-act="gs-rentals" role="switch" aria-checked="${rentals}"><span class="l"><span class="t">Include rentals</span><span class="s">Titles you can rent or buy, faded. Remembered for next time.</span></span><span class="sw" aria-checked="${rentals}"></span></button></div>`;
  }
  // quality
  const sw = (key, title, sub) => `<button class="item" data-act="gs-way" data-val="${key}" role="switch" aria-checked="${a[key]}"><span class="l"><span class="t">${title}</span><span class="s">${sub}</span></span><span class="sw" aria-checked="${a[key]}"></span></button>`;
  return `<div class="rating-pick"><span class="big" id="min-v">${a.min.toFixed(1)}+</span><span class="s">minimum TMDb rating</span></div>
    <input id="min-rating" class="range" type="range" min="5" max="9" step="0.5" value="${a.min}" data-gs-range="min" aria-label="Minimum TMDb rating">
    <div class="range-ends"><span>5.0 · more</span><span>9.0 · fewer</span></div>
    <h3 class="sub-sec" style="margin:20px 0 8px">Also include, whatever the rating</h3>
    <div class="panel">${sw('awards', 'Award winners and nominees', 'Oscars, Emmys, Golden Globes, BAFTAs and more')}${sw('cult', 'Cult classics', 'Tagged as cult films')}${sw('trending', 'Trending', 'Popular this week')}</div>`;
}

// "Surprise me" only while nothing on the step is selected; "Continue" otherwise; "Show results" on the last step.
// Movies or shows and Where always have something selected (they can't be left empty), so they say Continue.
function nextLabel(step, a, last) {
  if (last) return 'Show results';
  const nothingSelected = {
    genres: a.genres.length === 0,
    keywords: a.keywords.length === 0,
    years: a.years.preset === 'any'
  }[step];
  return nothingSelected ? 'Surprise me' : 'Continue';
}
function stepBlocked(step, a) {
  if (step === 'kinds' && !a.kinds.length) return 'Pick movies, shows or both.';
  if (step === 'services' && !chosenServices(a).length) return 'Pick at least one service.';
  return '';
}

async function screenGoodStep(rid, step) {
  renderNav('good', true);
  const g = gs();
  const a = g.answers;
  if (!state.goodGenres || !state.goodSettings || !state.goodProfiles) {
    $view.innerHTML = '<p class="loading">Loading…</p>';
    await loadGoodBasics();
    if (rid !== state.renderId) return;
  }
  const steps = goodSteps(a);
  if (!steps.includes(step)) { location.replace('#/good/step/' + (step === 'keywords' ? 'years' : 'kinds')); return; }
  const i = steps.indexOf(step);
  const last = i === steps.length - 1;
  const blocked = stepBlocked(step, a);
  const [q, sub] = STEP_TEXT[step];
  $view.innerHTML = `<div class="guide">
      <div class="guide-top"><p class="kicker">Good Stuff · step ${i + 1} of ${steps.length}</p>
        <div class="progress" aria-hidden="true"><span style="width:${((i + 1) / steps.length) * 100}%"></span></div>
        <h1>${esc(q)}</h1><p class="guide-sub">${esc(sub)}</p></div>
      <div class="guide-body">${stepBody(step, a)}</div>
      ${!last ? '<button class="link-btn skip-results" data-act="gs-results">Skip to results</button>' : ''}
    </div>
    <div class="footer-bar guide-foot">
      <button class="skip" data-act="gs-back" ${i === 0 ? 'disabled' : ''}>Back</button>
      <span class="blocked" id="gs-blocked">${esc(blocked)}</span>
      <button class="btn-primary" id="gs-next" data-act="gs-next" data-step="${step}" ${blocked ? 'disabled' : ''}>${nextLabel(step, a, last)}</button>
    </div>`;
}

// Re-draw just the parts of the current step that depend on the answers, so scrolling stays put.
function refreshStep(step) {
  const a = gs().answers;
  const steps = goodSteps(a);
  const last = steps.indexOf(step) === steps.length - 1;
  const blocked = stepBlocked(step, a);
  const next = document.getElementById('gs-next');
  if (next) { next.textContent = nextLabel(step, a, last); next.disabled = !!blocked; }
  const b = document.getElementById('gs-blocked');
  if (b) b.textContent = blocked;
  const kicker = document.querySelector('.guide .kicker');
  if (kicker) {
    const i = steps.indexOf(step);
    kicker.textContent = `Good Stuff · step ${i + 1} of ${steps.length}`;
    document.querySelector('.guide .progress span').style.width = ((i + 1) / steps.length) * 100 + '%';
  }
  saveGs();
}

// ---------- Results ----------

function goodQuery(a) {
  const qs = new URLSearchParams();
  if (a.kinds.length === 1) qs.set('kinds', a.kinds[0]);
  if (a.genres.length) qs.set('genres', a.genres.join(','));
  // Keywords only count while their genre is still picked.
  const live = new Set((state.goodGenres || []).filter((g) => a.genres.includes(g.name)).flatMap((g) => g.keywords.flatMap((k) => k.ids)));
  const kw = a.keywords.filter((id) => live.has(id));
  if (kw.length) qs.set('keywords', kw.join(','));
  if (a.leave.length) qs.set('leave', a.leave.join(','));
  const r = yearRange(a.years);
  if (r.from) qs.set('from', r.from);
  if (r.to) qs.set('to', r.to);
  if (a.services) qs.set('services', a.services.join(','));
  qs.set('min', String(a.min));
  for (const k of ['awards', 'cult', 'trending']) if (!a[k]) qs.set(k, '0');
  return qs.toString();
}

// One chip per answered step; tapping it goes back to that step.
function summaryChips(a) {
  const chips = [];
  chips.push(['kinds', a.kinds.length === 2 ? 'Movies and shows' : a.kinds[0] === 'movie' ? 'Movies' : 'Shows']);
  chips.push(['genres', a.genres.length ? a.genres.join(', ') : 'Any genre']);
  const kwLabels = (state.goodGenres || []).flatMap((g) => g.keywords).filter((k) => k.ids.every((id) => a.keywords.includes(id))).map((k) => k.label);
  if (kwLabels.length && goodSteps(a).includes('keywords')) chips.push(['keywords', [...new Set(kwLabels)].join(', ')]);
  if (a.leave.length) chips.push(['genres', 'No ' + a.leave.map((x) => x === 'kids' ? 'kids & family' : 'animation').join(' or ')]);
  chips.push(['years', yearLabel(a.years)]);
  const svc = chosenServices(a);
  chips.push(['services', svc.length === myServiceList().length ? 'All your services' : svc.map((f) => (myServiceList().find((s) => s.family === f) || { name: f }).name).join(', ')]);
  if (state.goodSettings && state.goodSettings.rentals) chips.push(['services', '+ rentals']);
  const ways = [a.awards && 'awards', a.cult && 'cult', a.trending && 'trending'].filter(Boolean);
  chips.push(['quality', `${a.min.toFixed(1)}+${ways.length ? ' or ' + ways.join(', ') : ' only'}`]);
  return chips.map(([step, label]) => `<a class="chip" href="#/good/step/${step}">${esc(label)}</a>`).join('');
}

function profileDirty(g) {
  if (!g.profile) return false;
  const p = (state.goodProfiles || []).find((x) => x.id === g.profile);
  return !!p && JSON.stringify(p.filters) !== JSON.stringify(g.answers);
}

async function screenGoodResults(rid) {
  renderNav('good', true);
  const g = gs();
  await loadGoodBasics();
  if (rid !== state.renderId) return;
  const a = g.answers;
  const prof = g.profile ? (state.goodProfiles || []).find((x) => x.id === g.profile) : null;
  const dirty = profileDirty(g);
  $view.innerHTML = `<div class="top"><h1>${prof ? esc(prof.name) : 'Good Stuff'}</h1><a class="icon-btn" href="#/search" aria-label="Search all titles">${ICONS.search}</a></div>
    <div class="chips wrap">${summaryChips(a)}</div>
    <div class="results-actions">
      <button class="btn-primary" data-act="gs-pick3">Pick 3 for me</button>
      <div class="quiet-row" style="justify-content:flex-start;flex-wrap:wrap">
        ${dirty ? `<button class="link-btn" data-act="gs-save-changes" style="color:var(--accent)">Save changes to "${esc(prof.name)}"</button><span aria-hidden="true">·</span>` : ''}
        <button class="link-btn" data-act="gs-save-as">${prof ? 'Save as new' : 'Save this search'}</button><span aria-hidden="true">·</span>
        <a class="link-btn" href="#/good/step/kinds">Edit</a><span aria-hidden="true">·</span>
        <a class="link-btn" href="#/good">Start over</a>
      </div>
    </div>
    <div id="pick3"></div>
    <div id="good-results"><p class="loading">Finding good stuff…</p></div>`;
  try {
    const d = await api('/good?' + goodQuery(a));
    if (rid !== state.renderId) return;
    state.goodItems = d.items;
    state.goodPage = d.page;
    document.getElementById('good-results').innerHTML = d.items.length
      ? `<h2 class="sec" style="font-size:16px">Results <span class="count" id="good-count">${d.items.length}</span></h2><div class="grid" id="good-grid">${d.items.map((t) => card({ ...t, sub: t.reason })).join('')}</div>
        <div class="pad" style="margin:18px 0 6px"><button class="btn-secondary" id="good-more" data-act="gs-more" ${d.hasMore ? '' : 'hidden'}>Show more</button></div>`
      : '<p class="empty" style="margin-top:12px">Nothing matches. Tap a filter above to loosen it: a lower rating, more years, or fewer sub-genres.</p>';
  } catch (e) { if (rid === state.renderId) document.getElementById('good-results').innerHTML = errorHtml(e); }
}

function renderPick3() {
  const items = [...(state.goodItems || [])];
  const box = document.getElementById('pick3');
  if (!box) return;
  if (!items.length) { box.innerHTML = '<p class="empty">Nothing to pick from with these filters.</p>'; return; }
  const picks = [];
  while (picks.length < 3 && items.length) picks.push(items.splice(Math.floor(Math.random() * items.length), 1)[0]);
  box.innerHTML = `<div class="pick3"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="margin:0;font-size:16px">Your three</h2><button class="chip" data-act="gs-pick3">Re-roll</button></div>
    <div class="grid" style="padding:0">${picks.map((t) => card({ ...t, sub: t.reason })).join('')}</div></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openProfilesSheet() {
  const list = state.goodProfiles || [];
  openSheet(`<h2>Saved searches</h2><p>Rename or delete. To change what a search finds, open it, adjust a filter, then save changes.</p>
    <div class="panel">${list.map((p) => `<div class="item"><span class="t">${esc(p.name)}</span><span style="display:flex;gap:4px"><button class="link-btn" data-act="gs-profile-rename" data-id="${p.id}" data-name="${esc(p.name)}">Rename</button><button class="link-btn" data-act="gs-profile-delete" data-id="${p.id}" data-name="${esc(p.name)}" style="color:#E5484D">Delete</button></span></div>`).join('') || '<p class="empty" style="padding:12px 0">None yet.</p>'}</div>`);
}

function openNameSheet(title, value, act, id) {
  openSheet(`<h2>${esc(title)}</h2><p>A short name, like "Date night" or "Learning".</p>
    <label class="lbl" for="gs-name">Name</label>
    <input id="gs-name" class="search" type="text" maxlength="40" value="${esc(value || '')}" placeholder="Date night">
    <div class="stack" style="margin-top:12px"><button class="btn-primary" data-act="${act}" ${id ? `data-id="${id}"` : ''}>Save</button></div>`);
  const input = document.getElementById('gs-name');
  input.focus();
  input.select();
}

// ---------- Events ----------

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act^="gs-"]');
  if (!el) return;
  const act = el.dataset.act;
  const g = gs();
  const a = g.answers;
  const step = location.hash.split('/')[3];
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const press = (on) => el.setAttribute('aria-pressed', String(on));
  try {
    if (act === 'gs-kind') { a.kinds = toggleIn(a.kinds, el.dataset.val); press(a.kinds.includes(el.dataset.val)); return refreshStep(step); }
    if (act === 'gs-genre') { a.genres = toggleIn(a.genres, el.dataset.val); press(a.genres.includes(el.dataset.val)); return refreshStep(step); }
    if (act === 'gs-leave') { a.leave = toggleIn(a.leave, el.dataset.val); press(a.leave.includes(el.dataset.val)); return refreshStep(step); }
    if (act === 'gs-keyword') {
      const ids = el.dataset.val.split(',').map(Number);
      const on = !ids.every((id) => a.keywords.includes(id));
      a.keywords = on ? [...new Set([...a.keywords, ...ids])] : a.keywords.filter((id) => !ids.includes(id));
      // The same sub-genre can sit under two genres (Heist, Spy); keep both chips in step.
      document.querySelectorAll(`[data-act="gs-keyword"][data-val="${el.dataset.val}"]`).forEach((b) => b.setAttribute('aria-pressed', String(on)));
      return refreshStep(step);
    }
    if (act === 'gs-year') {
      a.years = { preset: el.dataset.val };
      document.querySelectorAll('[data-act="gs-year"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      const span = yearSpan(a.years);
      document.getElementById('year-from').value = span.from;
      document.getElementById('year-to').value = span.to;
      document.getElementById('year-from-v').textContent = span.from;
      document.getElementById('year-to-v').textContent = span.to;
      document.getElementById('year-label').textContent = yearLabel(a.years);
      return refreshStep(step);
    }
    if (act === 'gs-service') {
      const all = myServiceList().map((s) => s.family);
      const next = toggleIn(chosenServices(a), el.dataset.val);
      a.services = next.length === all.length ? null : next;
      press(next.includes(el.dataset.val));
      return refreshStep(step);
    }
    if (act === 'gs-rentals') {
      const on = el.getAttribute('aria-checked') !== 'true';
      state.goodSettings = await api('/good/settings', { rentals: on });
      el.setAttribute('aria-checked', String(on));
      el.querySelector('.sw').setAttribute('aria-checked', String(on));
      return;
    }
    if (act === 'gs-way') {
      const k = el.dataset.val;
      a[k] = !a[k];
      el.setAttribute('aria-checked', String(a[k]));
      el.querySelector('.sw').setAttribute('aria-checked', String(a[k]));
      return refreshStep(step);
    }
    if (act === 'gs-next') {
      const steps = goodSteps(a);
      const i = steps.indexOf(el.dataset.step);
      saveGs();
      location.hash = i === steps.length - 1 ? '#/good/results' : '#/good/step/' + steps[i + 1];
      return;
    }
    if (act === 'gs-back') { const steps = goodSteps(a); const i = steps.indexOf(step); if (i > 0) location.hash = '#/good/step/' + steps[i - 1]; return; }
    if (act === 'gs-results') { saveGs(); location.hash = '#/good/results'; return; }
    if (act === 'gs-pick3') return renderPick3();
    if (act === 'gs-more') {
      // The next page reaches deeper into TMDb; titles already on screen stay put and new ones are added below.
      el.disabled = true;
      el.textContent = 'Loading more…';
      const rid = state.renderId;
      const qs = goodQuery(a) + '&page=' + ((state.goodPage || 1) + 1);
      try {
        const d = await api('/good?' + qs);
        if (rid !== state.renderId) return;
        const shown = new Set(state.goodItems.map((t) => t.kind + ':' + t.id));
        const fresh = d.items.filter((t) => !shown.has(t.kind + ':' + t.id));
        state.goodItems = state.goodItems.concat(fresh);
        state.goodPage = d.page;
        document.getElementById('good-grid').insertAdjacentHTML('beforeend', fresh.map((t) => card({ ...t, sub: t.reason })).join(''));
        document.getElementById('good-count').textContent = state.goodItems.length;
        el.hidden = !d.hasMore || !fresh.length;
        if (!fresh.length) toast("That's everything for these filters.");
      } finally {
        el.disabled = false;
        el.textContent = 'Show more';
      }
      return;
    }

    if (act === 'gs-profile') {
      const p = state.goodProfiles.find((x) => x.id === Number(el.dataset.id));
      if (!p) return;
      state.gs = { answers: { ...goodDefaults(), ...JSON.parse(JSON.stringify(p.filters)) }, profile: p.id };
      saveGs();
      location.hash = '#/good/results';
      return;
    }
    if (act === 'gs-profiles-manage') return openProfilesSheet();
    if (act === 'gs-save-as') return openNameSheet('Save this search', '', 'gs-name-save');
    if (act === 'gs-profile-rename') return openNameSheet('Rename search', el.dataset.name, 'gs-name-rename', el.dataset.id);
    if (act === 'gs-name-save' || act === 'gs-name-rename') {
      const name = document.getElementById('gs-name').value.trim();
      if (!name) return toast('Give the search a name.');
      const body = act === 'gs-name-save' ? { name, filters: a } : { id: el.dataset.id, name };
      const r = await api('/good/profiles', body);
      state.goodProfiles = r.profiles;
      if (act === 'gs-name-save') { g.profile = r.id; saveGs(); }
      toast(act === 'gs-name-save' ? `Saved "${name}"` : 'Renamed');
      return route();
    }
    if (act === 'gs-save-changes') {
      const p = state.goodProfiles.find((x) => x.id === g.profile);
      const r = await api('/good/profiles', { id: p.id, name: p.name, filters: a });
      state.goodProfiles = r.profiles;
      toast(`Saved changes to "${p.name}"`);
      return route();
    }
    if (act === 'gs-profile-delete') {
      const r = await api('/good/profiles-delete', { id: el.dataset.id });
      state.goodProfiles = r.profiles;
      if (g.profile === Number(el.dataset.id)) { g.profile = null; saveGs(); }
      toast(`Deleted "${el.dataset.name}"`);
      return route();
    }
  } catch (e) {
    toast(e.message);
  }
});

// Sliders: the year range (either handle makes it a custom range) and the minimum rating.
document.addEventListener('input', (ev) => {
  const el = ev.target;
  const which = el.dataset && el.dataset.gsRange;
  if (!which) return;
  const a = gs().answers;
  if (which === 'min') {
    a.min = Number(el.value);
    document.getElementById('min-v').textContent = a.min.toFixed(1) + '+';
    return refreshStep('quality');
  }
  let from = Number(document.getElementById('year-from').value);
  let to = Number(document.getElementById('year-to').value);
  if (from > to) { if (which === 'from') to = from; else from = to; }
  document.getElementById('year-from').value = from;
  document.getElementById('year-to').value = to;
  document.getElementById('year-from-v').textContent = from;
  document.getElementById('year-to-v').textContent = to;
  a.years = from === YEAR_MIN && to === YEAR_NOW ? { preset: 'any' } : { preset: 'custom', from, to };
  document.querySelectorAll('[data-act="gs-year"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === a.years.preset)));
  document.getElementById('year-label').textContent = yearLabel(a.years);
  refreshStep('years');
});
