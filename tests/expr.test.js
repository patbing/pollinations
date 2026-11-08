'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');
const G = load(['js/util.js', 'js/expr.js']);
const E = G.Expr;
const ev = (src, env) => E.compile(E.parse(src).ast)(Object.assign(Object.create(null), env || {}));

test('precedence and associativity', () => {
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('2^-1'), 0.5);
  assert.equal(ev('1+2*3'), 7);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('10-4-3'), 3);
  assert.equal(ev('7%4'), 3);
});
test('comparisons, logic, ternary', () => {
  assert.equal(ev('1<2'), 1); assert.equal(ev('2<=1'), 0); assert.equal(ev('3==3'), 1); assert.equal(ev('3!=3'), 0);
  assert.equal(ev('1&&0'), 0); assert.equal(ev('1||0'), 1); assert.equal(ev('!0'), 1);
  assert.equal(ev('x>1 ? 10 : 20', { x: 2 }), 10);
  assert.equal(ev('x>1 ? 10 : x>0 ? 20 : 30', { x: 0.5 }), 20);
});
test('constants, variables, functions', () => {
  assert.ok(Math.abs(ev('2*pi') - 2 * Math.PI) < 1e-12);
  assert.equal(ev('max(1,5,3)'), 5);
  assert.equal(ev('clamp(5,0,2)'), 2);
  assert.equal(ev('if(1,7,9)'), 7);
  assert.ok(Math.abs(ev('rad(180)') - Math.PI) < 1e-12);
  assert.equal(ev('mod(-1,3)'), 2);
  assert.equal(ev('a*b', { a: 3, b: 4 }), 12);
  assert.equal(ev('1.5e2'), 150);
  assert.ok(Number.isNaN(ev('zzz')));
});
test('every whitelisted function evaluates', () => {
  for (const f of E.FUNCTIONS) {
    const src = ['atan2', 'pow', 'mod'].includes(f) ? f + '(1,2)' : ['clamp', 'lerp', 'if'].includes(f) ? f + '(1,2,3)' : f + '(0.5)';
    assert.equal(typeof ev(src), 'number', f);
  }
});
test('errors have codes and positions', () => {
  assert.throws(() => E.parse('1 +'), (e) => e.code === 'EXPR_PARSE' && e.pos >= 2);
  assert.throws(() => E.parse('foo(1)'), (e) => e.code === 'EXPR_UNKNOWN_FN' && /Functions:/.test(e.message));
  assert.throws(() => E.parse('sin(1,2)'), (e) => e.code === 'EXPR_ARITY');
  assert.throws(() => E.parse('2 $ 3'), (e) => e.code === 'EXPR_PARSE');
  assert.throws(() => E.parse('x'.repeat(301)), /longer than/);
  assert.throws(() => E.parse(''), /empty/);
});
test('ids and fns are collected; constants are not ids', () => {
  const r = E.parse('L*sin(theta)+pi');
  assert.deepEqual([...r.ids].sort(), ['L', 'theta']);
  assert.deepEqual(r.fns, ['sin']);
});
test('no access to prototype members', () => {
  const r = E.parse('constructor');
  assert.deepEqual(r.ids, ['constructor']);
  assert.ok(Number.isNaN(ev('constructor')));
  assert.ok(Number.isNaN(ev('__proto__')));
  assert.throws(() => E.parse('constructor(1)'), (e) => e.code === 'EXPR_UNKNOWN_FN');
});
test('toText pretty prints', () => {
  assert.equal(E.toText(E.parse('2*pi*sqrt(L/g)').ast), '2 · π · √(L/g)');
  assert.equal(E.toText(E.parse('theta^2').ast), 'theta²');
  assert.equal(E.toText(E.parse('(a+b)*c').ast), '(a + b) · c');
  assert.equal(E.toText(E.parse('a<=b').ast), 'a ≤ b');
  assert.equal(E.toText(E.parse('-(g/L)*sin(theta) - b*omega').ast), '−(g/L) · sin(theta) − b · omega');
});
