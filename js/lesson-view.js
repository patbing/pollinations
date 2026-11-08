/* Glassbox.View: renders a lesson (stage, controls, tour, predict, equations, sources and checks, glossary).
 * Player module: also inlined into exported lessons, so it must not use Net, Pipeline, Auth or App.
 * All model-written text is inserted with textContent only. */
(function (G) {
  'use strict';
  function install(G) {
    var V = {}, U = G.Util, el = U.el;
    var LEVELS = { kid: 'Kid (10–13)', highschool: 'High school', university: 'University intro', teacher: 'Teacher' };
    var SUBJECTS = { physics: 'Physics', biology: 'Biology', chemistry: 'Chemistry', 'earth-space': 'Earth & Space', other: 'Science' };
    V.LEVELS = LEVELS; V.SUBJECTS = SUBJECTS;
    var WIKI_RE = /^https:\/\/[a-z]{2,3}\.wikipedia\.org\//;

    function pretty(src) { try { return G.Expr.toText(G.Expr.parse(src).ast); } catch (e) { return String(src); } }
    function chips(text, onCite) {
      var out = [];
      U.splitCitations(text).forEach(function (p) {
        if (p.type === 'text') out.push(document.createTextNode(p.value));
        else out.push(el('button', { type: 'button', 'class': 'gb-cite', 'aria-label': 'Source ' + p.value, onclick: function () { onCite(p.value); } }, p.value));
      });
      return out;
    }
    function icon(kind) { return el('span', { 'class': 'gb-ic gb-ic-' + kind, 'aria-hidden': 'true' }, { ok: '✓', warn: '!', info: 'i', err: '×' }[kind] || 'i'); }
    function hasDeviceVoice() { return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; }

    // ------------------------------------------------------------------ checks list
    V.checkRows = function (lesson, report, critic) {
      var rows = [], meta = lesson.meta || {};
      if (report) {
        if (!report.errors) rows.push({ kind: 'ok', text: U.fmt(report.runs, 0) + ' simulation runs across ' + report.sets + ' slider settings: no invalid numbers.' });
        else rows.push({ kind: 'warn', text: report.errors + ' problem' + (report.errors === 1 ? '' : 's') + ' could not be fixed automatically.' });
        if (meta.repairs) rows.push({ kind: 'info', text: 'The checker found problems in the first draft and sent them back to the model (' + meta.repairs + ' round' + (meta.repairs === 1 ? '' : 's') + ').' });
        if (report.removed && report.removed.length) rows.push({ kind: 'warn', text: 'Some parts were removed: ' + report.removed.join(', ') + '.' });
        if (lesson.sim) rows.push(report.deadSliders && report.deadSliders.length ? { kind: 'warn', text: 'These sliders change nothing you can see: ' + report.deadSliders.join(', ') + '.' } : { kind: 'ok', text: 'Every slider changes something you can see.' });
        var n = lesson.predictions.length, k = lesson.predictions.filter(function (p) { var r = report.experiments && report.experiments[p.id]; return r && r.matches && !p.correctedBySim; }).length;
        if (n) rows.push(k === n ? { kind: 'ok', text: k + ' of ' + n + ' prediction answers confirmed by running the simulation.' } : { kind: 'warn', text: k + ' of ' + n + ' prediction answers confirmed by running the simulation; the rest were corrected to match it.' });
      }
      if (critic) rows.push({ kind: critic.verdict === 'ok' ? 'ok' : 'warn', text: 'Second opinion' + (critic.model ? ' from ' + critic.model : '') + ': ' + (critic.summary || critic.verdict) });
      else rows.push({ kind: 'info', text: meta.origin === 'gallery' ? 'This hand-checked example was reviewed by its authors, not by a model.' : 'The reviewer was skipped.' });
      var cited = lesson.claims.filter(function (c) { return (c.sources || []).length; }).length;
      var unc = lesson.claims.length - cited;
      rows.push({ kind: 'info', text: cited + ' claim' + (cited === 1 ? ' cites' : 's cite') + ' Wikipedia; ' + unc + (unc === 1 ? ' is' : ' are') + ' marked textbook knowledge or simplification.' });
      if (lesson.sim) rows.push({ kind: 'info', text: 'Equations are shown in full on the Equations tab.' });
      return rows;
    };
    V.renderChecks = function (container, lesson, report, critic) {
      container.appendChild(el('ul', { 'class': 'gb-checks' }, V.checkRows(lesson, report, critic).map(function (r) { return el('li', { 'class': 'gb-check gb-check-' + r.kind }, icon(r.kind), el('span', {}, r.text)); })));
    };
    V.checkSummary = function (lesson, report, critic) {
      var bits = [];
      if (report) bits.push(U.fmt(report.runs, 0) + ' runs');
      var n = lesson.predictions.length; if (n && report) bits.push(lesson.predictions.filter(function (p) { var r = report.experiments && report.experiments[p.id]; return r && r.matches; }).length + '/' + n + ' answers verified');
      if (critic) bits.push('reviewer: ' + (critic.verdict === 'ok' ? 'no issues' : critic.issues.length + ' note' + (critic.issues.length === 1 ? '' : 's')));
      return 'Checked: ' + bits.join(' · ');
    };

    // ------------------------------------------------------------------ gallery card
    V.renderGalleryCard = function (lesson, onOpen) {
      var cv = el('canvas', { 'class': 'gb-thumb', 'aria-hidden': 'true' });
      var card = el('article', { 'class': 'gb-gcard' },
        el('div', { 'class': 'gb-gthumb' }, cv),
        el('div', { 'class': 'gb-gbody' },
          el('div', { 'class': 'gb-tags' }, el('span', { 'class': 'gb-tag gb-tag-' + lesson.subject }, SUBJECTS[lesson.subject] || 'Science'), el('span', { 'class': 'gb-tag' }, LEVELS[lesson.level] || '')),
          el('h3', {}, lesson.title), el('p', {}, lesson.summary),
          el('a', { 'class': 'gb-btn gb-primary', href: '#/lesson/' + lesson.id, onclick: function () { if (onOpen) onOpen(lesson); } }, 'Open lesson')));
      var built = null;
      card._draw = function () { try { if (!built) built = G.Sim.build(G.Schema.normalize(JSON.parse(JSON.stringify(lesson)), {}).lesson.sim); G.Sim.renderThumb(cv, built, card); } catch (e) { /* thumbnail is decorative */ } };
      return card;
    };

    // ------------------------------------------------------------------ lesson
    V.renderLesson = function (root, lesson, opts) {
      opts = opts || {}; var hooks = opts.hooks || {}, mode = opts.mode || 'app', report = opts.report || null, critic = opts.critic || null;
      root.textContent = '';
      var timers = [], player = null, model = null, tourPlaying = false, disposed = false;
      var meta = lesson.meta || {}, reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function later(fn, ms) { var t = setTimeout(function () { if (!disposed) fn(); }, ms); timers.push(t); return t; }

      // header
      var originLabel = meta.origin === 'gallery' ? 'Hand-checked example' : (meta.origin === 'demo' ? 'Demo (pre-recorded)' : 'AI-generated');
      var checkChip = el('button', { type: 'button', 'class': 'gb-chip gb-chip-check', onclick: function () { selectTab('checks'); } }, V.checkSummary(lesson, report, critic));
      var head = el('header', { 'class': 'gb-lhead' },
        el('h1', { tabindex: '-1', id: 'lesson-title' }, lesson.title),
        el('p', { 'class': 'gb-bigidea' }, lesson.bigIdea || lesson.summary),
        el('div', { 'class': 'gb-chips' }, el('span', { 'class': 'gb-chip' }, LEVELS[lesson.level] || ''), el('span', { 'class': 'gb-chip' }, SUBJECTS[lesson.subject] || 'Science'), el('span', { 'class': 'gb-chip gb-chip-origin' }, originLabel), report ? checkChip : null));
      root.appendChild(head);
      function banner(kind, text, extra) { root.appendChild(el('div', { 'class': 'gb-banner gb-banner-' + kind, role: 'note' }, el('span', {}, text), extra || null)); }
      if (critic && critic.verdict === 'major') banner('warn', "The reviewer model flagged a possible error. Read 'Sources & checks' before teaching with this lesson.");
      if (meta.simFallback === 'explorer') banner('info', "The AI's simulation didn't pass our checks, so this is a simpler explorer built from the parts that did. The explanation and sources are unaffected.", hooks.rebuildSim ? el('button', { type: 'button', 'class': 'gb-btn', onclick: hooks.rebuildSim }, 'Try building the simulation again') : null);
      if (meta.simFallback === 'none' || !lesson.sim) banner('info', "We couldn't build a safe simulation for this topic. The tour, sources and glossary are still available.");
      if (!lesson.sources.length) banner('warn', "We couldn't reach Wikipedia, so this lesson has no external sources. Treat every claim as unverified.");

      var grid = el('div', { 'class': 'gb-lgrid' }), stageCol = el('div', { 'class': 'gb-stagecol' }), panel = el('aside', { 'class': 'gb-panel', 'aria-label': 'Lesson panel' });
      grid.appendChild(stageCol); grid.appendChild(panel); root.appendChild(grid);

      if (opts.coverUrl) stageCol.appendChild(el('figure', { 'class': 'gb-cover' }, el('img', { src: opts.coverUrl, alt: '', loading: 'lazy' }), el('figcaption', {}, 'Decorative illustration' + (meta.models && meta.models.image ? ' by ' + meta.models.image : '') + '. Not a scientific diagram.')));

      // ---- stage + controls
      var inputs = {};
      var host = el('div', { 'class': 'gb-simhost' });
      if (lesson.sim) {
        stageCol.appendChild(host);
        try {
          model = G.Sim.build(JSON.parse(JSON.stringify(lesson.sim)));
          player = G.Sim.mount(host, model, { title: lesson.title, reducedMotion: reduced, onParams: syncControls });
        } catch (e) {
          host.appendChild(el('p', { 'class': 'gb-banner gb-banner-warn' }, 'This simulation could not start: ' + (e && e.message ? e.message : 'unknown error')));
          model = null; player = null;
        }
      }
      function syncControls(p) {
        Object.keys(p).forEach(function (k) { var i = inputs[k]; if (!i) return; var v = String(p[k]); if (i.range.value !== v) i.range.value = v; var shown = numStr(p[k], decimals(model.params[k])); if (document.activeElement !== i.num && i.num.value !== shown) i.num.value = shown; valueText(i.range, model.params[k], p[k]); });
      }
      function decimals(pr) {
        var s = String(pr.step), e = /e-(\d+)$/.exec(s), i = s.indexOf('.');
        if (e) return Math.min(6, +e[1]);
        return i < 0 ? 0 : Math.min(4, s.length - i - 1);
      }
      // value for <input type=number>: plain ASCII digits (U.fmt uses a Unicode minus and exponents, which number inputs reject)
      function numStr(v, d) { var n = Number(v); if (!isFinite(n)) return ''; var s = n.toFixed(d); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; }
      function valueText(range, pr, v) { range.setAttribute('aria-valuetext', U.fmt(Number(v), decimals(pr)) + (pr.unit ? ' ' + pr.unit : '')); }

      if (model) {
        var ctl = el('section', { 'class': 'gb-card gb-controls', 'aria-labelledby': 'gb-ctl-h' }, el('h2', { id: 'gb-ctl-h' }, 'Controls'));
        lesson.sim.params.forEach(function (p) {
          var idR = 'gb-r-' + p.id, idN = 'gb-n-' + p.id;
          var range = el('input', { type: 'range', id: idR, min: p.min, max: p.max, step: p.step, value: p.value, 'aria-describedby': p.description ? idR + '-d' : null });
          var num = el('input', { type: 'number', id: idN, min: p.min, max: p.max, step: p.step, value: numStr(p.value, decimals(p)), 'aria-label': p.label + ' value', inputmode: 'decimal' });
          valueText(range, p, p.value);
          range.addEventListener('input', function () { var v = Number(range.value); num.value = numStr(v, decimals(p)); valueText(range, p, v); player.setParams(one(p.id, v), { live: true }); });
          range.addEventListener('change', function () { player.setParams(one(p.id, Number(range.value))); });
          num.addEventListener('change', function () {
            var raw = String(num.value).trim(), v = raw === '' ? NaN : U.clamp(Number(raw), p.min, p.max);
            if (!isFinite(v)) v = player.getParams()[p.id];
            range.value = v; num.value = numStr(v, decimals(p)); valueText(range, p, v); player.setParams(one(p.id, v));
          });
          inputs[p.id] = { range: range, num: num };
          ctl.appendChild(el('div', { 'class': 'gb-param' },
            el('div', { 'class': 'gb-param-top' }, el('label', { 'for': idR }, p.label, p.unit ? el('small', {}, ' (' + p.unit + ')') : null), num),
            range, p.description ? el('p', { 'class': 'gb-hint', id: idR + '-d' }, p.description) : null,
            (p.presets && p.presets.length) ? el('div', { 'class': 'gb-presets' }, p.presets.map(function (q) { return el('button', { type: 'button', 'class': 'gb-chip gb-chip-btn', onclick: function () { player.setParams(one(p.id, q.value), { animateMs: 450 }); } }, q.label); })) : null));
        });
        ctl.appendChild(el('button', { type: 'button', 'class': 'gb-link', onclick: function () { player.setParams(model.defaults(), { animateMs: 400 }); player.highlight([]); } }, 'Reset sliders'));
        panel.appendChild(ctl);
      }
      function one(k, v) { var o = {}; o[k] = v; return o; }

      // ---- tabs
      var tabDefs = [];
      if (lesson.tour.length) tabDefs.push({ id: 'tour', label: 'Tour' });
      if (lesson.predictions.length && model) tabDefs.push({ id: 'predict', label: 'Predict' });
      if (model) tabDefs.push({ id: 'equations', label: 'Equations' });
      tabDefs.push({ id: 'checks', label: 'Sources & checks' });
      if (lesson.glossary.length) tabDefs.push({ id: 'glossary', label: 'Glossary' });
      if (lesson.misconceptions.length) tabDefs.push({ id: 'misc', label: 'Misconceptions' });
      var tablist = el('div', { role: 'tablist', 'aria-label': 'Lesson sections', 'class': 'gb-tabs' }), panes = {}, tabBtns = {};
      tabDefs.forEach(function (t, i) {
        var b = el('button', { type: 'button', role: 'tab', id: 'gb-tab-' + t.id, 'aria-controls': 'gb-pane-' + t.id, 'aria-selected': 'false', tabindex: '-1', 'class': 'gb-tab' }, t.label);
        b.addEventListener('click', function () { selectTab(t.id); });
        b.addEventListener('keydown', function (e) {
          var n = tabDefs.length, j = i;
          if (e.key === 'ArrowRight') j = (i + 1) % n; else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = n - 1; else return;
          e.preventDefault(); selectTab(tabDefs[j].id); tabBtns[tabDefs[j].id].focus();
        });
        tabBtns[t.id] = b; tablist.appendChild(b);
        panes[t.id] = el('div', { role: 'tabpanel', id: 'gb-pane-' + t.id, 'aria-labelledby': 'gb-tab-' + t.id, 'class': 'gb-pane', hidden: true, tabindex: '0' });
      });
      var tabsWrap = el('section', { 'class': 'gb-card gb-tabwrap' }, tablist); tabDefs.forEach(function (t) { tabsWrap.appendChild(panes[t.id]); }); panel.appendChild(tabsWrap);
      function selectTab(id) { if (!panes[id]) return; Object.keys(panes).forEach(function (k) { var on = k === id; panes[k].hidden = !on; tabBtns[k].setAttribute('aria-selected', on ? 'true' : 'false'); tabBtns[k].tabIndex = on ? 0 : -1; }); }

      // ---- source helpers
      function openSource(id) {
        selectTab('checks'); var li = root.querySelector('#gb-src-' + id); if (li) { li.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); li.classList.add('gb-flash'); later(function () { li.classList.remove('gb-flash'); }, 1600); var d = li.querySelector('details'); if (d) d.open = true; }
      }
      function rich(text) { return el('span', {}, chips(text, openSource)); }

      // ---- tour
      var stepEls = {};
      function showStep(step) {
        if (!player) return;
        Object.keys(stepEls).forEach(function (k) { stepEls[k].classList.toggle('gb-active', k === step.id); });
        player.setParams(step.set || {}, { animateMs: 700 }); player.highlight(step.highlight || []);
        if (!player.isPlaying() && model.kind === 'ode') player.play();
      }
      var audio = null;
      function stopAudio() { if (audio) { audio.pause(); audio = null; } if (hasDeviceVoice()) window.speechSynthesis.cancel(); }
      function speakDevice(step, done) {
        if (!hasDeviceVoice()) { if (done) done(); return; }
        window.speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(step.title + '. ' + U.stripCitations(step.text)); u.lang = lesson.language || 'en'; if (done) { u.onend = done; u.onerror = done; } window.speechSynthesis.speak(u);
      }
      function listen(step, btn, deviceOnly) {
        stopAudio();
        if (!deviceOnly && hooks.narrate) {
          btn.disabled = true; var old = btn.textContent; btn.textContent = 'Preparing audio…';
          Promise.resolve(hooks.narrate(step)).then(function (url) {
            btn.disabled = false; btn.textContent = old; if (disposed) return;
            if (!url) { speakDevice(step); return; }
            var a = audio = new Audio(url), p = a.play();
            if (p && p.catch) p.catch(function () { if (audio === a) { audio = null; speakDevice(step); } });
          }, function () { btn.disabled = false; btn.textContent = old; speakDevice(step); });
        } else speakDevice(step);
      }
      if (panes.tour) {
        var readAloud = el('input', { type: 'checkbox', id: 'gb-aloud' });
        var playTour = el('button', { type: 'button', 'class': 'gb-btn gb-primary' }, 'Play tour');
        var tourList = el('ol', { 'class': 'gb-tour' });
        lesson.tour.forEach(function (st, i) {
          var li = el('li', { 'class': 'gb-step', id: 'gb-step-' + st.id }, el('h3', {}, st.title), el('p', {}, rich(st.text)));
          var btns = el('div', { 'class': 'gb-row' }, model ? el('button', { type: 'button', 'class': 'gb-btn', onclick: function () { if (tourPlaying) { tourPlaying = false; playTour.textContent = 'Play tour'; stopAudio(); } showStep(st); } }, 'Show me') : null);
          var lb = el('button', { type: 'button', 'class': 'gb-btn', onclick: function () { listen(st, lb, false); } }, hooks.narrate ? 'Listen' : 'Listen (device voice)');
          btns.appendChild(lb);
          if (hooks.narrate) { var db = el('button', { type: 'button', 'class': 'gb-btn gb-btn-quiet', onclick: function () { listen(st, db, true); } }, 'Device voice (free)'); btns.appendChild(db); }
          li.appendChild(btns); stepEls[st.id] = li; tourList.appendChild(li);
        });
        playTour.addEventListener('click', function () {
          if (tourPlaying) { tourPlaying = false; playTour.textContent = 'Play tour'; stopAudio(); return; }
          tourPlaying = true; playTour.textContent = 'Stop tour'; var i = 0;
          (function next() {
            if (!tourPlaying || disposed) return;
            if (i >= lesson.tour.length) { tourPlaying = false; playTour.textContent = 'Play tour'; return; }
            var st = lesson.tour[i++]; showStep(st); stepEls[st.id].scrollIntoView({ block: 'nearest' });
            var wait = Math.max(5500, st.text.length * 55);
            if (readAloud.checked) speakDevice(st, function () { later(next, 900); }); else later(next, wait);
          })();
        });
        panes.tour.appendChild(el('div', { 'class': 'gb-row gb-tourbar' }, model ? playTour : null, model && hasDeviceVoice() ? el('label', { 'class': 'gb-inline', 'for': 'gb-aloud' }, readAloud, ' Read aloud (device voice)') : null));
        panes.tour.appendChild(tourList);
      }

      // ---- predict
      if (panes.predict) {
        var score = { right: 0, done: 0 }, scoreEl = el('p', { 'class': 'gb-score', 'aria-live': 'polite' }, '');
        function labels(p) { var o = p.options || {}; return { increases: o.increases || 'It increases', decreases: o.decreases || 'It decreases', same: o.same || 'It stays the same' }; }
        lesson.predictions.forEach(function (p, idx) {
          var name = 'gb-pred-' + p.id, lab = labels(p), out = el('div', { 'class': 'gb-reveal', 'aria-live': 'polite' }), chosen = null;
          var opts2 = ['increases', 'decreases', 'same'].map(function (k) {
            var r = el('input', { type: 'radio', name: name, value: k, id: name + '-' + k });
            r.addEventListener('change', function () { chosen = k; lock.disabled = false; });
            return el('label', { 'class': 'gb-opt', 'for': name + '-' + k }, r, ' ' + lab[k]);
          });
          var lock = el('button', { type: 'button', 'class': 'gb-btn gb-primary', disabled: true }, 'Lock in my prediction');
          var card = el('fieldset', { 'class': 'gb-pcard' }, el('legend', {}, 'Question ' + (idx + 1)), el('p', { 'class': 'gb-q' }, p.question), el('div', { 'class': 'gb-opts' }, opts2), lock, out);
          lock.addEventListener('click', function () {
            lock.disabled = true; opts2.forEach(function (o) { o.querySelector('input').disabled = true; });
            out.textContent = ''; out.appendChild(el('p', { 'class': 'gb-running' }, 'Running the experiment…'));
            var ex = p.experiment, A = Object.assign(model.defaults(), ex.from || {}), B = Object.assign({}, A, ex.to || {});
            player.pause(); player.highlight([]);
            function reveal() {
              var r = G.Sim.runExperiment(model, ex), u = ex.unit ? ' ' + ex.unit : '', ratio = r.a !== 0 && isFinite(r.a) && isFinite(r.b) ? ' (×' + U.fmt(r.b / r.a, 2) + ')' : '';
              var right = chosen === r.verdict; score.done++; if (right) score.right++;
              var word = { increases: 'it increases', decreases: 'it decreases', same: 'it stays about the same' };
              out.textContent = '';
              out.appendChild(el('p', { 'class': 'gb-verdict ' + (right ? 'gb-right' : 'gb-wrong') }, 'You predicted ' + (lab[chosen] || chosen).toLowerCase() + '. The simulation says ' + word[r.verdict] + '.'));
              out.appendChild(el('p', { 'class': 'gb-measure' }, (ex.label || ex.measure) + ': ' + U.fmt(r.a, 3) + u + ' → ' + U.fmt(r.b, 3) + u + ratio));
              out.appendChild(el('p', {}, rich(p.explanation)));
              if (p.correctedBySim) out.appendChild(el('p', { 'class': 'gb-note-corrected' }, "The AI's original answer key disagreed with its own simulation; this answer comes from running the simulation."));
              out.appendChild(el('p', { 'class': 'gb-hint' }, 'Try it yourself: the sliders are now at the “to” settings.'));
              scoreEl.textContent = score.right + ' of ' + lesson.predictions.length + ' predictions right' + (score.done < lesson.predictions.length ? ' so far' : '');
              if (model.kind === 'ode') player.play();
            }
            player.setParams(A, { animateMs: 600, onDone: function () { later(function () { player.setParams(B, { animateMs: 900, onDone: reveal }); }, reduced ? 100 : 1000); } });
          });
          panes.predict.appendChild(card);
        });
        panes.predict.appendChild(scoreEl);
      }

      // ---- equations
      if (panes.equations) {
        var eq = el('div', { 'class': 'gb-eqs' });
        eq.appendChild(el('p', { 'class': 'gb-hint' }, 'These are the exact equations the simulation runs.'));
        var sim = lesson.sim;
        if (sim.state.length) { eq.appendChild(el('h3', {}, 'How things change')); sim.state.forEach(function (s) { eq.appendChild(el('div', { 'class': 'gb-eq' }, el('code', {}, 'd' + s.id + '/dt = ' + pretty(s.rate)), el('span', { 'class': 'gb-eqnote' }, s.label + (s.unit ? ' (' + s.unit + ')' : '') + ', starts at ' + pretty(s.initial)))); }); }
        if (sim.derived.length) { eq.appendChild(el('h3', {}, 'Calculated values')); sim.derived.forEach(function (d) { eq.appendChild(el('div', { 'class': 'gb-eq' }, el('code', {}, d.id + ' = ' + pretty(d.expr)), el('span', { 'class': 'gb-eqnote' }, d.label + (d.unit ? ' (' + d.unit + ')' : '')))); }); }
        if (sim.constants.length) { eq.appendChild(el('h3', {}, 'Constants')); sim.constants.forEach(function (c) { eq.appendChild(el('div', { 'class': 'gb-eq' }, el('code', {}, c.id + ' = ' + c.value), el('span', { 'class': 'gb-eqnote' }, c.label + (c.unit ? ' (' + c.unit + ')' : '')))); }); }
        eq.appendChild(el('h3', {}, 'Sliders'));
        sim.params.forEach(function (p) { eq.appendChild(el('div', { 'class': 'gb-eq' }, el('code', {}, p.id + ' ∈ [' + p.min + ', ' + p.max + ']'), el('span', { 'class': 'gb-eqnote' }, p.label + (p.unit ? ' (' + p.unit + ')' : '')))); });
        panes.equations.appendChild(eq);
      }

      // ---- sources & checks
      (function () {
        var p = panes.checks;
        p.appendChild(el('h3', {}, 'How this lesson was checked')); V.renderChecks(p, lesson, report, critic);
        if (lesson.claims.length) {
          p.appendChild(el('h3', {}, 'Key claims'));
          var tb = el('table', { 'class': 'gb-claims' }, el('thead', {}, el('tr', {}, el('th', {}, 'Claim'), el('th', {}, 'Certainty'), el('th', {}, 'Sources'))));
          var body = el('tbody', {});
          lesson.claims.forEach(function (c) { body.appendChild(el('tr', {}, el('td', {}, c.text), el('td', {}, el('span', { 'class': 'gb-badge gb-badge-' + c.certainty }, c.certainty)), el('td', {}, (c.sources || []).length ? (c.sources || []).map(function (s) { return el('button', { type: 'button', 'class': 'gb-cite', onclick: function () { openSource(s); } }, s); }) : '–'))); });
          tb.appendChild(body); p.appendChild(el('div', { 'class': 'gb-tablewrap' }, tb));
        }
        p.appendChild(el('h3', {}, 'Sources'));
        if (lesson.sources.length) {
          var ol = el('ol', { 'class': 'gb-sources' });
          lesson.sources.forEach(function (s) {
            var title = WIKI_RE.test(s.url || '') ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title) : el('span', {}, s.title);
            ol.appendChild(el('li', { id: 'gb-src-' + s.id }, el('strong', {}, s.id + ' '), title, el('span', { 'class': 'gb-hint' }, ' · ' + (s.publisher || '') + (s.retrieved ? ' · retrieved ' + s.retrieved : '')),
              (s.excerpt || s.supports) ? el('details', {}, el('summary', {}, s.excerpt ? 'Retrieved excerpt' : 'What it supports'), el('p', {}, s.excerpt || s.supports)) : null));
          });
          p.appendChild(ol);
        } else p.appendChild(el('p', { 'class': 'gb-hint' }, 'No external sources are attached to this lesson.'));
        if (critic) {
          p.appendChild(el('h3', {}, 'Reviewer notes'));
          if (!critic.issues.length) p.appendChild(el('p', {}, 'The reviewer found no problems.'));
          else p.appendChild(el('ul', { 'class': 'gb-notes' }, critic.issues.map(function (i) { return el('li', {}, el('span', { 'class': 'gb-badge gb-badge-' + (i.severity === 'major' ? 'uncertain' : 'textbook') }, i.severity), ' ', el('strong', {}, i.target + ': '), i.problem, i.fix ? el('div', { 'class': 'gb-hint' }, 'Suggested fix: ' + i.fix) : null); })));
        }
        var retrieved = lesson.sources[0] && lesson.sources[0].retrieved ? lesson.sources[0].retrieved : (meta.createdAt || '').slice(0, 10);
        p.appendChild(el('p', { 'class': 'gb-stance' }, 'Glassbox lessons are written by AI models and can be wrong. Every simulation passes automatic checks and a second model reviews the lesson, but neither replaces your judgment. Sources are Wikipedia articles as retrieved' + (retrieved ? ' on ' + retrieved : '') + "; claims marked 'textbook' cite no source."));
      })();

      // ---- glossary / misconceptions
      if (panes.glossary) panes.glossary.appendChild(el('dl', { 'class': 'gb-gloss' }, lesson.glossary.map(function (g) { return [el('dt', {}, g.term), el('dd', {}, g.definition)]; })));
      if (panes.misc) panes.misc.appendChild(el('ul', { 'class': 'gb-misc' }, lesson.misconceptions.map(function (m) { return el('li', {}, el('p', { 'class': 'gb-wrongtxt' }, el('strong', {}, 'Common mistake: '), m.wrong), el('p', {}, el('strong', {}, 'Instead: '), rich(m.right))); })));

      // ---- what if (optional)
      if (hooks.whatIf && model) {
        var qIn = el('input', { type: 'text', maxlength: '200', id: 'gb-wi', placeholder: 'e.g. What if gravity were like Mars?' }), wiOut = el('p', { 'class': 'gb-hint', 'aria-live': 'polite' });
        var go = el('button', { type: 'button', 'class': 'gb-btn' }, 'Try it');
        go.addEventListener('click', function () {
          if (!qIn.value.trim()) return; go.disabled = true; wiOut.textContent = 'Thinking…';
          Promise.resolve(hooks.whatIf(qIn.value.trim(), player.getParams())).then(function (r) {
            go.disabled = false; if (!r) { wiOut.textContent = ''; return; }
            if (r.outOfModel) { wiOut.textContent = r.note || "This simulation can't represent that question."; return; }
            player.setParams(r.set || {}, { animateMs: 700 }); wiOut.textContent = r.say || '';
          }, function (e) { go.disabled = false; wiOut.textContent = e && e.message ? e.message : 'That did not work.'; });
        });
        panel.appendChild(el('section', { 'class': 'gb-card' }, el('h2', {}, 'What if…?'), el('label', { 'for': 'gb-wi', 'class': 'gb-hint' }, 'Ask the model to set the sliders for a question (uses a little Pollen).'), qIn, go, wiOut));
      }

      // ---- action bar
      if (mode === 'app' && (hooks.export || hooks.buildAnother)) {
        root.appendChild(el('div', { 'class': 'gb-actions' },
          hooks.export ? el('button', { type: 'button', 'class': 'gb-btn', onclick: function () { hooks.export('html'); } }, 'Download as offline HTML') : null,
          hooks.export ? el('button', { type: 'button', 'class': 'gb-btn', onclick: function () { hooks.export('json'); } }, 'Download lesson data (.json)') : null,
          hooks.buildAnother ? el('button', { type: 'button', 'class': 'gb-btn', onclick: hooks.buildAnother }, 'Build another') : null));
      }

      selectTab(tabDefs[0].id);
      if (player && model.kind === 'ode' && !reduced && opts.autoplay !== false) player.play();
      var api = {
        player: player, selectTab: selectTab, showStep: showStep, openSource: openSource,
        destroy: function () { disposed = true; timers.forEach(clearTimeout); stopAudio(); if (player) player.destroy(); root.textContent = ''; }
      };
      return api;
    };

    G.View = V;
  }
  G.__player = G.__player || {};
  G.__player.view = install;
  install(G);
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
