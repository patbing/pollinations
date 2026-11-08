/* Glassbox.Demo: a replacement transport for Glassbox.Net. The whole pipeline runs unchanged, but every "network"
 * call is answered locally from pre-recorded data. No Pollen is used and nothing leaves the browser. */
(function (G) {
  'use strict';
  var Demo = { enabled: false, busy: false, latency: true };
  var TOPICS = [
    { id: 'pendulum', re: /pendul|swing|clock/i }, { id: 'predator-prey', re: /predator|prey|fox|rabbit|lotka|volterra/i },
    { id: 'equilibri', alias: 'equilibrium', re: /equilibri|catalys|reaction|reversible/i }, { id: 'seasons', re: /season|tilt|daylight|summer|winter|solstice/i }];
  Demo.matchTopic = function (text) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].re.test(text || '')) return { id: TOPICS[i].alias || TOPICS[i].id, matched: true };
    return { id: 'pendulum', matched: false };
  };
  var busyServed = false, writerCalls = {};

  function resp(status, body, headers, kind) {
    var text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status: status, headers: { get: function (n) { return (headers || {})[n] || (headers || {})[String(n).toLowerCase()] || null; } },
      json: function () { return Promise.resolve(typeof body === 'string' ? JSON.parse(body) : JSON.parse(text)); }, text: function () { return Promise.resolve(text); },
      blob: function () { return Promise.resolve(kind === 'svg' ? new Blob([body], { type: 'image/svg+xml' }) : new Blob([text])); } };
  }
  function lessonIndex(id) { for (var i = 0; i < G.gallery.length; i++) if (G.gallery[i].id === id) return i; return 0; }
  function delay(ms, signal) {
    if (!Demo.latency) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); var e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
  }
  function seeded(url) { return 400 + (G.Util.hash(url) % 800); }
  function chatReply(content, pin, pout) { return { choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }], usage: { prompt_tokens: pin, completion_tokens: pout }, model: 'demo-model' }; }

  function coverSvg(seed) {
    var h = 200 + (seed % 120), h2 = (h + 60) % 360;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 576"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + h + ',55%,72%)"/><stop offset="1" stop-color="hsl(' + h2 + ',50%,45%)"/></linearGradient></defs>' +
      '<rect width="1024" height="576" fill="url(#g)"/><circle cx="780" cy="170" r="70" fill="hsl(45,90%,70%)" opacity=".9"/><circle cx="260" cy="400" r="150" fill="hsl(' + h2 + ',40%,35%)" opacity=".5"/><circle cx="420" cy="460" r="90" fill="hsl(' + h + ',40%,85%)" opacity=".45"/></svg>';
  }

  Demo.transport = function (req) {
    var url = req.url, signal = req.signal;
    return delay(seeded(url), signal).then(function () {
      if (/wikipedia\.org/.test(url)) {
        if (/list=search/.test(url)) {
          var q = decodeURIComponent((/srsearch=([^&]*)/.exec(url) || [])[1] || ''), m = Demo.matchTopic(q), idx = lessonIndex(m.id), L = G.gallery[idx];
          return resp(200, { query: { search: L.sources.map(function (s, i) { return { pageid: 1000 * (idx + 1) + i, title: s.title, snippet: s.supports }; }) } });
        }
        var ids = decodeURIComponent((/pageids=([^&]*)/.exec(url) || [])[1] || '').split('|').map(Number), pages = {};
        ids.forEach(function (pid) { var idx = Math.floor(pid / 1000) - 1, i = pid % 1000, s = G.gallery[idx] && G.gallery[idx].sources[i]; if (s) pages[pid] = { pageid: pid, title: s.title, fullurl: s.url, extract: s.supports + ' (Demo excerpt: pre-recorded text, not fetched from Wikipedia.)' }; });
        return resp(200, { query: { pages: pages } });
      }
      var path = url.replace(G.CONFIG.API_BASE, '');
      if (/^\/text\/models/.test(path)) return resp(200, [{ name: 'demo-writer', aliases: ['demo'], pricing: { promptTextTokens: 0, completionTextTokens: 0 }, output_modalities: ['text'] }, { name: 'demo-critic', pricing: { promptTextTokens: 0, completionTextTokens: 0 }, output_modalities: ['text'] }]);
      if (/^\/image\/models/.test(path)) return resp(200, [{ name: 'demo-image', pricing: { completionImageTokens: 0 }, output_modalities: ['image'] }]);
      if (/^\/audio\/models/.test(path)) return resp(200, [{ name: 'demo-tts', voices: ['alloy'] }]);
      if (/^\/account\/balance/.test(path)) return resp(200, { balance: 0 });
      if (/^\/v1\/audio\/speech/.test(path)) return resp(500, { error: { message: 'Demo mode has no speech model' } });
      if (/^\/image\//.test(path)) return resp(200, coverSvg(G.Util.hash(path)), { 'Content-Type': 'image/svg+xml' }, 'svg');
      if (/^\/v1\/chat\/completions/.test(path)) {
        var body = JSON.parse(req.body || '{}'), sys = (body.messages[0] || {}).content || '', user = (body.messages[1] || {}).content || '';
        var topicText = (/<topic>([\s\S]*?)<\/topic>/.exec(user) || [])[1] || '', m2 = Demo.matchTopic(topicText);
        if (/^You are a strict but fair/.test(sys)) {
          var lt = (/^Title: (.*)$/m.exec(user) || [])[1] || '', mc = Demo.matchTopic(lt);
          var out = JSON.stringify(G.demoData.critiques[mc.id] || G.demoData.critiques.pendulum);
          return resp(200, chatReply(out, 3500, 300));
        }
        if (/<errors>/.test(user)) return resp(200, chatReply(G.demoData.repairs[m2.id], 7000, 4500));
        if (Demo.busy && !busyServed) { busyServed = true; return resp(429, { error: { message: 'Busy' } }, { 'Retry-After': '2' }); }
        writerCalls[m2.id] = (writerCalls[m2.id] || 0) + 1;
        return resp(200, chatReply(G.demoData.drafts[m2.id], 9000, 4500));
      }
      return resp(404, { error: { message: 'Not found in demo mode' } });
    });
  };

  Demo.enable = function (o) { Demo.enabled = true; Demo.busy = !!(o && o.busy); busyServed = false; G.Net.setTransport(Demo.transport); };
  Demo.disable = function () { Demo.enabled = false; G.Net.setTransport(null); };
  Demo.reset = function () { busyServed = false; writerCalls = {}; };
  G.Demo = Demo;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
