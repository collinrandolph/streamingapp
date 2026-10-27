// Good Stuff: titles on your services that clear your minimum rating, or that get in another way
// you've switched on (awards, cult status, trending). The routes are never averaged.
// The guided flow on the phone builds the query; saved profiles store its answers.
const config = require('./config');
const { notability } = require('./wikidata');

const DEFAULTS = { minVotes: 100, minRt: 85, minMc: 75, rentals: false };
// Shown first when a title has several awards.
const MAJOR = /Academy Award|Golden Globe|Primetime Emmy|BAFTA|Palme d'Or|Golden Lion|Golden Bear|Peabody|Screen Actors Guild|Independent Spirit|Critics' Choice/i;

// Step 2b: sub-genres per genre, as TMDb keyword IDs (any of a chip's IDs counts).
// Checked against TMDb on 2026-10-27; thin keywords are paired with a related one.
const KEYWORDS = {
  Documentary: [['Nature & wildlife', [18330, 9902]], ['True crime', [33722]], ['Biography', [5565]], ['Music', [283297, 246377]], ['Sports', [159290, 333328]], ['Politics', [6078]], ['Science', [287067, 325892]]],
  Comedy: [['Romantic comedy', [9799]], ['Dark comedy', [10123]], ['Satire', [8201]], ['Mockumentary', [11800]], ['Stand-up', [9716]]],
  'Science Fiction': [['Space', [9882]], ['Time travel', [4379]], ['Dystopia', [4565]], ['AI', [310]], ['Cyberpunk', [12190]]],
  Thriller: [['Heist', [10051]], ['Spy', [470]], ['Psychological', [12565]], ['Conspiracy', [10410]]],
  Horror: [['Supernatural', [256183]], ['Slasher', [12339]], ['Folk horror', [209568]], ['Zombie', [12377]]],
  Drama: [['Based on a true story', [9672]], ['Period piece', [15060]], ['Courtroom', [33519]], ['Coming of age', [10683]]],
  Crime: [['Heist', [10051]], ['Gangster', [3149]], ['Detective', [703]], ['Serial killer', [10714]], ['Neo-noir', [207268]]],
  Romance: [['Romantic comedy', [9799]], ['Period piece', [15060]], ['LGBTQ+', [158718]], ['Coming of age', [10683]]],
  Action: [['Martial arts', [779]], ['Superhero', [9715]], ['Spy', [470]], ['Disaster', [10617]]],
  Fantasy: [['Sword and sorcery', [234213]], ['Fairy tale', [3205]], ['Magic', [2343]], ['Mythology', [2035]]],
  Animation: [['Anime', [210024]], ['Stop motion', [10121]], ['Adult animation', [161919]]],
  Mystery: [['Whodunit', [12570]], ['Murder mystery', [207046]], ['Detective', [703]]]
};

// TMDb's TV genres combine some film genres ("Sci-Fi & Fantasy"); these names map across.
const TV_ALIASES = { 'Sci-Fi': 'Science Fiction', Kids: 'Family', Politics: null, News: null, Talk: null, Soap: null, Reality: null };
const HIDDEN = ['TV Movie'];
const FAMILY = { movie: [10751], tv: [10751, 10762] };
const ANIMATION = { movie: [16], tv: [16] };

module.exports = function good(h) {
  const { db, tmdb, DAY } = h;

  function settings() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'good'").get();
    return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}), hasOmdb: !!config.load().omdbKey };
  }
  function saveSettings(b) {
    const s = settings();
    delete s.hasOmdb;
    for (const k of Object.keys(DEFAULTS)) {
      if (b[k] === undefined || b[k] === '') continue;
      s[k] = typeof DEFAULTS[k] === 'boolean' ? !!b[k] : Number(b[k]);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('good', ?)").run(JSON.stringify(s));
    return settings();
  }

  // Movie and TV genres merged by name, since the two lists use different IDs.
  async function genres() {
    const [m, t] = await Promise.all([tmdb.get('/genre/movie/list', 30 * DAY), tmdb.get('/genre/tv/list', 30 * DAY)]);
    const by = new Map();
    for (const g of m.genres || []) if (!HIDDEN.includes(g.name)) by.set(g.name, { name: g.name, movie: [g.id], tv: [] });
    for (const g of t.genres || []) {
      for (const part of g.name.split(' & ')) {
        const name = part in TV_ALIASES ? TV_ALIASES[part] : part;
        if (!name) continue;
        if (!by.has(name)) by.set(name, { name, movie: [], tv: [] });
        if (!by.get(name).tv.includes(g.id)) by.get(name).tv.push(g.id);
      }
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ ...g, keywords: (KEYWORDS[g.name] || []).map(([label, ids]) => ({ label, ids })) }));
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
      mc: o.Metascore && o.Metascore !== 'N/A' ? Number(o.Metascore) : null
    };
    db.prepare('INSERT OR REPLACE INTO cache (key, body, fetched_at) VALUES (?, ?, ?)').run(cacheKey, JSON.stringify(out), Date.now());
    return out;
  }

  // The candidate pool: titles on the chosen services (plus rentals if switched on) matching the filters.
  // depth grows with each Show more: more TMDb pages per sort, so the pool reaches further down.
  async function candidates(q, genreList, s, depth) {
    const fams = await h.providerFamilies();
    const mine = h.myFamilySet();
    const chosen = q.services && q.services.length ? new Set(q.services.filter((f) => mine.has(f))) : mine;
    const ids = fams.filter((f) => chosen.has(f.family)).flatMap((f) => f.ids).join('|');
    if (!ids) return [];
    const region = config.load().region;
    const mono = s.rentals ? 'flatrate|free|ads|rent|buy' : 'flatrate|free|ads';
    const picked = genreList.filter((g) => (q.genres || []).includes(g.name));
    const calls = [];
    for (const kind of q.kinds && q.kinds.length ? q.kinds : ['movie', 'tv']) {
      if (q.person && kind === 'tv') continue; // TV discover can't filter by person; their shows come from credits below
      const withG = [...new Set(picked.flatMap((g) => g[kind]))];
      if (picked.length && !withG.length) continue; // none of the chosen genres exist for this kind
      const leave = [...(q.leave || []).includes('kids') ? FAMILY[kind] : [], ...(q.leave || []).includes('animation') ? ANIMATION[kind] : []]
        .filter((id) => !withG.includes(id)); // a genre you picked wins over leaving it out
      const dateKey = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
      let base = `&watch_region=${region}&with_watch_providers=${ids}&with_watch_monetization_types=${mono}&include_adult=false`;
      if (withG.length) base += '&with_genres=' + withG.join('|');
      if (leave.length) base += '&without_genres=' + leave.join(',');
      if (q.keywords && q.keywords.length) base += '&with_keywords=' + q.keywords.join('|');
      if (q.from) base += `&${dateKey}.gte=${q.from}`;
      if (q.to) base += `&${dateKey}.lte=${q.to}`;
      if (q.studio) base += '&with_companies=' + Number(q.studio);
      if (q.person) base += '&with_people=' + Number(q.person);
      const narrow = q.person || q.studio || (q.keywords && q.keywords.length) || q.from;
      const floor = narrow ? 20 : 100;
      const sorts = [[`sort_by=vote_count.desc&vote_count.gte=${floor}`, 2 * depth], [`sort_by=vote_average.desc&vote_count.gte=${s.minVotes}`, depth], [`sort_by=popularity.desc&vote_count.gte=${floor}`, depth]];
      for (const [sort, n] of sorts) for (let p = 1; p <= n; p++) calls.push([kind, `/discover/${kind}?${sort}&page=${p}${base}`, p === n]);
    }
    // more: whether any sort has pages beyond the ones fetched, so Show more can reach further.
    let more = false;
    const pages = await Promise.all(calls.map(([kind, path, last]) => tmdb.get(path, DAY).then((r) => {
      if (last && (r.page || 1) < (r.total_pages || 1)) more = true;
      return (r.results || []).map((x) => ({ ...x, kind }));
    }).catch(() => [])));
    const out = new Map();
    for (const x of pages.flat()) out.set(x.kind + ':' + x.id, x);
    if (q.person && (!q.kinds || !q.kinds.length || q.kinds.includes('tv'))) {
      const tv = await tmdb.get('/person/' + Number(q.person) + '/tv_credits', DAY);
      const seen = new Set();
      const tvG = picked.flatMap((g) => g.tv);
      for (const x of [...(tv.cast || []), ...(tv.crew || [])]) {
        if (seen.has(x.id) || (x.vote_count || 0) < 20) continue;
        if (/\b(self|himself|herself|themselves)\b/i.test(x.character || '')) continue;
        if (tvG.length && !(x.genre_ids || []).some((id) => tvG.includes(id))) continue;
        if (q.from && !(x.first_air_date >= q.from)) continue;
        if (q.to && !(x.first_air_date <= q.to)) continue;
        seen.add(x.id);
        out.set('tv:' + x.id, { ...x, kind: 'tv' });
      }
    }
    return { pool: [...out.values()], more };
  }

  function awardReason(n) {
    if (!n) return null;
    const pick = (list) => list.find((l) => MAJOR.test(l)) || list[0];
    const majorWin = n.wins.find((l) => MAJOR.test(l));
    if (majorWin) return 'Won ' + majorWin;
    const majorNom = n.noms.find((l) => MAJOR.test(l));
    if (majorNom) return 'Nominated · ' + majorNom;
    if (n.wins.length >= 2) return `Won ${n.wins.length} awards incl. ${pick(n.wins)}`;
    return null;
  }

  // A rating pulled toward 6.5 until it has a few hundred votes, so 9.6 from 40 votes doesn't top the list.
  const weighted = (x) => { const v = x.vote_count || 0, m = 300; return (v * (x.vote_average || 0) + m * 6.5) / (v + m); };

  // q.min: minimum TMDb rating. q.awards / q.cult / q.trending: other ways in, each on unless set false.
  async function list(q) {
    const s = settings();
    const min = q.min != null && !Number.isNaN(Number(q.min)) ? Number(q.min) : 7.5;
    const ways = { awards: q.awards !== false, cult: q.cult !== false, trending: q.trending !== false };
    const genreList = await genres();
    const depth = Math.min(Math.max(Number(q.page) || 1, 1), 10);
    let { pool, more } = await candidates(q, genreList, s, depth);
    const onList = new Set(db.prepare('SELECT kind, tmdb_id FROM library').all().map((r) => r.kind + ':' + r.tmdb_id));
    pool = pool.filter((x) => !onList.has(x.kind + ':' + x.id));

    const needNotes = ways.awards || ways.cult;
    const [notes, trending] = await Promise.all([
      needNotes ? notability(pool.map((x) => ({ kind: x.kind, id: x.id }))) : new Map(),
      ways.trending ? tmdb.get('/trending/all/week', DAY / 2).then((r) => new Set((r.results || []).map((x) => x.media_type + ':' + x.id))).catch(() => new Set()) : new Set()
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
      const n = notes.get(k);
      const wellReviewed = ((x.vote_average || 0) >= min && (x.vote_count || 0) >= s.minVotes)
        || (r.rt != null && r.rt >= s.minRt) || (r.mc != null && r.mc >= s.minMc);
      const notable = (ways.cult && n && n.cult ? 'Cult classic' : null)
        || (ways.awards ? awardReason(n) : null)
        || (ways.trending && trending.has(k) ? 'Trending this week' : null);
      if (!wellReviewed && !notable) continue;
      const score = r.rt != null ? `${r.rt}% on RT` : r.mc != null ? `${r.mc} on Metacritic` : `${(x.vote_average || 0).toFixed(1)} on TMDb`;
      picked.push({
        kind: x.kind, id: x.id, name: x.title || x.name, poster: x.poster_path || null,
        year: (x.release_date || x.first_air_date || '').slice(0, 4),
        reason: notable ? `${notable} · ${score}` : score,
        rank: (wellReviewed && notable ? 2 : notable ? 1 : 0) + weighted(x) / 10
      });
    }
    picked.sort((a, b) => b.rank - a.rank);
    // Each page adds 60. Earlier pages' availability is already cached, so only the new titles cost a lookup.
    const limit = depth * 60;
    let items = await h.availabilityFor(picked.slice(0, limit));
    items = items.filter((x) => !x.faded || (s.rentals && x.anyOffer));
    return { items: h.withListFlags(items), rentals: s.rentals, page: depth, hasMore: picked.length > limit || more };
  }

  // Saved searches ("Date night", "Learning"): a name plus the guided flow's answers.
  function profiles() {
    return db.prepare('SELECT id, name, filters FROM good_profile ORDER BY name').all().map((p) => ({ id: p.id, name: p.name, filters: JSON.parse(p.filters) }));
  }
  function saveProfile(b) {
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) throw Object.assign(new Error('Give the search a name.'), { status: 400 });
    if (b.id) {
      const sets = ['name = ?'];
      const args = [name];
      if (b.filters) { sets.push('filters = ?'); args.push(JSON.stringify(b.filters)); }
      db.prepare(`UPDATE good_profile SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(b.id));
      return { id: Number(b.id), profiles: profiles() };
    }
    const r = db.prepare('INSERT INTO good_profile (name, filters, created_at) VALUES (?, ?, ?)').run(name, JSON.stringify(b.filters || {}), Date.now());
    return { id: Number(r.lastInsertRowid), profiles: profiles() };
  }
  function deleteProfile(b) {
    db.prepare('DELETE FROM good_profile WHERE id = ?').run(Number(b.id));
    return { profiles: profiles() };
  }

  return { list, settings, saveSettings, find, genres, profiles, saveProfile, deleteProfile };
};
