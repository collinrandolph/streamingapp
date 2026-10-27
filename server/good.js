// Good Stuff: titles on your services that are well reviewed (by your thresholds) or notable
// (an award win or nomination, the cult-film tag, or trending this week). The two routes are never averaged.
const config = require('./config');
const { notability } = require('./wikidata');

const DEFAULTS = { minTmdb: 7.5, minVotes: 300, minRt: 85, minMc: 75 };
// Shown first when a title has several awards.
const MAJOR = /Academy Award|Golden Globe|Primetime Emmy|BAFTA|Palme d'Or|Golden Lion|Golden Bear|Peabody|Screen Actors Guild|Independent Spirit|Critics' Choice/i;

module.exports = function good(h) {
  const { db, tmdb, DAY } = h;

  function settings() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'good'").get();
    return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}), hasOmdb: !!config.load().omdbKey };
  }
  function saveSettings(b) {
    const s = {};
    for (const k of Object.keys(DEFAULTS)) if (b[k] !== undefined && b[k] !== '' && !Number.isNaN(Number(b[k]))) s[k] = Number(b[k]);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('good', ?)").run(JSON.stringify({ ...settings(), ...s, hasOmdb: undefined }));
    return settings();
  }

  // Movie and TV genres merged by name, since the two lists use different IDs.
  async function genres() {
    const [m, t] = await Promise.all([tmdb.get('/genre/movie/list', 30 * DAY), tmdb.get('/genre/tv/list', 30 * DAY)]);
    const by = new Map();
    for (const g of m.genres || []) by.set(g.name, { name: g.name, movie: g.id, tv: null });
    for (const g of t.genres || []) {
      // TMDb's TV list combines some genres ("Action & Adventure"); match them to the film genres they cover.
      const names = g.name.split(' & ');
      let matched = false;
      for (const n of names) if (by.has(n)) { by.get(n).tv = g.id; matched = true; }
      if (!matched) by.set(g.name, { name: g.name, movie: null, tv: g.id });
    }
    return [...by.values()].filter((g) => !['TV Movie', 'News', 'Talk', 'Soap', 'Reality'].includes(g.name)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function find(type, q) {
    if (!q || !q.trim()) return { results: [] };
    const r = await tmdb.get('/search/' + type + '?query=' + encodeURIComponent(q.trim()), DAY);
    return {
      results: (r.results || []).slice(0, 8).map((x) => type === 'person'
        ? { id: x.id, name: x.name, image: x.profile_path, sub: x.known_for_department || '' }
        : { id: x.id, name: x.name, image: x.logo_path, sub: x.origin_country || '' })
    };
  }

  // OMDb ratings (IMDb, Rotten Tomatoes, Metacritic), only when you've added an OMDb key. Cached 30 days.
  async function omdbRatings(kind, id) {
    const key = config.load().omdbKey;
    if (!key) return null;
    const ext = await tmdb.get('/' + kind + '/' + id + '/external_ids', 30 * DAY);
    if (!ext.imdb_id) return null;
    const cacheKey = 'omdb:' + ext.imdb_id;
    const c = db.prepare('SELECT body, fetched_at FROM cache WHERE key = ?').get(cacheKey);
    if (c && Date.now() - c.fetched_at < 30 * DAY * 1000) return JSON.parse(c.body);
    const res = await fetch('https://www.omdbapi.com/?apikey=' + encodeURIComponent(key) + '&i=' + ext.imdb_id);
    if (!res.ok) return null;
    const o = await res.json();
    if (o.Response === 'False') return null;
    const rt = (o.Ratings || []).find((r) => r.Source === 'Rotten Tomatoes');
    const out = {
      imdb: o.imdbRating && o.imdbRating !== 'N/A' ? Number(o.imdbRating) : null,
      rt: rt ? parseInt(rt.Value, 10) : null,
      mc: o.Metascore && o.Metascore !== 'N/A' ? Number(o.Metascore) : null,
      awards: o.Awards && o.Awards !== 'N/A' ? o.Awards : null
    };
    db.prepare('INSERT OR REPLACE INTO cache (key, body, fetched_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify(out), Date.now());
    return out;
  }

  function decadeRange(decade) {
    if (!decade) return null;
    if (decade === 'older') return { from: '1900-01-01', to: '1969-12-31' };
    const y = Number(decade);
    return { from: y + '-01-01', to: (y + 9) + '-12-31' };
  }

  // The candidate pool: titles on your services (plus rentals if switched on) matching the filters.
  async function candidates(q, genreList) {
    const fams = await h.providerFamilies();
    const mine = h.myFamilySet();
    const ids = fams.filter((f) => mine.has(f.family)).flatMap((f) => f.ids).join('|');
    if (!ids) return [];
    const region = config.load().region;
    const mono = q.rentals ? 'flatrate|free|ads|rent|buy' : 'flatrate|free|ads';
    const g = q.genre ? genreList.find((x) => x.name === q.genre) : null;
    const range = decadeRange(q.decade);
    const kinds = (q.person ? ['movie'] : ['movie', 'tv']).filter((k) => !g || g[k]);
    const calls = [];
    for (const kind of kinds) {
      const dateKey = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
      let base = `&watch_region=${region}&with_watch_providers=${ids}&with_watch_monetization_types=${mono}&include_adult=false`;
      if (g) base += '&with_genres=' + g[kind];
      if (range) base += `&${dateKey}.gte=${range.from}&${dateKey}.lte=${range.to}`;
      if (q.studio) base += '&with_companies=' + Number(q.studio);
      if (q.person) base += '&with_people=' + Number(q.person);
      const floor = q.person || q.studio ? 20 : 100;
      calls.push([kind, `/discover/${kind}?sort_by=vote_count.desc&vote_count.gte=${floor}${base}`]);
      calls.push([kind, `/discover/${kind}?sort_by=vote_count.desc&vote_count.gte=${floor}&page=2${base}`]);
      calls.push([kind, `/discover/${kind}?sort_by=vote_average.desc&vote_count.gte=300${base}`]);
      calls.push([kind, `/discover/${kind}?sort_by=popularity.desc&vote_count.gte=${floor}${base}`]);
    }
    const pages = await Promise.all(calls.map(([kind, path]) => tmdb.get(path, DAY).then((r) => (r.results || []).map((x) => ({ ...x, kind }))).catch(() => [])));
    const out = new Map();
    for (const x of pages.flat()) out.set(x.kind + ':' + x.id, x);
    // TV discover can't filter by person, so a person filter adds their shows from their credits.
    if (q.person) {
      const tv = await tmdb.get('/person/' + Number(q.person) + '/tv_credits', DAY);
      const seen = new Set();
      for (const x of [...(tv.cast || []), ...(tv.crew || [])]) {
        if (seen.has(x.id) || (x.vote_count || 0) < 20) continue;
        if (/\b(self|himself|herself|themselves)\b/i.test(x.character || '')) continue;
        if (g && !(x.genre_ids || []).includes(g.tv)) continue;
        if (range && !(x.first_air_date >= range.from && x.first_air_date <= range.to)) continue;
        seen.add(x.id);
        out.set('tv:' + x.id, { ...x, kind: 'tv', fromCredits: true });
      }
    }
    return [...out.values()];
  }

  function awardReason(n) {
    if (!n) return null;
    if (n.cult) return 'Cult classic';
    const pick = (list) => list.find((l) => MAJOR.test(l)) || list[0];
    const majorWin = n.wins.find((l) => MAJOR.test(l));
    if (majorWin) return 'Won ' + majorWin;
    const majorNom = n.noms.find((l) => MAJOR.test(l));
    if (majorNom) return 'Nominated · ' + majorNom;
    if (n.wins.length >= 2) return `Won ${n.wins.length} awards incl. ${pick(n.wins)}`;
    return null;
  }

  async function list(q) {
    const s = settings();
    const genreList = await genres();
    let pool = await candidates(q, genreList);
    const onList = new Set(db.prepare('SELECT kind, tmdb_id FROM library').all().map((r) => r.kind + ':' + r.tmdb_id));
    pool = pool.filter((x) => !onList.has(x.kind + ':' + x.id));

    const [notes, trending] = await Promise.all([
      notability(pool.map((x) => ({ kind: x.kind, id: x.id }))),
      tmdb.get('/trending/all/week', DAY / 2).then((r) => new Set((r.results || []).map((x) => x.media_type + ':' + x.id))).catch(() => new Set())
    ]);
    const ratings = new Map();
    if (s.hasOmdb) {
      await Promise.all(pool.map(async (x) => {
        try { ratings.set(x.kind + ':' + x.id, await omdbRatings(x.kind, x.id)); } catch (e) { /* no OMDb data */ }
      }));
    }

    const picked = [];
    for (const x of pool) {
      const k = x.kind + ':' + x.id;
      const r = ratings.get(k) || {};
      const tmdbOk = (x.vote_average || 0) >= s.minTmdb && (x.vote_count || 0) >= s.minVotes;
      const wellReviewed = tmdbOk || (r.rt != null && r.rt >= s.minRt) || (r.mc != null && r.mc >= s.minMc);
      const notable = awardReason(notes.get(k)) || (trending.has(k) ? 'Trending this week' : null);
      if (!wellReviewed && !notable) continue;
      const score = r.rt != null ? `${r.rt}% on RT` : r.mc != null ? `${r.mc} on Metacritic` : `${(x.vote_average || 0).toFixed(1)} on TMDb`;
      picked.push({
        kind: x.kind, id: x.id, name: x.title || x.name, poster: x.poster_path || null,
        year: (x.release_date || x.first_air_date || '').slice(0, 4),
        reason: notable ? `${notable} · ${score}` : score,
        rank: (wellReviewed && notable ? 2 : notable ? 1 : 0) + (x.vote_average || 0) / 10
      });
    }
    picked.sort((a, b) => b.rank - a.rank);
    let items = await h.availabilityFor(picked.slice(0, 60));
    // A person filter adds shows from their credits, which still need to be on your services (or rentable).
    items = items.filter((x) => !x.faded || (q.rentals && x.anyOffer));
    return { items: h.withListFlags(items), settings: s, genres: genreList };
  }

  return { list, settings, saveSettings, find, genres };
};
