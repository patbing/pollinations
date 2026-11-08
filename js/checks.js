/* Glassbox.Checks: runs a lesson through the simulation and reports problems the model can be asked to repair.
 * Deterministic: parameter sets come from mulberry32(seed). */
(function (G) {
  'use strict';
  var Checks = {};
  var Sim = null, S = null, U = null, E = null;
  function deps() { Sim = G.Sim; S = G.Schema; U = G.Util; E = G.Expr; }

  function mk(level, code, path, message, hint, data) { var o = { level: level, code: code, path: path, message: message, hint: hint || '' }; if (data) o.data = data; return o; }
  function fmtSet(p) { return Object.keys(p).map(function (k) { return k + '=' + U.fmt(p[k]); }).join(', '); }
  Checks.CORE_CODES = ['SCHEMA_REQUIRED', 'SCHEMA_ENUM', 'SCHEMA_ID', 'SCHEMA_DUP', 'SCHEMA_NUMBER', 'SCHEMA_RANGE', 'KIND_MISMATCH', 'DT_RANGE', 'DERIVED_CYCLE'];

  // ids a (compiled) expression ultimately depends on, expanding state through its rate/initial expressions
  function closure(model, c) {
    var out = {}, stack = Object.keys(model.depsOfExpr(c));
    while (stack.length) {
      var id = stack.pop(); if (out[id]) continue; out[id] = true;
      if (model.stateDeps[id]) Object.keys(model.stateDeps[id]).forEach(function (k) { if (!out[k]) stack.push(k); });
    }
    return out;
  }

  function sampleSets(model, seed) {
    var rng = U.mulberry32(seed || 1), sets = [], def = model.defaults(), ps = model.paramList;
    sets.push(Object.assign({}, def));
    ps.forEach(function (p) { for (var i = 0; i < 5; i++) { var s = Object.assign({}, def); s[p.id] = p.min + (p.max - p.min) * i / 4; sets.push(s); } });
    for (var k = 0; k < 30; k++) { var s2 = {}; ps.forEach(function (p) { s2[p.id] = p.min + (p.max - p.min) * rng(); }); sets.push(s2); }
    return sets;
  }

  Checks.run = function (lesson, opts) {
    deps(); opts = opts || {};
    var issues = Schema_validate(lesson), report = { issues: issues, runs: 0, sets: 0, experiments: {}, deadSliders: [], ok: false, errors: 0, warnings: 0 };
    var sim = lesson.sim, model = null;
    var groundedIds = opts.groundedIds || (lesson.sources || []).map(function (s) { return s.id; });

    // ---- citations (independent of sim)
    var known = {}; groundedIds.forEach(function (i) { known[i] = true; });
    function scanCites(text, path) {
      (String(text || '').match(/\[S\d+\]/g) || []).forEach(function (m) { var id = m.slice(1, -1); if (!known[id]) issues.push(mk('error', 'CITE_UNKNOWN', path, 'Cites ' + id + ', which is not in the provided sources', 'Cite only: ' + (groundedIds.join(', ') || 'none (remove citations)'), { id: id })); });
    }
    lesson.tour.forEach(function (t, i) { scanCites(t.text, 'tour[' + i + '].text'); });
    lesson.predictions.forEach(function (p, i) { scanCites(p.explanation, 'predictions[' + i + '].explanation'); });
    lesson.misconceptions.forEach(function (m, i) { scanCites(m.right, 'misconceptions[' + i + '].right'); });
    scanCites(lesson.summary, 'summary');
    lesson.claims.forEach(function (c, i) {
      (c.sources || []).forEach(function (id) { if (!known[id]) issues.push(mk('error', 'CITE_UNKNOWN', 'claims[' + i + '].sources', 'Claim cites ' + id + ', which is not in the provided sources', 'Cite only: ' + (groundedIds.join(', ') || 'none'), { id: id })); });
      if (!(c.sources || []).length && ['textbook', 'simplification', 'uncertain'].indexOf(c.certainty) < 0) issues.push(mk('info', 'CLAIM_UNSOURCED', 'claims[' + i + ']', 'Claim ' + c.id + ' has no source and is marked "' + c.certainty + '"'));
    });
    if (!groundedIds.length) issues.push(mk('warning', 'NO_SOURCES', 'sources', 'No sources are attached to this lesson'));
    if (lesson.level === 'teacher' && lesson.misconceptions.length < 2) issues.push(mk('warning', 'TEACHER_MISCONCEPTIONS', 'misconceptions', 'Teacher lessons should list at least 2 misconceptions'));

    if (!sim) { finish(); return report; }

    // ---- time / kind
    var dt = sim.time && sim.time.dt;
    if (!(dt >= 0.0005 && dt <= 0.1)) issues.push(mk('error', 'DT_RANGE', 'sim.time.dt', 'dt ' + dt + ' is outside [0.0005, 0.1]', 'Use a step between 0.0005 and 0.1 seconds'));
    if (sim.kind === 'static') {
      sim.charts.forEach(function (c, i) { if (c.type === 'time' || c.type === 'phase') issues.push(mk('error', 'KIND_MISMATCH', 'sim.charts[' + i + ']', 'A "' + c.type + '" chart needs kind "ode"', 'Use a "sweep" chart for static simulations')); });
    } else if (sim.time && sim.time.animateParam) issues.push(mk('error', 'KIND_MISMATCH', 'sim.time.animateParam', 'animateParam is only for kind "static"'));
    if (sim.time && sim.time.animateParam && !sim.params.some(function (p) { return p.id === sim.time.animateParam.param; })) issues.push(mk('error', 'EXP_PARAM', 'sim.time.animateParam.param', 'animateParam.param is not a slider id'));

    // ---- compile
    var coreBad = issues.some(function (i) { return i.level === 'error' && Checks.CORE_CODES.indexOf(i.code) >= 0 && /^sim\./.test(i.path); });
    var comp = Sim.compile(JSON.parse(JSON.stringify(sim)));
    comp.issues.forEach(function (i) { issues.push(i); });
    model = comp.model;
    var compileBad = comp.issues.some(function (i) { return i.level === 'error'; });

    if (!compileBad) {
      // sweep must be static
      model.charts.forEach(function (cc, i) {
        if (cc.chart.type === 'sweep') cc.series.forEach(function (s, j) { if (model.isDynamic(s.c)) issues.push(mk('error', 'SWEEP_NOT_STATIC', 'sim.charts[' + i + '].series[' + j + '].expr', 'Sweep series "' + s.s.expr + '" depends on a state variable or t', 'Sweep charts can only plot values computed from sliders and constants')); });
      });
      // nothing moves
      if (sim.kind === 'ode') {
        var moves = model.shapes.some(function (cs) { return Object.keys(cs.f).some(function (k) { return model.isDynamic(cs.f[k]); }) || (cs.parts || []).some(function (p) { return p.c && model.isDynamic(p.c); }); });
        if (!moves) issues.push(mk('error', 'NOTHING_MOVES', 'sim.shapes', 'No shape depends on the state variables or t, so nothing will move', 'Make at least one shape position, size or count depend on a state variable'));
      }
      // dead sliders
      var used = {};
      function use(c) { Object.keys(closure(model, c)).forEach(function (k) { used[k] = true; }); }
      model.shapes.forEach(function (cs) { Object.keys(cs.f).forEach(function (k) { use(cs.f[k]); }); if (cs.visible) use(cs.visible); (cs.parts || []).forEach(function (p) { if (p.c) use(p.c); }); });
      model.charts.forEach(function (cc) { cc.series.forEach(function (s) { use(s.c); }); if (cc.xc) use(cc.xc); if (cc.yc) use(cc.yc); if (cc.chart.type === 'sweep') used[cc.chart.param] = true; });
      var rd = {}; sim.readouts.forEach(function (r) { rd[r] = true; });
      model.spec.derived.forEach(function (d) { if (rd[d.id]) use(d.c); });
      sim.state.forEach(function (s) { if (rd[s.id]) use({ ids: [s.id] }); });
      sim.params.forEach(function (p) { if (rd[p.id]) used[p.id] = true; });
      if (sim.time && sim.time.animateParam) used[sim.time.animateParam.param] = true;
      sim.params.forEach(function (p, i) { if (!used[p.id]) { report.deadSliders.push(p.id); issues.push(mk('warning', 'DEAD_SLIDER', 'sim.params[' + i + ']', 'Slider "' + p.id + '" does not change any shape, chart or readout', 'Use it in a shape, a chart series or a readout')); } });

      // sampling
      var sets = sampleSets(model, opts.seed || 1), seconds = Math.min((sim.time && sim.time.duration) || 20, 20), nonfinite = {}, nfSets = 0, huge = {}, off = {}, offTotal = 0, offCount = {};
      var view = sim.view || { xmin: -5, xmax: 5, ymin: -3, ymax: 3 }; // same default as the player
      sets.forEach(function (ps, si) {
        var samples, unstable = false;
        if (sim.kind === 'static') { samples = [Sim.staticEnv(model, ps)]; }
        else { var r = Sim.sampleRun(model, ps, seconds, 20); samples = r.samples; unstable = r.unstable; }
        report.runs += samples.length; report.sets++;
        var bad = unstable ? [{ path: 'sim.state', what: 'the state variables became non-finite (unstable)' }] : [];
        samples.forEach(function (env) {
          sim.derived.forEach(function (d, i) { var v = env[d.id]; if (!isFinite(v)) { if (!bad.some(function (b) { return b.path === 'sim.derived[' + i + '].expr'; })) bad.push({ path: 'sim.derived[' + i + '].expr', what: '"' + d.expr + '" is not a finite number' }); } else if (Math.abs(v) > 1e9) huge['sim.derived[' + i + '].expr'] = d.expr; });
          sim.state.forEach(function (s, i) { var v = env[s.id]; if (!isFinite(v)) { if (!bad.some(function (b) { return b.path === 'sim.state[' + i + '].rate'; })) bad.push({ path: 'sim.state[' + i + '].rate', what: 'state "' + s.id + '" is not finite' }); } else if (Math.abs(v) > 1e9) huge['sim.state[' + i + '].rate'] = s.rate; });
          model.shapes.forEach(function (cs, i) {
            var v = Sim.evalShape(cs, env); if (!v) return;
            if (v.bad) { var p = 'sim.shapes[' + i + '].' + v.bad; if (!bad.some(function (b) { return b.path === p; })) bad.push({ path: p, what: 'shape "' + cs.id + '" field ' + v.bad + ' ("' + cs.shape[v.bad] + '") is not finite' }); return; }
            var ax = v.x !== undefined ? v.x : v.x1, ay = v.y !== undefined ? v.y : v.y1;
            if (ax !== undefined && ay !== undefined && cs.type !== 'particles') {
              offTotal++; var mx = (view.xmax - view.xmin) * 0.5, my = (view.ymax - view.ymin) * 0.5;
              if (ax < view.xmin - mx || ax > view.xmax + mx || ay < view.ymin - my || ay > view.ymax + my) offCount[cs.id] = (offCount[cs.id] || 0) + 1;
            }
          });
        });
        if (bad.length) { nfSets++; bad.forEach(function (b) { if (!nonfinite[b.path]) nonfinite[b.path] = { what: b.what, set: ps, first: si === 0 }; if (si === 0) nonfinite[b.path].first = true; }); }
      });
      Object.keys(nonfinite).forEach(function (path) {
        var n = nonfinite[path];
        if (n.first || nfSets / sets.length > 0.02) issues.push(mk('error', 'NONFINITE', path, 'Invalid number: ' + n.what + (n.first ? ' at default slider values' : ' for settings such as ' + fmtSet(n.set)), 'Avoid division by zero and square roots of negatives, or narrow the slider ranges'));
        else issues.push(mk('warning', 'NONFINITE', path, 'Rarely invalid: ' + n.what + ' for settings such as ' + fmtSet(n.set)));
      });
      Object.keys(huge).forEach(function (path) { issues.push(mk('warning', 'HUGE_VALUE', path, 'Values above 1e9 appear in "' + huge[path] + '"', 'Check the units or narrow the slider ranges')); });
      Object.keys(offCount).forEach(function (id) { var share = offCount[id] / Math.max(1, report.runs); if (share > 0.3) issues.push(mk('warning', 'OFF_VIEW', 'sim.shapes', 'Shape "' + id + '" is outside the view in ' + Math.round(share * 100) + '% of samples', 'Move it, or widen "view"')); });
    }

    // ---- tour / experiments
    var pmap = Object.create(null); sim.params.forEach(function (p) { pmap[p.id] = p; });
    lesson.tour.forEach(function (t, i) {
      Object.keys(t.set || {}).forEach(function (k) {
        var p = pmap[k];
        if (!p) issues.push(mk('error', 'TOUR_SET', 'tour[' + i + '].set', 'Tour step "' + t.id + '" sets unknown slider "' + k + '"', 'Sliders: ' + Object.keys(pmap).join(', '), { key: k }));
        else if (t.set[k] < p.min || t.set[k] > p.max) issues.push(mk('error', 'TOUR_SET', 'tour[' + i + '].set', 'Tour step "' + t.id + '" sets ' + k + ' = ' + t.set[k] + ', outside [' + p.min + ', ' + p.max + ']', '', { key: k }));
      });
      var shapeIds = Object.create(null); sim.shapes.forEach(function (s) { shapeIds[s.id] = true; });
      (t.highlight || []).forEach(function (h) { if (!shapeIds[h]) issues.push(mk('warning', 'TOUR_HIGHLIGHT', 'tour[' + i + '].highlight', 'Tour step "' + t.id + '" highlights unknown shape "' + h + '"', 'Shape ids: ' + Object.keys(shapeIds).join(', '), { id: h })); });
    });
    lesson.predictions.forEach(function (p, i) {
      var path = 'predictions[' + i + '].experiment', ex = p.experiment, bad = false;
      ['from', 'to'].forEach(function (side) {
        Object.keys(ex[side] || {}).forEach(function (k) {
          var pr = pmap[k];
          if (!pr) { bad = true; issues.push(mk('error', 'EXP_PARAM', path + '.' + side, 'Prediction ' + p.id + ' uses unknown slider "' + k + '"', 'Sliders: ' + Object.keys(pmap).join(', '))); }
          else if (ex[side][k] < pr.min || ex[side][k] > pr.max) { bad = true; issues.push(mk('error', 'EXP_PARAM', path + '.' + side, 'Prediction ' + p.id + ' sets ' + k + ' = ' + ex[side][k] + ', outside [' + pr.min + ', ' + pr.max + ']')); }
        });
      });
      var same = JSON.stringify(ex.from || {}) === JSON.stringify(ex.to || {});
      if (same) issues.push(mk('warning', 'PREDICTION_TRIVIAL', path, 'Prediction ' + p.id + ' compares identical settings'));
      if (bad || !model || compileBad) return;
      try {
        var r = Sim.runExperiment(model, ex), ok = isFinite(r.a) && isFinite(r.b);
        if (!ok) { issues.push(mk('error', 'NONFINITE', path + '.measure', 'Prediction ' + p.id + ' measure "' + ex.measure + '" is not finite (' + r.a + ' -> ' + r.b + ')')); return; }
        var m = r.verdict === p.answer;
        report.experiments[p.id] = { a: r.a, b: r.b, verdict: r.verdict, matches: m };
        if (!m && !same) issues.push(mk('error', 'PREDICTION_MISMATCH', 'predictions[' + i + ']', 'Prediction ' + p.id + ' says "' + p.answer + '" but the simulation gives ' + (ex.label || ex.measure) + ': ' + U.fmt(r.a, 3) + ' -> ' + U.fmt(r.b, 3) + ' (' + r.verdict + ')', 'Fix the experiment or the answer; the answer must match what the simulation does.', { verdict: r.verdict, a: r.a, b: r.b }));
      } catch (e) {
        issues.push(mk('error', e.code || 'EXPR_PARSE', path + '.measure', 'Prediction ' + p.id + ' measure "' + String(ex.measure).slice(0, 60) + '": ' + e.message, 'Known names: ' + Object.keys(model.names).join(', ')));
      }
    });
    finish();
    return report;

    function finish() {
      // dedupe identical issues
      var seen = {}; report.issues = issues.filter(function (i) { var k = i.code + '|' + i.path + '|' + i.message; if (seen[k]) return false; seen[k] = true; return true; });
      report.errors = report.issues.filter(function (i) { return i.level === 'error'; }).length;
      report.warnings = report.issues.filter(function (i) { return i.level === 'warning'; }).length;
      report.ok = report.errors === 0;
    }
  };
  function Schema_validate(lesson) { return G.Schema.validate(lesson); }

  // ------------------------------------------------------------------ local fallback
  function stripCites(text, known) { return String(text || '').replace(/\s*\[S\d+\]/g, function (m) { var id = m.trim().slice(1, -1); return known[id] ? m : ''; }); }

  Checks.applyLocalFixes = function (lesson0, report0, opts) {
    deps(); opts = opts || {};
    var L = JSON.parse(JSON.stringify(lesson0)), removed = [];
    // re-check the normalized lesson itself: report0 may carry normalization issues whose indices refer to the raw
    // draft (e.g. a shape with an unknown type was already dropped, so "sim.shapes[3]" would hit the wrong shape)
    var report = Checks.run(L, { groundedIds: opts.groundedIds });
    var known = {}; (L.sources || []).forEach(function (s) { known[s.id] = true; });
    if (opts.groundedIds) { known = {}; opts.groundedIds.forEach(function (i) { known[i] = true; }); }
    function note(s) { if (removed.indexOf(s) < 0) removed.push(s); }

    for (var round = 0; round < 4; round++) {
      var errs = report.issues.filter(function (i) { return i.level === 'error'; });
      if (!errs.length) break;
      var dropShapes = {}, dropCharts = {}, dropReadouts = {}, dropPreds = {}, progress = false;
      errs.forEach(function (i) {
        var m;
        if (i.code === 'CITE_UNKNOWN') {
          L.tour.forEach(function (t) { t.text = stripCites(t.text, known); });
          L.predictions.forEach(function (p) { p.explanation = stripCites(p.explanation, known); });
          L.misconceptions.forEach(function (x) { x.right = stripCites(x.right, known); });
          L.summary = stripCites(L.summary, known);
          L.claims.forEach(function (c) { c.sources = (c.sources || []).filter(function (s) { return known[s]; }); });
          progress = true; note('unsupported citations');
        } else if (i.code === 'DT_RANGE' && L.sim && L.sim.time) {
          L.sim.time.dt = Math.max(0.0005, Math.min(0.1, isFinite(L.sim.time.dt) ? L.sim.time.dt : 0.01)); progress = true; note('an out-of-range time step (clamped)');
        } else if (/^sim\.time\.animateParam/.test(i.path) && L.sim && L.sim.time) {
          delete L.sim.time.animateParam; progress = true; note('an invalid slider animation');
        } else if (i.path === 'sim.view' && i.code === 'SCHEMA_RANGE' && L.sim) {
          delete L.sim.view; progress = true; note('an invalid view (default used)');
        } else if (i.code === 'TOUR_SET') {
          L.tour.forEach(function (t) { if (i.data && i.data.key !== undefined) delete t.set[i.data.key]; }); progress = true; note('invalid tour settings');
        } else if (i.code === 'PREDICTION_MISMATCH' && (m = /^predictions\[(\d+)\]/.exec(i.path)) && i.data) {
          var p = L.predictions[+m[1]]; p.answer = i.data.verdict; p.correctedBySim = true; progress = true; note('prediction answers corrected by the simulation');
        } else if ((m = /^predictions\[(\d+)\]/.exec(i.path))) { dropPreds[+m[1]] = true; progress = true; note('a broken prediction'); }
        else if ((m = /^sim\.shapes\[(\d+)\]/.exec(i.path))) { dropShapes[+m[1]] = true; progress = true; note('a broken shape'); }
        else if ((m = /^sim\.charts\[(\d+)\]/.exec(i.path))) { dropCharts[+m[1]] = true; progress = true; note('a broken chart'); }
        else if ((m = /^sim\.readouts\[(\d+)\]/.exec(i.path))) { dropReadouts[+m[1]] = true; progress = true; note('a broken readout'); }
      });
      if (L.sim) {
        L.sim.shapes = L.sim.shapes.filter(function (s, i) { return !dropShapes[i]; });
        L.sim.charts = L.sim.charts.filter(function (s, i) { return !dropCharts[i]; });
        L.sim.readouts = L.sim.readouts.filter(function (s, i) { return !dropReadouts[i]; });
      }
      L.predictions = L.predictions.filter(function (p, i) { return !dropPreds[i]; });
      if (!progress) break;
      report = Checks.run(L, { groundedIds: opts.groundedIds });
    }
    // sim core still broken, or nothing left to show: relationship explorer
    var coreErr = report.issues.some(function (i) { return i.level === 'error' && /^sim\./.test(i.path) && i.code !== 'TOUR_SET'; }) || report.issues.some(function (i) { return i.level === 'error' && i.code === 'NOTHING_MOVES'; });
    var empty = L.sim && !L.sim.shapes.length && !L.sim.charts.length;
    if (L.sim && (coreErr || empty)) {
      var res = buildExplorer(L); L = res.lesson; note(res.mode === 'explorer' ? 'the simulation (replaced by a relationship explorer)' : 'the simulation');
      report = Checks.run(L, { groundedIds: opts.groundedIds });
      // prune what still fails
      var guard = 0;
      while (report.errors && guard++ < 3) {
        var again = Checks.applyLocalFixes.prune(L, report, known, note); L = again; report = Checks.run(L, { groundedIds: opts.groundedIds });
      }
    }
    return { lesson: L, removed: removed, report: report };
  };
  Checks.applyLocalFixes.prune = function (L, report, known, note) {
    var dropP = {};
    report.issues.filter(function (i) { return i.level === 'error'; }).forEach(function (i) {
      var m;
      if ((m = /^predictions\[(\d+)\]/.exec(i.path))) { if (i.code === 'PREDICTION_MISMATCH' && i.data) { L.predictions[+m[1]].answer = i.data.verdict; L.predictions[+m[1]].correctedBySim = true; } else dropP[+m[1]] = true; }
      else if (i.code === 'TOUR_SET' && i.data) { L.tour.forEach(function (t) { delete t.set[i.data.key]; }); }
      else if (i.code === 'CITE_UNKNOWN') { L.tour.forEach(function (t) { t.text = stripCites(t.text, known); }); L.predictions.forEach(function (p) { p.explanation = stripCites(p.explanation, known); }); L.misconceptions.forEach(function (x) { x.right = stripCites(x.right, known); }); L.claims.forEach(function (c) { c.sources = (c.sources || []).filter(function (s) { return known[s]; }); }); }
    });
    L.predictions = L.predictions.filter(function (p, i) { return !dropP[i]; });
    return L;
  };

  function buildExplorer(L) {
    var sim = L.sim || {}, params = (sim.params || []).filter(function (p) { return S.ID_RE.test(p.id || '') && isFinite(p.min) && isFinite(p.max) && p.min < p.max && p.step > 0 && p.value >= p.min && p.value <= p.max; }).slice(0, 6);
    var ids = {}; params.forEach(function (p) { ids[p.id] = 1; });
    var consts = (sim.constants || []).filter(function (c) { return S.ID_RE.test(c.id || '') && isFinite(c.value) && !ids[c.id]; });
    consts.forEach(function (c) { ids[c.id] = 1; });
    var keep = [], changed = true, cand = (sim.derived || []).filter(function (d) { return S.ID_RE.test(d.id || '') && !ids[d.id]; });
    while (changed) {
      changed = false;
      cand.forEach(function (d) {
        if (keep.indexOf(d) >= 0) return;
        try {
          var parsed = E.parse(d.expr), okIds = parsed.ids.every(function (x) { return ids[x] && x !== 't'; });
          if (!okIds) return;
          var env = Object.create(null); consts.forEach(function (c) { env[c.id] = c.value; }); params.forEach(function (p) { env[p.id] = p.value; });
          keep.forEach(function (k) { env[k.id] = E.compile(E.parse(k.expr).ast)(env); });
          var v = E.compile(parsed.ast)(env); if (!isFinite(v)) return;
          keep.push(d); ids[d.id] = 1; changed = true;
        } catch (e) { /* skip */ }
      });
    }
    var out = JSON.parse(JSON.stringify(L)), meta = out.meta = out.meta || {};
    if (!keep.length || !params.length) { out.sim = null; out.tour = []; out.predictions = []; meta.simFallback = 'none'; return { lesson: out, mode: 'none' }; }
    var firstDerived = keep[0], dparam = params[0];
    for (var i = 0; i < params.length; i++) { try { var pd = E.parse(firstDerived.expr).ids; if (pd.indexOf(params[i].id) >= 0 || keep.some(function (k) { return E.parse(k.expr).ids.indexOf(params[i].id) >= 0; })) { dparam = params[i]; break; } } catch (e) { } }
    out.sim = { kind: 'static', params: params, constants: consts, state: [], derived: keep, time: { dt: 0.01, speed: 1, duration: 60, resetOn: 'paramChange' }, view: { xmin: -5, xmax: 5, ymin: -3, ymax: 3, grid: false }, shapes: [],
      charts: [{ id: 'explore', type: 'sweep', title: firstDerived.label + ' vs ' + dparam.label, param: dparam.id, samples: 60, series: [{ expr: firstDerived.id, label: firstDerived.label, unit: firstDerived.unit || '', color: 'accent' }] }],
      readouts: keep.slice(0, 4).map(function (d) { return d.id; }) };
    out.tour = (out.tour || []).map(function (t) { t.highlight = []; return t; });
    meta.simFallback = 'explorer';
    return { lesson: out, mode: 'explorer' };
  }

  G.Checks = Checks;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
