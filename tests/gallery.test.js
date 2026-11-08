'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');
const G = load();

test('four gallery lessons with unique ids', () => {
  assert.equal(G.gallery.length, 4);
  assert.equal(new Set(G.gallery.map((l) => l.id)).size, 4);
});
for (const raw of load().gallery) {
  test(`gallery: ${raw.id} passes every check with no errors or warnings`, () => {
    const { lesson, issues } = G.Schema.normalize(plain(raw), {});
    assert.deepEqual(plain(issues.filter((i) => i.level !== 'info')), []);
    const rep = G.Checks.run(lesson, {});
    assert.deepEqual(plain(rep.issues.filter((i) => i.level !== 'info').map((i) => i.code + ' ' + i.path + ' ' + i.message)), []);
    assert.deepEqual(plain(rep.deadSliders), []);
    for (const p of lesson.predictions) assert.equal(rep.experiments[p.id].matches, true, p.id);
  });
  test(`gallery: ${raw.id} has the expected structure`, () => {
    const L = G.Schema.normalize(plain(raw), {}).lesson;
    assert.ok(L.tour.length >= 4 && L.tour.length <= 6);
    assert.ok(L.predictions.length >= 2 && L.predictions.length <= 3);
    assert.ok(L.claims.length >= 3 && L.claims.length <= 8);
    assert.ok(L.glossary.length >= 3);
    assert.ok(L.misconceptions.length >= 1);
    assert.ok(L.sources.length >= 2);
    assert.ok(L.sources.every((s) => /^https:\/\/en\.wikipedia\.org\//.test(s.url)));
    assert.ok(L.sim.readouts.length <= 4 && L.sim.readouts.length >= 1);
    // every non-simplification claim cites a source
    for (const c of L.claims) if (c.certainty === 'established') assert.ok(c.sources.length >= 1, c.id);
    // no tour step leaves a slider outside its range (also covered by checks); every step has text
    for (const t of L.tour) assert.ok(t.title && t.text.length > 20);
  });
}
test('predictions in gallery are not all the same answer', () => {
  for (const raw of G.gallery) {
    const answers = new Set(raw.predictions.map((p) => p.answer));
    assert.ok(answers.size >= 2, raw.id);
  }
});
test('predator-prey p3 is a simulation-measured verdict (needs a time horizon)', () => {
  const p3 = G.gallery[1].predictions[2];
  assert.equal(p3.experiment.at.t, 100);
});
