'use strict';
// Phone remote for the Roku, and the calibration wizard that records the path to Roku search.
// Every press goes through rokuPress: sent to the TV (or logged in a dry run) and, while calibrating, recorded.
// Uses the shared helpers in app.js (api, esc, renderNav, openSheet, toast, state…), loaded after this file.

const CAL_WORD = 'DUNE';
const CAL_STEPS = [
  { id: 'home', title: 'Press Home', text: 'Press Home on this remote. The TV should show the Roku home screen.', keys: true },
  { id: 'topbar', title: 'Go to the top bar', text: 'Use the arrows to reach the top bar or menu of the home screen. Press against the edge as much as you like; extra presses there are harmless.', keys: true },
  { id: 'search', title: 'Go to Search and open it', text: 'Arrow to Search and press OK. Stop when the search keyboard is on screen.', keys: true },
  { id: 'type', title: `Type ${CAL_WORD}`, text: `Type ${CAL_WORD} in the box below and tap Send. The letters should appear in the TV's search box.`, typing: true },
  { id: 'result', title: 'Highlight the first result', text: 'Use the arrows to move from the keyboard to the first search result. Don\'t press OK yet.', keys: true },
  { id: 'open', title: 'Open it', text: 'Press OK. You should land on the title\'s page, with nothing playing.', keys: true },
  { id: 'test', title: 'Test run', text: 'The app now replays everything from Home with a different title. Watch the TV, then say where it landed.', test: true }
];

// ---------- Presses ----------

async function rokuPress(key) {
  const cal = state.cal;
  const step = cal && CAL_STEPS[cal.step];
  if (step && (step.keys || (step.typing && cal.typeMode === 'grid'))) {
    (cal.rec[step.id] = cal.rec[step.id] || []).push(key);
    renderCalRecord();
  }
  flashKey(key);
  const r = await api('/roku/key', { key });
  if (r.dry) refreshLog();
}

async function rokuText(t) {
  if (!t) return;
  const cal = state.cal;
  if (cal && CAL_STEPS[cal.step].id === 'type') { cal.typed = (cal.typed || '') + t; renderCalRecord(); }
  const r = await api('/roku/text', { text: t });
  if (r.dry) refreshLog();
}

function flashKey(key) {
  const el = document.querySelector(`.rk [data-key="${key}"]`);
  if (!el) return;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 160);
}

async function refreshLog() {
  const box = document.getElementById('rk-log');
  if (!box) return;
  const s = await api('/roku');
  state.roku = s;
  box.innerHTML = logHtml(s.log);
}
function logHtml(entries) {
  if (!entries.length) return '<p class="empty" style="margin:0">Presses will show here.</p>';
  return entries.slice(-24).reverse().map((e) => `<span class="rk-log-key">${esc(e.key.startsWith('Lit_') ? '“' + e.key.slice(4) + '”' : e.key)}</span>`).join('');
}

// ---------- Pieces ----------

const RK_ICON = {
  up: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3"/></svg>',
  rev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 6v12L3 12zm9 0v12l-8-6z"/></svg>',
  play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5v14l7-7zM14 5h3v14h-3zM19 5h2v14h-2z"/></svg>',
  fwd: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 6v12l8-6zm9 0v12l8-6z"/></svg>',
  replay: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18" r="2"/></svg>'
};

function remotePad() {
  const k = (key, label, content, cls = '') => `<button class="rk-btn ${cls}" data-act="rk-key" data-key="${key}" aria-label="${label}">${content}</button>`;
  return `<div class="rk">
    <div class="rk-row">${k('Back', 'Back', RK_ICON.back)}${k('Home', 'Home', RK_ICON.home)}</div>
    <div class="rk-dpad">
      ${k('Up', 'Up', RK_ICON.up, 'rk-up')}
      ${k('Left', 'Left', RK_ICON.up, 'rk-left')}
      ${k('Select', 'OK', 'OK', 'rk-ok')}
      ${k('Right', 'Right', RK_ICON.up, 'rk-right')}
      ${k('Down', 'Down', RK_ICON.up, 'rk-down')}
    </div>
    <div class="rk-row">${k('InstantReplay', 'Instant replay', RK_ICON.replay)}${k('Info', 'Options', RK_ICON.info)}</div>
    <div class="rk-row">${k('Rev', 'Rewind', RK_ICON.rev)}${k('Play', 'Play or pause', RK_ICON.play)}${k('Fwd', 'Fast forward', RK_ICON.fwd)}</div>
    <form class="rk-type" data-rk-type>
      <label class="lbl" for="rk-text">Type on the TV</label>
      <div style="display:flex;gap:8px"><input id="rk-text" class="search" type="text" autocomplete="off" autocapitalize="characters" placeholder="Works when the TV shows a keyboard"><button class="btn-secondary" style="width:auto;padding:0 18px" type="submit">Send</button></div>
      <button type="button" class="link-btn" data-act="rk-key" data-key="Backspace" style="padding-left:0">Delete a letter on the TV</button>
    </form>
  </div>`;
}

function deviceBanner(s) {
  if (s.dryRun) {
    return `<div class="rk-banner dry"><div><strong>Dry run.</strong> No Roku is set up, so presses are logged below instead of sent.</div><button class="chip" data-act="rk-setup">Set up Roku</button></div>`;
  }
  return `<div class="rk-banner"><div><strong>${esc(s.device.name)}</strong> · ${esc(s.device.model || 'Roku')} · ${esc(s.device.ip)}</div><button class="chip" data-act="rk-setup">Change</button></div>`;
}

// ---------- Remote screen ----------

async function screenRemote(rid) {
  renderNav(null, true);
  state.cal = null;
  const s = await api('/roku');
  if (rid !== state.renderId) return;
  state.roku = s;
  const c = s.calibration;
  $view.innerHTML = `<a class="back" href="javascript:history.back()">‹ Back</a>
    <div class="pad"><h1 style="margin:4px 0 10px;font-size:26px">Remote</h1>${deviceBanner(s)}</div>
    ${remotePad()}
    <h2 class="sec" style="font-size:16px">Search path</h2>
    <div class="pad"><div class="panel"><div class="item"><span class="l"><span class="t">${c ? 'Calibrated' : 'Not calibrated yet'}</span><span class="s">${c ? `Saved ${esc(new Date(c.savedAt).toLocaleDateString())} · ${c.typeMode === 'grid' ? 'types with arrows' : 'types letters directly'}${c.stale ? ' · Roku updated since, worth re-checking' : ''}` : 'Teach the app how to reach Roku search, so Play on TV can open a title\'s page.'}</span></span>
      <a class="chip" href="#/remote/calibrate">${c ? 'Recalibrate' : 'Calibrate'}</a></div>
      ${c ? '<div class="item"><span class="l"><span class="t">Try it</span><span class="s">Open a title\'s page on the TV through search</span></span><button class="chip" data-act="rk-try">Try</button></div>' : ''}</div></div>
    <h2 class="sec" style="font-size:16px">${s.dryRun ? 'Logged presses' : 'Recent presses'} <button class="link-btn" data-act="rk-log-clear" style="font-size:12px">Clear</button></h2>
    <div class="pad"><div class="rk-log" id="rk-log">${logHtml(s.log)}</div></div>`;
}

function openSetup() {
  const d = state.roku && state.roku.device;
  openSheet(`<h2>Set up your Roku</h2>
    <p>Find its address on the TV under Settings › Network › About. For remote presses, also set Settings › System › Advanced system settings › Control by mobile apps to Enabled.</p>
    <label class="lbl" for="rk-ip">IP address</label>
    <input id="rk-ip" class="search" type="text" inputmode="decimal" placeholder="192.168.0.42" value="${esc(d ? d.ip : '')}">
    <div id="rk-found" style="margin-top:10px"></div>
    <div class="stack" style="margin-top:12px">
      <button class="btn-primary" data-act="rk-save">Connect</button>
      <button class="btn-secondary" data-act="rk-find">Look for Rokus on the network</button>
      ${d ? '<button class="btn-secondary" data-act="rk-forget" style="color:#FF8A8E">Forget this Roku (back to dry run)</button>' : ''}
    </div>`);
}

// ---------- Calibration wizard ----------

async function screenCalibrate(rid) {
  renderNav(null, true);
  const s = await api('/roku');
  if (rid !== state.renderId) return;
  state.roku = s;
  if (!state.cal) state.cal = { step: 0, rec: {}, typeMode: 'text', typed: '', testTitle: 'Breaking Bad' };
  renderCalibrate();
}

function renderCalibrate() {
  const cal = state.cal;
  const step = CAL_STEPS[cal.step];
  const s = state.roku;
  const dots = CAL_STEPS.map((x, i) => `<span class="${i < cal.step ? 'done' : i === cal.step ? 'now' : ''}"></span>`).join('');
  $view.innerHTML = `<a class="back" href="#/remote">‹ Remote</a>
    <div class="pad">${deviceBanner(s)}</div>
    <div class="cal-card">
      <p class="kicker">Calibration · step ${cal.step + 1} of ${CAL_STEPS.length}</p>
      <div class="cal-dots" aria-hidden="true">${dots}</div>
      <h1>${esc(step.title)}</h1>
      <p class="guide-sub">${esc(step.text)}</p>
      ${step.typing ? typingStepHtml() : ''}
      ${step.test ? testStepHtml() : ''}
      <div id="cal-record">${calRecordHtml()}</div>
      ${step.test ? '' : `<div class="cal-actions">
        <button class="skip" data-act="cal-back" ${cal.step === 0 ? 'disabled' : ''}>Back</button>
        <button class="link-btn" data-act="cal-redo">Redo step</button>
        <button class="btn-primary" data-act="cal-done" ${calStepReady() ? '' : 'disabled'}>Done</button>
      </div>`}
    </div>
    ${step.test ? '' : remotePad()}
    ${s.dryRun ? `<h2 class="sec" style="font-size:16px">Logged presses</h2><div class="pad"><div class="rk-log" id="rk-log">${logHtml(s.log)}</div></div>` : ''}`;
}

function typingStepHtml() {
  const cal = state.cal;
  if (cal.typeMode === 'grid') {
    return `<div class="cal-note">Spell ${CAL_WORD} with the arrows and OK on the TV's keyboard below, one letter at a time: move to D, press OK, move to U, press OK, and so on. The app works out the keyboard's layout from your moves.
      <button class="link-btn" data-act="cal-typemode" data-mode="text" style="padding-left:0">Back to typing letters</button></div>`;
  }
  return `<form class="rk-type" data-rk-type style="margin-bottom:6px"><div style="display:flex;gap:8px"><input id="rk-text" class="search" type="text" autocomplete="off" autocapitalize="characters" value="${CAL_WORD}"><button class="btn-secondary" style="width:auto;padding:0 18px" type="submit">Send</button></div></form>
    <button class="link-btn" data-act="cal-typemode" data-mode="grid" style="padding-left:0">The letters didn't appear on the TV</button>`;
}

function testStepHtml() {
  const cal = state.cal;
  return `<label class="lbl" for="cal-test-title">Test title</label>
    <div style="display:flex;gap:8px;margin-bottom:12px"><input id="cal-test-title" class="search" type="text" value="${esc(cal.testTitle)}"><button class="btn-primary" style="width:auto;padding:0 18px" data-act="cal-run">Run</button></div>
    ${cal.ran ? `<div class="stack">
      <button class="btn-primary" data-act="cal-save">Landed on the right page · Save</button>
      <button class="btn-secondary" data-act="cal-wrong">Wrong place</button>
    </div>` : ''}`;
}

function calStepReady() {
  const cal = state.cal;
  const step = CAL_STEPS[cal.step];
  if (step.id === 'type') return cal.typeMode === 'grid' ? (cal.rec.type || []).filter((k) => k === 'Select').length >= CAL_WORD.length : !!cal.typed;
  if (step.id === 'home') return (cal.rec.home || []).includes('Home');
  if (step.id === 'open') return (cal.rec.open || []).includes('Select');
  if (step.id === 'search') return (cal.rec.search || []).includes('Select');
  return true;
}

function calRecordHtml() {
  const cal = state.cal;
  const step = CAL_STEPS[cal.step];
  if (step.test) {
    if (!cal.lastRun) return '';
    return `<p class="hint" style="margin:10px 0 0">${cal.lastRun.dry ? 'Dry run: ' : ''}${cal.lastRun.presses} presses${cal.lastRun.dry ? ' logged, not sent' : ' sent'}.</p>
      <div class="rk-log" style="margin-top:6px">${cal.lastRun.sequence.map((k) => `<span class="rk-log-key">${esc(k.startsWith('Lit_') ? '“' + k.slice(4) + '”' : k)}</span>`).join('')}</div>`;
  }
  if (step.id === 'type' && cal.typeMode === 'text') {
    return cal.typed ? `<p class="hint" style="margin:10px 0 0">Sent “${esc(cal.typed)}”. If it appeared on the TV, tap Done.</p>` : '';
  }
  const keys = cal.rec[step.id === 'type' ? 'type' : step.id] || [];
  return `<p class="hint" style="margin:10px 0 4px">Recorded for this step:</p>
    <div class="rk-log">${keys.length ? keys.map((k) => `<span class="rk-log-key">${esc(k)}</span>`).join('') + '<button class="link-btn" data-act="cal-undo" style="font-size:12px">Undo last</button>' : '<span class="hint" style="margin:0">Nothing yet.</span>'}</div>`;
}
function renderCalRecord() {
  const box = document.getElementById('cal-record');
  if (box) box.innerHTML = calRecordHtml();
  const done = document.querySelector('[data-act="cal-done"]');
  if (done) done.disabled = !calStepReady();
}

// What the server needs: the keys per step, and how typing works.
function calRecording() {
  const r = state.cal.rec;
  const type = { mode: state.cal.typeMode, word: CAL_WORD };
  if (state.cal.typeMode === 'grid') {
    // Split the spelling moves at each OK: one segment of arrows per letter.
    const segments = [[]];
    for (const k of r.type || []) { if (k === 'Select') segments.push([]); else segments[segments.length - 1].push(k); }
    type.segments = segments.slice(0, CAL_WORD.length);
  }
  return { topbar: r.topbar || [], search: r.search || [], result: r.result || [], open: r.open || [], type };
}

// ---------- Events ----------

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act^="rk-"], [data-act^="cal-"]');
  if (!el) return;
  const act = el.dataset.act;
  const cal = state.cal;
  try {
    if (act === 'rk-key') return await rokuPress(el.dataset.key);
    if (act === 'rk-setup') return openSetup();
    if (act === 'rk-save') {
      const s = await api('/roku/setup', { ip: document.getElementById('rk-ip').value });
      state.roku = s;
      toast(`Connected to ${s.device.name}`);
      return route();
    }
    if (act === 'rk-forget') { await api('/roku/setup', { op: 'clear' }); toast('Back to dry run'); return route(); }
    if (act === 'rk-find') {
      const box = document.getElementById('rk-found');
      box.innerHTML = '<p class="loading" style="margin:0">Looking for about 4 seconds…</p>';
      const r = await api('/roku/find', {});
      box.innerHTML = r.found.length
        ? `<div class="panel">${r.found.map((d) => `<button class="item" data-act="rk-pick" data-ip="${esc(d.ip)}"><span class="l"><span class="t">${esc(d.name)}</span><span class="s">${esc(d.ip)}${d.model ? ' · ' + esc(d.model) : ''}</span></span></button>`).join('')}</div>`
        : '<p class="hint" style="margin:0">No Roku answered. Your network may block discovery; enter the address by hand.</p>';
      return;
    }
    if (act === 'rk-pick') { document.getElementById('rk-ip').value = el.dataset.ip; return; }
    if (act === 'rk-log-clear') { await api('/roku/log-clear', {}); return refreshLog(); }
    if (act === 'rk-try') {
      openSheet(`<h2>Open a title on the TV</h2><p>Replays the calibrated search path with this title and stops on its page.</p>
        <input id="rk-try-title" class="search" type="text" value="Severance"><div class="stack" style="margin-top:12px"><button class="btn-primary" data-act="rk-try-run">Open on TV</button></div>`);
      return;
    }
    if (act === 'rk-try-run') {
      const r = await api('/roku/open-search', { title: document.getElementById('rk-try-title').value });
      closeSheet();
      toast(r.dry ? `Dry run: ${r.presses} presses logged` : 'Sent to the TV');
      return refreshLog();
    }

    if (!cal) return;
    const step = CAL_STEPS[cal.step];
    if (act === 'cal-done') {
      cal.step = Math.min(cal.step + 1, CAL_STEPS.length - 1);
      return renderCalibrate();
    }
    if (act === 'cal-back') { cal.step = Math.max(0, cal.step - 1); return renderCalibrate(); }
    if (act === 'cal-redo') {
      delete cal.rec[step.id];
      if (step.id === 'type') cal.typed = '';
      toast('Step cleared. Get the TV back to where this step starts, then record it again.');
      return renderCalibrate();
    }
    if (act === 'cal-undo') {
      const list = cal.rec[step.id];
      if (list && list.length) list.pop();
      toast('Removed from the recording (the TV already got the press)');
      return renderCalRecord();
    }
    if (act === 'cal-typemode') {
      cal.typeMode = el.dataset.mode;
      delete cal.rec.type;
      cal.typed = '';
      return renderCalibrate();
    }
    if (act === 'cal-run') {
      cal.testTitle = document.getElementById('cal-test-title').value.trim() || 'Breaking Bad';
      el.disabled = true;
      el.textContent = 'Running…';
      cal.lastRun = await api('/roku/open-search', { title: cal.testTitle, rec: calRecording() });
      cal.ran = true;
      renderCalibrate();
      return refreshLog();
    }
    if (act === 'cal-save') {
      await api('/roku/calibration', { rec: calRecording() });
      state.cal = null;
      toast('Search path saved');
      location.hash = '#/remote';
      return;
    }
    if (act === 'cal-wrong') {
      openSheet(`<h2>Where did it go wrong?</h2><p>Pick the first step that didn't do what you expected. You'll re-record just that step, then test again.</p>
        <div class="stack">${CAL_STEPS.slice(1, -1).map((x, i) => `<button class="btn-secondary" data-act="cal-goto" data-step="${i + 1}">${esc(x.title)}</button>`).join('')}</div>`);
      return;
    }
    if (act === 'cal-goto') {
      cal.step = Number(el.dataset.step);
      delete cal.rec[CAL_STEPS[cal.step].id];
      cal.ran = false;
      closeSheet();
      toast('Get the TV to where this step starts, then record it again.');
      return renderCalibrate();
    }
  } catch (e) {
    toast(e.message);
    if (act === 'cal-run') renderCalibrate();
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-rk-type]');
  if (!form) return;
  ev.preventDefault();
  const input = form.querySelector('input');
  rokuText(input.value).catch((e) => toast(e.message));
  if (!state.cal) input.value = '';
});
