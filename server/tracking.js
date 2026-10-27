// Tracking rules, follows, and the Updates feed built from them.
// Takes the shared helpers from api.js so the TMDb lookups stay in one place.
module.exports = function tracking(h) {
  const { db } = h;
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  function isFollowing(type, id) {
    const r = db.prepare('SELECT enabled FROM follow WHERE target_type = ? AND target_id = ?').get(type, Number(id));
    return !!(r && r.enabled);
  }
  function isTracked(kind, id) {
    return !!db.prepare('SELECT 1 FROM tracked_title WHERE kind = ? AND tmdb_id = ?').get(kind, Number(id));
  }

  // Everything you could track on a title. Franchise, director or creator, and the top three cast are ticked by default.
  async function options(kind, id) {
    const d = await h.details(kind, id);
    const tracked = isTracked(kind, id);
    const saved = new Map(db.prepare('SELECT * FROM track_rule WHERE kind = ? AND tmdb_id = ?').all(kind, Number(id)).map((r) => [r.target_type + ':' + r.target_id, r]));
    const items = [];
    if (d.belongs_to_collection) items.push({ type: 'collection', id: d.belongs_to_collection.id, label: d.belongs_to_collection.name, role: 'Franchise', def: true });
    let cast = 0;
    for (const p of h.creditsOf(kind, d)) {
      const isCast = p.role.split(', ').includes('Cast');
      const def = /Director|Creator/.test(p.role) || (isCast && cast < 3);
      if (isCast) cast += 1;
      items.push({ type: 'person', id: p.id, label: p.name, role: p.role, photo: p.photo, def });
    }
    const co = (d.production_companies || [])[0];
    if (co) items.push({ type: 'studio', id: co.id, label: co.name, role: 'Studio', def: false });
    for (const it of items) {
      const s = saved.get(it.type + ':' + it.id);
      it.on = tracked ? !!(s && s.enabled) : it.def;
    }
    return { tracked, items };
  }

  function save(b) {
    const kind = b.kind;
    const id = Number(b.id);
    if ((kind !== 'movie' && kind !== 'tv') || !id) throw Object.assign(new Error('Bad tracking request'), { status: 400 });
    db.prepare('DELETE FROM track_rule WHERE kind = ? AND tmdb_id = ?').run(kind, id);
    if (b.op === 'stop') {
      db.prepare('DELETE FROM tracked_title WHERE kind = ? AND tmdb_id = ?').run(kind, id);
      return { tracked: false };
    }
    db.prepare('INSERT OR IGNORE INTO tracked_title (kind, tmdb_id, name, poster, year, added_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, id, b.name || '', b.poster || null, b.year || '', Date.now());
    // Unticked items are kept too, so their switches still show on the Tracked page.
    const ins = db.prepare('INSERT INTO track_rule (kind, tmdb_id, target_type, target_id, label, role, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const it of b.items || []) ins.run(kind, id, it.type, Number(it.id), it.label || '', it.role || '', it.on ? 1 : 0);
    return { tracked: true };
  }

  function setRule(b) {
    db.prepare('UPDATE track_rule SET enabled = ? WHERE kind = ? AND tmdb_id = ? AND target_type = ? AND target_id = ?')
      .run(b.enabled ? 1 : 0, b.kind, Number(b.id), b.type, Number(b.target));
    return { ok: true };
  }

  function follow(b) {
    const type = b.type;
    if (!['person', 'collection', 'studio'].includes(type) || !Number(b.id)) throw Object.assign(new Error('Bad follow request'), { status: 400 });
    if (b.on) {
      db.prepare('INSERT INTO follow (target_type, target_id, name, image, enabled, added_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (target_type, target_id) DO UPDATE SET enabled = 1')
        .run(type, Number(b.id), b.name || '', b.image || null, Date.now());
    } else {
      db.prepare('DELETE FROM follow WHERE target_type = ? AND target_id = ?').run(type, Number(b.id));
    }
    return { following: !!b.on };
  }

  // Every released title a person, franchise or studio has, newest first.
  async function targetTitles(type, id) {
    let list;
    if (type === 'person') { const p = await h.person(id); list = [...p.movies, ...p.shows]; }
    else if (type === 'collection') list = (await h.collection(id)).items;
    else { const s = await h.studio(id); list = [...s.movies, ...s.shows]; }
    const seen = new Set();
    return list.filter((x) => { const k = x.kind + ':' + x.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // Updates: titles from the last 90 days (theaters included) that a rule or follow points to.
  async function feed() {
    const targets = new Map();
    const add = (type, id, reason) => {
      const k = type + ':' + id;
      if (!targets.has(k)) targets.set(k, { type, id, reasons: [] });
      targets.get(k).reasons.push(reason);
    };
    const rules = db.prepare('SELECT r.*, t.name AS title_name FROM track_rule r JOIN tracked_title t ON t.kind = r.kind AND t.tmdb_id = r.tmdb_id WHERE r.enabled = 1').all();
    for (const r of rules) {
      add(r.target_type, r.target_id, { text: `Because you track ${r.title_name} · ${r.label}`, label: `${r.title_name} · ${r.label}`, rule: { kind: r.kind, id: r.tmdb_id, type: r.target_type, target: r.target_id } });
    }
    for (const f of db.prepare('SELECT * FROM follow WHERE enabled = 1').all()) {
      add(f.target_type, f.target_id, { text: `Because you follow ${f.name}`, label: f.name, follow: { type: f.target_type, id: f.target_id, name: f.name } });
    }
    const skip = new Set([
      ...db.prepare('SELECT kind, tmdb_id FROM library').all(),
      ...db.prepare('SELECT kind, tmdb_id FROM tracked_title').all(),
      ...db.prepare('SELECT kind, tmdb_id FROM update_seen WHERE dismissed = 1').all()
    ].map((r) => r.kind + ':' + r.tmdb_id));
    const from = daysAgo(90);
    const to = h.today();
    const found = new Map();
    await Promise.all([...targets.values()].map(async (t) => {
      try {
        for (const x of await targetTitles(t.type, t.id)) {
          if (!x.date || x.date < from || x.date > to) continue;
          const k = x.kind + ':' + x.id;
          if (skip.has(k)) continue;
          if (!found.has(k)) found.set(k, { kind: x.kind, id: x.id, name: x.name, poster: x.poster, year: x.year, date: x.date, reasons: [] });
          const item = found.get(k);
          for (const r of t.reasons) if (!item.reasons.some((y) => y.text === r.text)) item.reasons.push(r);
        }
      } catch (e) { /* this target is skipped until its data loads */ }
    }));
    const items = await h.availabilityFor([...found.values()]);
    const seen = db.prepare('INSERT OR IGNORE INTO update_seen (kind, tmdb_id, first_seen) VALUES (?, ?, ?)');
    const groups = { yours: [], other: [], theaters: [] };
    for (const it of items) {
      seen.run(it.kind, it.id, Date.now());
      // A recent movie with no streaming, rental or purchase offer is treated as in theaters.
      const g = !it.faded ? 'yours' : (!it.anyOffer && it.kind === 'movie') ? 'theaters' : 'other';
      if (g === 'theaters') { it.badge = { label: 'In theaters' }; it.more = 0; it.faded = false; }
      groups[g].push({ ...it, reason: it.reasons[0].text, sub: (it.kind === 'tv' ? 'Series · ' : 'Movie · ') + h.shortDate(it.date) });
    }
    for (const g of Object.values(groups)) g.sort((a, b) => b.date.localeCompare(a.date));
    return {
      hasRules: targets.size > 0,
      groups: [['yours', 'On your services'], ['other', 'Other services, rent or buy'], ['theaters', 'In theaters']]
        .map(([key, label]) => ({ key, label, items: groups[key] })).filter((g) => g.items.length)
    };
  }

  function dismiss(b) {
    db.prepare('INSERT INTO update_seen (kind, tmdb_id, first_seen, dismissed) VALUES (?, ?, ?, 1) ON CONFLICT (kind, tmdb_id) DO UPDATE SET dismissed = 1')
      .run(b.kind, Number(b.id), Date.now());
    return { ok: true };
  }

  function list() {
    const titles = db.prepare('SELECT * FROM tracked_title ORDER BY added_at DESC').all().map((t) => {
      const rules = db.prepare('SELECT label, enabled FROM track_rule WHERE kind = ? AND tmdb_id = ?').all(t.kind, t.tmdb_id);
      const on = rules.filter((r) => r.enabled).map((r) => r.label);
      return { kind: t.kind, id: t.tmdb_id, name: t.name, poster: t.poster, year: t.year, line: on.length ? on.slice(0, 3).join(', ') + (on.length > 3 ? ` +${on.length - 3}` : '') : 'All rules off' };
    });
    const follows = db.prepare('SELECT * FROM follow ORDER BY added_at DESC').all()
      .map((f) => ({ type: f.target_type, id: f.target_id, name: f.name, image: f.image }));
    return { titles, follows };
  }

  // A tracked title's management page: each rule with its switch and the titles it returns, old and new.
  async function manage(kind, id) {
    const t = db.prepare('SELECT * FROM tracked_title WHERE kind = ? AND tmdb_id = ?').get(kind, Number(id));
    if (!t) throw Object.assign(new Error('Not tracked'), { status: 404 });
    const rules = db.prepare('SELECT * FROM track_rule WHERE kind = ? AND tmdb_id = ? ORDER BY enabled DESC, rowid').all(kind, Number(id));
    const out = await Promise.all(rules.map(async (r) => {
      let results = [];
      try {
        results = (await targetTitles(r.target_type, r.target_id))
          .filter((x) => !(x.kind === kind && x.id === Number(id)) && x.date && x.date <= h.today()).slice(0, 12);
      } catch (e) { /* show the rule without results */ }
      return { type: r.target_type, target: r.target_id, label: r.label, role: r.role, enabled: !!r.enabled, results };
    }));
    return { kind, id: Number(id), name: t.name, poster: t.poster, year: t.year, rules: out };
  }

  return { isFollowing, isTracked, options, save, setRule, follow, feed, dismiss, list, manage };
};
