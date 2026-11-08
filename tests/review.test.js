'use strict';
// Regression tests for issues found in review.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');
const G = load();
const norm = (raw) => G.Schema.normalize(raw, {}).lesson;
const pend = () => plain(G.gallery[0]);
const ok = (body) => ({ status: 200, headers: { get: () => null }, json: async () => body, blob: async () => ({ size: 1 }), text: async () => '' });
const err = (status, m) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: m || 'no' } }) });

test('Object.prototype names are not treated as known identifiers', () => {
  const raw = pend(); raw.sim.shapes[3].x2 = 'constructor + toString';
  const ids = G.Checks.run(norm(raw), {}).issues.filter((i) => i.code === 'EXPR_UNKNOWN_ID').map((i) => i.message).join(' ');
  assert.match(ids, /constructor/); assert.match(ids, /toString/);
});

test('measure aggregates ignore a non-finite first sample', () => {
  const raw = pend();
  raw.sim.derived.push({ id: 'inv', label: 'inv', expr: '1/t' });
  const m = G.Sim.build(norm(raw).sim);
  const mx = G.Sim.measure(m, {}, 'inv', { t: 2, agg: 'max' }), mean = G.Sim.measure(m, {}, 'inv', { t: 2, agg: 'mean' });
  assert.ok(isFinite(mx) && mx > 1, 'max ' + mx); assert.ok(isFinite(mean), 'mean ' + mean);
});

test('checks do not crash on a lesson without a view', () => {
  const raw = pend(); delete raw.sim.view;
  const rep = G.Checks.run(norm(raw), {});
  assert.equal(rep.errors, 0);
});

test('local fixes re-check the normalized lesson (no stale shape indices) and clamp dt', () => {
  const raw = pend();
  raw.sim.shapes.unshift({ type: 'hexagon', id: 'junk' }); // dropped by normalize, reported at sim.shapes[0]
  raw.sim.time.dt = 0.5;
  const n = G.Schema.normalize(raw, {});
  const rep = G.Checks.run(n.lesson, {}); rep.issues = n.issues.concat(rep.issues);
  rep.errors = rep.issues.filter((i) => i.level === 'error').length;
  const before = n.lesson.sim.shapes.map((s) => s.id);
  const fx = G.Checks.applyLocalFixes(n.lesson, rep, {});
  assert.deepEqual(fx.lesson.sim.shapes.map((s) => s.id), before, 'no valid shape was dropped');
  assert.equal(fx.lesson.sim.time.dt, 0.1);
  assert.equal(fx.report.errors, 0);
  assert.ok(!fx.lesson.meta.simFallback, 'the real simulation is kept');
});

test('schema: language is a language tag, trimming never splits a surrogate pair', () => {
  const raw = pend(); raw.language = 'en" x="'; raw.title = 'a'.repeat(78) + '😀😀';
  const L = norm(raw);
  assert.equal(L.language, 'en');
  assert.doesNotThrow(() => encodeURIComponent(L.title));
});

test('withRetry: cancelling during a retry wait rejects with kind "aborted"', async () => {
  const G2 = load(); const ctl = new AbortController(); let calls = 0;
  const p = G2.Net.withRetry(() => { calls++; return Promise.reject(G2.Net.NetError('rate', 'busy')); }, { attempts: 3, signal: ctl.signal, onWait: () => setTimeout(() => ctl.abort(), 10) });
  await assert.rejects(p, (e) => e.kind === 'aborted');
  assert.equal(calls, 1);
});

test('net.image: long prompts are shortened before encoding (valid escapes, bounded length)', async () => {
  const G2 = load(); let url = '';
  G2.Net.setTransport(async (req) => { url = req.url; return ok({}); });
  await G2.Net.image({ prompt: 'é😀 '.repeat(600) + '\uD800', width: 10, height: 10 });
  const path = url.split('/image/')[1].split('?')[0];
  assert.ok(path.length <= 1500, 'length ' + path.length);
  assert.doesNotThrow(() => decodeURIComponent(path));
  assert.ok(!/Authorization|sk_/.test(url));
});

test('net.speech: object voices are sent as strings; a rejected model falls back to server defaults', async () => {
  const G2 = load(); const bodies = [];
  G2.Net.setTransport(async (req) => { const b = JSON.parse(req.body); bodies.push(b); return b.model ? err(400, 'unknown voice') : ok({}); });
  await G2.Net.speech({ text: 'hi', model: 'tts-x', voice: { id: 'nova' } });
  assert.equal(bodies.length, 2); assert.equal(bodies[0].voice, 'nova'); assert.equal(bodies[1].model, undefined); assert.equal(bodies[1].voice, 'alloy');
});

test('net.chat: a 403 for the chosen model retries once with the server default model', async () => {
  const G2 = load(); const bodies = [];
  G2.Net.setTransport(async (req) => { const b = JSON.parse(req.body); bodies.push(b); return b.model ? err(403) : ok({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }); });
  const r = await G2.Net.chat({ model: 'paid-model', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(bodies.length, 2); assert.equal(r.modelFallback, true);
  // a 403 without a model is final
  G2.Net.setTransport(async () => err(403));
  await assert.rejects(G2.Net.chat({ messages: [{ role: 'user', content: 'x' }] }), (e) => e.kind === 'forbidden');
});

test('export: attribute text is quoted safely; ids that merely contain "sk_" do not block the export', () => {
  const G2 = load();
  const L = norm(pend()); L.summary = 'risk_factor and task_runner_long_name'; L.language = 'en';
  const html = G2.Exporter.buildHtml(L, {});
  assert.match(html, /<html lang="en">/);
  const L2 = norm(pend()); L2.summary = 'a blob:https://x/y url';
  assert.throws(() => G2.Exporter.buildHtml(L2, {}), /blob URL/);
});

test('pipeline: Cancel during a "busy, retrying" wait ends the build as aborted', async () => {
  const G2 = load(); G2.Demo.latency = false; G2.Demo.enable({});
  const real = G2.Demo.transport;
  G2.Net.setTransport((req) => /chat\/completions/.test(req.url) ? Promise.resolve({ status: 429, headers: { get: () => '1' }, text: async () => '{}' }) : real(req));
  const models = await G2.Models.load({ force: true });
  const plan = G2.Pipeline.plan({ topic: 'pendulum', settings: { writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image', capPollen: 0.5, demo: true }, models });
  const ctl = new AbortController();
  const p = G2.Pipeline.run(plan, { signal: ctl.signal, onStage: (k, s, d) => { if (/busy/.test(d)) setTimeout(() => ctl.abort(), 5); } });
  await assert.rejects(p, (e) => e.kind === 'aborted');
});
