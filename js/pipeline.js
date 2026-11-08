/* Glassbox.Pipeline: sources -> write -> check -> repair (max 2) -> local fallback -> review || cover.
 * Everything the model returns is untrusted data: it is parsed, normalized and checked before any use. */
(function (G) {
  'use strict';
  var Pipeline = {};
  var Net, Models, Cost, Prompts, Schema, Checks, U;
  function deps() { Net = G.Net; Models = G.Models; Cost = G.Cost; Prompts = G.Prompts; Schema = G.Schema; Checks = G.Checks; U = G.Util; }

  // ------------------------------------------------------------------ JSON extraction
  Pipeline.extractJson = function (text) {
    var s = String(text || '').replace(/^﻿/, '').trim();
    var fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
    if (fence && fence[1].indexOf('{') >= 0) s = fence[1].trim();
    var start = s.indexOf('{');
    if (start < 0) return { error: { message: 'no JSON object found', pos: 0 } };
    var depth = 0, inStr = false, esc = false, end = -1;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return { error: { message: 'the JSON object is not closed (the reply may have been cut off)', pos: s.length, truncated: true } };
    var body = s.slice(start, end + 1);
    try { return { value: JSON.parse(body) }; } catch (e1) {
      var fixed = body.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      try { return { value: JSON.parse(fixed) }; } catch (e2) {
        var m = /position (\d+)/.exec(e2.message);
        return { error: { message: String(e2.message).slice(0, 160), pos: m ? +m[1] : 0 } };
      }
    }
  };

  // ------------------------------------------------------------------ planning
  Pipeline.plan = function (o) {
    deps();
    var st = o.settings || {}, models = o.models || { text: [], image: [], audio: [] }, q = st.quality || 'balanced';
    function byId(list, id) { return list.filter(function (m) { return m.id === id; })[0]; }
    var writer = st.writer && st.writer !== 'auto' ? (byId(models.text, st.writer) || { id: st.writer, aliases: [] }) : Models.pick(models.text, Models.PREFS.writer[q] || Models.PREFS.writer.balanced);
    var critic = st.critic && st.critic !== 'auto' ? (byId(models.text, st.critic) || { id: st.critic, aliases: [] }) : Models.pick(models.text, Models.PREFS.writer.balanced, { avoidFamilyOf: writer && writer.id }) || writer;
    var image = st.image && st.image !== 'auto' ? (byId(models.image, st.image) || { id: st.image, aliases: [] }) : Models.pick(models.image, Models.PREFS.image);
    var plan = { topic: String(o.topic || '').trim(), level: o.level || 'highschool', language: o.language || st.language || 'English', settings: st, origin: o.origin || (st.demo ? 'demo' : 'generated'),
      models: { writer: writer || null, critic: critic || null, image: image || null }, withCritic: st.reviewer !== false, withCover: st.cover !== false, maxSources: o.maxSources || (st.demo ? 5 : 3) };
    plan.estimate = Cost.estimateLesson({ writer: plan.models.writer, critic: plan.models.critic, image: plan.models.image, promptChars: 9000 + plan.topic.length, withCritic: plan.withCritic, withCover: plan.withCover });
    return plan;
  };

  // ------------------------------------------------------------------ run
  function normReport(extra) { return extra; }

  Pipeline.run = function (plan, hooks) {
    deps(); hooks = hooks || {};
    var signal = hooks.signal, st = plan.settings || {}, cap = isFinite(st.capPollen) ? st.capPollen : 0.5, spent = 0, notes = [], t0 = {};
    var model = function (k) { return plan.models[k] ? plan.models[k].id : undefined; };
    var pricing = { writer: Cost.parsePricing(plan.models.writer), critic: Cost.parsePricing(plan.models.critic), image: Cost.parsePricing(plan.models.image) };
    var est = plan.estimate, lineOf = function (k) { return est.lines.filter(function (l) { return l.key === k; })[0] || {}; };
    function stage(key, status, detail) { if (hooks.onStage) hooks.onStage(key, status, detail || ''); }
    function addSpend(v) { spent += v || 0; if (hooks.onSpend) hooks.onSpend(spent); }
    function aborted() { if (signal && signal.aborted) throw Net.NetError('aborted', 'Cancelled'); }
    // a cancel can surface as NetError kind 'aborted' (fetch) or as a DOM AbortError (Util.sleep during a retry wait)
    function isStop(e) { return !!e && (e.kind === 'aborted' || e.name === 'AbortError' || e.kind === 'auth' || e.kind === 'budget' || (signal && signal.aborted)); }
    function asStop(e) { return e && e.name === 'AbortError' && !e.kind ? Net.NetError('aborted', 'Cancelled') : e; }
    function canAfford(worst) { return worst === null || worst === undefined || spent + worst <= cap; }
    function waitNote(key) { return function (sec, n) { stage(key, 'active', 'Pollinations is busy: retrying in ' + Math.round(sec) + 's (attempt ' + n + ' of 3)'); }; }

    var sources = [], writerRaw = '', repairs = 0, critic = null, coverBlob = null, report = null, lesson = null;
    var today = new Date().toISOString().slice(0, 10);

    // 1. sources
    function stageSources() {
      stage('sources', 'active', 'Searching Wikipedia');
      var lang = /^[a-z]{2,3}$/.test(plan.wikiLang || '') ? plan.wikiLang : 'en';
      function search(q) { return Net.wikiSearch(q, lang, { signal: signal }); }
      return search(plan.topic).then(function (r) { return r.length ? r : search(plan.topic.split(/\s+/).slice(0, 4).join(' ')); }).then(function (r) {
        var pick = r.filter(function (x) { return !/^List of/i.test(x.title) && !/may refer to/i.test(x.snippet); }).slice(0, plan.maxSources || 3);
        if (!pick.length) return [];
        return Net.wikiExtracts(pick.map(function (p) { return p.pageid; }), lang, { signal: signal });
      }).then(function (ex) {
        sources = ex.map(function (e, i) { return { id: 'S' + (i + 1), title: e.title, url: e.url, publisher: 'Wikipedia', excerpt: String(e.extract).slice(0, 1800), retrieved: today }; });
        stage('sources', sources.length ? 'done' : 'warn', sources.length ? sources.length + ' Wikipedia article' + (sources.length > 1 ? 's' : '') : 'No articles found');
      }).catch(function (e) { if (isStop(e)) throw asStop(e); sources = []; stage('sources', 'warn', "Couldn't reach Wikipedia"); notes.push({ level: 'warning', code: 'NO_SOURCES_FETCH', message: "We couldn't reach Wikipedia, so this lesson has no external sources. Treat every claim as unverified." }); });
    }

    function chat(messages, key, o) {
      return Net.withRetry(function () {
        return Net.chat({ model: model(o.who), messages: messages, temperature: o.temperature, maxTokens: o.maxTokens, json: true, signal: signal, timeoutMs: o.timeoutMs });
      }, { attempts: 3, signal: signal, onWait: waitNote(key) }).then(function (r) {
        var chars = { in: messages.reduce(function (a, m) { return a + m.content.length; }, 0), out: r.text.length };
        addSpend(Cost.fromUsage(r.usage, pricing[o.who], chars));
        if (r.modelFallback) notes.push({ level: 'info', code: 'MODEL_FALLBACK', message: (model(o.who) || 'The chosen model') + ' is not available for this key; the server default model was used.' });
        return r;
      });
    }

    function parseAndCheck(text, rawPrev) {
      var ex = Pipeline.extractJson(text);
      if (ex.error) return { parseError: ex.error, raw: text };
      if (ex.value && typeof ex.value.refusal === 'string' && !ex.value.sim) return { refusal: ex.value.refusal };
      var n = Schema.normalize(ex.value, { groundedSources: sources });
      if (!n.lesson.title) n.lesson.title = plan.topic.charAt(0).toUpperCase() + plan.topic.slice(1, 80); // a missing title is not worth a paid repair
      var rep = Checks.run(n.lesson, { groundedIds: sources.map(function (s) { return s.id; }) });
      rep.issues = n.issues.filter(function (i) { return i.level !== 'info'; }).concat(rep.issues);
      rep.errors = rep.issues.filter(function (i) { return i.level === 'error'; }).length; rep.warnings = rep.issues.filter(function (i) { return i.level === 'warning'; }).length; rep.ok = rep.errors === 0;
      return { lesson: n.lesson, report: rep };
    }

    function fail(msg, kind) { var e = Net.NetError(kind || 'fatal', msg); return e; }

    return Promise.resolve().then(stageSources).then(function () {
      aborted();
      // 2. write
      var wLine = lineOf('write');
      if (wLine.worst !== null && wLine.worst !== undefined && wLine.worst > cap) throw fail('This model could cost more than your ' + cap + ' Pollen cap for one lesson. Raise the cap in Settings or pick a cheaper model.', 'cap');
      stage('write', 'active', model('writer') || 'server default model');
      var started = Date.now();
      return chat(Prompts.writer({ topic: plan.topic, level: plan.level, language: plan.language, sources: sources }), 'write', { who: 'writer', temperature: 0.4, maxTokens: 8000, timeoutMs: 120000 }).then(function (r) {
        writerRaw = r.text; stage('write', 'done', Math.round((Date.now() - started) / 1000) + ' s' + (r.finishReason === 'length' ? ' · reply was cut off' : ''));
        return r;
      });
    }).then(function (r) {
      aborted();
      // 3. check (+ repair loop)
      stage('check', 'active', 'Running the simulation');
      var cur = parseAndCheck(r.text);
      if (cur.refusal) { var e = fail(cur.refusal, 'refused'); throw e; }
      var best = cur, round = 0;
      function errCount(c) { return c.parseError ? 999 : c.report.errors; }
      function loop() {
        if (!best.parseError) stage('check', best.report.errors ? 'warn' : 'done', summary(best.report));
        else stage('check', 'warn', 'The reply was not valid JSON');
        if (errCount(best) === 0 || round >= 2) return Promise.resolve(best);
        var rLine = lineOf('repair'), oneRepair = rLine.worst === null || rLine.worst === undefined ? null : rLine.worst / 2;
        if (!canAfford(oneRepair)) { notes.push({ level: 'info', code: 'SKIPPED', message: 'Skipped repair: would exceed your ' + cap + ' Pollen cap.' }); return Promise.resolve(best); }
        round++; repairs = round;
        var nErr = best.parseError ? 1 : best.report.errors;
        stage('repair', 'active', 'Round ' + round + ' of 2: ' + nErr + ' problem' + (nErr === 1 ? '' : 's') + ' sent back to the model');
        aborted();
        var msgs = Prompts.repair({ topic: plan.topic, level: plan.level, language: plan.language, sourceIds: sources.map(function (s) { return s.id; }), issues: best.parseError ? [] : best.report.issues, json: best.parseError ? null : best.lesson, raw: best.raw, parseError: best.parseError });
        return chat(msgs, 'repair', { who: 'writer', temperature: 0.2, maxTokens: 8000, timeoutMs: 120000 }).then(function (rr) {
          var next = parseAndCheck(rr.text);
          if (next.refusal) next = best;
          if (errCount(next) <= errCount(best)) best = next;
          stage('repair', 'done', 'Round ' + round + ': ' + (next.parseError ? 'not valid JSON' : next.report.errors + ' problem' + (next.report.errors === 1 ? '' : 's') + ' left'));
          return loop();
        }, function (er) { if (isStop(er)) throw asStop(er); stage('repair', 'warn', er.message); return best; });
      }
      return loop();
    }).then(function (best) {
      aborted();
      // 4. local fallback
      var ids = sources.map(function (s) { return s.id; });
      if (best.parseError) throw fail("The model's reply was not usable JSON, even after repair attempts. Try again or choose another model in Settings.", 'parse');
      lesson = best.lesson; report = best.report;
      var removed = [];
      if (report.errors) {
        stage('check', 'active', 'Fixing what we can locally');
        var fx = Checks.applyLocalFixes(lesson, report, { groundedIds: ids });
        lesson = fx.lesson; report = fx.report; removed = fx.removed;
        if (removed.length) notes.push({ level: 'warning', code: 'REMOVED', message: 'Some parts were removed: ' + removed.join(', ') + '.' });
        stage('check', report.errors ? 'warn' : 'done', summary(report) + (removed.length ? ' · local fixes applied' : ''));
      }
      report.removed = removed;
      // 5. review || cover
      var reviewP = plan.withCritic ? doReview() : (stage('review', 'skipped', 'Turned off in settings'), Promise.resolve(null));
      var coverP = plan.withCover && lesson.media && lesson.media.imagePrompt ? doCover() : (stage('cover', 'skipped', plan.withCover ? 'No image prompt' : 'Turned off in settings'), Promise.resolve(null));
      return Promise.all([reviewP, coverP]);
    }).then(function (r) {
      aborted();
      critic = r[0]; coverBlob = r[1];
      lesson.format = Schema.FORMAT; lesson.id = U.slug(lesson.title || plan.topic) || 'lesson'; lesson.sources = sources;
      lesson.level = plan.level; lesson.language = lesson.language || 'en';
      lesson.meta = Object.assign({}, lesson.meta || {}, { origin: plan.origin, createdAt: new Date().toISOString(), models: { writer: model('writer') || '', critic: model('critic') || '', image: model('image') || '' },
        spentPollen: spent, checks: { runs: report.runs, errors: report.errors, warnings: report.warnings }, critic: critic, repairs: repairs });
      return { lesson: lesson, report: report, critic: critic, coverBlob: coverBlob, spent: spent, notes: notes };
    });

    function summary(rep) { return U.fmt(rep.runs, 0) + ' runs · ' + rep.errors + ' error' + (rep.errors === 1 ? '' : 's') + ' · ' + rep.warnings + ' warning' + (rep.warnings === 1 ? '' : 's'); }

    function doReview() {
      var line = lineOf('review');
      if (!canAfford(line.worst)) { stage('review', 'skipped', 'Would exceed your ' + cap + ' Pollen cap'); notes.push({ level: 'info', code: 'SKIPPED', message: 'Skipped the reviewer: would exceed your ' + cap + ' Pollen cap.' }); return Promise.resolve(null); }
      stage('review', 'active', model('critic') || 'server default model');
      return chat(Prompts.critic({ lesson: lesson, report: report, sources: sources }), 'review', { who: 'critic', temperature: 0.2, maxTokens: 1500, timeoutMs: 60000 }).then(function (r) {
        var ex = Pipeline.extractJson(r.text);
        if (ex.error || !ex.value) { stage('review', 'warn', 'The reviewer reply could not be read'); return null; }
        var v = ex.value, verdict = ['ok', 'minor', 'major'].indexOf(v.verdict) >= 0 ? v.verdict : 'minor';
        var out = { verdict: verdict, summary: String(v.summary || '').slice(0, 300), model: model('critic') || '',
          issues: (Array.isArray(v.issues) ? v.issues : []).slice(0, 8).map(function (i) { i = i || {}; return { severity: i.severity === 'major' ? 'major' : 'minor', target: String(i.target || '').slice(0, 60), problem: String(i.problem || '').slice(0, 300), fix: String(i.fix || '').slice(0, 300) }; }),
          claimSupport: (Array.isArray(v.claimSupport) ? v.claimSupport : []).slice(0, 10).map(function (c) { c = c || {}; return { claim: String(c.claim || '').slice(0, 12), support: ['supported', 'partly', 'not_in_sources', 'wrong'].indexOf(c.support) >= 0 ? c.support : 'partly', note: String(c.note || '').slice(0, 200) }; }) };
        stage('review', verdict === 'ok' ? 'done' : 'warn', 'Verdict: ' + verdict);
        return out;
      }, function (e) { if (isStop(e)) throw asStop(e); stage('review', 'warn', e.message); return null; });
    }

    function doCover() {
      var line = lineOf('cover');
      if (!canAfford(line.worst)) { stage('cover', 'skipped', 'Would exceed your ' + cap + ' Pollen cap'); notes.push({ level: 'info', code: 'SKIPPED', message: 'Skipped the cover: would exceed your ' + cap + ' Pollen cap.' }); return Promise.resolve(null); }
      stage('cover', 'active', model('image') || 'server default model');
      return Net.withRetry(function () { return Net.image({ prompt: Prompts.imagePrompt(lesson), model: model('image'), width: 1024, height: 576, seed: U.hash(plan.topic) % 100000, signal: signal, timeoutMs: 60000 }); }, { attempts: 2, signal: signal, onWait: waitNote('cover') })
        .then(function (b) { addSpend(pricing.image.perImage || 0); stage('cover', 'done', model('image') || 'default'); return b; },
          function (e) { if (isStop(e)) throw asStop(e); stage('cover', 'warn', 'Skipped: ' + (e.kind === 'network' ? 'the image could not be loaded' : e.message)); return null; });
    }
  };

  G.Pipeline = Pipeline;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
