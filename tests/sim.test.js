'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');
const G = load();
const lesson = (id) => G.Schema.normalize(plain(G.gallery.find((l) => l.id === id)), {}).lesson;
const build = (id) => G.Sim.build(lesson(id).sim);

test('pendulum period matches 2*pi*sqrt(L/g) within 1% for a small angle', () => {
  const m = build('pendulum');
  const rt = G.Sim.createRuntime(m, { theta0: 5, b: 0 });
  let prev = rt.env.theta, crossings = [], t = 0;
  while (t < 12 && crossings.length < 3) {
    rt.step(0.01, 100); t += 0.01;
    const th = rt.env.theta;
    if (prev > 0 && th <= 0) crossings.push(rt.t);
    prev = th;
  }
  const T = crossings[1] - crossings[0];
  assert.ok(Math.abs(T - rt.env.T0) / rt.env.T0 < 0.01, `T=${T} T0=${rt.env.T0}`);
});

test('pendulum conserves energy without friction', () => {
  const m = build('pendulum');
  const rt = G.Sim.createRuntime(m, { b: 0, theta0: 40 });
  const E0 = rt.env.E;
  rt.step(30, 20000);
  assert.ok(Math.abs(rt.env.E - E0) / E0 < 1e-4, `${E0} -> ${rt.env.E}`);
});

test('friction removes energy', () => {
  const m = build('pendulum');
  const rt = G.Sim.createRuntime(m, { b: 0.3 });
  const E0 = rt.env.E; rt.step(20, 20000);
  assert.ok(rt.env.E < E0 * 0.1);
});

test('Lotka-Volterra invariant drifts less than 1e-3 over 60 years', () => {
  const m = build('predator-prey');
  const rt = G.Sim.createRuntime(m, {});
  const inv = (e) => 0.01 * e.R - 0.8 * Math.log(e.R) + 0.02 * e.F - 0.6 * Math.log(e.F);
  const v0 = inv(rt.env); let worst = 0;
  for (let i = 0; i < 60; i++) { rt.step(1, 400); worst = Math.max(worst, Math.abs(inv(rt.env) - v0)); }
  assert.ok(worst < 1e-3, 'drift ' + worst);
});

test('equilibrium start stays put', () => {
  const m = build('predator-prey');
  const rt = G.Sim.createRuntime(m, { R0: 80, F0: 30 });
  rt.step(30, 20000);
  assert.ok(Math.abs(rt.env.R - 80) < 0.01 && Math.abs(rt.env.F - 30) < 0.01);
});

test('reaction approaches kf/(kf+kb) and a catalyst only speeds it up', () => {
  const m = build('equilibrium');
  const a = G.Sim.measure(m, { cat: 1 }, 'x', { t: 40, agg: 'final' });
  const b = G.Sim.measure(m, { cat: 5 }, 'x', { t: 40, agg: 'final' });
  assert.ok(Math.abs(a - 2 / 3) < 1e-6 && Math.abs(b - 2 / 3) < 1e-6);
  const early1 = G.Sim.measure(m, { cat: 1 }, 'x', { t: 1, agg: 'final' });
  const early5 = G.Sim.measure(m, { cat: 5 }, 'x', { t: 1, agg: 'final' });
  assert.ok(early5 > early1 * 1.5);
});

test('aggregates: mean, max, min', () => {
  const m = build('pendulum');
  const mx = G.Sim.measure(m, { theta0: 30 }, 'angleDeg', { t: 10, agg: 'max' });
  const mn = G.Sim.measure(m, { theta0: 30 }, 'angleDeg', { t: 10, agg: 'min' });
  const mean = G.Sim.measure(m, { theta0: 30 }, 'angleDeg', { t: 10, agg: 'mean' });
  assert.ok(Math.abs(mx - 30) < 0.5 && Math.abs(mn + 30) < 0.5 && Math.abs(mean) < 3);
});

test('verdict uses a relative tolerance', () => {
  assert.equal(G.Sim.verdict(100, 101, 0.02), 'same');
  assert.equal(G.Sim.verdict(100, 110, 0.02), 'increases');
  assert.equal(G.Sim.verdict(110, 100, 0.02), 'decreases');
  assert.equal(G.Sim.verdict(0, 0, 0.02), 'same');
});

test('seasons: Seoul solstice numbers', () => {
  const m = build('seasons');
  const env = G.Sim.staticEnv(m, {});
  assert.ok(Math.abs(env.decl - 23.44) < 0.05);
  assert.ok(Math.abs(env.elev - 75.94) < 0.1);
  assert.ok(env.dayLen > 14.4 && env.dayLen < 14.8);
});

test('blow-up is detected, state reverts and unstable is set', () => {
  const raw = plain(G.gallery[0]);
  raw.sim.state[1].rate = 'omega*omega*1e6 + 1e6';
  const { lesson: L } = G.Schema.normalize(raw, {});
  const m = G.Sim.build(L.sim);
  const rt = G.Sim.createRuntime(m, {});
  rt.step(200, 100000);
  assert.equal(rt.unstable, true);
  assert.ok(Number.isFinite(rt.env.theta) && Number.isFinite(rt.env.omega));
});

test('unknown names are compile errors with a hint, not exceptions at run time', () => {
  const raw = plain(G.gallery[0]); raw.sim.shapes[3].x2 = 'len*sin(theta)';
  const { lesson: L } = G.Schema.normalize(raw, {});
  const r = G.Sim.compile(L.sim);
  const e = r.issues.find((i) => i.code === 'EXPR_UNKNOWN_ID');
  assert.ok(e && /Known names/.test(e.hint));
  assert.throws(() => G.Sim.build(L.sim));
});

test('derived cycles are reported', () => {
  const raw = plain(G.gallery[0]);
  raw.sim.derived.push({ id: 'a1', label: 'a', expr: 'b1+1' }, { id: 'b1', label: 'b', expr: 'a1+1' });
  const { lesson: L } = G.Schema.normalize(raw, {});
  assert.ok(G.Sim.compile(L.sim).issues.some((i) => i.code === 'DERIVED_CYCLE'));
});
