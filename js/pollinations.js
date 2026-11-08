// Pollinations endpoints used by this app (all via https://gen.pollinations.ai):
//   POST /v1/chat/completions  (lesson writer + reviewer)   GET /image/{prompt} (cover illustration)
//   POST /v1/audio/speech      (narration)                   GET /text/models, /image/models, /audio/models
// Sign-in is Pollinations Connect (BYOP): the user's own key stays in this tab (sessionStorage) and is only sent
// to gen.pollinations.ai in an Authorization header. Wikipedia (CORS) is the only other host this app calls.
var CONFIG = { API_BASE: 'https://gen.pollinations.ai', APP_KEY: 'pk_REPLACE_ME', CONNECT_BUDGET: '1', CONNECT_EXPIRY: '7' };

(function (G) {
  'use strict';
  G.CONFIG = CONFIG;
  var U = null;
  var Net = {}, Models = {};

  // ------------------------------------------------------------------ errors
  function NetError(kind, message, extra) {
    var e = new Error(message); e.name = 'NetError'; e.kind = kind; e.message = message;
    extra = extra || {}; e.status = extra.status || 0; e.retryAfter = extra.retryAfter || 0; e.code = extra.code || ''; e.body = extra.body || '';
    return e;
  }
  Net.NetError = NetError;

  // ------------------------------------------------------------------ transport (replaceable: demo mode, tests)
  var transport = null, keyProvider = function () { return null; };
  function defaultTransport(req) {
    var init = { method: req.method || 'GET', headers: req.headers || {}, signal: req.signal, credentials: 'omit' };
    if (req.body !== undefined) init.body = req.body;
    return fetch(req.url, init);
  }
  Net.setTransport = function (fn) { transport = fn || null; };
  Net.getTransport = function () { return transport || defaultTransport; };
  Net.setKeyProvider = function (fn) { keyProvider = fn || function () { return null; }; };
  Net.urlFor = function (path) { return CONFIG.API_BASE + path; };

  // at most 2 in-flight Pollinations requests
  var inflight = 0, waiting = [];
  function acquire(signal) {
    return new Promise(function (resolve, reject) {
      function go() { inflight++; resolve(); }
      if (signal && signal.aborted) return reject(NetError('aborted', 'Cancelled'));
      if (inflight < 2) return go();
      var w = { go: go, reject: reject };
      waiting.push(w);
      if (signal) signal.addEventListener('abort', function () { var i = waiting.indexOf(w); if (i >= 0) { waiting.splice(i, 1); reject(NetError('aborted', 'Cancelled')); } });
    });
  }
  function release() { inflight = Math.max(0, inflight - 1); var w = waiting.shift(); if (w) w.go(); }

  function linkSignals(outer, ms) {
    var ctl = new AbortController(), timedOut = false, timer = null;
    if (ms) timer = setTimeout(function () { timedOut = true; ctl.abort(); }, ms);
    function onAbort() { ctl.abort(); }
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onAbort); }
    return { signal: ctl.signal, done: function () { if (timer) clearTimeout(timer); if (outer) outer.removeEventListener('abort', onAbort); }, timedOut: function () { return timedOut; } };
  }

  function mapStatus(status, text, retryAfter) {
    var msg = ''; try { var j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { msg = String(text || '').slice(0, 200); }
    msg = typeof msg === 'string' ? msg : JSON.stringify(msg);
    var x = { status: status, retryAfter: retryAfter, body: text };
    if (status === 401) return NetError('auth', 'Your Pollinations connection expired. Connect again to continue.', x);
    if (status === 402) return NetError('budget', 'Your Pollen budget for this app ran out. Top up or raise the budget at enter.pollinations.ai, then try again.', x);
    if (status === 403) return NetError('forbidden', "This model isn't available for your account. Choose another in Settings.", x);
    if (status === 429 || status === 503) return NetError('rate', 'Pollinations is busy.', x);
    if (status === 400) return NetError('bad_request', 'The model rejected the request: ' + msg, x);
    if (status >= 500) return NetError('server', 'Pollinations had a server problem (' + status + ').', x);
    return NetError('server', 'Unexpected response (' + status + ') ' + msg, x);
  }

  // Low-level request. Resolves to the response object on 2xx, otherwise rejects with NetError.
  Net.request = function (req, opts) {
    opts = opts || {};
    var isPolli = req.url.indexOf(CONFIG.API_BASE) === 0, paid = !!opts.paid;
    var p = paid ? acquire(opts.signal) : Promise.resolve();
    return p.then(function () {
      var link = linkSignals(opts.signal, opts.timeoutMs || 30000);
      var headers = Object.assign({}, req.headers || {});
      if (isPolli && opts.auth) { var k = keyProvider(); if (k) headers.Authorization = 'Bearer ' + k; }
      return Promise.resolve().then(function () { return (transport || defaultTransport)({ method: req.method || 'GET', url: req.url, headers: headers, body: req.body, signal: link.signal }); })
        .then(function (res) {
          link.done();
          if (res.status >= 200 && res.status < 300) return res;
          var ra = 0; try { ra = parseFloat(res.headers && res.headers.get && res.headers.get('Retry-After')) || 0; } catch (e) { }
          return Promise.resolve(res.text ? res.text() : '').then(function (t) { throw mapStatus(res.status, t, ra); });
        }, function (err) {
          link.done();
          if (err && err.name === 'NetError') throw err;
          if (link.timedOut()) throw NetError('timeout', 'The model took longer than ' + Math.round((opts.timeoutMs || 30000) / 1000) + ' s. Try again, or pick a faster model in Settings.');
          if (err && err.name === 'AbortError') throw NetError('aborted', 'Cancelled');
          throw NetError('network', "Can't reach Pollinations. Check your connection.");
        });
    }).then(function (res) { if (paid) release(); return res; }, function (err) { if (paid) release(); throw err; });
  };

  Net.withRetry = function (fn, opts) {
    opts = opts || {}; var attempts = opts.attempts || 3, n = 0, backoff = [2, 5, 10];
    U = U || G.Util;
    function run() {
      n++;
      return fn(n).catch(function (e) {
        if (!e || e.name !== 'NetError' || n >= attempts) throw e;
        var wait = 0;
        if (e.kind === 'rate') wait = e.retryAfter ? Math.min(30, Math.max(1, e.retryAfter)) : backoff[n - 1] || 10;
        else if ((e.kind === 'server' || e.kind === 'timeout') && n < 2) wait = 2;
        else throw e;
        if (opts.signal && opts.signal.aborted) throw NetError('aborted', 'Cancelled');
        if (opts.onWait) opts.onWait(wait, n);
        // Util.sleep rejects with a DOM AbortError on cancel; callers expect NetError kind 'aborted'
        return U.sleep(wait * 1000, opts.signal).then(run, function () { throw NetError('aborted', 'Cancelled'); });
      });
    }
    return run();
  };

  // ------------------------------------------------------------------ chat / image / speech
  var noResponseFormat = {}; // model -> true after a 400 about response_format
  Net.chat = function (o) {
    var body = { messages: o.messages, temperature: o.temperature === undefined ? 0.4 : o.temperature, max_tokens: o.maxTokens || 4000, stream: false };
    if (o.model) body.model = o.model;
    var key = o.model || '_default';
    if (o.json && !noResponseFormat[key]) body.response_format = { type: 'json_object' };
    function send() {
      return Net.request({ method: 'POST', url: Net.urlFor('/v1/chat/completions'), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        { paid: true, auth: true, signal: o.signal, timeoutMs: o.timeoutMs || 120000 });
    }
    var fellBack = false;
    function attempt(n) {
      return send().catch(function (e) {
        // a model the key may not use (403): retry once with the server default model rather than failing the build
        if (n < 3 && e.kind === 'forbidden' && body.model && !fellBack) { fellBack = true; delete body.model; return attempt(n + 1); }
        if (n < 3 && e.kind === 'bad_request' && body.response_format && /response_format|json_object/i.test(e.message + e.body)) { noResponseFormat[key] = true; delete body.response_format; return attempt(n + 1); }
        if (n < 3 && e.kind === 'bad_request' && body.max_tokens > 4000 && /max_tokens|max_completion/i.test(e.message + e.body)) { body.max_tokens = 4000; return attempt(n + 1); }
        throw e;
      });
    }
    return attempt(1).then(function (res) { return res.json(); }).then(function (j) {
      var ch = (j.choices && j.choices[0]) || {}, msg = ch.message || {};
      var text = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(function (p) { return p.text || ''; }).join('') : '');
      return { text: text, usage: j.usage || null, model: j.model || body.model || '', finishReason: ch.finish_reason || '', modelFallback: fellBack };
    });
  };

  Net.image = function (o) {
    var q = ['width=' + (o.width || 1024), 'height=' + (o.height || 576), 'seed=' + (o.seed || 1), 'safe=true', 'nologo=true'];
    if (o.model) q.push('model=' + encodeURIComponent(o.model));
    // shorten the prompt before encoding (slicing the encoded string can cut a %XX escape in half)
    var prompt = String(o.prompt || '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1'), enc = encodeURIComponent(prompt);
    while (enc.length > 1500 && prompt.length > 1) { prompt = prompt.slice(0, Math.floor(prompt.length * 0.9)).replace(/[\uD800-\uDBFF]$/, ''); enc = encodeURIComponent(prompt); }
    var url = Net.urlFor('/image/' + enc) + '?' + q.join('&');
    return Net.request({ method: 'GET', url: url }, { paid: true, auth: true, signal: o.signal, timeoutMs: o.timeoutMs || 60000 }).then(function (r) { return r.blob(); });
  };

  Net.speech = function (o) {
    // the catalogue's "voices" may be strings or objects; only a string goes on the wire
    var voice = typeof o.voice === 'string' ? o.voice : (o.voice && typeof o.voice === 'object' ? String(o.voice.id || o.voice.name || '') : '');
    var body = { input: String(o.text).slice(0, 600), voice: voice || 'alloy', response_format: 'mp3' };
    if (o.model) body.model = o.model;
    function send() {
      return Net.request({ method: 'POST', url: Net.urlFor('/v1/audio/speech'), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        { paid: true, auth: true, signal: o.signal, timeoutMs: o.timeoutMs || 60000 }).then(function (r) { return r.blob(); });
    }
    // U5: if the chosen model/voice is rejected, try once more with the server defaults
    return send().catch(function (e) {
      if (body.model && (e.kind === 'bad_request' || e.kind === 'forbidden' || (e.kind === 'server' && e.status >= 400 && e.status < 500))) { delete body.model; body.voice = 'alloy'; return send(); }
      throw e;
    });
  };

  Net.balance = function (o) {
    return Net.request({ method: 'GET', url: Net.urlFor('/account/balance') }, { auth: true, signal: o && o.signal, timeoutMs: 8000 })
      .then(function (r) { return r.json(); }).then(function (j) { var v = typeof j === 'number' ? j : (j && (j.balance !== undefined ? j.balance : j.pollen)); v = Number(v); return isFinite(v) ? v : null; })
      .catch(function () { return null; });
  };

  // ------------------------------------------------------------------ Wikipedia (CORS, no custom headers)
  function wikiBase(lang) { return 'https://' + (/^[a-z]{2,3}$/.test(lang || '') ? lang : 'en') + '.wikipedia.org/w/api.php'; }
  Net.wikiSearch = function (query, lang, o) {
    var url = wikiBase(lang) + '?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&srlimit=4&format=json&origin=*';
    return Net.request({ method: 'GET', url: url }, { signal: o && o.signal, timeoutMs: 10000 }).then(function (r) { return r.json(); })
      .then(function (j) { return ((j.query && j.query.search) || []).map(function (s) { return { pageid: s.pageid, title: s.title, snippet: String(s.snippet || '').replace(/<[^>]+>/g, '') }; }); });
  };
  Net.wikiExtracts = function (pageids, lang, o) {
    var url = wikiBase(lang) + '?action=query&prop=extracts%7Cinfo&exintro=1&explaintext=1&inprop=url&pageids=' + pageids.join('%7C') + '&format=json&origin=*';
    return Net.request({ method: 'GET', url: url }, { signal: o && o.signal, timeoutMs: 10000 }).then(function (r) { return r.json(); })
      .then(function (j) { var pages = (j.query && j.query.pages) || {}; return pageids.map(function (id) { var p = pages[id]; return p && p.extract ? { title: p.title, url: p.fullurl || ('https://en.wikipedia.org/?curid=' + id), extract: p.extract } : null; }).filter(Boolean); });
  };

  // ------------------------------------------------------------------ model catalogue
  function asList(j) { if (Array.isArray(j)) return j; if (j && Array.isArray(j.data)) return j.data; if (j && Array.isArray(j.models)) return j.models; return []; }
  function normModel(m) {
    if (typeof m === 'string') return { id: m, aliases: [], description: '', paidOnly: false, pricing: null, input: [], output: [], voices: [], reasoning: false };
    var id = m.name || m.id || '';
    var aliases = Array.isArray(m.aliases) ? m.aliases : (m.aliases ? [m.aliases] : []);
    return { id: String(id), aliases: aliases.map(String), description: m.description || '', paidOnly: !!(m.paid_only || m.paidOnly || m.tier === 'paid'), pricing: m.pricing || null,
      input: m.input_modalities || m.input || [], output: m.output_modalities || m.output || [], voices: Array.isArray(m.voices) ? m.voices : [], reasoning: !!m.reasoning };
  }
  var modelCache = null;
  Models.load = function (o) {
    if (modelCache && !(o && o.force)) return Promise.resolve(modelCache);
    function get(path) { return Net.request({ method: 'GET', url: Net.urlFor(path) }, { signal: o && o.signal, timeoutMs: 10000 }).then(function (r) { return r.json(); }).then(function (j) { return asList(j).map(normModel).filter(function (m) { return m.id; }); }).catch(function () { return null; }); }
    return Promise.all([get('/text/models'), get('/image/models'), get('/audio/models')]).then(function (r) {
      var res = { text: (r[0] || []).filter(function (m) { return !m.output.length || m.output.indexOf('text') >= 0; }), image: r[1] || [], audio: r[2] || [], ok: !!r[0], loadedAt: Date.now() };
      modelCache = res; return res;
    });
  };
  Models.reset = function () { modelCache = null; };
  function family(id) { return String(id).split(/[-/]/)[0].toLowerCase(); }
  Models.family = family;
  // prefs: array of keywords (first match wins). Returns ModelInfo or null.
  Models.pick = function (list, prefs, o) {
    o = o || {}; list = list || [];
    var exclude = o.exclude || [];
    var pool = list.filter(function (m) { return exclude.indexOf(m.id) < 0 && !(o.avoidFamilyOf && family(m.id) === family(o.avoidFamilyOf)); });
    for (var i = 0; i < prefs.length; i++) {
      var kw = prefs[i].toLowerCase();
      var hits = pool.filter(function (m) { return m.id.toLowerCase() === kw || m.aliases.some(function (a) { return a.toLowerCase() === kw; }); });
      if (!hits.length) hits = pool.filter(function (m) { return m.id.toLowerCase().indexOf(kw) >= 0 || m.aliases.some(function (a) { return a.toLowerCase().indexOf(kw) >= 0; }); });
      if (hits.length) return hits.filter(function (m) { return !m.paidOnly; })[0] || hits[0];
    }
    return null;
  };
  Models.PREFS = {
    writer: { fast: ['openai-fast', 'gemini-fast', 'mistral', 'openai'], balanced: ['openai', 'gemini', 'deepseek', 'claude', 'mistral'], best: ['claude', 'openai-large', 'gemini-large', 'gemini', 'openai'] },
    image: ['flux', 'z-image', 'zimage', 'turbo', 'gptimage', 'gpt-image'],
    speech: /tts|speech|audio|eleven/i
  };
  Models.pickSpeech = function (list) { return (list || []).filter(function (m) { return Models.PREFS.speech.test(m.id + ' ' + m.aliases.join(' ')); })[0] || null; };

  G.Net = Net; G.Models = Models; G.NetError = NetError;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
