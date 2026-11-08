/* Glassbox.Auth: reads the user's own key from the <polli-connect> element (Pollinations Connect, BYOP).
 * The key lives in memory and the element's own sessionStorage only. This app never writes it anywhere else. */
(function (G) {
  'use strict';
  var Auth = {}, key = null, onChange = null, el = null, timer = null;
  var KEY_RE = /^sk_[A-Za-z0-9_-]{8,}$/;

  function scanStorage() {
    try {
      for (var i = 0; i < sessionStorage.length; i++) {
        var v = sessionStorage.getItem(sessionStorage.key(i));
        if (!v) continue;
        if (KEY_RE.test(v)) return v;
        if (v.indexOf('sk_') >= 0 && v[0] === '{') { try { var j = JSON.parse(v); for (var k in j) if (typeof j[k] === 'string' && KEY_RE.test(j[k])) return j[k]; } catch (e) { /* not JSON */ } }
      }
    } catch (e) { /* storage blocked */ }
    return null;
  }
  function read(e) {
    var k = (el && (el.apiKey || el.key || el.token)) || (e && e.detail && (e.detail.apiKey || e.detail.key)) || null;
    if (typeof k === 'string' && KEY_RE.test(k)) return k;
    return scanStorage();
  }
  function refresh(e) { var k = read(e); if (k !== key) { var had = !!key; key = k; if (onChange) onChange(!!k, had); } }

  Auth.init = function (o) {
    onChange = o.onChange; el = document.getElementById(o.elementId || 'connect');
    if (el) {
      el.setAttribute('app-key', o.appKey); el.setAttribute('budget', String(o.budget)); el.setAttribute('expiry', String(o.expiry));
      el.setAttribute('menu-links', JSON.stringify([{ label: 'Source code', href: o.repoUrl || '#' }]));
      ['change', 'connected', 'disconnected', 'connect', 'disconnect'].forEach(function (n) { el.addEventListener(n, refresh); });
    }
    window.addEventListener('focus', function () { refresh(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    var n = 0; clearInterval(timer); timer = setInterval(function () { refresh(); if (++n > 15) clearInterval(timer); }, 2000);
    refresh();
  };
  Auth.getKey = function () { return key; };
  Auth.isConnected = function () { return !!key; };
  Auth.disconnect = function () {
    try { for (var i = sessionStorage.length - 1; i >= 0; i--) { var k = sessionStorage.key(i), v = sessionStorage.getItem(k); if (v && v.indexOf('sk_') >= 0) sessionStorage.removeItem(k); } } catch (e) { /* ignore */ }
    var had = !!key; key = null; if (onChange && had) onChange(false, true);
  };
  Auth.refresh = refresh;
  Auth.__setKeyForDemo = function (k) { key = k; };
  G.Auth = Auth;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
