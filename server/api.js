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

async function details(kind, id, ttl = DAY / 2) {
  if (kind === 'movie') return tmdb.get('/movie/' + id + '?append_to_response=credits,watch/providers,release_dates', ttl);
  return tmdb.get('/tv/' + id + '?append_to_response=aggregate_credits,watch/providers,external_ids', ttl);
}

// How often a title is re-checked depends on its state: shows you're watching twice a day,
// Caught up, Not started and Paused weekly, Finished monthly (to catch revivals).
function refreshFor(r) {
  if (r.status === 'none' || r.status === 'paused') return 7 * DAY;
  if (r.status === 'finished') return 30 * DAY;
  return { caught: 7 * DAY, done: 30 * DAY }[r.pstate] || DAY / 2;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
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
// A saved place past the end of a season moves to the next season once TMDb lists it.
function normalizePos(seasons, s, e) {
  const se = seasons.find((x) => x.n === s);
  if (se && e > se.count) {
    const later = seasons.find((x) => x.n > s);
    if (later) return { s: later.n, e: 1 };
  }
  return { s, e };
}

// Where a started show stands, worked out from TMDb data. You set your place; the app works out the state.
//   watching: aired episodes left to watch                          → Watching
//   waiting:  none left, but the next episode has an air date       → Watching
//   caught:   none left and nothing scheduled (a season may be
//             announced without dates)                              → Caught up
//   done:     none left and the show has ended or been canceled     → Finished (set automatically)
function progressOf(d, s, e) {
  const seasons = seasonsOf(d);
  const unwatched = unwatchedFrom(seasons, s, e);
  if (unwatched > 0) return { state: 'watching', label: 'Watching', unwatched, line: `Next up · S${s}E${e} · ${unwatched} unwatched` };
  const na = d.next_episode_to_air;
  if (na && na.air_date) {
    const premiere = na.episode_number === 1;
    return {
      state: 'waiting', label: 'Watching', date: na.air_date, premiere, season: na.season_number,
      line: premiere ? `Season ${na.season_number} premieres ${shortDate(na.air_date)}` : `S${na.season_number}E${na.episode_number} airs ${shortDate(na.air_date)}`
    };
  }
  const ended = d.status === 'Ended' || d.status === 'Canceled';
  if (!ended) {
    // Announced but not scheduled still counts as Caught up; the line says what's coming.
    const newSeason = seasons.find((x) => x.aired === 0 && (x.n > s || (x.n === s && e === 1)));
    if (newSeason) return { state: 'caught', label: 'Caught up', premiere: true, season: newSeason.n, line: `Season ${newSeason.n} announced, no date yet` };
    const more = seasons.find((x) => x.aired > 0 && x.count > x.aired);
    if (more) return { state: 'caught', label: 'Caught up', line: `More of Season ${more.n} announced, no date yet` };
    return { state: 'caught', label: 'Caught up', line: 'No new episodes announced' };
  }
  return { state: 'done', label: 'Finished', line: 'The show has ended' };
}
// Saves where a show stands, and closes out (or reopens) shows the app finished by itself.
function reconcile(r, p) {
  setPstate(r, p);
  if (r.status === 'active' && p.state === 'done') r.status = 'finished';
  else if (r.status === 'finished' && r.pstate === 'done' && p.state !== 'done') r.status = 'active'; // the show came back
  else return;
  db.prepare('UPDATE library SET status = ? WHERE kind = ? AND tmdb_id = ?').run(r.status, r.kind, r.tmdb_id);
}
function setPstate(r, p) {
  if (r.pstate !== p.state) db.prepare('UPDATE library SET pstate = ? WHERE kind = ? AND tmdb_id = ?').run(p.state, r.kind, r.tmdb_id);
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
    out.push({
      title: r.title,
      shows: withListFlags((tv.results || []).map((x) => summarize(x, 'tv'))),
      movies: withListFlags((m.results || []).map((x) => summarize(x, 'movie')))
    });
  }
  return { service: { family: svc.family, name: svc.name, logo: svc.logo }, rows: out };
}

async function availabilityFor(items) {
  const mine = myFamilySet();
  return Promise.all(items.map(async (t) => {
    try {
      const wp = await tmdb.get('/' + t.kind + '/' + t.id + '/watch/providers', DAY / 2);
      const a = availability(wp, mine);
      return { ...t, badge: a.badges[0], more: a.badges.length - 1, faded: a.tier !== 'yours', yours: a.yours.map((y) => y.family), anyOffer: a.hasStream || a.rent.length > 0 || a.buy.length > 0 };
    } catch (e) {
      return { ...t, badge: null, more: 0, faded: false, yours: [], anyOffer: false };
    }
  }));
}

// Titles, plus (outside a service page) the things you can follow: people, collections and studios.
// People come back in the same /search/multi call; collections and studios cost one call each.
async function search(q, fam) {
  if (!q || !q.trim()) return { results: [], people: [], collections: [], studios: [] };
  const query = encodeURIComponent(q.trim());
  const [r, cols, cos] = await Promise.all([
    tmdb.get('/search/multi?include_adult=false&query=' + query, 3600),
    fam ? null : tmdb.get('/search/collection?query=' + query, 3600).catch(() => null),
    fam ? null : tmdb.get('/search/company?query=' + query, 3600).catch(() => null)
  ]);
  const all = r.results || [];
  let items = all.filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 15).map((x) => summarize(x));
  items = await availabilityFor(items);
  if (fam) {
    items = items.filter((t) => t.yours.includes(fam) || (t.badge && family(t.badge.label || '') === fam));
    return { results: withListFlags(items), people: [], collections: [], studios: [] };
  }
  const people = all.filter((x) => x.media_type === 'person' && (x.popularity || 0) >= 1).slice(0, 8)
    .map((x) => ({ id: x.id, name: x.name, photo: x.profile_path || null, known: x.known_for_department || '' }));
  const collections = ((cols && cols.results) || []).filter((x) => x.poster_path && x.name.length > 2).slice(0, 6).map((x) => ({ id: x.id, name: x.name, poster: x.poster_path || null }));
  // Company search returns many tiny namesakes; ones with a logo are usually the real studio.
  const studios = ((cos && cos.results) || []).sort((a, b) => (!!b.logo_path - !!a.logo_path)).slice(0, 5)
    .map((x) => ({ id: x.id, name: x.name, logo: x.logo_path || null, country: x.origin_country || '' }));
  // Put people first when TMDb ranks a person as the best match ("Zendaya", "Greta Gerwig").
  const personFirst = all[0] && all[0].media_type === 'person';
  return { results: withListFlags(items), people, collections, studios, personFirst };
}

// The best YouTube trailer TMDb lists: official English trailers first, then any trailer, then a teaser.
function trailerOf(videos) {
  const yt = ((videos && videos.results) || []).filter((v) => v.site === 'YouTube' && v.key);
  const score = (v) => (v.type === 'Trailer' ? 4 : v.type === 'Teaser' ? 1 : 0) + (v.official ? 2 : 0) + (v.iso_639_1 === 'en' ? 1 : 0);
  const best = yt.filter((v) => v.type === 'Trailer' || v.type === 'Teaser')
    .sort((a, b) => score(b) - score(a) || (b.published_at || '').localeCompare(a.published_at || ''))[0];
  return best ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(best.key) : null;
}

async function title(kind, id) {
  if (kind !== 'movie' && kind !== 'tv') throw Object.assign(new Error('Unknown kind'), { status: 400 });
  const [d, videos] = await Promise.all([details(kind, id), tmdb.get('/' + kind + '/' + id + '/videos', 7 * DAY).catch(() => null)]);
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
    entry,
    tracked: tracking.isTracked(kind, id),
    trailer: trailerOf(videos)
  };
  if (isTv) {
    const seasons = seasonsOf(d);
    const { s, e } = normalizePos(seasons, entry ? entry.next_s : 1, entry ? entry.next_e : 1);
    out.seasons = seasons;
    out.ended = d.status === 'Ended' || d.status === 'Canceled';
    out.next = { s, e, aired: isAired(seasons, s, e), unwatched: unwatchedFrom(seasons, s, e) };
    out.progress = progressOf(d, s, e);
    if (entry && entry.status === 'active') setPstate(entry, out.progress);
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

async function library(body) {
  const kind = body.kind;
  const id = Number(body.id);
  if ((kind !== 'movie' && kind !== 'tv') || !id) throw Object.assign(new Error('Bad library request'), { status: 400 });
  const cur = libEntry(kind, id);
  if (body.op === 'remove') {
    db.prepare('DELETE FROM library WHERE kind = ? AND tmdb_id = ?').run(kind, id);
    return { entry: null };
  }
  const prev = cur ? { status: cur.status, s: cur.next_s, e: cur.next_e } : null;
  if (!cur) {
    db.prepare('INSERT INTO library (kind, tmdb_id, name, poster, year, added_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, id, body.name || '', body.poster || null, body.year || '', Date.now());
  }
  const set = (status, s, e) => {
    db.prepare('UPDATE library SET status = ? WHERE kind = ? AND tmdb_id = ?').run(status, kind, id);
    if (s && e) db.prepare('UPDATE library SET next_s = ?, next_e = ? WHERE kind = ? AND tmdb_id = ?').run(Number(s), Number(e), kind, id);
  };
  // The few things you set by hand. Everything else about a show's state comes from its episodes.
  const op = body.op;
  if (op === 'start') set('active', 1, 1);
  else if (op === 'pause') set('paused');
  else if (op === 'resume') set(kind === 'tv' ? 'active' : 'none');
  else if (op === 'rewatch') { if (kind === 'tv') set('active', 1, 1); else set('none'); }
  else if (op === 'watched') set('finished');
  else if (body.status) set(body.status, body.s, body.e); // restoring a previous state (Undo)
  else if (body.s && body.e) set('active', body.s, body.e); // un-marking episodes back to this one

  const startsShow = op === 'start' || op === 'resume' || op === 'rewatch' || body.through || body.s || body.status === 'active';
  if (kind !== 'tv' || !startsShow) return { entry: libEntry(kind, id), prev };

  const d = await details('tv', id);
  const seasons = seasonsOf(d);
  // Watched through an episode (or every aired one): Next up becomes the episode after it.
  if (body.through) {
    let th = body.through;
    if (th === 'all') {
      const last = d.last_episode_to_air;
      if (!last) throw Object.assign(new Error('No episodes have aired yet.'), { status: 400 });
      th = { s: last.season_number, e: last.episode_number };
    }
    const pos = nextPos(seasons, Number(th.s), Number(th.e));
    set('active', pos.s, pos.e);
  }
  const r = libEntry(kind, id);
  const pos = normalizePos(seasons, r.next_s, r.next_e);
  const p = progressOf(d, pos.s, pos.e);
  reconcile(r, p);
  return { entry: libEntry(kind, id), progress: p, autoFinished: r.status === 'finished', prev };
}

async function myList() {
  const rows = db.prepare('SELECT * FROM library ORDER BY added_at DESC').all();
  const progress = new Map();
  await Promise.all(rows.filter((r) => r.kind === 'tv' && r.status === 'active').map(async (r) => {
    try {
      const d = await details('tv', r.tmdb_id, refreshFor(r));
      const pos = normalizePos(seasonsOf(d), r.next_s, r.next_e);
      const p = progressOf(d, pos.s, pos.e);
      reconcile(r, p);
      progress.set(r.tmdb_id, p);
    } catch (e) { /* no line this time */ }
  }));
  // My List groups: Watching, Caught up, Not started, Paused, Finished. Started shows split by where you are in them.
  // Not started titles added in the last 3 days sit in their own group at the top.
  const recentSince = Date.now() - 3 * 864e5;
  const groupOf = (r) => {
    if (r.status === 'none' && r.added_at >= recentSince) return 'recent';
    if (r.status !== 'active') return r.status;
    const p = progress.get(r.tmdb_id);
    return p && p.state === 'caught' ? 'caught' : 'watching';
  };
  const lineOf = (r) => {
    if (r.kind !== 'tv') return null;
    if (r.status === 'paused') return `Paused at S${r.next_s}E${r.next_e}`;
    const p = progress.get(r.tmdb_id);
    return r.status === 'active' && p ? p.line : null;
  };
  const items = await availabilityFor(rows.map((r) => ({
    kind: r.kind, id: r.tmdb_id, name: r.name, year: r.year, poster: r.poster, status: r.status,
    group: groupOf(r), pstate: progress.has(r.tmdb_id) ? progress.get(r.tmdb_id).state : r.pstate, tracked: !!r.tracked, progress: lineOf(r), place: r.kind === 'tv' && r.status !== 'none' ? `S${r.next_s}E${r.next_e}` : null
  })));
  const groups = [['recent', 'Recently added'], ['watching', 'Watching'], ['none', 'Not started'], ['caught', 'Caught up'], ['paused', 'Paused'], ['finished', 'Finished']].map(([k, label]) => ({
    key: k, label, items: items.filter((i) => i.group === k)
  })).filter((g) => g.items.length);
  return { groups };
}

async function watching() {
  const mine = myFamilySet();
  // Started shows, unwatched movies, and Finished shows the app closed out itself (checked monthly, in case they come back).
  // Not started shows and Paused titles stay off this tab.
  const rows = db.prepare("SELECT * FROM library WHERE status = 'active' OR (kind = 'movie' AND status = 'none') OR (kind = 'tv' AND status = 'finished' AND pstate = 'done') ORDER BY added_at DESC").all();
  const shows = [];
  const coming = [];
  const movies = [];
  const updates = [];
  const t = today();
  const in10 = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await Promise.all(rows.map(async (r) => {
    try {
      const d = await details(r.kind, r.tmdb_id, refreshFor(r));
      const a = availability(d['watch/providers'], mine);
      const base = { kind: r.kind, id: r.tmdb_id, name: r.name, poster: r.poster, year: r.year, badge: a.badges[0], faded: a.tier !== 'yours' };
      if (r.kind === 'tv' && (r.status === 'active' || r.status === 'finished')) {
        const pos = normalizePos(seasonsOf(d), r.next_s, r.next_e);
        const p = progressOf(d, pos.s, pos.e);
        reconcile(r, p);
        if (r.status === 'finished') return;
        if (p.state === 'watching') shows.push({ ...base, next: 'S' + pos.s + 'E' + pos.e, unwatched: p.unwatched, added: r.added_at });
        const na = d.next_episode_to_air;
        if (na && na.air_date && na.air_date >= t && na.air_date <= in10) {
          coming.push({ ...base, line: 'S' + na.season_number + 'E' + na.episode_number + ' · ' + shortDate(na.air_date), date: na.air_date });
        } else if (p.premiere) {
          // A new season you're waiting on: announced, or premiering more than 10 days out.
          updates.push({ ...base, line: p.line, date: p.date || '9999' });
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
  updates.sort((x, y) => x.date.localeCompare(y.date));
  return { shows, movies, coming, updates };
}

// Top-line jobs shown on person pages; everything else (Thanks, Producer, crew roles) is left out.
const CREDIT_JOBS = {
  Director: 'Director', Screenplay: 'Writer', Writer: 'Writer', Creator: 'Creator',
  'Original Music Composer': 'Composer', 'Director of Photography': 'Cinematographer'
};

// withAvail adds service badges (one watch/providers lookup per title), for the page itself;
// the Updates feed leaves it off and checks availability only for the titles it keeps.
async function person(id, withAvail = false) {
  const p = await tmdb.get('/person/' + id + '?append_to_response=combined_credits', DAY);
  const all = [...((p.combined_credits && p.combined_credits.cast) || []), ...((p.combined_credits && p.combined_credits.crew) || [])];
  const seen = new Map();
  // New releases haven't collected votes yet, so recent titles need fewer to count.
  const recent = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  for (const c of all) {
    if (c.media_type !== 'movie' && c.media_type !== 'tv') continue;
    const date = c.release_date || c.first_air_date || '';
    if (!date) continue;
    if ((c.vote_count || 0) < (date >= recent ? 2 : 20)) continue;
    if (!c.job && /\b(self|himself|herself|themselves)\b/i.test(c.character || '')) continue;
    if (c.job && !CREDIT_JOBS[c.job]) continue;
    const key = c.media_type + ':' + c.id;
    const role = c.job ? CREDIT_JOBS[c.job] : 'Cast';
    if (seen.has(key)) { const s = seen.get(key); if (!s.roles.includes(role)) s.roles.push(role); continue; }
    seen.set(key, { ...summarize(c, c.media_type), roles: [role], date: c.release_date || c.first_air_date || '' });
  }
  let items = [...seen.values()].sort((a, b) => b.date.localeCompare(a.date)).map((x) => ({ ...x, sub: x.roles.slice(0, 2).join(', ') + (x.year ? ' · ' + x.year : '') }));
  if (withAvail) items = yoursFirst(await availabilityFor(items));
  return {
    id: Number(id), name: p.name, photo: p.profile_path, known: p.known_for_department,
    following: tracking.isFollowing('person', id),
    movies: withListFlags(items.filter((x) => x.kind === 'movie')),
    shows: withListFlags(items.filter((x) => x.kind === 'tv'))
  };
}

// Titles on your services first, everything else after; each part keeps its order.
function yoursFirst(items) {
  return [...items.filter((x) => !x.faded), ...items.filter((x) => x.faded)];
}

async function collection(id, withAvail = false) {
  const c = await tmdb.get('/collection/' + id, DAY);
  const t = today();
  // Unreleased entries stay hidden until they come out.
  const parts = (c.parts || []).filter((p) => p.release_date && p.release_date <= t).sort((a, b) => a.release_date.localeCompare(b.release_date));
  let items = parts.map((p) => ({ ...summarize(p, 'movie'), sub: yearOf(p.release_date), date: p.release_date }));
  if (withAvail) items = yoursFirst(await availabilityFor(items));
  return {
    id: Number(id), name: c.name, overview: c.overview, poster: c.poster_path || null,
    following: tracking.isFollowing('collection', id),
    items: withListFlags(items)
  };
}

async function studio(id, withAvail = false) {
  const t = today();
  // Established titles need 20 votes; the last 120 days only need a couple, so new releases show up.
  const recent = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const [co, m, tv, mNew, tvNew] = await Promise.all([
    tmdb.get('/company/' + id, 7 * DAY),
    tmdb.get('/discover/movie?with_companies=' + id + '&sort_by=primary_release_date.desc&primary_release_date.lte=' + t + '&vote_count.gte=20', DAY),
    tmdb.get('/discover/tv?with_companies=' + id + '&sort_by=first_air_date.desc&first_air_date.lte=' + t + '&vote_count.gte=20', DAY),
    tmdb.get('/discover/movie?with_companies=' + id + '&sort_by=popularity.desc&primary_release_date.gte=' + recent + '&primary_release_date.lte=' + t + '&vote_count.gte=2', DAY),
    tmdb.get('/discover/tv?with_companies=' + id + '&sort_by=popularity.desc&first_air_date.gte=' + recent + '&first_air_date.lte=' + t + '&vote_count.gte=2', DAY)
  ]);
  const merge = (a, b) => { const ids = new Set(); return [...a, ...b].filter((x) => !ids.has(x.id) && ids.add(x.id)); };
  const byDate = (key) => (a, b) => (b[key] || '').localeCompare(a[key] || '');
  let movies = merge(mNew.results || [], m.results || []).sort(byDate('release_date')).map((x) => ({ ...summarize(x, 'movie'), sub: yearOf(x.release_date), date: x.release_date }));
  let shows = merge(tvNew.results || [], tv.results || []).sort(byDate('first_air_date')).map((x) => ({ ...summarize(x, 'tv'), sub: yearOf(x.first_air_date), date: x.first_air_date }));
  if (withAvail) [movies, shows] = await Promise.all([availabilityFor(movies).then(yoursFirst), availabilityFor(shows).then(yoursFirst)]);
  return {
    id: Number(id), name: co.name, logo: co.logo_path || null,
    following: tracking.isFollowing('studio', id),
    movies: withListFlags(movies),
    shows: withListFlags(shows)
  };
}

// Shared helpers for the tracking and Good Stuff modules.
const helpers = { db, tmdb, DAY, today, shortDate, summarize, withListFlags, availabilityFor, myFamilySet, providerFamilies, details, creditsOf, person, collection, studio, yearOf };
const tracking = require('./tracking')(helpers);
const good = require('./good')(helpers);
const roku = require('./roku');

// ---------- Backup ----------
// Your data, not the API cache: for backups, and for moving it between the PC and the phone.
// Roku settings and calibration stay with the PC, which is the one that talks to the TV.
const BACKUP_TABLES = ['services', 'library', 'tracked_title', 'track_rule', 'follow', 'update_seen', 'good_profile'];
const BACKUP_SETTINGS = ['good'];

function exportData() {
  const out = { app: 'streaming-tracker', version: 1, exportedAt: Date.now(), tables: {} };
  for (const t of BACKUP_TABLES) out.tables[t] = db.prepare('SELECT * FROM ' + t).all().map((row) => ({ ...row }));
  out.settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${BACKUP_SETTINGS.map(() => '?').join(', ')})`).all(...BACKUP_SETTINGS).map((row) => ({ ...row }));
  return out;
}

// Replaces your data with a backup's.
function importData(b) {
  if (!b || b.app !== 'streaming-tracker' || !b.tables) throw Object.assign(new Error("That isn't a Streaming Tracker backup."), { status: 400 });
  db.exec('BEGIN');
  try {
    for (const t of BACKUP_TABLES) {
      const rows = b.tables[t];
      if (!Array.isArray(rows)) continue;
      db.exec('DELETE FROM ' + t);
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
        db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
      }
    }
    for (const st of b.settings || []) {
      if (BACKUP_SETTINGS.includes(st.key)) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(st.key, st.value);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { imported: Object.fromEntries(BACKUP_TABLES.map((t) => [t, (b.tables[t] || []).length])) };
}

// ---------- Router ----------

async function handle(method, path, query, body) {
  const parts = path.split('/').filter(Boolean).slice(1);
  const [a, b, c, d] = parts;
  if (method === 'GET' && a === 'status') return status();
  if (method === 'GET' && a === 'export') return exportData();
  if (method === 'POST' && a === 'import') return importData(body);
  if (method === 'GET' && a === 'providers') return providers();
  if (method === 'POST' && a === 'services') return saveServices(body || {});
  if (method === 'GET' && a === 'service' && b) return servicePage(decodeURIComponent(b));
  if (method === 'GET' && a === 'search') return search(query.get('q'), query.get('service'));
  if (method === 'GET' && a === 'title' && b && c && d === 'season') return season(c, parts[4]);
  if (method === 'GET' && a === 'title' && b && c) return title(b, c);
  if (method === 'POST' && a === 'library') return library(body || {});
  if (method === 'GET' && a === 'mylist') return myList();
  if (method === 'GET' && a === 'watching') return watching();
  if (method === 'GET' && a === 'person' && b) return person(b, true);
  if (method === 'GET' && a === 'collection' && b) return collection(b, true);
  if (method === 'GET' && a === 'studio' && b) return studio(b, true);
  if (method === 'GET' && a === 'track' && b && c) return tracking.options(b, c);
  if (method === 'POST' && a === 'track') return tracking.save(body || {});
  if (method === 'POST' && a === 'rule') return tracking.setRule(body || {});
  if (method === 'POST' && a === 'follow') return tracking.follow(body || {});
  if (method === 'GET' && a === 'updates') return tracking.feed();
  if (method === 'POST' && a === 'updates' && b === 'dismiss') return tracking.dismiss(body || {});
  if (method === 'GET' && a === 'tracked' && b && c) return tracking.manage(b, c);
  if (method === 'GET' && a === 'tracked') return tracking.list();
  if (method === 'GET' && a === 'good' && b === 'settings') return good.settings();
  if (method === 'POST' && a === 'good' && b === 'settings') return good.saveSettings(body || {});
  if (method === 'GET' && a === 'good' && b === 'genres') return good.genres();
  if (method === 'GET' && a === 'good' && b === 'profiles') return good.profiles();
  if (method === 'POST' && a === 'good' && b === 'profiles') return good.saveProfile(body || {});
  if (method === 'POST' && a === 'good' && b === 'profiles-delete') return good.deleteProfile(body || {});
  if (method === 'GET' && a === 'good') {
    return good.list({
      kinds: (query.get('kinds') || '').split(',').filter(Boolean), genres: (query.get('genres') || '').split(',').filter(Boolean), keywords: (query.get('keywords') || '').split(',').filter(Boolean).map(Number), leave: (query.get('leave') || '').split(',').filter(Boolean),
      services: (query.get('services') || '').split(',').filter(Boolean), from: query.get('from'), to: query.get('to'), min: query.get('min'), page: query.get('page'),
      awards: query.get('awards') !== '0', cult: query.get('cult') !== '0', trending: query.get('trending') !== '0',
      person: query.get('person'), studio: query.get('studio')
    });
  }
  if (method === 'GET' && a === 'find' && (b === 'person' || b === 'company')) return good.find(b, query.get('q'));
  if (a === 'roku') {
    if (method === 'GET' && !b) return roku.status();
    if (method === 'POST' && b === 'setup') return roku.setup(body || {});
    if (method === 'POST' && b === 'find') return roku.find();
    if (method === 'POST' && b === 'key') return roku.key(body || {});
    if (method === 'POST' && b === 'text') return roku.text(body || {});
    if (method === 'POST' && b === 'calibration') return roku.saveCalibration(body || {});
    if (method === 'POST' && b === 'calibration-clear') return roku.clearCalibration();
    if (method === 'POST' && b === 'open-search') return roku.openBySearch(body || {});
    if (method === 'POST' && b === 'log-clear') return roku.clearLog();
  }
  throw Object.assign(new Error('Not found'), { status: 404 });
}

module.exports = { handle, family, nextPos, unwatchedFrom, isAired, seasonsOf, availability };
