/* Glassbox.Sim: compiles a SimSpec, runs it (RK4), measures it, and draws it on canvas.
 * Player module (inlined into exports). Never executes model-written code: only the whitelisted Expr language. */
(function (G) {
  'use strict';
  function install(G) {
    var Sim = {};
    var Expr = G.Expr, U = G.Util, S = G.Schema;
    var SHAPE_FIELDS = S.SHAPE_FIELDS;

    // ------------------------------------------------------------------ compile
    function mkIssue(level, code, path, message, hint) { return { level: level, code: code, path: path, message: message, hint: hint || '' }; }

    // Returns {model, issues}. Expressions that fail to compile are reported and replaced by NaN functions.
    Sim.compile = function (spec) {
      var issues = [];
      var model = { spec: spec, kind: spec.kind, params: Object.create(null), paramList: spec.params, constants: {}, stateList: spec.state, derivedList: spec.derived, order: [], exprs: [] };
      var names = Object.create(null); // null prototype: ids like "constructor" must not look known
      spec.params.forEach(function (p) { names[p.id] = 'param'; model.params[p.id] = p; });
      spec.constants.forEach(function (c) { names[c.id] = 'const'; model.constants[c.id] = c.value; });
      spec.state.forEach(function (s) { names[s.id] = 'state'; });
      spec.derived.forEach(function (d) { names[d.id] = 'derived'; });
      names.t = 'time';
      var known = Object.keys(names).filter(function (n) { return n !== 't'; }).concat(['t']);
      model.names = names;
      var NAN = function () { return NaN; };

      // compile one expression; scope = which kinds of names are visible
      function comp(src, path, ctx) {
        var parsed;
        try { parsed = Expr.parse(src); } catch (e) {
          issues.push(mkIssue('error', e.code || 'EXPR_PARSE', path, e.message + ' in "' + String(src).slice(0, 80) + '"', ''));
          return { fn: NAN, ids: [], bad: true, src: src };
        }
        var bad = false;
        parsed.ids.forEach(function (id) {
          if (!names[id] || (ctx === 'init' && names[id] === 'derived' && false)) {
            bad = true;
            issues.push(mkIssue('error', 'EXPR_UNKNOWN_ID', path, 'Unknown name "' + id + '" in "' + String(src).slice(0, 80) + '"',
              'Known names: ' + known.join(', ') + '. Functions: ' + Expr.FUNCTIONS.join(', ')));
          }
        });
        return { fn: bad ? NAN : Expr.compile(parsed.ast), ids: parsed.ids, ast: parsed.ast, bad: bad, src: src };
      }
      model.comp = comp;

      spec.state.forEach(function (s, i) {
        s.initialC = comp(s.initial, 'sim.state[' + i + '].initial', 'init');
        s.rateC = comp(s.rate, 'sim.state[' + i + '].rate', 'rate');
      });
      spec.derived.forEach(function (d, i) { d.c = comp(d.expr, 'sim.derived[' + i + '].expr', 'derived'); });

      // derived topological order
      var dmap = Object.create(null); spec.derived.forEach(function (d) { dmap[d.id] = d; });
      var mark = Object.create(null), order = [], cyc = false;
      function visit(d, stack) {
        if (mark[d.id] === 2) return;
        if (mark[d.id] === 1) { if (!cyc) issues.push(mkIssue('error', 'DERIVED_CYCLE', 'sim.derived', 'Derived values depend on each other in a loop: ' + stack.concat([d.id]).join(' -> '))); cyc = true; return; }
        mark[d.id] = 1;
        d.c.ids.forEach(function (id) { if (dmap[id]) visit(dmap[id], stack.concat([d.id])); });
        mark[d.id] = 2; order.push(d);
      }
      spec.derived.forEach(function (d) { visit(d, []); });
      model.order = order;

      // shapes
      model.shapes = spec.shapes.map(function (sh, i) {
        var base = 'sim.shapes[' + i + ']', c = { shape: sh, f: {}, id: sh.id, type: sh.type };
        (SHAPE_FIELDS[sh.type] || []).forEach(function (f) { if (sh[f] !== undefined) c.f[f] = comp(sh[f], base + '.' + f, 'shape'); });
        if (sh.visible !== undefined) c.visible = comp(sh.visible, base + '.visible', 'shape');
        if (sh.type === 'text') {
          c.parts = []; var re = /\{([^{}]+)\}/g, last = 0, m, txt = sh.text || '';
          while ((m = re.exec(txt))) {
            if (m.index > last) c.parts.push({ lit: txt.slice(last, m.index) });
            var inner = m[1], dm = /^(.*):(\d+)$/.exec(inner), digits = null;
            if (dm) { inner = dm[1]; digits = parseInt(dm[2], 10); }
            c.parts.push({ c: comp(inner, base + '.text', 'shape'), digits: digits });
            last = m.index + m[0].length;
          }
          if (last < txt.length) c.parts.push({ lit: txt.slice(last) });
        }
        return c;
      });
      // charts
      model.charts = spec.charts.map(function (ch, i) {
        var base = 'sim.charts[' + i + ']', c = { chart: ch, id: ch.id, series: [] };
        c.series = ch.series.map(function (s, j) { return { s: s, c: comp(s.expr, base + '.series[' + j + '].expr', 'chart') }; });
        if (ch.type === 'phase') { c.xc = comp(ch.x, base + '.x', 'chart'); c.yc = comp(ch.y, base + '.y', 'chart'); }
        if (ch.type === 'sweep' && !model.params[ch.param]) issues.push(mkIssue('error', 'SCHEMA_REF', base + '.param', 'Sweep chart param "' + ch.param + '" is not a param id', 'Params: ' + Object.keys(model.params).join(', ')));
        return c;
      });
      readoutsCheck();
      function readoutsCheck() {
        spec.readouts.forEach(function (r, i) { if (!names[r] || names[r] === 'time') issues.push(mkIssue('error', 'EXPR_UNKNOWN_ID', 'sim.readouts[' + i + ']', 'Readout "' + r + '" is not a param, state or derived id', 'Known names: ' + known.join(', '))); });
      }

      // dependency analysis: which base ids (params/state/t) does each name depend on?
      var deps = Object.create(null); // id -> {id:true}
      function depsOf(id, seen) {
        if (deps[id]) return deps[id];
        var out = {}; deps[id] = out; // cycle guard
        if (names[id] === 'derived') { (dmap[id].c.ids || []).forEach(function (x) { out[x] = true; var d2 = depsOf(x); Object.keys(d2).forEach(function (k) { out[k] = true; }); }); }
        return out;
      }
      model.depsOfExpr = function (c) {
        var out = {};
        (c.ids || []).forEach(function (x) { out[x] = true; var d = depsOf(x); Object.keys(d).forEach(function (k) { out[k] = true; }); });
        return out;
      };
      model.isDynamic = function (c) {
        var d = model.depsOfExpr(c);
        return Object.keys(d).some(function (k) { return names[k] === 'state' || k === 't'; });
      };
      // state rates also make state depend on params
      model.stateDeps = {};
      spec.state.forEach(function (s) { var d = model.depsOfExpr(s.rateC), d2 = model.depsOfExpr(s.initialC); var o = {}; Object.keys(d).concat(Object.keys(d2)).forEach(function (k) { o[k] = true; }); model.stateDeps[s.id] = o; });

      model.defaults = function () { var o = {}; spec.params.forEach(function (p) { o[p.id] = p.value; }); return o; };
      return { model: model, issues: issues };
    };

    Sim.build = function (spec) {
      var r = Sim.compile(spec);
      var errs = r.issues.filter(function (i) { return i.level === 'error'; });
      if (errs.length) { var e = new Error('Simulation spec has errors: ' + errs[0].message); e.issues = errs; throw e; }
      return r.model;
    };

    // ------------------------------------------------------------------ runtime
    Sim.createRuntime = function (model, params) {
      var spec = model.spec, st = spec.state, n = st.length, order = model.order;
      var env = Object.create(null);
      var rt = { model: model, env: env, t: 0, unstable: false, params: null };
      var y = new Float64Array(n), good = new Float64Array(n), acc = 0;
      var k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), tmp = new Float64Array(n);
      var dt = Math.max(0.0005, Math.min(0.1, spec.time.dt || 0.01));

      function setParams(p) {
        rt.params = Object.assign(model.defaults(), p || {});
        Object.keys(model.constants).forEach(function (k) { env[k] = model.constants[k]; });
        Object.keys(rt.params).forEach(function (k) { env[k] = rt.params[k]; });
      }
      function derive() { for (var i = 0; i < order.length; i++) env[order[i].id] = order[i].c.fn(env); }
      function f(yv, t, out) {
        for (var i = 0; i < n; i++) env[st[i].id] = yv[i];
        env.t = t; derive();
        for (var j = 0; j < n; j++) out[j] = st[j].rateC.fn(env);
      }
      rt.setParams = function (p) { setParams(p); derive(); };
      rt.reset = function (p) {
        if (p) setParams(p); else if (!rt.params) setParams({});
        rt.t = 0; acc = 0; rt.unstable = false; env.t = 0;
        for (var i = 0; i < n; i++) env[st[i].id] = 0;
        derive();
        for (var j = 0; j < n; j++) { y[j] = st[j].initialC.fn(env); env[st[j].id] = y[j]; }
        derive();
        good.set(y);
      };
      rt.stateOk = function () { for (var i = 0; i < n; i++) if (!isFinite(y[i])) return false; return true; };
      function rk4() {
        var h = dt, t = rt.t, i;
        f(y, t, k1);
        for (i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
        f(tmp, t + 0.5 * h, k2);
        for (i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
        f(tmp, t + 0.5 * h, k3);
        for (i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
        f(tmp, t + h, k4);
        for (i = 0; i < n; i++) y[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        rt.t = t + h;
      }
      // advance by `seconds` of simulated time (fixed dt, at most maxSteps per call)
      rt.step = function (seconds, maxSteps) {
        if (n === 0 || rt.unstable) return 0;
        acc += seconds; var steps = 0, cap = maxSteps || 2000;
        while (acc >= dt && steps < cap) {
          rk4(); acc -= dt; steps++;
          if (!rt.stateOk()) { y.set(good); rt.unstable = true; for (var i = 0; i < n; i++) env[st[i].id] = y[i]; env.t = rt.t; derive(); return steps; }
          if ((steps & 15) === 0) good.set(y);
        }
        if (steps >= cap) acc = 0; // drop backlog rather than spiral
        good.set(y);
        for (var j = 0; j < n; j++) env[st[j].id] = y[j];
        env.t = rt.t; derive();
        return steps;
      };
      rt.dt = dt;
      rt.reset(params);
      return rt;
    };

    // Environment for a static evaluation (no state): derived computed from params only.
    Sim.staticEnv = function (model, params) {
      var env = Object.create(null);
      Object.keys(model.constants).forEach(function (k) { env[k] = model.constants[k]; });
      var p = Object.assign(model.defaults(), params || {});
      Object.keys(p).forEach(function (k) { env[k] = p[k]; });
      env.t = 0;
      for (var i = 0; i < model.order.length; i++) env[model.order[i].id] = model.order[i].c.fn(env);
      return env;
    };

    // Evaluate an arbitrary expression string in the environment of a (re)set runtime.
    function evalIn(model, env, src) {
      var parsed = Expr.parse(src);
      return Expr.compile(parsed.ast)(env);
    }

    // Measure an expression: at t=0 (or static), or aggregate over [0, at.t].
    Sim.measure = function (model, params, expr, at) {
      var c = Expr.compile(Expr.parse(expr).ast);
      if (model.kind === 'static' || !at || !(at.t > 0)) {
        if (model.kind === 'static') return c(Sim.staticEnv(model, params));
        var rt0 = Sim.createRuntime(model, params); return c(rt0.env);
      }
      var rt = Sim.createRuntime(model, params);
      var T = Math.min(at.t, 600), samples = 400, chunk = T / samples, sum = 0, cnt = 0, mx = -Infinity, mn = Infinity, last = c(rt.env);
      if (isFinite(last)) { sum += last; cnt++; mx = last; mn = last; }
      // use a larger internal step when the horizon is long, so a measure stays under ~60,000 steps
      for (var i = 0; i < samples; i++) {
        rt.step(chunk, 20000);
        var v = c(rt.env); last = v;
        if (isFinite(v)) { sum += v; cnt++; if (v > mx) mx = v; if (v < mn) mn = v; }
        if (rt.unstable) break;
      }
      var agg = at.agg || 'final';
      if (agg !== 'final' && !cnt) return NaN;
      return agg === 'mean' ? sum / cnt : (agg === 'max' ? mx : (agg === 'min' ? mn : last));
    };

    Sim.verdict = function (a, b, tolerance) {
      var tol = (tolerance === undefined || tolerance === null ? 0.02 : tolerance) * Math.max(Math.abs(a), Math.abs(b)) + 1e-9;
      if (b - a > tol) return 'increases';
      if (a - b > tol) return 'decreases';
      return 'same';
    };

    Sim.runExperiment = function (model, exp) {
      var A = Object.assign(model.defaults(), exp.from || {}), B = Object.assign({}, A, exp.to || {});
      var expr = String(exp.measure);
      var a = Sim.measure(model, A, expr, exp.at), b = Sim.measure(model, B, expr, exp.at);
      return { a: a, b: b, verdict: Sim.verdict(a, b, exp.tolerance), A: A, B: B };
    };

    // Evaluate the numeric fields of a compiled shape in env. Returns null when hidden or not finite.
    Sim.evalShape = function (cs, env) {
      if (cs.visible) { var vis = cs.visible.fn(env); if (!vis) return null; }
      var o = {};
      var keys = Object.keys(cs.f);
      for (var i = 0; i < keys.length; i++) { var v = cs.f[keys[i]].fn(env); if (!isFinite(v)) return { bad: keys[i] }; o[keys[i]] = v; }
      if (cs.type === 'text') {
        var s = '';
        for (var j = 0; j < cs.parts.length; j++) { var p = cs.parts[j]; s += p.lit !== undefined ? p.lit : U.fmt(p.c.fn(env), p.digits); }
        o.text = s;
      }
      return o;
    };

    // Sweep samples for a chart: series values over the parameter's range at the other params' current values.
    Sim.sweep = function (model, cc, params) {
      var ch = cc.chart, p = model.params[ch.param]; if (!p) return [];
      var N = Math.max(20, Math.min(120, Math.round(ch.samples || 60))), out = cc.series.map(function () { return []; }), xs = [];
      var base = Object.assign(model.defaults(), params || {});
      for (var i = 0; i < N; i++) {
        var v = p.min + (p.max - p.min) * i / (N - 1);
        base[ch.param] = v;
        var env = Sim.staticEnv(model, base);
        xs.push(v);
        cc.series.forEach(function (s, j) { out[j].push(s.c.fn(env)); });
      }
      return { xs: xs, ys: out };
    };

    // Sample an ode run for the checker: returns array of env snapshots (references to the live env are copied).
    Sim.sampleRun = function (model, params, seconds, everySteps) {
      var rt = Sim.createRuntime(model, params), out = [Object.assign(Object.create(null), rt.env)];
      var total = Math.min(seconds, 4000 * rt.dt), stepsDone = 0, chunk = rt.dt * (everySteps || 20);
      var t = 0;
      while (t < total - 1e-12 && !rt.unstable) { rt.step(chunk, (everySteps || 20) + 2); out.push(Object.assign(Object.create(null), rt.env)); t += chunk; stepsDone += (everySteps || 20); if (stepsDone > 4000) break; }
      return { samples: out, unstable: rt.unstable };
    };

    // ------------------------------------------------------------------ rendering
    var TOKEN_VAR = { fg: '--fg', muted: '--muted', accent: '--accent', accent2: '--accent2', accent3: '--accent3', warn: '--warn', good: '--good', sky: '--sky', ground: '--ground', sun: '--sun' };
    var FALLBACK = { fg: '#1d1c1a', muted: '#6b6a66', accent: '#2457d6', accent2: '#0f8a78', accent3: '#b36b00', warn: '#c2410c', good: '#15803d', sky: '#dbe8f6', ground: '#d9cfb8', sun: '#e0a100', line: '#e2e0da', surface: '#ffffff' };
    function readTheme(el) {
      var cs = getComputedStyle(el), th = {};
      Object.keys(TOKEN_VAR).forEach(function (k) { th[k] = cs.getPropertyValue(TOKEN_VAR[k]).trim() || FALLBACK[k]; });
      th.line = cs.getPropertyValue('--line').trim() || FALLBACK.line;
      th.surface = cs.getPropertyValue('--surface').trim() || FALLBACK.surface;
      return th;
    }
    function nice(raw) { var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

    function setupCanvas(cv, cssW, cssH) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      cv.style.height = cssH + 'px';
      var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
    }

    function drawLineChart(cv, th, o) {
      var W = cv.clientWidth || 300, H = 170, ctx = setupCanvas(cv, W, H);
      ctx.clearRect(0, 0, W, H);
      var padL = 44, padR = 10, padT = 8, padB = 24, w = W - padL - padR, h = H - padT - padB;
      var xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      o.series.forEach(function (s) { for (var i = 0; i < s.xs.length; i++) { var x = s.xs[i], y = s.ys[i]; if (!isFinite(x) || !isFinite(y)) continue; if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; } });
      if (o.xmin !== undefined) xmin = o.xmin; if (o.xmax !== undefined) xmax = o.xmax;
      if (!isFinite(xmin) || xmin === xmax) { xmin = (isFinite(xmin) ? xmin : 0); xmax = xmin + 1; }
      if (isFinite(o.ymin)) ymin = o.ymin; if (isFinite(o.ymax)) ymax = o.ymax;
      if (!isFinite(ymin)) ymin = isFinite(ymax) ? ymax - 1 : 0;
      if (!isFinite(ymax)) ymax = ymin + 1;
      if (ymax < ymin) { var sw0 = ymin; ymin = ymax; ymax = sw0; }
      // flat or near-flat data (also huge constants where +-0.5 is below float resolution)
      if (ymax - ymin <= Math.abs(ymax) * 1e-9) { var d0 = Math.abs(ymax) * 0.05 || 0.5; ymin -= d0; ymax += d0; }
      if (!isFinite(o.ymin) && !isFinite(o.ymax)) { var pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad; }
      function X(v) { return padL + (v - xmin) / (xmax - xmin) * w; }
      function Y(v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * h; }
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      var step = nice((ymax - ymin) / 4), v, guard;
      if (isFinite(step) && step > 0) for (v = Math.ceil(ymin / step) * step, guard = 0; v <= ymax + 1e-9 && guard < 12; v += step, guard++) {
        var yy = Math.round(Y(v)) + 0.5; ctx.strokeStyle = th.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + w, yy); ctx.stroke();
        ctx.fillStyle = th.muted; ctx.fillText(U.fmt(Math.abs(v) < step * 1e-6 ? 0 : v, step >= 1 ? 0 : (step >= 0.1 ? 1 : 2)), padL - 5, yy);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = th.muted;
      // the axis label sits at the right end of the tick row; ticks that would collide with it are skipped
      var xlw = o.xlabel ? ctx.measureText(o.xlabel).width : 0, xlimit = padL + w - xlw - 8;
      var xs2 = nice((xmax - xmin) / 4);
      if (isFinite(xs2) && xs2 > 0) for (v = Math.ceil(xmin / xs2) * xs2, guard = 0; v <= xmax + 1e-9 && guard < 12; v += xs2, guard++) {
        var lab = U.fmt(Math.abs(v) < xs2 * 1e-6 ? 0 : v, xs2 >= 1 ? 0 : 1), xx = X(v);
        if (o.xlabel && xx + ctx.measureText(lab).width / 2 > xlimit) continue;
        ctx.fillText(lab, xx, padT + h + 4);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, w, h); ctx.clip();
      o.series.forEach(function (s) {
        ctx.beginPath(); var started = false;
        for (var i = 0; i < s.xs.length; i++) { var x = s.xs[i], y = s.ys[i]; if (!isFinite(x) || !isFinite(y)) { started = false; continue; } if (!started) { ctx.moveTo(X(x), Y(y)); started = true; } else ctx.lineTo(X(x), Y(y)); }
        ctx.strokeStyle = th[s.color] || th.accent; ctx.lineWidth = 2; ctx.setLineDash(s.dash ? [5, 4] : []); ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
      });
      if (o.marker !== undefined && isFinite(o.marker)) { ctx.strokeStyle = th.muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(o.marker), padT); ctx.lineTo(X(o.marker), padT + h); ctx.stroke(); ctx.setLineDash([]);
        o.series.forEach(function (s) { if (o.markerY && isFinite(o.markerY[0])) { } }); }
      if (o.dot) { ctx.fillStyle = th[o.dot.color] || th.accent; ctx.beginPath(); ctx.arc(X(o.dot.x), Y(o.dot.y), 4, 0, 6.2832); ctx.fill(); }
      ctx.restore();
      if (o.xlabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = th.muted; ctx.fillText(o.xlabel, padL + w, padT + h + 4); }
    }

    // ----- scene
    function Player(el, model, opts) {
      opts = opts || {};
      var spec = model.spec, th = null, self = this;
      var params = model.defaults(), rt = null, playing = false, speed = spec.time.speed || 1, rafId = 0, lastTs = 0, destroyed = false, offscreen = false;
      var highlightSet = {}, tween = null, pulse = 0, dirty = true, charts = [], trails = {}, parts = {};
      var reduced = !!opts.reducedMotion, visible = true;
      var isStatic = model.kind === 'static';
      var anim = spec.time.animateParam && model.params[spec.time.animateParam.param] ? spec.time.animateParam : null;
      var view = spec.view || { xmin: -5, xmax: 5, ymin: -3, ymax: 3 };

      var U_ = G.Util.el;
      var stage = U_('div', { 'class': 'gb-stage' });
      var canvas = U_('canvas', { 'class': 'gb-canvas', role: 'img', tabindex: '0', 'aria-label': opts.title || 'Simulation' });
      var transport = U_('div', { 'class': 'gb-transport' });
      var readouts = U_('div', { 'class': 'gb-readouts', 'aria-live': 'off' });
      var chartsEl = U_('div', { 'class': 'gb-charts' });
      var playBtn = U_('button', { type: 'button', 'class': 'gb-btn gb-primary', 'aria-pressed': 'false' }, anim && isStatic ? 'Play the ' + (model.params[anim.param].label || anim.param).toLowerCase() : 'Play');
      var resetBtn = U_('button', { type: 'button', 'class': 'gb-btn', title: 'Reset (R)' }, 'Reset');
      var speedSel = U_('select', { 'class': 'gb-select', 'aria-label': 'Speed' }, [0.25, 0.5, 1, 2, 4].map(function (v) { return U_('option', { value: v, selected: v === 1 }, v + '×'); }));
      var timeEl = U_('span', { 'class': 'gb-time' }, '');
      var note = U_('div', { 'class': 'gb-note', role: 'status', hidden: true });
      if (!(isStatic && !anim)) transport.appendChild(playBtn);
      transport.appendChild(resetBtn);
      if (!(isStatic && !anim)) transport.appendChild(speedSel);
      if (!isStatic) transport.appendChild(timeEl);
      stage.appendChild(canvas); stage.appendChild(note); stage.appendChild(transport); stage.appendChild(readouts);
      el.appendChild(stage); el.appendChild(chartsEl);

      model.charts.forEach(function (cc) {
        var cv = U_('canvas', { 'class': 'gb-chart', role: 'img', 'aria-label': cc.chart.title || 'Chart' });
        var legend = U_('div', { 'class': 'gb-legend' });
        var fig = U_('figure', { 'class': 'gb-fig' }, U_('figcaption', {}, cc.chart.title || ''), cv, legend);
        chartsEl.appendChild(fig);
        var entry = { cc: cc, cv: cv, legend: legend, buf: { t: [], ys: cc.series.map(function () { return []; }), xs: [] }, sweep: null, lastSample: -1 };
        cc.series.forEach(function (s) {
          legend.appendChild(U_('span', { 'class': 'gb-lg' }, U_('i', { style: 'background:var(--' + (s.s.color === 'fg' ? 'fg' : s.s.color) + ')' + (s.s.dash ? ';opacity:.6' : '') }), (s.s.label || s.s.expr) + (s.s.unit ? ' (' + s.s.unit + ')' : '')));
        });
        charts.push(entry);
      });

      function theme() { if (!th) th = readTheme(el); return th; }
      this.refreshTheme = function () { th = null; dirty = true; schedule(); };

      // --- runtime control
      function newRuntime() { rt = isStatic ? null : G.Sim.createRuntime(model, params); clearBuffers(); }
      function clearBuffers() { trails = {}; charts.forEach(function (c) { c.buf = { t: [], ys: c.cc.series.map(function () { return []; }), xs: [] }; c.lastSample = -1; c.sweep = null; }); note.hidden = true; }
      function currentEnv() { return isStatic ? Sim.staticEnv(model, params) : rt.env; }
      newRuntime();

      function applyParams(p, full) {
        Object.assign(params, p);
        if (isStatic) { charts.forEach(function (c) { c.sweep = null; }); }
        else if (full && spec.time.resetOn !== 'never') { newRuntime(); }
        else rt.setParams(params);
        dirty = true; schedule();
        if (opts.onParams) opts.onParams(Object.assign({}, params));
      }

      this.setParams = function (p, o) {
        o = o || {}; var target = {};
        Object.keys(p).forEach(function (k) { var pr = model.params[k], v = Number(p[k]); if (pr && isFinite(v)) target[k] = U.clamp(v, pr.min, pr.max); });
        // a running tween that gets replaced (slider drag, preset, tour step) still reports completion, so callers
        // waiting on it (the predict flow) never hang
        if (tween) { var prevDone = tween.done; tween = null; if (prevDone) setTimeout(prevDone, 0); }
        if (!o.animateMs || reduced) { applyParams(target, !o.live); if (o.onDone) o.onDone(); return; }
        var from = {}; Object.keys(target).forEach(function (k) { from[k] = params[k]; });
        tween = { from: from, to: target, t0: performance.now(), ms: o.animateMs, done: o.onDone };
        schedule();
      };
      this.getParams = function () { return Object.assign({}, params); };
      this.getModel = function () { return model; };
      this.values = function () { return currentEnv(); };
      this.isPlaying = function () { return playing; };
      this.play = function () { if (!isStatic && rt && rt.unstable) return; if (!isStatic && rt && rt.t >= (spec.time.duration || 60)) { newRuntime(); } playing = true; playBtn.setAttribute('aria-pressed', 'true'); playBtn.textContent = anim && isStatic ? 'Pause' : 'Pause'; lastTs = 0; schedule(); if (opts.onPlay) opts.onPlay(true); };
      this.pause = function () { playing = false; playBtn.setAttribute('aria-pressed', 'false'); playBtn.textContent = anim && isStatic ? 'Play the ' + (model.params[anim.param].label || anim.param).toLowerCase() : 'Play'; if (opts.onPlay) opts.onPlay(false); };
      this.reset = function () { newRuntime(); if (anim && isStatic) {} dirty = true; schedule(); };
      this.setSpeed = function (x) { speed = (spec.time.speed || 1) * x; };
      this.highlight = function (ids) { highlightSet = {}; (ids || []).forEach(function (i) { highlightSet[i] = true; }); dirty = true; schedule(); };
      this.snapshot = function () { return canvas.toDataURL('image/png'); };
      this.canvas = canvas;
      this.describe = function () {
        var env = currentEnv(), bits = [];
        spec.params.forEach(function (p) { bits.push(p.label + ' ' + U.fmt(params[p.id]) + (p.unit ? ' ' + p.unit : '')); });
        var rd = [];
        spec.readouts.forEach(function (id) { var lab = labelFor(id); rd.push(lab.label + ' ' + U.fmt(env[id], lab.digits) + (lab.unit ? ' ' + lab.unit : '')); });
        return (opts.title || 'Simulation') + '. ' + bits.join(', ') + '.' + (rd.length ? ' ' + rd.join(', ') + '.' : '');
      };
      this.destroy = function () { destroyed = true; cancelAnimationFrame(rafId); if (io) io.disconnect(); if (mo) mo.disconnect(); if (ro) ro.disconnect(); tween = null; if (mq && mq.removeEventListener) mq.removeEventListener('change', onTheme); document.removeEventListener('visibilitychange', onVis); if (el.contains(stage)) el.removeChild(stage); if (el.contains(chartsEl)) el.removeChild(chartsEl); };

      function labelFor(id) {
        var p = model.params[id]; if (p) return { label: p.label, unit: p.unit, digits: undefined };
        var s = spec.state.filter(function (x) { return x.id === id; })[0]; if (s) return { label: s.label, unit: s.unit, digits: undefined };
        var d = spec.derived.filter(function (x) { return x.id === id; })[0]; if (d) return { label: d.label, unit: d.unit, digits: d.digits };
        return { label: id, unit: '', digits: undefined };
      }

      // --- readouts DOM
      var roEls = spec.readouts.map(function (id) {
        var lab = labelFor(id), v = U_('b', { 'class': 'gb-ro-val' }, '–');
        var wrap = U_('div', { 'class': 'gb-ro' }, U_('span', { 'class': 'gb-ro-label' }, lab.label), U_('span', { 'class': 'gb-ro-line' }, v, lab.unit ? U_('small', {}, ' ' + lab.unit) : ''));
        readouts.appendChild(wrap); return { id: id, v: v, digits: lab.digits };
      });
      function updateReadouts() {
        var env = currentEnv();
        roEls.forEach(function (r) { r.v.textContent = U.fmt(env[r.id], r.digits); });
        if (!isStatic) timeEl.textContent = 't = ' + U.fmt(rt.t, 1) + ' s';
      }

      // --- geometry
      var geo = { s: 1, ox: 0, oy: 0, w: 300, h: 200 };
      function layout() {
        var W = Math.max(200, el.clientWidth || canvas.parentNode.clientWidth || 320);
        var ratio = U.clamp((view.ymax - view.ymin) / (view.xmax - view.xmin), 0.45, 1.1);
        var H = Math.min(W * ratio, Math.max(220, (window.innerHeight || 700) * 0.6));
        var s = Math.min(W / (view.xmax - view.xmin), H / (view.ymax - view.ymin));
        geo = { s: s, ox: (W - s * (view.xmax - view.xmin)) / 2, oy: (H - s * (view.ymax - view.ymin)) / 2, w: W, h: H };
        return setupCanvas(canvas, W, H);
      }
      function sx(x) { return geo.ox + (x - view.xmin) * geo.s; }
      function sy(y) { return geo.oy + (view.ymax - y) * geo.s; }

      function colorOf(tok) { return theme()[tok] || theme().fg; }

      function drawShapes(ctx, env) {
        var t = theme(), i;
        ctx.clearRect(0, 0, geo.w, geo.h);
        ctx.fillStyle = t.surface; ctx.fillRect(0, 0, geo.w, geo.h);
        if (view.grid) {
          ctx.strokeStyle = t.line; ctx.lineWidth = 1;
          var gs = nice((view.xmax - view.xmin) / 8);
          for (var gx = Math.ceil(view.xmin / gs) * gs, gi = 0; gx <= view.xmax && gi < 60; gx += gs, gi++) { ctx.beginPath(); ctx.moveTo(Math.round(sx(gx)) + .5, sy(view.ymax)); ctx.lineTo(Math.round(sx(gx)) + .5, sy(view.ymin)); ctx.stroke(); }
          for (var gy = Math.ceil(view.ymin / gs) * gs, gj = 0; gy <= view.ymax && gj < 60; gy += gs, gj++) { ctx.beginPath(); ctx.moveTo(sx(view.xmin), Math.round(sy(gy)) + .5); ctx.lineTo(sx(view.xmax), Math.round(sy(gy)) + .5); ctx.stroke(); }
        }
        ctx.save(); ctx.beginPath(); ctx.rect(sx(view.xmin), sy(view.ymax), (view.xmax - view.xmin) * geo.s, (view.ymax - view.ymin) * geo.s); ctx.clip();
        model.shapes.forEach(function (cs) {
          var v = Sim.evalShape(cs, env); if (!v || v.bad) return;
          var sh = cs.shape, hl = !!highlightSet[sh.id], col = colorOf(sh.color), lw = v.width !== undefined ? U.clamp(v.width, 1, 8) : 2;
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.setLineDash([]);
          var lx = null, ly = null;
          function halo(fn) { if (!hl) return; ctx.save(); ctx.globalAlpha = 0.35 + (reduced ? 0 : 0.2 * Math.sin(pulse)); ctx.strokeStyle = colorOf('accent'); ctx.lineWidth = lw + 8; ctx.lineJoin = 'round'; fn(); ctx.restore(); }
          switch (cs.type) {
            case 'circle':
              ctx.beginPath(); ctx.arc(sx(v.x), sy(v.y), Math.max(0.5, v.r * geo.s), 0, 6.2832);
              halo(function () { ctx.stroke(); });
              if (sh.fill) ctx.fill(); else ctx.stroke(); lx = sx(v.x) + v.r * geo.s * 0.75; ly = sy(v.y) - v.r * geo.s * 0.75; break;
            case 'line': case 'arrow': {
              var x1 = sx(v.x1), y1 = sy(v.y1), x2 = sx(v.x2), y2 = sy(v.y2), len = Math.hypot(x2 - x1, y2 - y1);
              if (cs.type === 'arrow' && len < 2) break;
              ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); if (sh.dash) ctx.setLineDash([6, 5]);
              halo(function () { ctx.stroke(); }); ctx.stroke(); ctx.setLineDash([]);
              if (cs.type === 'arrow') { var a = Math.atan2(y2 - y1, x2 - x1), hs = 8; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hs * Math.cos(a - 0.4), y2 - hs * Math.sin(a - 0.4)); ctx.lineTo(x2 - hs * Math.cos(a + 0.4), y2 - hs * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill(); }
              lx = x2 + 6; ly = y2 - 6; break; }
            case 'rect': {
              var rx = sx(v.x), ry = sy(v.y + v.h), rw = v.w * geo.s, rh = v.h * geo.s;
              halo(function () { ctx.strokeRect(rx, ry, rw, rh); });
              if (sh.fill) ctx.fillRect(rx, ry, rw, rh); else ctx.strokeRect(rx, ry, rw, rh); lx = rx + 4; ly = ry - 5; break; }
            case 'arc':
              ctx.beginPath(); ctx.arc(sx(v.x), sy(v.y), Math.max(0.5, v.r * geo.s), -v.start, -v.end, true); halo(function () { ctx.stroke(); }); ctx.stroke(); lx = sx(v.x) + 6; ly = sy(v.y) - v.r * geo.s; break;
            case 'spring': {
              var ax = sx(v.x1), ay = sy(v.y1), bx = sx(v.x2), by = sy(v.y2), L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
              var coils = U.clamp(Math.round(v.coils || 8), 3, 30), pts = coils * 2, amp = 7;
              ctx.beginPath(); ctx.moveTo(ax, ay);
              for (var k = 1; k < pts; k++) { var f = k / pts, sgn = (k % 2 ? 1 : -1) * amp; ctx.lineTo(ax + ux * L * f + nx * sgn, ay + uy * L * f + ny * sgn); }
              ctx.lineTo(bx, by); halo(function () { ctx.stroke(); }); ctx.stroke(); lx = bx + 6; ly = by - 6; break; }
            case 'text': {
              var size = Math.round(({ s: 12, m: 15, l: 19 }[sh.size] || 15) * U.clamp(geo.w / 560, 0.6, 1)); ctx.font = size + 'px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
              if (hl) { var tw = ctx.measureText(v.text).width; ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = colorOf('accent'); ctx.fillRect(sx(v.x) - 3, sy(v.y) - size, tw + 6, size + 5); ctx.restore(); }
              ctx.fillStyle = col; ctx.fillText(v.text, sx(v.x), sy(v.y)); break; }
            case 'trail': {
              var tr = trails[sh.id] || (trails[sh.id] = []); if (playing || tr.length === 0) { /* pushed in tick */ }
              if (tr.length > 1) { ctx.beginPath(); tr.forEach(function (q, qi) { if (qi === 0) ctx.moveTo(sx(q[0]), sy(q[1])); else ctx.lineTo(sx(q[0]), sy(q[1])); }); ctx.globalAlpha = 0.55; halo(function () { ctx.stroke(); }); ctx.stroke(); ctx.globalAlpha = 1; }
              break; }
            case 'particles': drawParticles(ctx, cs, sh, v, hl); break;
          }
          if (sh.label && lx !== null) { ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = colorOf('muted'); ctx.fillText(sh.label, lx, ly); }
        });
        ctx.restore();
      }

      function particleState(sh) {
        var st = parts[sh.id];
        if (!st) { st = parts[sh.id] = { rng: U.mulberry32(Math.round(sh.seed || 1) + 7), list: [] }; }
        return st;
      }
      function stepParticles(cs, v, dtReal) {
        var sh = cs.shape, st = particleState(sh), want = U.clamp(Math.round(v.count || 0), 0, 400), L = st.list, bw = Math.max(0.001, v.w), bh = Math.max(0.001, v.h);
        while (L.length < want) { var a = st.rng() * 6.2832; L.push({ x: v.x + st.rng() * bw, y: v.y + st.rng() * bh, a: a, u: st.rng(), sp: 0.6 + st.rng() * 0.8 }); }
        if (L.length > want) L.length = want;
        var sp = (v.speed || 0) * dtReal;
        for (var i = 0; i < L.length; i++) {
          var p = L[i]; p.a += (st.rng() - 0.5) * 0.5;
          p.x += Math.cos(p.a) * sp * p.sp; p.y += Math.sin(p.a) * sp * p.sp;
          if (p.x < v.x) { p.x = v.x; p.a = Math.PI - p.a; } if (p.x > v.x + bw) { p.x = v.x + bw; p.a = Math.PI - p.a; }
          if (p.y < v.y) { p.y = v.y; p.a = -p.a; } if (p.y > v.y + bh) { p.y = v.y + bh; p.a = -p.a; }
        }
        var churn = (v.churn || 0) * dtReal * L.length; var n = Math.floor(churn) + (st.rng() < churn - Math.floor(churn) ? 1 : 0);
        for (var c = 0; c < n; c++) L[Math.floor(st.rng() * L.length)].u = st.rng();
      }
      function drawParticles(ctx, cs, sh, v, hl) {
        var st = particleState(sh); if (st.list.length === 0) stepParticles(cs, v, 0);
        var r = U.clamp(v.r || 3, 1, 8), frac = U.clamp(v.fraction === undefined ? 0 : v.fraction, 0, 1), c1 = colorOf(sh.color), c2 = colorOf(sh.color2 || 'accent2');
        var L = st.list;
        // keep inside box if the box moved
        for (var i = 0; i < L.length; i++) { var p = L[i]; ctx.fillStyle = p.u < frac ? c2 : c1; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), r, 0, 6.2832); ctx.fill(); }
        if (hl) { ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = colorOf('accent'); ctx.lineWidth = 2; ctx.strokeRect(sx(v.x), sy(v.y + v.h), v.w * geo.s, v.h * geo.s); ctx.restore(); }
      }

      function sampleCharts() {
        var env = rt.env;
        charts.forEach(function (c) {
          var ch = c.cc.chart;
          if (ch.type === 'time') {
            if (c.lastSample < 0 || rt.t - c.lastSample >= 1 / 30 - 1e-9) {
              c.lastSample = rt.t; c.buf.t.push(rt.t); c.cc.series.forEach(function (s, j) { c.buf.ys[j].push(s.c.fn(env)); });
              var win = ch.window || spec.time.duration || 20, cut = rt.t - win;
              while (c.buf.t.length > 2 && c.buf.t[0] < cut) { c.buf.t.shift(); c.buf.ys.forEach(function (a) { a.shift(); }); }
            }
          } else if (ch.type === 'phase') {
            c.buf.xs.push(c.cc.xc.fn(env)); c.buf.ys[0].push(c.cc.yc.fn(env));
            var len = Math.round(ch.length || 300); while (c.buf.xs.length > len) { c.buf.xs.shift(); c.buf.ys[0].shift(); }
          }
        });
      }
      function pushTrails(env) {
        model.shapes.forEach(function (cs) {
          if (cs.type !== 'trail') return; var v = Sim.evalShape(cs, env); if (!v || v.bad) return;
          var tr = trails[cs.id] || (trails[cs.id] = []); tr.push([v.x, v.y]); var len = U.clamp(Math.round(v.length || 100), 10, 400); while (tr.length > len) tr.shift();
        });
      }
      function drawCharts() {
        var t = theme(), env = currentEnv();
        charts.forEach(function (c) {
          var ch = c.cc.chart, o;
          if (ch.type === 'time') {
            var tmax = rt ? rt.t : 0, win = ch.window || spec.time.duration || 20;
            o = { series: c.cc.series.map(function (s, j) { return { xs: c.buf.t, ys: c.buf.ys[j], color: s.s.color, dash: s.s.dash }; }), ymin: ch.ymin, ymax: ch.ymax, xmin: Math.max(0, tmax - win), xmax: Math.max(win, tmax), xlabel: 't (s)' };
            if (c.buf.t.length && tmax < win) { o.xmin = 0; o.xmax = win; }
          } else if (ch.type === 'phase') {
            o = { series: [{ xs: c.buf.xs, ys: c.buf.ys[0], color: c.cc.series[0] ? c.cc.series[0].s.color : 'accent' }], ymin: ch.ymin, ymax: ch.ymax, xlabel: String(ch.x) };
            var last = c.buf.xs.length - 1; if (last >= 0) o.dot = { x: c.buf.xs[last], y: c.buf.ys[0][last], color: 'warn' };
          } else {
            if (!c.sweep) c.sweep = Sim.sweep(model, c.cc, params);
            var sw = c.sweep; if (!sw || !sw.xs) return;
            var pm = model.params[ch.param];
            o = { series: c.cc.series.map(function (s, j) { return { xs: sw.xs, ys: sw.ys[j], color: s.s.color, dash: s.s.dash }; }), ymin: ch.ymin, ymax: ch.ymax, xmin: pm.min, xmax: pm.max, marker: params[ch.param], xlabel: pm.label + (pm.unit ? ' (' + pm.unit + ')' : '') };
            if (c.cc.series.length) { var yv = c.cc.series[0].c.fn(env); if (isFinite(yv)) o.dot = { x: params[ch.param], y: yv, color: c.cc.series[0].s.color }; }
          }
          drawLineChart(c.cv, t, o);
        });
      }

      function draw() {
        var ctx = layout(), env = currentEnv();
        drawShapes(ctx, env); drawCharts(); updateReadouts();
        canvas.setAttribute('aria-label', self.describe());
      }

      function tick(ts) {
        rafId = 0; if (destroyed) return;
        var dtReal = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016; lastTs = ts; pulse += dtReal * 5;
        var needNext = false;
        if (tween) {
          var u = Math.min(1, (performance.now() - tween.t0) / tween.ms), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2, cur = {};
          Object.keys(tween.to).forEach(function (k) { cur[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e; });
          if (u >= 1) { var done = tween.done; var tgt = tween.to; tween = null; applyParams(tgt, true); if (done) done(); }
          else applyParams(cur, false);
          needNext = true;
        }
        if (playing && visible && !offscreen && !document.hidden) {
          if (isStatic) {
            if (anim) {
              var p = model.params[anim.param], span = p.max - p.min, rate = isFinite(anim.rate) && anim.rate !== 0 ? anim.rate : span / 10, nv = params[anim.param] + rate * dtReal * (speed / (spec.time.speed || 1)), stop = false;
              if (nv > p.max) { if (anim.loop === false) { nv = p.max; stop = true; } else nv = p.min + (nv - p.max) % span; }
              else if (nv < p.min) { if (anim.loop === false) { nv = p.min; stop = true; } else nv = p.max - (p.min - nv) % span; }
              params[anim.param] = nv;
              // sweeps over another slider depend on the animated value
              charts.forEach(function (c) { if (c.cc.chart.param !== anim.param) c.sweep = null; });
              if (opts.onParams) opts.onParams(Object.assign({}, params));
              if (stop) self.pause();
            }
          } else {
            var before = rt.t; rt.step(dtReal * speed, 2000);
            if (rt.t > before) { sampleCharts(); pushTrails(rt.env); }
            if (rt.unstable) { self.pause(); note.hidden = false; note.textContent = 'The simulation became unstable at these settings. Try smaller values.'; resetBtn.classList.add('gb-pulse'); }
            else if (rt.t >= (spec.time.duration || 60)) { self.pause(); }
            for (var pi = 0; pi < model.shapes.length; pi++) { var cs = model.shapes[pi]; if (cs.type === 'particles') { var pv = Sim.evalShape(cs, rt.env); if (pv && !pv.bad) stepParticles(cs, pv, dtReal); } }
          }
          needNext = true;
        } else if (!isStatic) {
          // keep particles gently alive only while playing; nothing to do when paused
        }
        if (isStatic && playing) {
          model.shapes.forEach(function (cs) { if (cs.type === 'particles') { var pv = Sim.evalShape(cs, Sim.staticEnv(model, params)); if (pv && !pv.bad) stepParticles(cs, pv, dtReal); } });
        }
        if (Object.keys(highlightSet).length && !reduced) needNext = true;
        draw();
        if (needNext) schedule(); else lastTs = 0;
      }
      function schedule() { if (!rafId && !destroyed) rafId = requestAnimationFrame(tick); }

      // --- wiring
      playBtn.addEventListener('click', function () { if (playing) self.pause(); else self.play(); });
      resetBtn.addEventListener('click', function () {
        resetBtn.classList.remove('gb-pulse');
        if (anim && isStatic) { params[anim.param] = model.params[anim.param].value; charts.forEach(function (c) { c.sweep = null; }); if (opts.onParams) opts.onParams(Object.assign({}, params)); }
        else if (isStatic) { self.setParams(model.defaults()); return; } // no time to rewind: Reset restores the sliders
        self.reset();
      });
      speedSel.addEventListener('change', function () { self.setSpeed(Number(speedSel.value)); });
      canvas.addEventListener('keydown', function (e) {
        if (e.key === ' ' && !(isStatic && !anim)) { e.preventDefault(); playBtn.click(); }
        else if (e.key === 'r' || e.key === 'R') { resetBtn.click(); }
      });
      var io = null, mo = null, mq = null, ro = null;
      if (typeof IntersectionObserver !== 'undefined') { io = new IntersectionObserver(function (es) { offscreen = !es[0].isIntersecting; if (!offscreen) schedule(); }); io.observe(stage); }
      function onVis() { if (!document.hidden) schedule(); }
      document.addEventListener('visibilitychange', onVis);
      function onTheme() { self.refreshTheme(); }
      if (typeof MutationObserver !== 'undefined') { mo = new MutationObserver(onTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); }
      if (window.matchMedia) { mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', onTheme); }
      if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(function () { dirty = true; schedule(); }); ro.observe(stage); }
      if (!reduced) { /* start paused by default; the view decides when to autoplay */ }
      if (!isStatic) { /* prime one sample so charts show the first point */ sampleCharts(); pushTrails(rt.env); }
      draw();
    }
    Sim.mount = function (el, model, opts) { return new Player(el, model, opts); };

    // Static thumbnail of the scene (used on gallery cards). Pre-runs an ode a little so shapes are not degenerate.
    Sim.renderThumb = function (canvas, model, themeEl) {
      var spec = model.spec, view = spec.view || { xmin: -5, xmax: 5, ymin: -3, ymax: 3 };
      var th = readTheme(themeEl || canvas), W = canvas.clientWidth || 280, ratio = U.clamp((view.ymax - view.ymin) / (view.xmax - view.xmin), 0.45, 0.8), H = Math.round(W * ratio);
      var ctx = setupCanvas(canvas, W, H);
      var rt = model.kind === 'static' ? null : Sim.createRuntime(model, model.defaults());
      if (rt) rt.step(1.3, 4000);
      var env = rt ? rt.env : Sim.staticEnv(model, model.defaults());
      var s = Math.min(W / (view.xmax - view.xmin), H / (view.ymax - view.ymin)), ox = (W - s * (view.xmax - view.xmin)) / 2, oy = (H - s * (view.ymax - view.ymin)) / 2;
      function X(x) { return ox + (x - view.xmin) * s; } function Y(y) { return oy + (view.ymax - y) * s; }
      ctx.fillStyle = th.surface; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.beginPath(); ctx.rect(X(view.xmin), Y(view.ymax), (view.xmax - view.xmin) * s, (view.ymax - view.ymin) * s); ctx.clip();
      var rng = U.mulberry32(5);
      model.shapes.forEach(function (cs) {
        var v = Sim.evalShape(cs, env); if (!v || v.bad) return; var sh = cs.shape, col = th[sh.color] || th.fg;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = v.width ? U.clamp(v.width, 1, 6) : 2; ctx.setLineDash(sh.dash ? [5, 4] : []);
        if (cs.type === 'circle') { ctx.beginPath(); ctx.arc(X(v.x), Y(v.y), Math.max(1, v.r * s), 0, 6.2832); sh.fill ? ctx.fill() : ctx.stroke(); }
        else if (cs.type === 'line' || cs.type === 'arrow') { ctx.beginPath(); ctx.moveTo(X(v.x1), Y(v.y1)); ctx.lineTo(X(v.x2), Y(v.y2)); ctx.stroke(); }
        else if (cs.type === 'rect') { sh.fill ? ctx.fillRect(X(v.x), Y(v.y + v.h), v.w * s, v.h * s) : ctx.strokeRect(X(v.x), Y(v.y + v.h), v.w * s, v.h * s); }
        else if (cs.type === 'arc') { ctx.beginPath(); ctx.arc(X(v.x), Y(v.y), v.r * s, -v.start, -v.end, true); ctx.stroke(); }
        else if (cs.type === 'spring') { ctx.beginPath(); ctx.moveTo(X(v.x1), Y(v.y1)); ctx.lineTo(X(v.x2), Y(v.y2)); ctx.stroke(); }
        else if (cs.type === 'particles') {
          var n = Math.min(120, Math.round(v.count || 0)), fr = U.clamp(v.fraction || 0, 0, 1);
          for (var i = 0; i < n; i++) { ctx.fillStyle = rng() < fr ? (th[sh.color2] || th.accent2) : col; ctx.beginPath(); ctx.arc(X(v.x + rng() * v.w), Y(v.y + rng() * v.h), 2.5, 0, 6.2832); ctx.fill(); }
        }
      });
      ctx.restore();
    };

    G.Sim = Sim;
  }
  G.__player = G.__player || {};
  G.__player.sim = install;
  install(G);
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
