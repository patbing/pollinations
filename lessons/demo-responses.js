/* Glassbox.demoData: pre-recorded "model" replies for demo mode. The writer drafts contain planted defects so the
 * repair path runs on every demo build; the repair reply is the clean gallery lesson. Built from the gallery at load. */
(function (G) {
  'use strict';
  function strip(lesson) { var c = JSON.parse(JSON.stringify(lesson)); delete c.format; delete c.id; delete c.meta; delete c.sources; return c; }
  function byId(id) { return (G.gallery || []).filter(function (l) { return l.id === id; })[0]; }
  var drafts = {}, repairs = {}, critiques = {};

  var p = strip(byId('pendulum'));
  p.sim.shapes.forEach(function (s) { if (s.id === 'rod') s.x2 = 'len*sin(theta)'; });
  p.predictions[1].answer = 'increases';
  drafts.pendulum = '```json\n' + JSON.stringify(p) + '\n```';

  var pp = strip(byId('predator-prey'));
  pp.tour[1].text += ' [S7]'; pp.sim.time.dt = 0.5;
  drafts['predator-prey'] = JSON.stringify(pp);

  var eq = strip(byId('equilibrium'));
  eq.sim.charts[1].series[0].expr = 'x';
  drafts.equilibrium = JSON.stringify(eq);

  drafts.seasons = JSON.stringify(strip(byId('seasons')));

  ['pendulum', 'predator-prey', 'equilibrium', 'seasons'].forEach(function (id) { repairs[id] = JSON.stringify(strip(byId(id))); });

  critiques.pendulum = { verdict: 'minor', summary: 'Accurate overall; one figure should be worded as approximate.',
    issues: [{ severity: 'minor', target: 'tour:t5', problem: 'The 12% figure comes from a series approximation, so it is not exact.', fix: "Say 'about 12%'." }],
    claimSupport: [{ claim: 'c1', support: 'supported', note: 'Matches the small-angle formula in S1.' }, { claim: 'c2', support: 'supported', note: '' }, { claim: 'c3', support: 'supported', note: '' }, { claim: 'c4', support: 'supported', note: '' }] };
  ['predator-prey', 'equilibrium', 'seasons'].forEach(function (id) { critiques[id] = { verdict: 'ok', summary: 'No factual problems found; simplifications are labelled.', issues: [], claimSupport: [] }; });

  G.demoData = { drafts: drafts, repairs: repairs, critiques: critiques };
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
