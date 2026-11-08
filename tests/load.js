// Loads the browser scripts (classic IIFE files) into a Node vm context for unit tests.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

const ORDER = ['js/pollinations.js', 'js/util.js', 'js/expr.js', 'js/schema.js', 'js/sim-engine.js', 'js/checks.js', 'js/cost.js',
  'js/prompts.js', 'js/pipeline.js', 'lessons/gallery.js', 'lessons/demo-responses.js', 'js/demo-transport.js', 'js/export-css.js', 'js/lesson-view.js', 'js/export.js'];

function load(files, extra) {
  const sandbox = Object.assign({
    console, setTimeout, clearTimeout, AbortController, Promise, Math, Date, JSON, Number, Object, Array, String, Error, isFinite, Blob,
    URL, TextEncoder, structuredClone
  }, extra || {});
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of (files || ORDER)) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }
  return sandbox.Glassbox;
}
const plain = (x) => JSON.parse(JSON.stringify(x));
module.exports = { load, plain, ROOT };
