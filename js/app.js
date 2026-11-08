/* Glassbox.App: router, settings, build flow (estimate -> progress -> lesson), wiring. */
(function (G) {
  'use strict';
  var U = G.Util, el = U.el, Net = G.Net, CONFIG = G.CONFIG, App = {};
  var SETTINGS_KEY = 'glassbox.settings.v1';
  var DEFAULTS = { quality: 'balanced', writer: 'auto', critic: 'auto', image: 'auto', voice: 'auto', reviewer: true, cover: true, askBeforeBuild: true, capPollen: 0.5, language: 'English', demo: false, demoBusy: false, theme: 'system' };
  var state = { route: 'home', auth: { connected: false }, models: { text: [], image: [], audio: [], ok: false, loadedAt: null }, settings: Object.assign({}, DEFAULTS), job: null, current: null, balance: null };
  var view, lessonApi = null, galleryCache = {}, routeToken = 0, preparing = false;
  App.state = state;

  // ------------------------------------------------------------------ settings
  function loadSettings() { try { var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); Object.keys(DEFAULTS).forEach(function (k) { if (s[k] !== undefined && typeof s[k] === typeof DEFAULTS[k]) state.settings[k] = s[k]; }); } catch (e) { /* storage blocked */ } }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* ignore */ } }
  function applyTheme() { var t = state.settings.theme; if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  function applyDemo() {
    if (state.settings.demo) { G.Demo.enable({ busy: state.settings.demoBusy }); } else if (G.Demo.enabled) { G.Demo.disable(); G.Models.reset(); }
    state.models = { text: [], image: [], audio: [], ok: false, loadedAt: null };
    renderChip(); if (state.route === 'home' && !state.job) renderHome();
  }

  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 4200); }
  function q(name) { return new URLSearchParams(location.search).get(name); }
  function isAbort(e) { return e && (e.kind === 'aborted' || e.name === 'AbortError'); }

  // ------------------------------------------------------------------ header chip / auth
  function renderChip() {
    var chip = document.getElementById('chip');
    if (state.settings.demo) { chip.hidden = false; chip.textContent = 'Demo · 0 Pollen'; }
    else if (state.auth.connected && state.balance !== null) { chip.hidden = false; chip.textContent = 'Balance: ' + U.fmt(state.balance, 2) + ' Pollen'; }
    else chip.hidden = true;
  }
  function onAuthChange(connected) {
    state.auth.connected = connected; state.balance = null; renderChip();
    if (connected && !state.settings.demo) Net.balance().then(function (b) { state.balance = b; renderChip(); });
    if (state.route === 'home' && !state.job) renderHome();
  }
  function canBuild() { return state.settings.demo || state.auth.connected; }

  // ------------------------------------------------------------------ models
  function ensureModels() {
    if (state.models.loadedAt) return Promise.resolve(state.models);
    return G.Models.load({ force: true }).then(function (m) { state.models = m; return m; });
  }

  // ------------------------------------------------------------------ router
  function parseRoute() {
    var h = location.hash || '#/'; var m = /^#\/lesson\/([\w-]+)/.exec(h);
    if (m) return { name: 'lesson', id: m[1] };
    if (/^#\/settings/.test(h)) return { name: 'settings' };
    return { name: 'home' };
  }
  function disposeLesson() { if (lessonApi) { lessonApi.destroy(); lessonApi = null; } }
  function route() {
    var r = parseRoute(), token = ++routeToken; state.route = r.name; disposeLesson();
    var dlg = document.getElementById('dlg'); if (dlg && dlg.open) dlg.close(); // a pending build confirmation is abandoned
    document.getElementById('nav-home').removeAttribute('aria-current'); document.getElementById('nav-settings').removeAttribute('aria-current');
    if (r.name === 'settings') document.getElementById('nav-settings').setAttribute('aria-current', 'page'); else document.getElementById('nav-home').setAttribute('aria-current', 'page');
    if (state.job && state.job.active && r.name !== 'home') { /* leaving the progress screen keeps the job running; it re-renders on return */ }
    if (r.name === 'home') { if (state.job) renderProgress(); else renderHome(); }
    else if (r.name === 'settings') renderSettings();
    else openLesson(r.id, token);
    window.scrollTo(0, 0);
  }
  App.go = function (hash) { location.hash = hash; };
  function focusHeading() { var h = view.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }

  // ------------------------------------------------------------------ home
  var homeDraft = { topic: '', level: 'highschool' };
  var QUICK = ['Lotka–Volterra predator–prey', 'Radioactive decay', 'Projectile motion', 'Greenhouse effect energy balance', 'Enzyme kinetics'];
  function renderHome() {
    document.title = 'Glassbox Lab · turn a science topic into a simulation you can question';
    view.textContent = '';
    if (state.settings.demo) view.appendChild(el('div', { 'class': 'banner-demo' }, el('span', {}, 'Demo mode: AI responses are pre-recorded and no Pollen is used. Only 4 topics are available.'), el('button', { type: 'button', 'class': 'gb-btn', onclick: function () { state.settings.demo = false; saveSettings(); applyDemo(); } }, 'Exit demo')));
    if (state.current) view.appendChild(el('div', { 'class': 'banner-demo' }, el('span', {}, 'Your last lesson: ' + state.current.lesson.title), el('a', { 'class': 'gb-btn', href: '#/lesson/current' }, 'Open it')));
    view.appendChild(el('section', { 'class': 'hero' }, el('h1', {}, 'Turn a science topic into a simulation you can question.'), el('p', {}, 'Glassbox builds a live model with sliders, a guided tour and predict-then-test questions, checks it automatically, and shows its sources. You pay with your own Pollen.')));
    var input = el('input', { type: 'text', id: 'topic', maxlength: '200', placeholder: 'e.g. Why does a pendulum keep time?', value: homeDraft.topic, autocomplete: 'off', 'aria-describedby': 'topic-help topic-err' });
    var err = el('p', { 'class': 'err', id: 'topic-err', role: 'alert' });
    input.addEventListener('input', function () { homeDraft.topic = input.value; err.textContent = ''; });
    var lv = el('fieldset', { 'class': 'levels' }, el('legend', {}, 'Audience'));
    [['kid', 'Kid (10–13)'], ['highschool', 'High school'], ['university', 'University intro'], ['teacher', 'Teacher']].forEach(function (l) {
      var r = el('input', { type: 'radio', name: 'level', value: l[0], checked: homeDraft.level === l[0] }); r.addEventListener('change', function () { homeDraft.level = l[0]; });
      lv.appendChild(el('label', {}, r, el('span', {}, l[1])));
    });
    var go = el('button', { type: 'submit', 'class': 'btn primary' }, canBuild() ? 'Estimate & build' : 'Connect to build');
    var quick = el('div', { 'class': 'quick', 'aria-label': 'Example topics' }, QUICK.map(function (t) { return el('button', { type: 'button', 'class': 'gb-chip gb-chip-btn', onclick: function () { input.value = t; homeDraft.topic = t; input.focus(); } }, t); }));
    var form = el('form', { 'class': 'create', novalidate: true },
      el('label', { 'class': 'lab', 'for': 'topic' }, 'Science topic or question'), input,
      el('p', { 'class': 'hint', id: 'topic-help' }, 'Works best for things that change: motion, populations, reactions, orbits, circuits, climate.'), err, lv, quick, go,
      canBuild() ? null : el('p', { 'class': 'hint' }, 'Building a new lesson uses Pollinations AI models paid from your own Pollen. No sign-in needed for the gallery below.'));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var t = input.value.trim();
      if (t.length < 3) { err.textContent = 'Please describe a topic (at least 3 characters).'; input.focus(); return; }
      if (!canBuild()) { var c = document.getElementById('connect'); try { var b = c.shadowRoot && c.shadowRoot.querySelector('button'); if (b) b.click(); else c.focus(); } catch (x) { /* ignore */ } toast('Use the Connect button at the top to sign in with Pollinations.'); return; }
      startBuild(t, homeDraft.level);
    });
    view.appendChild(form);
    view.appendChild(el('h2', { 'class': 'section-title', id: 'gallery' }, 'Try a finished lesson (no sign-in, works offline)'));
    var grid = el('div', { 'class': 'gallery' }); view.appendChild(grid);
    var cards = G.gallery.map(function (l) { var c = G.View.renderGalleryCard(l); grid.appendChild(c); return c; });
    requestAnimationFrame(function () { cards.forEach(function (c) { c._draw(); }); });
    App._cards = cards;
  }

  // ------------------------------------------------------------------ build flow
  var STAGES = [['sources', 'Finding sources'], ['write', 'Designing the simulation'], ['check', 'Checking the simulation'], ['repair', 'Fixing issues'], ['review', 'Second opinion'], ['cover', 'Cover illustration']];

  function startBuild(topic, level) {
    if (preparing || state.job) return; // double submit
    var s = state.settings, token = routeToken;
    function stale() { return token !== routeToken; } // the user navigated away before the build started
    preparing = true;
    view.textContent = ''; view.appendChild(el('p', { role: 'status' }, 'Loading the model list…'));
    ensureModels().then(function (models) {
      if (stale()) return null;
      var settings = Object.assign({}, s);
      if (s.demo) Object.assign(settings, { writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image' });
      var plan = G.Pipeline.plan({ topic: topic, level: level, language: s.language, settings: settings, models: models });
      var worstOver = plan.estimate.worst > s.capPollen;
      if (s.askBeforeBuild || worstOver) return confirmDialog(plan).then(function (r) { if (stale()) return null; if (!r) { renderHome(); return null; } plan.withCover = plan.withCover && !r.skipCover; plan.withCritic = plan.withCritic && !r.skipReviewer; return plan; });
      return plan;
    }).then(function (plan) { preparing = false; if (plan && !stale()) runJob(plan); }, function (e) { preparing = false; if (!stale()) showError(e); });
  }

  function confirmDialog(plan) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById('dlg'), est = plan.estimate, cap = plan.settings.capPollen;
      var cover = el('input', { type: 'checkbox', id: 'sk-cover' }), rev = el('input', { type: 'checkbox', id: 'sk-rev' });
      var rows = est.lines.map(function (l) { return el('tr', {}, el('td', {}, l.label), el('td', {}, l.model || 'server default'), el('td', {}, l.key === 'repair' ? (l.worst === null ? 'price not published' : 'up to ' + G.Cost.format(l.worst)) : (l.known ? '≈ ' + G.Cost.format(l.typical) : 'price not published'))); });
      rows.unshift(el('tr', {}, el('td', {}, 'Find sources'), el('td', {}, 'Wikipedia'), el('td', {}, 'free')));
      var form = el('form', { method: 'dialog' },
        el('h2', { id: 'dlg-title' }, 'Build “' + plan.topic.slice(0, 80) + '”?'),
        el('table', { 'class': 'cost' }, el('tbody', {}, rows)),
        el('p', {}, est.unknown ? 'Typical and worst case are partly unknown. ' : 'Typical ≈ ' + G.Cost.format(est.typical) + ' Pollen · worst case ' + G.Cost.format(est.worst) + ' · ', 'your cap ' + cap + ' Pollen'),
        est.unknown ? el('p', { 'class': 'hint' }, "Some prices aren't published by the API. Your per-lesson cap and your connection budget still limit spending.") : null,
        !est.unknown && est.worst > cap ? el('p', { 'class': 'hint' }, 'Worst case is above your cap; optional steps will be skipped if needed.') : null,
        el('p', {}, el('label', { 'class': 'gb-inline' }, cover, ' Skip cover illustration'), el('br'), el('label', { 'class': 'gb-inline' }, rev, ' Skip reviewer')),
        plan.origin === 'demo' ? el('p', { 'class': 'hint' }, 'Demo mode: nothing is charged.') : el('p', { 'class': 'hint' }, 'Narration is billed later, per step you play.'),
        el('div', { 'class': 'dlg-actions' }, el('button', { type: 'button', 'class': 'btn', id: 'dlg-cancel' }, 'Cancel'), el('button', { type: 'submit', 'class': 'btn primary', id: 'dlg-ok' }, 'Build lesson')));
      dlg.textContent = ''; dlg.appendChild(form);
      var done = false;
      function finish(v) { if (done) return; done = true; if (dlg.open) dlg.close(); resolve(v); }
      form.querySelector('#dlg-cancel').addEventListener('click', function () { finish(null); });
      form.addEventListener('submit', function (e) { e.preventDefault(); finish({ skipCover: cover.checked, skipReviewer: rev.checked }); });
      dlg.oncancel = function (e) { e.preventDefault(); finish(null); };
      dlg.onclose = function () { finish(null); };
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      form.querySelector('#dlg-ok').focus();
    });
  }

  function runJob(plan) {
    var ctl = new AbortController();
    var job = state.job = { id: Date.now(), topic: plan.topic, level: plan.level, active: true, rows: STAGES.map(function (s) { return { key: s[0], label: s[1], status: 'pending', detail: '', hidden: s[0] === 'repair' }; }), abort: ctl, spent: 0, status: 'Starting…', finished: false, error: null };
    if (state.route === 'home') renderProgress();
    var t0 = Date.now(), tick = setInterval(function () { if (state.job === job && job.active) { var a = job.rows.filter(function (r) { return r.status === 'active' && r.key === 'write'; })[0]; if (a && !a.busy) { a.detail = (a.base || a.detail) ; } updateProgress(); } }, 1000);
    G.Pipeline.run(plan, {
      signal: ctl.signal,
      onStage: function (key, status, detail) { var r = job.rows.filter(function (x) { return x.key === key; })[0]; if (!r) return; r.status = status; r.detail = detail; if (key === 'repair') r.hidden = false; if (status === 'active') job.status = r.label + '…'; updateProgress(); },
      onSpend: function (v) { job.spent = v; updateProgress(); }
    }).then(function (res) {
      clearInterval(tick); job.active = false; job.finished = true;
      var coverUrl = res.coverBlob ? URL.createObjectURL(res.coverBlob) : null, old = state.current;
      state.current = { lesson: res.lesson, report: res.report, critic: res.critic, coverUrl: coverUrl, coverBlob: res.coverBlob, audio: new Map(), plan: plan };
      state.job = null; saveLastSpent(res.spent);
      if (location.hash === '#/lesson/current') route();
      else if (state.route === 'home') App.go('#/lesson/current');
      else toast('Your lesson “' + res.lesson.title.slice(0, 60) + '” is ready. Open it from Create & gallery.');
      // the old lesson is no longer on screen: release its blob URLs
      if (old) { if (old.coverUrl) URL.revokeObjectURL(old.coverUrl); if (old.audio) old.audio.forEach(function (u) { URL.revokeObjectURL(u); }); }
    }, function (e) {
      clearInterval(tick); job.active = false; job.finished = true;
      if (e && e.kind === 'auth') G.Auth.disconnect();
      job.error = e; job.rows.forEach(function (r) { if (r.status === 'active') r.status = isAbort(e) ? 'skipped' : 'error'; });
      job.status = isAbort(e) ? 'Cancelled. Nothing else will be charged.' : (e && e.kind === 'refused' ? "This topic can't be turned into a lesson here: " + e.message : (e && e.message) || 'Something went wrong.');
      if (state.route === 'home') renderProgress();
    });
  }
  function saveLastSpent() { /* spending is shown live; nothing persisted */ }

  var progressEls = null;
  function renderProgress() {
    var job = state.job; if (!job) return renderHome();
    document.title = 'Building… · Glassbox Lab'; view.textContent = '';
    var status = el('p', { 'class': 'status', 'aria-live': 'polite' }), list = el('ol', { 'class': 'steps' }), spent = el('p', { 'class': 'hint' });
    var cancel = el('button', { type: 'button', 'class': 'btn' }, 'Cancel'), back = el('button', { type: 'button', 'class': 'btn primary', hidden: true }, 'Back');
    cancel.addEventListener('click', function () { if (job.active) job.abort.abort(); });
    back.addEventListener('click', function () { state.job = null; renderHome(); });
    view.appendChild(el('section', { 'class': 'progress' }, el('h1', {}, 'Building “' + job.topic.slice(0, 60) + '”'), status, list, spent, el('div', { 'class': 'dlg-actions' }, cancel, back)));
    progressEls = { status: status, list: list, spent: spent, cancel: cancel, back: back, job: job };
    updateProgress(); focusHeading();
  }
  function updateProgress() {
    var p = progressEls; if (!p || p.job !== state.job || state.route !== 'home') return;
    p.status.textContent = p.job.status;
    p.list.textContent = '';
    p.job.rows.forEach(function (r) { if (r.hidden) return; p.list.appendChild(el('li', { 'class': r.status }, el('span', { 'class': 'st', 'aria-hidden': 'true' }, { done: '✓', warn: '!', error: '×', skipped: '–' }[r.status] || ''), el('span', {}, r.label), el('span', { 'class': 'detail' }, r.detail || ''))); });
    p.spent.textContent = state.settings.demo ? 'Demo mode: nothing is charged.' : 'Spent so far: ' + G.Cost.format(p.job.spent) + ' Pollen';
    p.cancel.hidden = !p.job.active; p.back.hidden = p.job.active;
  }
  function showError(e) {
    view.textContent = ''; view.appendChild(el('section', { 'class': 'progress' }, el('h1', {}, 'That did not work'), el('p', {}, (e && e.message) || 'Something went wrong.'), el('button', { type: 'button', 'class': 'btn primary', onclick: renderHome }, 'Back')));
  }
  document.addEventListener('keydown', function (e) {
    var dlg = document.getElementById('dlg');
    if (e.key === 'Escape' && state.job && state.job.active && state.route === 'home' && progressEls && progressEls.job === state.job && !(dlg && dlg.open)) state.job.abort.abort();
  });

  // ------------------------------------------------------------------ lesson
  function openLesson(id, token) {
    view.textContent = '';
    if (id === 'current') {
      if (!state.current) { view.appendChild(el('section', { 'class': 'hero' }, el('h1', {}, 'No lesson loaded yet.'), el('a', { 'class': 'btn primary', href: '#/' }, 'Go to gallery'))); return; }
      return showLesson(state.current, token);
    }
    var raw = G.gallery.filter(function (l) { return l.id === id; })[0];
    if (!raw) { view.appendChild(el('section', { 'class': 'hero' }, el('h1', {}, 'Lesson not found.'), el('a', { 'class': 'btn primary', href: '#/' }, 'Go to gallery'))); return; }
    if (galleryCache[id]) return showLesson(galleryCache[id], token);
    view.appendChild(el('p', { role: 'status' }, 'Running the checks…'));
    setTimeout(function () {
      if (token !== routeToken) return;
      var n = G.Schema.normalize(JSON.parse(JSON.stringify(raw)), {}), report = G.Checks.run(n.lesson, {});
      n.lesson.meta = Object.assign({}, n.lesson.meta, { origin: 'gallery' });
      galleryCache[id] = { lesson: n.lesson, report: report, critic: null, coverUrl: null, audio: new Map() };
      showLesson(galleryCache[id], token);
    }, 30);
  }
  function narrateHook(cur) {
    if (!(state.auth.connected || state.settings.demo)) return null;
    return function (step) {
      if (cur.audio.has(step.id)) return Promise.resolve(cur.audio.get(step.id));
      var models = state.models, speech = state.settings.voice !== 'auto' ? { id: state.settings.voice } : G.Models.pickSpeech(models.audio);
      return Net.withRetry(function () { return Net.speech({ text: G.Prompts.narration(step), model: speech ? speech.id : undefined, voice: speech && speech.voices && speech.voices[0] }); }, { attempts: 2 })
        .then(function (blob) { var u = URL.createObjectURL(blob); cur.audio.set(step.id, u); return u; }, function (e) { if (e.kind === 'auth') G.Auth.disconnect(); toast('AI narration is not available; using the device voice.'); return null; });
    };
  }
  function whatIfHook(cur) {
    if (!state.auth.connected || state.settings.demo || cur.lesson.meta.origin === 'gallery' && false) return null;
    return function (question, params) {
      var w = state.models.text.length ? G.Models.pick(state.models.text, G.Models.PREFS.writer[state.settings.quality] || G.Models.PREFS.writer.balanced) : null;
      return Net.withRetry(function () { return Net.chat({ model: w ? w.id : undefined, messages: G.Prompts.whatIf({ lesson: cur.lesson, params: params, question: question }), maxTokens: 300, temperature: 0.2, json: true, timeoutMs: 40000 }); }, { attempts: 2 }).then(function (r) {
        var ex = G.Pipeline.extractJson(r.text); if (ex.error || !ex.value) throw new Error('The model reply could not be read.');
        var out = { set: {}, say: String(ex.value.say || '').slice(0, 300), outOfModel: !!ex.value.outOfModel, note: String(ex.value.note || '').slice(0, 300) };
        cur.lesson.sim.params.forEach(function (p) { var v = Number(ex.value.set && ex.value.set[p.id]); if (isFinite(v)) out.set[p.id] = U.clamp(v, p.min, p.max); });
        return out;
      });
    };
  }
  function toJpegDataUrl(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { var k = Math.min(1, 1024 / Math.max(img.width || 1024, 1)), c = document.createElement('canvas'); c.width = Math.round((img.width || 1024) * k); c.height = Math.round((img.height || 576) * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8)); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); }; img.src = url;
    });
  }
  function showLesson(cur, token) {
    if (token !== routeToken) return;
    view.textContent = ''; document.title = cur.lesson.title + ' · Glassbox Lab';
    var host = el('div', { id: 'lesson-root' }); view.appendChild(host);
    var includeCover = el('input', { type: 'checkbox', id: 'inc-cover', checked: true });
    lessonApi = G.View.renderLesson(host, cur.lesson, { report: cur.report, critic: cur.critic, coverUrl: cur.coverUrl, mode: 'app', hooks: {
      narrate: narrateHook(cur), whatIf: whatIfHook(cur), buildAnother: function () { App.go('#/'); },
      export: function (kind) {
        var base = U.slug(cur.lesson.title);
        if (kind === 'json') { U.download('glassbox-' + base + '.json', G.Exporter.lessonJson(cur.lesson), 'application/json'); return; }
        Promise.resolve(includeCover.checked && cur.coverBlob ? toJpegDataUrl(cur.coverBlob) : null).then(function (cover) {
          try { U.download('glassbox-' + base + '.html', G.Exporter.buildHtml(cur.lesson, { report: cur.report, critic: cur.critic, coverDataUrl: cover }), 'text/html'); toast('Saved. The file works offline.'); }
          catch (e) { toast(e.message); }
        });
      } } });
    var bar = host.querySelector('.gb-actions');
    if (bar && cur.coverBlob) bar.insertBefore(el('label', { 'class': 'gb-inline', 'for': 'inc-cover' }, includeCover, ' Include cover image'), bar.firstChild);
    focusHeading();
    G.App._lastLesson = cur;
  }

  // ------------------------------------------------------------------ settings
  function renderSettings() {
    document.title = 'Settings · Glassbox Lab'; view.textContent = '';
    var s = state.settings;
    function save() { saveSettings(); }
    function select(label, key, options) {
      var sel = el('select', { id: 's-' + key }, options.map(function (o) { return el('option', { value: o[0], selected: String(s[key]) === String(o[0]) }, o[1]); }));
      sel.addEventListener('change', function () { s[key] = sel.value; save(); }); return el('label', { 'class': 'row', 'for': 's-' + key }, label, sel);
    }
    function toggle(label, key, onchange) {
      var c = el('input', { type: 'checkbox', id: 's-' + key, checked: !!s[key] }); c.addEventListener('change', function () { s[key] = c.checked; save(); if (onchange) onchange(); }); return el('label', { 'class': 'row', 'for': 's-' + key }, label, c);
    }
    var textOpts = [['auto', 'Automatic']].concat(state.models.text.map(function (m) { return [m.id, m.id]; }));
    var imgOpts = [['auto', 'Automatic']].concat(state.models.image.map(function (m) { return [m.id, m.id]; }));
    var voiceOpts = [['auto', 'Automatic']].concat(state.models.audio.map(function (m) { return [m.id, m.id]; }));
    var cap = el('input', { type: 'number', id: 's-cap', min: '0.01', max: '5', step: '0.01', value: s.capPollen }); cap.addEventListener('change', function () { s.capPollen = U.clamp(Number(cap.value) || 0.5, 0.01, 5); cap.value = s.capPollen; save(); });
    var status = el('p', { 'class': 'hint' }, state.models.loadedAt ? (state.models.ok ? 'Models loaded from gen.pollinations.ai/text/models at ' + new Date(state.models.loadedAt).toLocaleTimeString() + '.' : "Couldn't load the model list; using the server default model.") : 'The model list loads when you start a build.');
    var load = el('button', { type: 'button', 'class': 'btn', onclick: function () { G.Models.reset(); state.models = { text: [], image: [], audio: [], ok: false, loadedAt: null }; ensureModels().then(renderSettings); } }, 'Load model list');
    view.appendChild(el('div', { 'class': 'settings' }, el('h1', {}, 'Settings'),
      el('section', { 'class': 'card' }, el('h2', {}, 'Models'), select('Quality preset', 'quality', [['fast', 'Fast & cheap'], ['balanced', 'Balanced'], ['best', 'Best']]), select('Writer model', 'writer', textOpts), select('Reviewer model', 'critic', textOpts), select('Image model', 'image', imgOpts), select('Narration voice model', 'voice', voiceOpts), status, load),
      el('section', { 'class': 'card' }, el('h2', {}, 'Lesson building'), toggle('Reviewer (second opinion)', 'reviewer'), toggle('Cover image', 'cover'), toggle('Ask before every build', 'askBeforeBuild'), el('label', { 'class': 'row', 'for': 's-cap' }, 'Max Pollen per lesson', cap),
        select('Language of the lesson', 'language', [['English', 'English'], ['Spanish', 'Spanish'], ['French', 'French'], ['German', 'German'], ['Korean', 'Korean'], ['Japanese', 'Japanese'], ['Portuguese', 'Portuguese']])),
      el('section', { 'class': 'card' }, el('h2', {}, 'Demo and account'), toggle('Demo mode (pre-recorded, no Pollen)', 'demo', applyDemo), toggle('Simulate a busy server in demo', 'demoBusy', function () { if (s.demo) applyDemo(); }),
        el('div', { 'class': 'gb-row' }, el('button', { type: 'button', 'class': 'btn', onclick: function () { G.Auth.disconnect(); toast('Disconnected from Pollinations.'); } }, 'Disconnect Pollinations')),
        el('p', { 'class': 'hint' }, 'Your key stays in this tab. Settings other than the key are stored in this browser (localStorage).'))));
    focusHeading();
  }

  // ------------------------------------------------------------------ init
  App.init = function () {
    view = document.getElementById('view'); loadSettings(); applyTheme();
    if (q('demo') === '1') { state.settings.demo = true; }
    var themeBtn = document.getElementById('theme');
    themeBtn.addEventListener('click', function () { var order = ['system', 'light', 'dark'], i = (order.indexOf(state.settings.theme) + 1) % 3; state.settings.theme = order[i]; saveSettings(); applyTheme(); themeBtn.setAttribute('aria-label', 'Switch theme (now ' + order[i] + ')'); themeBtn.title = 'Theme: ' + order[i]; if (App._cards) App._cards.forEach(function (c) { c._draw(); }); toast('Theme: ' + order[i]); });
    new MutationObserver(function () { if (App._cards) App._cards.forEach(function (c) { c._draw(); }); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    Net.setKeyProvider(function () { return G.Auth.getKey(); });
    var connect = document.getElementById('connect');
    if (connect.getAttribute('app-key') !== CONFIG.APP_KEY) connect.setAttribute('app-key', CONFIG.APP_KEY);
    G.Auth.init({ appKey: CONFIG.APP_KEY, budget: CONFIG.CONNECT_BUDGET, expiry: CONFIG.CONNECT_EXPIRY, repoUrl: 'https://github.com/patbing/glassbox-lab', onChange: onAuthChange });
    if (state.settings.demo) G.Demo.enable({ busy: state.settings.demoBusy });
    renderChip();
    window.addEventListener('hashchange', route); route();
  };
  G.App = App;
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.init); else App.init(); }
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
