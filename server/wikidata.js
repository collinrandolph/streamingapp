// Wikidata notability: awards won, nominations and the cult-film genre, matched by TMDb ID
// (P4947 for films, P4983 for TV, since the two TMDb ID ranges overlap). Cached a week per title.
const db = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'StreamingTracker/0.1 (personal, non-commercial; https://github.com/collinrandolph/streamingapp)';
const TTL = 7 * 86400 * 1000;
const BATCH = 80;
const CULT_FILM = 'Q1342372';

const readCache = db.prepare('SELECT body, fetched_at FROM cache WHERE key = ?');
const writeCache = db.prepare('INSERT OR REPLACE INTO cache (key, body, fetched_at) VALUES (?, ?, ?)');

function query(movieIds, tvIds) {
  const branch = (ids, prop, kind) => `{ VALUES ?tmdb { ${ids.map((i) => `"${i}"`).join(' ')} } ?item wdt:${prop} ?tmdb . BIND("${kind}" AS ?kind) }`;
  const sources = [movieIds.length && branch(movieIds, 'P4947', 'movie'), tvIds.length && branch(tvIds, 'P4983', 'tv')].filter(Boolean).join(' UNION ');
  return `SELECT ?tmdb ?kind ?type ?label WHERE {
    hint:Query hint:optimizer "None" .
    ${sources}
    { ?item wdt:P166 ?a . BIND("win" AS ?type) } UNION { ?item wdt:P1411 ?a . BIND("nom" AS ?type) }
    UNION { ?item wdt:P136 ?a . FILTER(?a = wd:${CULT_FILM}) BIND("cult" AS ?type) }
    ?a rdfs:label ?label . FILTER(LANG(?label) = "en")
  }`;
}

async function fetchBatch(batch) {
  const movieIds = batch.filter((x) => x.kind === 'movie').map((x) => x.id);
  const tvIds = batch.filter((x) => x.kind === 'tv').map((x) => x.id);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': UA },
    body: 'query=' + encodeURIComponent(query(movieIds, tvIds)),
    signal: AbortSignal.timeout(10000) // a slow Wikidata only costs the award reasons, never the results
  });
  if (!res.ok) throw new Error('Wikidata ' + res.status);
  const rows = (await res.json()).results.bindings;
  const out = new Map(batch.map((x) => [x.kind + ':' + x.id, { wins: [], noms: [], cult: false }]));
  for (const b of rows) {
    const n = out.get(b.kind.value + ':' + b.tmdb.value);
    if (!n) continue;
    if (b.type.value === 'cult') n.cult = true;
    else n[b.type.value === 'win' ? 'wins' : 'noms'].push(b.label.value);
  }
  return out;
}

// items: [{ kind, id }] → Map of "kind:id" → { wins: [labels], noms: [labels], cult }
async function notability(items) {
  const result = new Map();
  const missing = [];
  for (const x of items) {
    const c = readCache.get('wd:' + x.kind + ':' + x.id);
    if (c && Date.now() - c.fetched_at < TTL) result.set(x.kind + ':' + x.id, JSON.parse(c.body));
    else missing.push(x);
  }
  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
  // Batches run side by side, so a slow Wikidata adds at most one timeout, not one per batch.
  await Promise.all(batches.map(async (batch) => {
    try {
      const got = await fetchBatch(batch);
      for (const [k, v] of got) { result.set(k, v); writeCache.run('wd:' + k, JSON.stringify(v), Date.now()); }
    } catch (e) {
      // Wikidata is slow or busy: these titles just go without notability this time.
    }
  }));
  return result;
}

module.exports = { notability };
