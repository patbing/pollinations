/* Glassbox.Exporter: builds a single self-contained HTML file for a lesson (no network, no model calls). */
(function (G) {
  'use strict';
  var Ex = {};
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  Ex.lessonJson = function (lesson) {
    var c = JSON.parse(JSON.stringify(lesson));
    return JSON.stringify(c, null, 2);
  };
  Ex.buildHtml = function (lesson, o) {
    o = o || {};
    var P = G.__player;
    if (!P || !P.util || !P.expr || !P.schema || !P.sim || !P.view) throw new Error('Player modules are not registered');
    var data = { lesson: lesson, report: o.report || null, critic: o.critic || null, cover: o.coverDataUrl || null };
    var json = JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
    var models = lesson.meta && lesson.meta.models ? [lesson.meta.models.writer, lesson.meta.models.critic, lesson.meta.models.image].filter(Boolean).join(', ') : '';
    var foot = 'Made with Glassbox Lab' + (models ? ' · models: ' + models : '') + ' · via pollinations.ai · AI-generated, checked by simulation; may contain errors.';
    var src = ['util', 'expr', 'schema', 'sim', 'view'].map(function (k) { return '(' + P[k].toString() + ')(G);'; }).join('\n');
    var html = '<!doctype html>\n<html lang="' + esc(lesson.language || 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; media-src data:">\n' +
      '<title>' + esc(lesson.title) + ' · Glassbox Lab</title>\n<style>\n' + (G.__css || '') + '\n</style></head>\n<body><main class="wrap" id="app"></main>\n' +
      '<footer class="wrap gb-exportfoot"><p>' + esc(foot) + '</p></footer>\n' +
      '<script type="application/json" id="lesson">' + json + '</script>\n<script>\n(function(){\n"use strict";\nvar G = window.Glassbox = {};\n' + src +
      '\nvar d = JSON.parse(document.getElementById("lesson").textContent);\nG.View.renderLesson(document.getElementById("app"), d.lesson, { mode: "export", report: d.report, critic: d.critic, coverUrl: d.cover, hooks: {} });\n})();\n</script></body></html>\n';
    // key guard: the live key itself, or anything shaped like a secret key (word boundary, so ids like "risk_factor" pass)
    var liveKey = G.Auth && G.Auth.getKey ? G.Auth.getKey() : null;
    if ((liveKey && html.indexOf(liveKey) >= 0) || /\bsk_[A-Za-z0-9_-]{8,}/.test(html)) throw new Error('Export blocked: the output looks like it contains an API key.');
    if (/blob:(https?:|null)/.test(html)) throw new Error('Export blocked: the output contains a blob URL.');
    return html;
  };
  G.Exporter = Ex;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
