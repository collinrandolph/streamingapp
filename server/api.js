// JSON API for the phone web app.
const db = require('./db');
const tmdb = require('./tmdb');
const config = require('./config');

const DAY = 86400;
const REGION = () => config.load().region;

// ---------- Services ----------

// TMDb lists ad tiers and add-on channels as separate providers
// ("Netflix Standard with Ads", "HBO Max Amazon Channel"). Group them into one family.
const SUFFIXES = [
  /\s+(standard|basic)?\s*with ads$/i,
  /\s+(amazon|apple tv|roku premium|youtube tv)\s+channel$/i,
  /\s+premium(\s+plus)?$/i,
  /\s+essential$/i
];
function stripSuffixes(name) {
  let n = name.trim();
  for (const re of SUFFIXES) n = n.replace(re, '');
  return n.trim();
}
function family(name) {
  return stripSuffixes(name.replace(/\+/g, ' plus ')).toLowerCase().replace(/\s+/g, ' ').trim();
}

const GIANTS = ['netflix', 'amazon prime video', 'disney plus', 'hbo max', 'max', 'hulu', 'apple tv plus', 'apple tv', 'peacock', 'paramount plus'];
const NICE_NAMES = { 'disney plus': 'Disney+', 'paramount plus': 'Paramount+', 'apple tv plus': 'Apple TV', 'apple tv': 'Apple TV', peacock: 'Peacock', 'hbo max': 'HBO Max', 'amazon prime video': 'Prime Video', 'mgm plus': 'MGM+', 'amc plus': 'AMC+' };
// Stores and aggregators: rent/buy storefronts or JustWatch's own entries, not subscriptions.
const NOT_SERVICES = /\bstore\b|^amazon video$|google play|fandango|vudu|microsoft|justwatch|^youtube$|spectrum on demand|directv|redbox|verizon/i;
function displayName(f, rawName) {
  return NICE_NAMES[f] || stripSuffixes(rawName);
}

async function providerFamilies() {
  const region = REGION();
  const [m, t] = await Promise.all([
    tmdb.get('/watch/providers/movie?watch_region=' + region, 7 * DAY),
    tmdb.get('/watch/providers/tv?watch_region=' + region, 7 * DAY)
  ]);
  const byFamily = new Map();
  for (const p of [...(m.results || []), ...(t.results || [])]) {
    const f = family(p.provider_name);
    const prio = (p.display_priorities && p.display_priorities[region]) ?? p.display_priority ?? 999;
    const cur = byFamily.get(f);
    if (!cur) {
      byFamily.set(f, { family: f, id: p.provider_id, name: p.provider_name, logo: p.logo_path, priority: prio, ids: [p.provider_id] });
    } else {
      if (!cur.ids.includes(p.provider_id)) cur.ids.push(p.provider_id);
      // Prefer the plain-named provider as the family's face.
      if (p.provider_name.length < cur.name.length) { cur.id = p.provider_id; cur.name = p.provider_name; cur.logo = p.logo_path; }
      cur.priority = Math.min(cur.priority, prio);
    }
  }
  const list = [...byFamily.values()].filter((f) => !NOT_SERVICES.test(f.name));
  for (const f of list) {
    f.name = displayName(f.family, f.name);
    const gi = GIANTS.indexOf(f.family);
    f.giant = gi >= 0;
    f.giantOrder = gi;
  }
  list.sort((a, b) => (b.giant - a.giant) || (a.giant ? a.giantOrder - b.giantOrder : a.priority - b.priority));
  return list;
}

function myServices() {
  return db.prepare('SELECT family, provider_id AS id, name, logo FROM services ORDER BY rowid').all();
}
function myFamilySet() {
  return new Set(myServices().map((s) => s.family));
}

// ---------- Availability ----------

function availability(watchProviders, mine) {
  const us = (watchProviders && watchProviders.results && watchProviders.results[REGION()]) || {};
  const seen = new Set();
  const stream = [];
  for (const p of [...(us.flatrate || []), ...(us.free || []), ...(us.ads || [])]) {
    const f = family(p.provider_name);
    if (seen.has(f)) continue;
    seen.add(f);
    stream.push({ family: f, name: displayName(f, p.provider_name), logo: p.logo_path, free: !!(us.free || []).concat(us.ads || []).find((x) => x.provider_id === p.provider_id) });
  }
  const yours = stream.filter((s) => mine.has(s.family));
  const others = stream.filter((s) => !mine.has(s.family));
  const rent = (us.rent || []).map((p) => p.provider_name);
  const buy = (us.buy || []).map((p) => p.provider_name);
  const tier = yours.length ? 'yours' : 'other';
  const badges = [];
  for (const s of yours) badges.push({ label: s.name, logo: s.logo, mine: true });
  for (const s of others) badges.push({ label: s.name, logo: s.logo, mine: false });
  if (!yours.length && (rent.length || buy.length)) badges.push({ label: rent.length && buy.length ? 'Rent or buy' : rent.length ? 'Rent' : 'Buy' });
  if (!badges.length) badges.push({ label: 'Not streaming' });
  return { tier, yours, others, rent, buy, badges, link: us.link || null, hasStream: stream.length > 0 };
}

// ---------- Helpers ----------

const yearOf = (d) => (d ? d.slice(0, 4) : '');
const today = () => new Date().toISOString().slice(0, 10);

function summarize(item, kind) {
  const k = kind || item.media_type;
  return {
    kind: k,
    id: item.id,
    name: item.title || item.name,
    year: yearOf(item.release_date || item.first_air_date),
    poster: item.poster_path || null
  };
}

function libEntry(kind, id) {
  return db.prepare('SELECT * FROM library WHERE kind = ? AND tmdb_id = ?').get(kind, Number(id)) || null;
}
function withListFlags(items) {
  const rows = db.prepare('SELECT kind, tmdb_id FROM library').all();
  const on = new Set(rows.map((r) => r.kind + ':' + r.tmdb_id));
  return items.map((t) => ({ ...t, onList: on.has(t.kind + ':' + t.id) }));
}

async function details(kind, id) {
  if (kind === 'movie') return tmdb.get('/movie/' + id + '?append_to_response=credits,watch/providers,release_dates', DAY / 2);
  return tmdb.get('/tv/' + id + '?append_to_response=aggregate_credits,watch/providers,external_ids', DAY / 2);
}

// Seasons with their aired-episode counts, from the show's details (season 0 = specials, skipped).
function seasonsOf(tv) {
  const last = tv.last_episode_to_air;
  return (tv.seasons || []).filter((s) => s.season_number > 0).map((s) => {
    let aired = 0;
    if (last) {
      if (s.season_number < last.season_number) aired = s.episode_count;
      else if (s.season_number === last.season_number) aired = last.episode_number;
    }
    return { n: s.season_number, count: s.episode_count, aired };
  });
}
function isAired(seasons, s, e) {
  const se = seasons.find((x) => x.n === s);
  return !!se && e <= se.aired;
}
function unwatchedFrom(seasons, s, e) {
  let n = 0;
  for (const se of seasons) {
    if (se.n < s) continue;
    const start = se.n === s ? e : 1;
    n += Math.max(0, se.aired - start + 1);
  }
  return n;
}
function nextPos(seasons, s, e) {
  const se = seasons.find((x) => x.n === s);
  if (se && e < se.count) return { s, e: e + 1 };
  const later = seasons.find((x) => x.n > s);
  return later ? { s: later.n, e: 1 } : { s, e: e + 1 };
}

function theatrical(movie) {
  const r = (movie.release_dates && movie.release_dates.results || []).find((x) => x.iso_3166_1 === REGION());
  if (!r) return null;
  const dates = r.release_dates || [];
  const theater = dates.filter((d) => d.type === 3).map((d) => d.release_date.slice(0, 10)).sort()[0];
  const digital = dates.filter((d) => d.type === 4).map((d) => d.release_date.slice(0, 10)).sort()[0];
  return { theater, digital };
}

function creditsOf(kind, d) {
  const out = [];
  // One entry per person; extra jobs join the role line ("Director, Writer").
  const push = (p, role) => {
    const cur = out.find((x) => x.id === p.id);
    if (!cur) out.push({ id: p.id, name: p.name, role, photo: p.profile_path || null });
    else if (!cur.role.split(', ').includes(role)) cur.role += ', ' + role;
  };
  if (kind === 'movie') {
    const crew = (d.credits && d.credits.crew) || [];
    crew.filter((c) => c.job === 'Director').forEach((c) => push(c, 'Director'));
    crew.filter((c) => c.job === 'Screenplay' || c.job === 'Writer').slice(0, 2).forEach((c) => push(c, 'Writer'));
    ((d.credits && d.credits.cast) || []).slice(0, 8).forEach((c) => push(c, 'Cast'));
    crew.filter((c) => c.job === 'Original Music Composer').slice(0, 1).forEach((c) => push(c, 'Composer'));
    crew.filter((c) => c.job === 'Director of Photography').slice(0, 1).forEach((c) => push(c, 'Cinematographer'));
  } else {
    (d.created_by || []).forEach((c) => push(c, 'Creator'));
    ((d.aggregate_credits && d.aggregate_credits.cast) || []).slice(0, 8).forEach((c) => push(c, 'Cast'));
    const crew = (d.aggregate_credits && d.aggregate_credits.crew) || [];
    crew.filter((c) => (c.jobs || []).some((j) => j.job === 'Original Music Composer')).slice(0, 1).forEach((c) => push(c, 'Composer'));
  }
  return out;
}

// ---------- Handlers ----------

async function status() {
  return { hasKey: tmdb.hasKey(), services: myServices(), region: REGION() };
}

async function providers() {
  const mine = myFamilySet();
  const list = await providerFamilies();
  return list.map((p) => ({ family: p.family, id: p.id, name: p.name, logo: p.logo, giant: p.giant, selected: mine.has(p.family) }));
}

async function saveServices(body) {
  const list = await providerFamilies();
  const wanted = new Set(body.families || []);
  db.exec('DELETE FROM services');
  const ins = db.prepare('INSERT INTO services (family, provider_id, name, logo) VALUES (?, ?, ?, ?)');
  for (const p of list) if (wanted.has(p.family)) ins.run(p.family, p.id, p.name, p.logo);
  return { services: myServices() };
}

function providerIdsFor(fam, list) {
  const f = list.find((p) => p.family === fam);
  return f ? f.ids : [];
}

async function servicePage(fam) {
  const list = await providerFamilies();
  const svc = list.find((p) => p.family === fam);
  if (!svc) throw Object.assign(new Error('Unknown service'), { status: 404 });
  const ids = providerIdsFor(fam, list).join('|');
  const region = REGION();
  const base = '&watch_region=' + region + '&with_watch_providers=' + ids + '&with_watch_monetization_types=flatrate|free|ads&include_adult=false';
  const t = today();
  const rows = [
    { title: 'Newest', movie: 'sort_by=primary_release_date.desc&primary_release_date.lte=' + t + '&vote_count.gte=20', tv: 'sort_by=first_air_date.desc&first_air_date.lte=' + t + '&vote_count.gte=20' },
    { title: 'Popular now', movie: 'sort_by=popularity.desc', tv: 'sort_by=popularity.desc' },
    { title: 'Popular all-time', movie: 'sort_by=vote_count.desc', tv: 'sort_by=vote_count.desc' }
  ];
  const out = [];
  for (const r of rows) {
    const [m, tv] = await Promise.all([
      tmdb.get('/discover/movie?' + r.movie + base, DAY / 2),
      tmdb.get('/discover/tv?' + r.tv + base, DAY / 2)
    ]);
    const mi = (m.results || []).map((x) => summarize(x, 'movie'));
    const ti = (tv.results || []).map((x) => summarize(x, 'tv'));
    const merged = [];
    for (let i = 0; i < 20; i++) { if (ti[i]) merged.push(ti[i]); if (mi[i]) merged.push(mi[i]); }
    out.push({ title: r.title, items: withListFlags(merged.slice(0, 24)) });
  }
  return { service: { family: svc.family, name: svc.name, logo: svc.logo }, rows: out };
}

async function availabilityFor(items) {
  const mine = myFamilySet();
  return Promise.all(items.map(async (t) => {
    try {
      const wp = await tmdb.get('/' + t.kind + '/' + t.id + '/watch/providers', DAY / 2);
      const a = availability(wp, mine);
      return { ...t, badge: a.badges[0], more: a.badges.length - 1, faded: a.tier !== 'yours', yours: a.yours.map((y) => y.family) };
    } catch (e) {
      return { ...t, badge: null, more: 0, faded: false, yours: [] };
    }
  }));
}

async function search(q, fam) {
  if (!q || !q.trim()) return { results: [] };
  const r = await tmdb.get('/search/multi?include_adult=false&query=' + encodeURIComponent(q.trim()), 3600);
  let items = (r.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 15).map((x) => summarize(x));
  items = await availabilityFor(items);
  if (fam) items = items.filter((t) => t.yours.includes(fam) || (t.badge && family(t.badge.label || '') === fam));
  return { results: withListFlags(items) };
}

async function title(kind, id) {
  if (kind !== 'movie' && kind !== 'tv') throw Object.assign(new Error('Unknown kind'), { status: 400 });
  const d = await details(kind, id);
  const mine = myFamilySet();
  const a = availability(d['watch/providers'], mine);
  const entry = libEntry(kind, id);
  const isTv = kind === 'tv';
  const name = d.title || d.name;
  const year = yearOf(d.release_date || d.first_air_date);
  const genres = (d.genres || []).map((g) => g.name);
  let detailsLine;
  if (isTv) {
    const n = (d.seasons || []).filter((s) => s.season_number > 0).length;
    detailsLine = ['Series', year, n + (n === 1 ? ' season' : ' seasons'), genres[0]].filter(Boolean).join(' · ');
  } else {
    const rt = d.runtime ? Math.floor(d.runtime / 60) + 'h ' + (d.runtime % 60) + 'm' : '';
    detailsLine = ['Movie', year, rt, genres[0]].filter(Boolean).join(' · ');
  }

  let theaters = false;
  if (!isTv && !a.hasStream) {
    const th = theatrical(d);
    if (th && th.theater) {
      const days = (Date.now() - Date.parse(th.theater)) / 864e5;
      theaters = days >= 0 && days < 90 && !(a.rent.length || a.buy.length);
    }
  }
  if (theaters) a.badges = [{ label: 'In theaters' }];

  const where = [];
  for (const s of a.yours) where.push({ kind: s.free ? 'Free' : 'Stream', sub: 'One of your services', label: s.name, logo: s.logo, mine: true });
  for (const s of a.others) where.push({ kind: s.free ? 'Free' : 'Stream', sub: 'Not one of your services', label: s.name, logo: s.logo, mine: false });
  if (a.tier !== 'yours') {
    if (a.rent.length) where.push({ kind: 'Rent', sub: a.rent.slice(0, 4).join(', '), label: 'Rent' });
    if (a.buy.length) where.push({ kind: 'Buy', sub: a.buy.slice(0, 4).join(', '), label: 'Buy' });
  }
  if (theaters) where.push({ kind: 'In theaters', sub: 'Showtimes near you', label: 'Theaters' });

  const out = {
    kind, id: Number(id), name, year, poster: d.poster_path, backdrop: d.backdrop_path,
    details: detailsLine, overview: d.overview || '',
    rating: d.vote_average ? d.vote_average.toFixed(1) : null, votes: d.vote_count || 0,
    collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null,
    studio: (d.production_companies && d.production_companies[0]) ? { id: d.production_companies[0].id, name: d.production_companies[0].name } : null,
    network: isTv && d.networks && d.networks[0] ? d.networks[0].name : null,
    credits: creditsOf(kind, d),
    tier: theaters ? 'theaters' : a.tier,
    badges: a.badges,
    where,
    justwatch: a.link,
    showWill: !theaters && !a.hasStream && (a.rent.length > 0 || a.buy.length > 0),
    willSearch: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + year + ' streaming release date'),
    entry
  };
  if (isTv) {
    const seasons = seasonsOf(d);
    const s = entry ? entry.next_s : 1;
    const e = entry ? entry.next_e : 1;
    out.seasons = seasons;
    out.ended = d.status === 'Ended' || d.status === 'Canceled';
    out.next = { s, e, aired: isAired(seasons, s, e), unwatched: unwatchedFrom(seasons, s, e) };
    out.nextAir = d.next_episode_to_air ? { s: d.next_episode_to_air.season_number, e: d.next_episode_to_air.episode_number, date: d.next_episode_to_air.air_date } : null;
  }
  return out;
}

async function season(id, n) {
  const s = await tmdb.get('/tv/' + id + '/season/' + n, DAY);
  const t = today();
  return {
    n: Number(n),
    episodes: (s.episodes || []).map((e) => ({ e: e.episode_number, name: e.name, date: e.air_date, aired: !!e.air_date && e.air_date <= t, runtime: e.runtime || null }))
  };
}

function library(body) {
  const kind = body.kind;
  const id = Number(body.id);
  if ((kind !== 'movie' && kind !== 'tv') || !id) throw Object.assign(new Error('Bad library request'), { status: 400 });
  const cur = libEntry(kind, id);
  if (body.op === 'remove') {
    db.prepare('DELETE FROM library WHERE kind = ? AND tmdb_id = ?').run(kind, id);
    return { entry: null };
  }
  if (!cur) {
    db.prepare('INSERT INTO library (kind, tmdb_id, name, poster, year, added_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, id, body.name || '', body.poster || null, body.year || '', Date.now());
  }
  if (body.status) db.prepare('UPDATE library SET status = ? WHERE kind = ? AND tmdb_id = ?').run(body.status, kind, id);
  if (body.s && body.e) db.prepare('UPDATE library SET next_s = ?, next_e = ? WHERE kind = ? AND tmdb_id = ?').run(Number(body.s), Number(body.e), kind, id);
  return { entry: libEntry(kind, id) };
}

async function myList() {
  const rows = db.prepare('SELECT * FROM library ORDER BY added_at DESC').all();
  const items = await availabilityFor(rows.map((r) => ({ kind: r.kind, id: r.tmdb_id, name: r.name, year: r.year, poster: r.poster, status: r.status, tracked: !!r.tracked })));
  const groups = [['active', 'Active'], ['none', 'No status'], ['finished', 'Finished']].map(([k, label]) => ({
    key: k, label, items: items.filter((i) => i.status === k)
  })).filter((g) => g.items.length);
  return { groups };
}

async function watching() {
  const mine = myFamilySet();
  const rows = db.prepare("SELECT * FROM library WHERE status != 'finished' ORDER BY added_at DESC").all();
  const shows = [];
  const coming = [];
  const movies = [];
  const t = today();
  const in10 = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await Promise.all(rows.map(async (r) => {
    try {
      const d = await details(r.kind, r.tmdb_id);
      const a = availability(d['watch/providers'], mine);
      const base = { kind: r.kind, id: r.tmdb_id, name: r.name, poster: r.poster, year: r.year, badge: a.badges[0], faded: a.tier !== 'yours' };
      if (r.kind === 'tv' && r.status === 'active') {
        const seasons = seasonsOf(d);
        const n = unwatchedFrom(seasons, r.next_s, r.next_e);
        if (n > 0) shows.push({ ...base, next: 'S' + r.next_s + 'E' + r.next_e, unwatched: n, added: r.added_at });
        const na = d.next_episode_to_air;
        if (na && na.air_date && na.air_date >= t && na.air_date <= in10) {
          coming.push({ ...base, line: 'S' + na.season_number + 'E' + na.episode_number + ' · ' + na.air_date, date: na.air_date });
        }
      } else if (r.kind === 'movie' && a.tier === 'yours') {
        movies.push({ ...base, added: r.added_at });
      }
    } catch (e) {
      // Skip titles whose details can't be fetched right now.
    }
  }));
  shows.sort((x, y) => y.added - x.added);
  movies.sort((x, y) => y.added - x.added);
  coming.sort((x, y) => x.date.localeCompare(y.date));
  return { shows, movies, coming };
}

// Top-line jobs shown on person pages; everything else (Thanks, Producer, crew roles) is left out.
const CREDIT_JOBS = {
  Director: 'Director', Screenplay: 'Writer', Writer: 'Writer', Creator: 'Creator',
  'Original Music Composer': 'Composer', 'Director of Photography': 'Cinematographer'
};

async function person(id) {
  const p = await tmdb.get('/person/' + id + '?append_to_response=combined_credits', DAY);
  const all = [...((p.combined_credits && p.combined_credits.cast) || []), ...((p.combined_credits && p.combined_credits.crew) || [])];
  const seen = new Map();
  for (const c of all) {
    if (c.media_type !== 'movie' && c.media_type !== 'tv') continue;
    if ((c.vote_count || 0) < 20) continue;
    if (!c.job && /\b(self|himself|herself|themselves)\b/i.test(c.character || '')) continue;
    if (c.job && !CREDIT_JOBS[c.job]) continue;
    const key = c.media_type + ':' + c.id;
    const role = c.job ? CREDIT_JOBS[c.job] : 'Cast';
    if (seen.has(key)) { const s = seen.get(key); if (!s.roles.includes(role)) s.roles.push(role); continue; }
    seen.set(key, { ...summarize(c, c.media_type), roles: [role], date: c.release_date || c.first_air_date || '' });
  }
  const items = [...seen.values()].sort((a, b) => b.date.localeCompare(a.date)).map((x) => ({ ...x, sub: x.roles.slice(0, 2).join(', ') + (x.year ? ' · ' + x.year : '') }));
  return {
    name: p.name, photo: p.profile_path, known: p.known_for_department,
    movies: withListFlags(items.filter((x) => x.kind === 'movie')),
    shows: withListFlags(items.filter((x) => x.kind === 'tv'))
  };
}

async function collection(id) {
  const c = await tmdb.get('/collection/' + id, DAY);
  const t = today();
  // Unreleased entries stay hidden until they come out.
  const parts = (c.parts || []).filter((p) => p.release_date && p.release_date <= t).sort((a, b) => a.release_date.localeCompare(b.release_date));
  return { name: c.name, overview: c.overview, items: withListFlags(parts.map((p) => ({ ...summarize(p, 'movie'), sub: yearOf(p.release_date) }))) };
}

async function studio(id) {
  const t = today();
  const [co, m, tv] = await Promise.all([
    tmdb.get('/company/' + id, 7 * DAY),
    tmdb.get('/discover/movie?with_companies=' + id + '&sort_by=primary_release_date.desc&primary_release_date.lte=' + t + '&vote_count.gte=20', DAY),
    tmdb.get('/discover/tv?with_companies=' + id + '&sort_by=first_air_date.desc&first_air_date.lte=' + t + '&vote_count.gte=20', DAY)
  ]);
  return {
    name: co.name,
    movies: withListFlags((m.results || []).map((x) => ({ ...summarize(x, 'movie'), sub: yearOf(x.release_date) }))),
    shows: withListFlags((tv.results || []).map((x) => ({ ...summarize(x, 'tv'), sub: yearOf(x.first_air_date) })))
  };
}

// ---------- Router ----------

async function handle(method, path, query, body) {
  const parts = path.split('/').filter(Boolean).slice(1);
  const [a, b, c, d] = parts;
  if (method === 'GET' && a === 'status') return status();
  if (method === 'GET' && a === 'providers') return providers();
  if (method === 'POST' && a === 'services') return saveServices(body || {});
  if (method === 'GET' && a === 'service' && b) return servicePage(decodeURIComponent(b));
  if (method === 'GET' && a === 'search') return search(query.get('q'), query.get('service'));
  if (method === 'GET' && a === 'title' && b && c && d === 'season') return season(c, parts[4]);
  if (method === 'GET' && a === 'title' && b && c) return title(b, c);
  if (method === 'POST' && a === 'library') return library(body || {});
  if (method === 'GET' && a === 'mylist') return myList();
  if (method === 'GET' && a === 'watching') return watching();
  if (method === 'GET' && a === 'person' && b) return person(b);
  if (method === 'GET' && a === 'collection' && b) return collection(b);
  if (method === 'GET' && a === 'studio' && b) return studio(b);
  throw Object.assign(new Error('Not found'), { status: 404 });
}

module.exports = { handle, family, nextPos, unwatchedFrom, isAired, seasonsOf, availability };
