/* Glassbox.Schema: normalizes untrusted lesson JSON (coercion, trimming, whitelisting) and checks its structure.
 * Player module (inlined into exports). */
(function (G) {
  'use strict';
  function install(G) {
    var S = {};
    S.FORMAT = 'glassbox-lesson/1';
    S.SUBJECTS = ['physics', 'biology', 'chemistry', 'earth-space', 'other'];
    S.LEVELS = ['kid', 'highschool', 'university', 'teacher'];
    S.CERTAINTY = ['established', 'textbook', 'simplification', 'uncertain'];
    S.COLORS = ['fg', 'muted', 'accent', 'accent2', 'accent3', 'warn', 'good', 'sky', 'ground', 'sun'];
    S.SHAPE_TYPES = ['circle', 'line', 'arrow', 'rect', 'arc', 'spring', 'text', 'trail', 'particles'];
    S.CHART_TYPES = ['time', 'sweep', 'phase'];
    S.ANSWERS = ['increases', 'decreases', 'same'];
    S.AGGS = ['final', 'mean', 'max', 'min'];
    S.ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
    S.LIMITS = {
      title: 80, topic: 200, summary: 300, bigIdea: 200, paramDesc: 120, label: 60, unit: 16, tourTitle: 60, tourText: 500, question: 200,
      explanation: 400, claim: 200, wrong: 150, right: 300, term: 40, definition: 200, imagePrompt: 300, shapeLabel: 30, textShape: 120,
      params: 6, constants: 6, state: 6, derived: 12, shapes: 30, charts: 2, series: 3, readouts: 4, tour: 6, predictions: 3, claims: 8,
      misconceptions: 4, glossary: 8, presets: 5, highlight: 6
    };
    // numeric (expression) fields per shape type
    var SHAPE_FIELDS = {
      circle: ['x', 'y', 'r'], line: ['x1', 'y1', 'x2', 'y2', 'width'], arrow: ['x1', 'y1', 'x2', 'y2', 'width'],
      rect: ['x', 'y', 'w', 'h'], arc: ['x', 'y', 'r', 'start', 'end'], spring: ['x1', 'y1', 'x2', 'y2', 'coils', 'width'],
      text: ['x', 'y'], trail: ['x', 'y', 'length'], particles: ['x', 'y', 'w', 'h', 'count', 'speed', 'r', 'fraction', 'churn', 'seed']
    };
    var SHAPE_FLAGS = { circle: ['fill'], line: ['dash'], rect: ['fill'] };
    S.SHAPE_FIELDS = SHAPE_FIELDS;

    function issue(list, level, code, path, message, hint) { list.push({ level: level, code: code, path: path, message: message, hint: hint || '' }); }
    function str(v, max) {
      if (v === null || v === undefined) return '';
      v = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
      if (v.length <= max) return v;
      var cut = max - 1; if (/[\uD800-\uDBFF]/.test(v.charAt(cut - 1))) cut--; // never split a surrogate pair (encodeURIComponent throws on halves)
      return v.slice(0, cut) + '…';
    }
    function num(v) {
      if (typeof v === 'number') return isFinite(v) ? v : NaN;
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
      return NaN;
    }
    // expression field: keep numbers as numbers, strings as strings
    function exprField(v) {
      if (typeof v === 'number') return isFinite(v) ? v : undefined;
      if (typeof v === 'string') { var t = v.trim(); if (t === '') return undefined; if (isFinite(Number(t)) && /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(t)) return Number(t); return t.slice(0, 300); }
      if (typeof v === 'boolean') return v ? 1 : 0;
      return undefined;
    }
    function bool(v) { return v === true || v === 1 || v === 'true'; }
    function arr(v, max, list, path, what) {
      if (!Array.isArray(v)) return [];
      if (v.length > max) issue(list, 'warning', 'SCHEMA_TRIM', path, what + ': only the first ' + max + ' of ' + v.length + ' items are kept');
      return v.slice(0, max);
    }
    function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    function pick(v, allowed, dflt) { v = String(v === undefined || v === null ? '' : v).toLowerCase(); return allowed.indexOf(v) >= 0 ? v : dflt; }
    function numMap(v, list, path) {
      var out = {}; v = obj(v);
      Object.keys(v).slice(0, 12).forEach(function (k) {
        var n = num(v[k]);
        if (isFinite(n) && S.ID_RE.test(k)) out[k] = n; else issue(list, 'warning', 'SCHEMA_TRIM', path + '.' + k, 'Ignored a non-numeric setting for "' + k + '"');
      });
      return out;
    }

    function normShape(sh, i, list) {
      sh = obj(sh);
      var type = String(sh.type || '').toLowerCase();
      if (S.SHAPE_TYPES.indexOf(type) < 0) { issue(list, 'error', 'SCHEMA_ENUM', 'sim.shapes[' + i + '].type', 'Unknown shape type "' + str(sh.type, 20) + '"', 'Shape types: ' + S.SHAPE_TYPES.join(', ')); return null; }
      var out = { type: type, id: str(sh.id, 24) || (type + (i + 1)), color: pick(sh.color, S.COLORS, 'fg') };
      if (sh.color !== undefined && S.COLORS.indexOf(String(sh.color).toLowerCase()) < 0) issue(list, 'warning', 'SCHEMA_ENUM', 'sim.shapes[' + i + '].color', 'Unknown color "' + str(sh.color, 20) + '" replaced by "fg"', 'Color tokens: ' + S.COLORS.join(', '));
      var vis = exprField(sh.visible); if (vis !== undefined) out.visible = vis;
      if (sh.label) out.label = str(sh.label, S.LIMITS.shapeLabel);
      SHAPE_FIELDS[type].forEach(function (f) { var v = exprField(sh[f]); if (v !== undefined) out[f] = v; });
      (SHAPE_FLAGS[type] || []).forEach(function (f) { if (sh[f] !== undefined) out[f] = bool(sh[f]); });
      if (type === 'text') { out.text = str(sh.text, S.LIMITS.textShape); out.size = pick(sh.size, ['s', 'm', 'l'], 'm'); }
      if (type === 'particles') { if (sh.color2) out.color2 = pick(sh.color2, S.COLORS, 'accent2'); else out.color2 = 'accent2'; }
      return out;
    }

    function normSim(sim, list) {
      sim = obj(sim);
      var out = { kind: String(sim.kind) === 'static' ? 'static' : 'ode' };
      if (['ode', 'static'].indexOf(String(sim.kind)) < 0) issue(list, 'error', 'SCHEMA_ENUM', 'sim.kind', 'kind must be "ode" or "static"');
      out.params = arr(sim.params, S.LIMITS.params, list, 'sim.params', 'params').map(function (p, i) {
        p = obj(p);
        var o = { id: str(p.id, 24), label: str(p.label, S.LIMITS.label) || str(p.id, 24), unit: str(p.unit, S.LIMITS.unit), min: num(p.min), max: num(p.max), step: num(p.step), value: num(p.value) };
        if (p.description) o.description = str(p.description, S.LIMITS.paramDesc);
        var pr = arr(p.presets, S.LIMITS.presets, list, 'sim.params[' + i + '].presets', 'presets').map(function (q) { q = obj(q); return { label: str(q.label, 24), value: num(q.value) }; }).filter(function (q) { return q.label && isFinite(q.value); });
        if (pr.length) o.presets = pr;
        return o;
      });
      out.constants = arr(sim.constants, S.LIMITS.constants, list, 'sim.constants', 'constants').map(function (c) { c = obj(c); return { id: str(c.id, 24), label: str(c.label, S.LIMITS.label), unit: str(c.unit, S.LIMITS.unit), value: num(c.value) }; });
      out.state = arr(sim.state, S.LIMITS.state, list, 'sim.state', 'state').map(function (s) { s = obj(s); return { id: str(s.id, 24), label: str(s.label, S.LIMITS.label) || str(s.id, 24), unit: str(s.unit, S.LIMITS.unit), initial: exprField(s.initial), rate: exprField(s.rate) }; });
      out.derived = arr(sim.derived, S.LIMITS.derived, list, 'sim.derived', 'derived').map(function (d) {
        d = obj(d); var o = { id: str(d.id, 24), label: str(d.label, S.LIMITS.label) || str(d.id, 24), unit: str(d.unit, S.LIMITS.unit), expr: exprField(d.expr) };
        var dg = num(d.digits); if (isFinite(dg)) o.digits = Math.max(0, Math.min(6, Math.round(dg)));
        return o;
      });
      var t = obj(sim.time), tm = { dt: num(t.dt), speed: num(t.speed), duration: num(t.duration), resetOn: t.resetOn === 'never' ? 'never' : 'paramChange' };
      if (!isFinite(tm.dt)) tm.dt = 0.01;
      if (!isFinite(tm.speed) || tm.speed <= 0) tm.speed = 1;
      if (!isFinite(tm.duration) || tm.duration <= 0) tm.duration = 60;
      if (t.animateParam && typeof t.animateParam === 'object') {
        var ap = t.animateParam; tm.animateParam = { param: str(ap.param, 24), rate: num(ap.rate), loop: ap.loop !== false };
      }
      out.time = tm;
      if (sim.view && typeof sim.view === 'object') {
        var v = sim.view; out.view = { xmin: num(v.xmin), xmax: num(v.xmax), ymin: num(v.ymin), ymax: num(v.ymax), grid: bool(v.grid) };
      } else issue(list, 'warning', 'SCHEMA_DEFAULT', 'sim.view', 'No view given; a default view is used');
      out.shapes = arr(sim.shapes, S.LIMITS.shapes, list, 'sim.shapes', 'shapes').map(function (sh, i) { return normShape(sh, i, list); }).filter(Boolean);
      out.charts = arr(sim.charts, S.LIMITS.charts, list, 'sim.charts', 'charts').map(function (c, i) {
        c = obj(c);
        var o = { id: str(c.id, 24) || ('chart' + (i + 1)), type: String(c.type || '').toLowerCase(), title: str(c.title, 80) };
        if (S.CHART_TYPES.indexOf(o.type) < 0) issue(list, 'error', 'SCHEMA_ENUM', 'sim.charts[' + i + '].type', 'Chart type must be one of ' + S.CHART_TYPES.join(', '));
        ['ymin', 'ymax', 'window', 'samples', 'length'].forEach(function (k) { var n = num(c[k]); if (isFinite(n)) o[k] = n; });
        if (c.param) o.param = str(c.param, 24);
        if (c.x !== undefined) o.x = exprField(c.x);
        if (c.y !== undefined) o.y = exprField(c.y);
        o.series = arr(c.series, S.LIMITS.series, list, 'sim.charts[' + i + '].series', 'series').map(function (s) {
          s = obj(s); var r = { expr: exprField(s.expr), label: str(s.label, 40), unit: str(s.unit, S.LIMITS.unit), color: pick(s.color, S.COLORS, 'accent') };
          if (bool(s.dash)) r.dash = true; return r;
        });
        return o;
      });
      out.readouts = arr(sim.readouts, S.LIMITS.readouts, list, 'sim.readouts', 'readouts').map(function (r) { return str(r, 24); }).filter(Boolean);
      return out;
    }

    S.normalize = function (raw, opts) {
      opts = opts || {};
      var list = [];
      raw = obj(raw);
      var L = {
        format: S.FORMAT, id: str(raw.id, 40) || 'lesson', title: str(raw.title, S.LIMITS.title), topic: str(raw.topic, S.LIMITS.topic),
        subject: pick(raw.subject, S.SUBJECTS, 'other'), level: pick(raw.level, S.LEVELS, 'highschool'), language: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(str(raw.language, 12)) ? str(raw.language, 12) : 'en',
        summary: str(raw.summary, S.LIMITS.summary), bigIdea: str(raw.bigIdea, S.LIMITS.bigIdea)
      };
      if (opts.groundedSources) L.sources = opts.groundedSources.slice(); else L.sources = arr(raw.sources, 8, list, 'sources', 'sources').map(function (s) {
        s = obj(s);
        var o = { id: str(s.id, 6), title: str(s.title, 120), url: str(s.url, 300), publisher: str(s.publisher, 60), retrieved: str(s.retrieved, 12) };
        if (s.excerpt) o.excerpt = str(s.excerpt, 2000); if (s.supports) o.supports = str(s.supports, 300); return o;
      });
      L.sim = raw.sim === null ? null : normSim(raw.sim, list);
      L.tour = arr(raw.tour, S.LIMITS.tour, list, 'tour', 'tour').map(function (t, i) {
        t = obj(t); return { id: str(t.id, 12) || ('t' + (i + 1)), title: str(t.title, S.LIMITS.tourTitle), text: str(t.text, S.LIMITS.tourText), set: numMap(t.set, list, 'tour[' + i + '].set'),
          highlight: (Array.isArray(t.highlight) ? t.highlight : []).slice(0, S.LIMITS.highlight).map(function (h) { return str(h, 24); }) };
      });
      L.predictions = arr(raw.predictions, S.LIMITS.predictions, list, 'predictions', 'predictions').map(function (p, i) {
        p = obj(p); var e = obj(p.experiment), at = obj(e.at);
        var exp = { from: numMap(e.from, list, 'predictions[' + i + '].experiment.from'), to: numMap(e.to, list, 'predictions[' + i + '].experiment.to'), measure: exprField(e.measure),
          label: str(e.label, S.LIMITS.label), unit: str(e.unit, S.LIMITS.unit) };
        if (e.at && typeof e.at === 'object') exp.at = { t: num(at.t), agg: pick(at.agg, S.AGGS, 'final') };
        var tol = num(e.tolerance); if (isFinite(tol)) exp.tolerance = Math.max(0.001, Math.min(0.1, tol));
        var o = { id: str(p.id, 12) || ('p' + (i + 1)), question: str(p.question, S.LIMITS.question), experiment: exp, answer: pick(p.answer, S.ANSWERS, ''), explanation: str(p.explanation, S.LIMITS.explanation) };
        if (p.options && typeof p.options === 'object') o.options = { increases: str(p.options.increases, 60), decreases: str(p.options.decreases, 60), same: str(p.options.same, 60) };
        return o;
      });
      L.claims = arr(raw.claims, S.LIMITS.claims, list, 'claims', 'claims').map(function (c, i) {
        c = obj(c); return { id: str(c.id, 12) || ('c' + (i + 1)), text: str(c.text, S.LIMITS.claim), sources: (Array.isArray(c.sources) ? c.sources : []).slice(0, 4).map(function (s) { return str(s, 6); }), certainty: pick(c.certainty, S.CERTAINTY, 'uncertain') };
      });
      L.misconceptions = arr(raw.misconceptions, S.LIMITS.misconceptions, list, 'misconceptions', 'misconceptions').map(function (m) { m = obj(m); return { wrong: str(m.wrong, S.LIMITS.wrong), right: str(m.right, S.LIMITS.right) }; }).filter(function (m) { return m.wrong && m.right; });
      L.glossary = arr(raw.glossary, S.LIMITS.glossary, list, 'glossary', 'glossary').map(function (g) { g = obj(g); return { term: str(g.term, S.LIMITS.term), definition: str(g.definition, S.LIMITS.definition) }; }).filter(function (g) { return g.term && g.definition; });
      L.media = { imagePrompt: str(obj(raw.media).imagePrompt, S.LIMITS.imagePrompt) };
      L.meta = raw.meta && typeof raw.meta === 'object' ? JSON.parse(JSON.stringify(raw.meta)) : {};
      return { lesson: L, issues: list };
    };

    // Structural checks (no expression evaluation here; Checks does that).
    S.validate = function (L) {
      var list = [];
      function req(cond, code, path, msg, hint) { if (!cond) issue(list, 'error', code, path, msg, hint); }
      req(L.title, 'SCHEMA_REQUIRED', 'title', 'title is missing');
      req(L.summary || L.bigIdea, 'SCHEMA_REQUIRED', 'summary', 'summary or bigIdea is missing');
      var sim = L.sim;
      if (sim) {
        var seen = {};
        function ident(id, path) {
          if (!S.ID_RE.test(id || '')) { issue(list, 'error', 'SCHEMA_ID', path, 'Invalid identifier "' + String(id).slice(0, 30) + '"', 'Use letters, digits and underscore, starting with a letter, max 24 chars'); return; }
          if (G.Expr && G.Expr.RESERVED.indexOf(id) >= 0) { issue(list, 'error', 'SCHEMA_ID', path, '"' + id + '" is reserved (constants, t and function names)'); return; }
          if (seen[id]) issue(list, 'error', 'SCHEMA_DUP', path, 'Duplicate identifier "' + id + '"'); seen[id] = true;
        }
        req(sim.params.length >= 1, 'SCHEMA_REQUIRED', 'sim.params', 'At least one param (slider) is required');
        sim.params.forEach(function (p, i) {
          var path = 'sim.params[' + i + ']'; ident(p.id, path + '.id');
          if (!isFinite(p.min) || !isFinite(p.max) || !isFinite(p.step) || !isFinite(p.value)) { issue(list, 'error', 'SCHEMA_NUMBER', path, 'min, max, step and value must all be numbers'); return; }
          if (!(p.min < p.max)) issue(list, 'error', 'SCHEMA_RANGE', path, 'min must be smaller than max');
          if (!(p.step > 0)) issue(list, 'error', 'SCHEMA_RANGE', path + '.step', 'step must be greater than 0');
          if (p.value < p.min || p.value > p.max) issue(list, 'error', 'SCHEMA_RANGE', path + '.value', 'value ' + p.value + ' is outside [' + p.min + ', ' + p.max + ']');
          (p.presets || []).forEach(function (q) { if (q.value < p.min || q.value > p.max) issue(list, 'warning', 'SCHEMA_RANGE', path + '.presets', 'preset "' + q.label + '" is outside the slider range'); });
        });
        sim.constants.forEach(function (c, i) { ident(c.id, 'sim.constants[' + i + '].id'); if (!isFinite(c.value)) issue(list, 'error', 'SCHEMA_NUMBER', 'sim.constants[' + i + ']', 'constant value must be a number'); });
        sim.state.forEach(function (s, i) { ident(s.id, 'sim.state[' + i + '].id'); req(s.initial !== undefined && s.rate !== undefined, 'SCHEMA_REQUIRED', 'sim.state[' + i + ']', 'state needs "initial" and "rate"'); });
        sim.derived.forEach(function (d, i) { ident(d.id, 'sim.derived[' + i + '].id'); req(d.expr !== undefined, 'SCHEMA_REQUIRED', 'sim.derived[' + i + '].expr', 'derived needs "expr"'); });
        if (sim.kind === 'ode') req(sim.state.length >= 1, 'KIND_MISMATCH', 'sim.state', 'kind "ode" needs at least one state variable');
        if (sim.kind === 'static' && sim.state.length) issue(list, 'error', 'KIND_MISMATCH', 'sim.state', 'kind "static" cannot have state variables');
        if (sim.view && !(sim.view.xmin < sim.view.xmax && sim.view.ymin < sim.view.ymax)) issue(list, 'error', 'SCHEMA_RANGE', 'sim.view', 'view needs xmin < xmax and ymin < ymax (numbers)');
        var sid = {}; sim.shapes.forEach(function (s, i) { if (sid[s.id]) issue(list, 'error', 'SCHEMA_DUP', 'sim.shapes[' + i + '].id', 'Duplicate shape id "' + s.id + '"'); sid[s.id] = true; });
      }
      L.tour.forEach(function (t, i) { req(t.title && t.text, 'SCHEMA_REQUIRED', 'tour[' + i + ']', 'tour step needs title and text'); });
      L.predictions.forEach(function (p, i) {
        var path = 'predictions[' + i + ']';
        req(p.question, 'SCHEMA_REQUIRED', path + '.question', 'question is missing');
        req(S.ANSWERS.indexOf(p.answer) >= 0, 'SCHEMA_ENUM', path + '.answer', 'answer must be increases, decreases or same');
        req(p.experiment.measure !== undefined, 'SCHEMA_REQUIRED', path + '.experiment.measure', 'experiment.measure is missing');
        if (p.experiment.at && !(p.experiment.at.t > 0 && p.experiment.at.t <= 600)) issue(list, 'error', 'SCHEMA_RANGE', path + '.experiment.at.t', 'at.t must be between 0 and 600');
      });
      L.claims.forEach(function (c, i) { req(c.text, 'SCHEMA_REQUIRED', 'claims[' + i + '].text', 'claim text is missing'); });
      return list;
    };

    G.Schema = S;
  }
  G.__player = G.__player || {};
  G.__player.schema = install;
  install(G);
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
