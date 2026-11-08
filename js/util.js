/* Glassbox.Util: small helpers shared by the player and the app. Player module (inlined into exports). */
(function (G) {
  'use strict';
  function install(G) {
    var U = {};

    // Builds a DOM element. Text always goes in as text nodes, never as HTML.
    U.el = function (tag, attrs) {
      var e = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          var v = attrs[k];
          if (v === false || v === null || v === undefined) return;
          if (k === 'class') e.className = v;
          else if (k === 'text') e.textContent = v;
          else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
          else if (v === true) e.setAttribute(k, '');
          else e.setAttribute(k, String(v));
        });
      }
      for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
      return e;
    };
    function add(parent, c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(function (x) { add(parent, x); }); return; }
      if (typeof c === 'object' && c.nodeType) parent.appendChild(c);
      else parent.appendChild(document.createTextNode(String(c)));
    }

    // Number formatting for readouts.
    U.fmt = function (n, d) {
      if (typeof n !== 'number' || !isFinite(n)) return '–';
      var a = Math.abs(n);
      if (a >= 1e7 || (a > 0 && a < 1e-4)) return n.toExponential(2).replace('-', '−');
      if (d === undefined || d === null) d = a === 0 ? 0 : a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4;
      var s = n.toFixed(d);
      if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
      return s.replace('-', '−');
    };

    U.clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };

    U.mulberry32 = function (seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    U.hash = function (str) {
      var h = 2166136261;
      str = String(str);
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    };

    // "text [S1] more" -> [{type:'text',value},{type:'cite',value:'S1'},...]
    U.splitCitations = function (text) {
      var out = [], re = /\[(S\d{1,2})\]/g, last = 0, m;
      text = String(text === undefined || text === null ? '' : text);
      while ((m = re.exec(text))) {
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
        out.push({ type: 'cite', value: m[1] });
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
      return out;
    };
    U.stripCitations = function (text) { return String(text || '').replace(/\s*\[S\d{1,2}\]/g, '').replace(/\s{2,}/g, ' ').trim(); };
    U.slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lesson'; };

    U.sleep = function (ms, signal) {
      return new Promise(function (resolve, reject) {
        if (signal && signal.aborted) { var e0 = new Error('aborted'); e0.name = 'AbortError'; reject(e0); return; }
        var t = setTimeout(function () { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        function onAbort() { clearTimeout(t); var e = new Error('aborted'); e.name = 'AbortError'; reject(e); }
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    };

    U.download = function (name, data, mime) {
      var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
    };

    G.Util = U;
  }
  G.__player = G.__player || {};
  G.__player.util = install;
  install(G);
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
