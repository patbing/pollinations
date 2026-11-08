'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');
const G = load();
const norm = (raw) => G.Schema.normalize(raw, {}).lesson;
const pend = () => plain(G.gallery[0]);
const codes = (rep, level) => rep.issues.filter((i) => !level || i.level === level).map((i) => i.code);

test('a clean lesson has no errors and counts its runs', () => {
  const rep = G.Checks.run(norm(pend()), {});
  assert.equal(rep.errors, 0); assert.ok(rep.runs > 1000 && rep.sets >= 50);
});
test('unknown identifier is reported with a path', () => {
  const raw = pend(); raw.sim.shapes[3].x2 = 'len*sin(theta)';
  const rep = G.Checks.run(norm(raw), {});
  const e = rep.issues.find((i) => i.code === 'EXPR_UNKNOWN_ID');
  assert.ok(e && e.path === 'sim.shapes[3].x2');
});
test('a wrong prediction answer is a PREDICTION_MISMATCH carrying the computed verdict', () => {
  const raw = pend(); raw.predictions[1].answer = 'increases';
  const rep = G.Checks.run(norm(raw), {});
  const e = rep.issues.find((i) => i.code === 'PREDICTION_MISMATCH');
  assert.ok(e && e.data.verdict === 'same' && /Period/.test(e.message));
});
test('unknown citations are errors in text and claims', () => {
  const raw = pend(); raw.tour[1].text += ' See [S7].'; raw.claims[0].sources = ['S9'];
  const rep = G.Checks.run(norm(raw), {});
  assert.equal(codes(rep, 'error').filter((c) => c === 'CITE_UNKNOWN').length, 2);
});
test('dt out of range', () => {
  const raw = pend(); raw.sim.time.dt = 0.5;
  assert.ok(codes(G.Checks.run(norm(raw), {})).includes('DT_RANGE'));
});
test('sweep series that depend on state are rejected', () => {
  const raw = pend(); raw.sim.charts[1].series[0].expr = 'theta';
  assert.ok(codes(G.Checks.run(norm(raw), {})).includes('SWEEP_NOT_STATIC'));
});
test('division by zero at some settings is NONFINITE', () => {
  const raw = pend(); raw.sim.derived[0].expr = '2*pi*sqrt(L/(g-g))';
  const rep = G.Checks.run(norm(raw), {});
  assert.ok(codes(rep, 'error').includes('NONFINITE'));
});
test('nothing moves is an error for ode', () => {
  const raw = pend(); raw.sim.shapes = raw.sim.shapes.filter((s) => s.type === 'line' && s.id === 'ceiling');
  raw.tour.forEach((t) => (t.highlight = []));
  assert.ok(codes(G.Checks.run(norm(raw), {})).includes('NOTHING_MOVES'));
});
test('dead slider warning', () => {
  const raw = pend(); raw.sim.params.push({ id: 'zzz', label: 'Unused', unit: '', min: 0, max: 1, step: 0.1, value: 0.5 });
  const rep = G.Checks.run(norm(raw), {});
  assert.deepEqual(plain(rep.deadSliders), ['zzz']);
});
test('tour and experiment parameter checks', () => {
  const raw = pend(); raw.tour[0].set.nope = 3; raw.tour[1].set.L = 99; raw.predictions[0].experiment.to.L = 99;
  const c = codes(G.Checks.run(norm(raw), {}), 'error');
  assert.equal(c.filter((x) => x === 'TOUR_SET').length, 2); assert.ok(c.includes('EXP_PARAM'));
});
test('time charts are rejected in static sims', () => {
  const raw = plain(G.gallery[3]); raw.sim.charts[0].type = 'time';
  assert.ok(codes(G.Checks.run(norm(raw), {})).includes('KIND_MISMATCH'));
});
test('checks are deterministic', () => {
  const a = G.Checks.run(norm(pend()), {}), b = G.Checks.run(norm(pend()), {});
  assert.equal(a.runs, b.runs); assert.deepEqual(plain(a.experiments), plain(b.experiments));
});

test('local fixes: removes broken shapes, strips citations, corrects answers', () => {
  const raw = pend(); raw.sim.shapes[3].x2 = 'len*sin(theta)'; raw.predictions[1].answer = 'increases'; raw.tour[0].text += ' [S8]';
  const L = norm(raw), rep = G.Checks.run(L, {});
  assert.ok(rep.errors >= 2);
  const out = G.Checks.applyLocalFixes(L, rep);
  assert.equal(out.report.errors, 0);
  assert.ok(!out.lesson.sim.shapes.some((s) => s.id === 'rod'));
  assert.equal(out.lesson.predictions[1].answer, 'same'); assert.equal(out.lesson.predictions[1].correctedBySim, true);
  assert.ok(out.removed.length >= 3);
});
test('local fixes: broken core falls back to the relationship explorer', () => {
  const raw = pend(); raw.sim.state[1].rate = 'zzz*omega';
  const L = norm(raw), rep = G.Checks.run(L, {});
  const out = G.Checks.applyLocalFixes(L, rep);
  assert.equal(out.lesson.meta.simFallback, 'explorer');
  assert.equal(out.lesson.sim.kind, 'static');
  assert.equal(out.report.errors, 0, JSON.stringify(out.report.issues.filter((i) => i.level === 'error')));
  assert.ok(out.lesson.sim.charts.length === 1 && out.lesson.sim.readouts.length >= 1);
});
test('local fixes: nothing usable gives a no-sim lesson', () => {
  const raw = pend(); raw.sim.derived = []; raw.sim.state[1].rate = 'zzz'; raw.sim.shapes = []; raw.sim.charts = [];
  raw.sim.readouts = []; raw.predictions = []; raw.tour.forEach((t) => (t.highlight = []));
  const L = norm(raw), rep = G.Checks.run(L, {});
  const out = G.Checks.applyLocalFixes(L, rep);
  assert.equal(out.lesson.sim, null); assert.equal(out.lesson.meta.simFallback, 'none');
});
