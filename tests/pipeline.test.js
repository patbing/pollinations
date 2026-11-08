'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');

function setup() {
  const G = load();
  G.Demo.latency = false; G.Demo.enable({});
  return G;
}
async function build(G, topic, extra) {
  const models = await G.Models.load({ force: true });
  const settings = Object.assign({ writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image', reviewer: true, cover: true, capPollen: 0.5, demo: true }, extra || {});
  const plan = G.Pipeline.plan({ topic, level: 'highschool', settings, models });
  const stages = [];
  const res = await G.Pipeline.run(plan, { onStage: (k, s, d) => stages.push([k, s, d]) });
  return { res, stages, plan };
}

test('extractJson: fences, prose around, trailing commas, braces in strings, truncation', () => {
  const G = load(); const x = G.Pipeline.extractJson;
  assert.deepEqual(plain(x('```json\n{"a":1}\n```').value), { a: 1 });
  assert.deepEqual(plain(x('Sure! Here it is: {"a":{"b":"}{"},} thanks').value), { a: { b: '}{' } });
  assert.deepEqual(plain(x('﻿{"a":[1,2,],}').value), { a: [1, 2] });
  assert.ok(x('{"a":1').error.truncated);
  assert.ok(x('no json here').error);
  assert.ok(x('{"a": nope}').error);
});

test('demo build: pendulum draft has planted defects, repair fixes them, result is clean', async () => {
  const G = setup();
  const { res, stages } = await build(G, 'Why does a pendulum keep time?');
  assert.equal(res.lesson.meta.repairs, 1);
  assert.equal(res.report.errors, 0);
  assert.equal(res.lesson.sources.length, 3);
  assert.equal(res.lesson.sim.kind, 'ode');
  assert.equal(res.critic.verdict, 'minor');
  assert.ok(res.coverBlob);
  assert.ok(stages.some(([k, s]) => k === 'repair' && s === 'active'));
  assert.equal(res.spent, 0);
  assert.equal(res.lesson.meta.origin, 'demo');
  assert.equal(res.lesson.format, 'glassbox-lesson/1');
});

test('demo build: each topic reaches READY with zero errors', async () => {
  const G = setup();
  for (const [topic, id, repairs] of [['predator and prey', 'predator-prey', 1], ['does a catalyst change equilibrium', 'equilibrium', 1], ['why do we have seasons', 'seasons', 0]]) {
    const { res } = await build(G, topic);
    assert.equal(res.report.errors, 0, id);
    assert.equal(res.lesson.meta.repairs, repairs, id);
    assert.ok(res.lesson.sim.shapes.length >= 3, id);
  }
});

test('repair is skipped when it would exceed the cap and local fixes take over', async () => {
  const G = setup();
  // price the demo model so a repair costs more than the cap
  const real = G.Demo.transport;
  G.Net.setTransport((req) => real(req).then(async (r) => {
    if (/\/text\/models/.test(req.url)) return { ...r, json: async () => [{ name: 'demo-writer', pricing: { promptTextTokens: 0.001, completionTextTokens: 0.001 } }, { name: 'demo-critic', pricing: { promptTextTokens: 0, completionTextTokens: 0 } }] };
    return r;
  }));
  const models = await G.Models.load({ force: true });
  const plan = G.Pipeline.plan({ topic: 'pendulum', settings: { writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image', capPollen: 20 }, models });
  assert.ok(plan.estimate.worst > 0);
  const plan2 = G.Pipeline.plan({ topic: 'pendulum', settings: { writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image', capPollen: 12.5 }, models });
  // writer typical ~ 12.4 Pollen with these absurd prices: repair (worst) cannot fit under the cap
  const res = await G.Pipeline.run(plan2, {});
  assert.equal(res.report.errors, 0);
  assert.equal(res.lesson.meta.repairs, 0);
  assert.ok(res.report.removed.length >= 1);
});

test('a refusal ends the build with kind "refused"', async () => {
  const G = setup(); const real = G.Demo.transport;
  G.Net.setTransport((req) => real(req).then((r) => {
    if (/chat\/completions/.test(req.url)) return { ...r, json: async () => ({ choices: [{ message: { content: '{"refusal":"Not a science topic."}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
    return r;
  }));
  await assert.rejects(build(G, 'how do I get rich'), (e) => e.kind === 'refused' && /science/.test(e.message));
});

test('unparseable output is repaired through the JSON_PARSE path', async () => {
  const G = setup(); const real = G.Demo.transport; let n = 0;
  G.Net.setTransport((req) => real(req).then((r) => {
    if (/chat\/completions/.test(req.url) && JSON.parse(req.body).messages[0].content.indexOf('strict but fair') < 0 && n++ === 0)
      return { ...r, json: async () => ({ choices: [{ message: { content: '{"title": "cut off' }, finish_reason: 'length' }], usage: null }) };
    return r;
  }));
  const { res } = await build(G, 'pendulum');
  assert.equal(res.lesson.meta.repairs >= 1, true);
  assert.equal(res.report.errors, 0);
});

test('cancel aborts the build', async () => {
  const G = setup(); G.Demo.latency = true;
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 50);
  const models = await G.Models.load({ force: true });
  const plan = G.Pipeline.plan({ topic: 'pendulum', settings: { writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image' }, models });
  await assert.rejects(G.Pipeline.run(plan, { signal: ctl.signal }), (e) => e.kind === 'aborted');
});

test('busy server: 429 with Retry-After is retried', async () => {
  const G = load(); G.Demo.latency = false; G.Demo.enable({ busy: true });
  const waits = [];
  const models = await G.Models.load({ force: true });
  const plan = G.Pipeline.plan({ topic: 'pendulum', settings: { writer: 'demo-writer', critic: 'demo-critic', image: 'demo-image', cover: false, reviewer: false }, models });
  const t = Date.now();
  const res = await G.Pipeline.run(plan, { onStage: (k, s, d) => { if (/busy/.test(d)) waits.push(d); } });
  assert.ok(waits.length >= 1 && Date.now() - t >= 1900);
  assert.equal(res.report.errors, 0);
});

test('cost: pricing parser handles per-token, per-million and unknown shapes', () => {
  const G = load();
  const a = G.Cost.parsePricing({ pricing: { promptTextTokens: 0.0000002, completionTextTokens: '0.0000008' } });
  assert.ok(a.known && Math.abs(a.inTok - 2e-7) < 1e-12 && Math.abs(a.outTok - 8e-7) < 1e-12);
  const b = G.Cost.parsePricing({ pricing: { input: 0.15, output: 0.6 } });
  assert.ok(Math.abs(b.inTok - 1.5e-7) < 1e-12);
  assert.equal(G.Cost.parsePricing({}).known, false);
  const est = G.Cost.estimateLesson({ writer: { pricing: {} }, critic: null, image: null });
  assert.equal(est.unknown, true);
});
