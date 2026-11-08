/* Glassbox.Expr: whitelisted expression language. Parses to an AST and compiles to closures. No eval, no Function.
 * Player module (inlined into exports). */
(function (G) {
  'use strict';
  function install(G) {
    var E = {};
    function ExprError(message, pos, code) {
      this.name = 'ExprError'; this.message = message; this.pos = pos || 0; this.code = code || 'EXPR_PARSE';
    }
    ExprError.prototype = Object.create(Error.prototype);
    E.ExprError = ExprError;

    var INF = Infinity;
    function lerp(a, b, u) { return a + (b - a) * u; }
    // name -> [minArgs, maxArgs, fn]
    var FUNCTIONS = {
      sin: [1, 1, Math.sin], cos: [1, 1, Math.cos], tan: [1, 1, Math.tan],
      asin: [1, 1, Math.asin], acos: [1, 1, Math.acos], atan: [1, 1, Math.atan], atan2: [2, 2, Math.atan2],
      sinh: [1, 1, Math.sinh], cosh: [1, 1, Math.cosh], tanh: [1, 1, Math.tanh],
      sqrt: [1, 1, Math.sqrt], cbrt: [1, 1, Math.cbrt], abs: [1, 1, Math.abs], exp: [1, 1, Math.exp],
      ln: [1, 1, Math.log], log: [1, 1, Math.log], log10: [1, 1, Math.log10], pow: [2, 2, Math.pow],
      min: [1, INF, Math.min], max: [1, INF, Math.max], hypot: [1, INF, Math.hypot],
      floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], round: [1, 1, Math.round], sign: [1, 1, Math.sign],
      clamp: [3, 3, function (x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }],
      lerp: [3, 3, lerp],
      mod: [2, 2, function (a, b) { return ((a % b) + b) % b; }],
      rad: [1, 1, function (d) { return d * Math.PI / 180; }],
      deg: [1, 1, function (r) { return r * 180 / Math.PI; }],
      'if': [3, 3, function (c, a, b) { return c ? a : b; }]
    };
    var CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
    E.FUNCTIONS = Object.keys(FUNCTIONS);
    E.RESERVED = Object.keys(CONSTANTS).concat(['t'], E.FUNCTIONS);
    E.MAX_LENGTH = 300;
    function isFn(n) { return Object.prototype.hasOwnProperty.call(FUNCTIONS, n); }

    // ---- tokenizer ----
    function tokenize(src) {
      var toks = [], i = 0, n = src.length, m;
      while (i < n) {
        var c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
          m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
          toks.push({ k: 'num', v: parseFloat(m[0]), pos: i }); i += m[0].length; continue;
        }
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
          m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
          toks.push({ k: 'id', v: m[0], pos: i }); i += m[0].length; continue;
        }
        var two = src.substr(i, 2);
        if (two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '&&' || two === '||') { toks.push({ k: 'op', v: two, pos: i }); i += 2; continue; }
        if ('+-*/%^(),?:<>!'.indexOf(c) >= 0) { toks.push({ k: 'op', v: c, pos: i }); i++; continue; }
        throw new ExprError('Unexpected character "' + c + '"', i);
      }
      toks.push({ k: 'end', v: '', pos: n });
      return toks;
    }

    // ---- parser (precedence climbing) ----
    E.parse = function (src) {
      if (typeof src === 'number') src = String(src);
      if (typeof src !== 'string') throw new ExprError('Expression must be a string or number', 0);
      if (src.length > E.MAX_LENGTH) throw new ExprError('Expression is longer than ' + E.MAX_LENGTH + ' characters', E.MAX_LENGTH);
      if (!src.trim()) throw new ExprError('Expression is empty', 0);
      var toks = tokenize(src), p = 0, ids = {}, fns = {};
      function peek() { return toks[p]; }
      function isOp(v) { var t = toks[p]; return t.k === 'op' && t.v === v; }
      function eat(v) {
        if (!isOp(v)) throw new ExprError('Expected "' + v + '" but found ' + describe(toks[p]) + ' at position ' + toks[p].pos, toks[p].pos);
        return toks[p++];
      }
      function describe(t) { return t.k === 'end' ? 'end of expression' : '"' + t.v + '"'; }

      function ternary() {
        var c = or();
        if (isOp('?')) { p++; var a = ternary(); eat(':'); var b = ternary(); return { t: 'tern', c: c, a: a, b: b }; }
        return c;
      }
      function or() { var l = and(); while (isOp('||')) { p++; l = { t: 'bin', op: '||', a: l, b: and() }; } return l; }
      function and() { var l = eq(); while (isOp('&&')) { p++; l = { t: 'bin', op: '&&', a: l, b: eq() }; } return l; }
      function eq() { var l = rel(); while (isOp('==') || isOp('!=')) { var o = toks[p++].v; l = { t: 'bin', op: o, a: l, b: rel() }; } return l; }
      function rel() { var l = add(); while (isOp('<') || isOp('<=') || isOp('>') || isOp('>=')) { var o = toks[p++].v; l = { t: 'bin', op: o, a: l, b: add() }; } return l; }
      function add() { var l = mul(); while (isOp('+') || isOp('-')) { var o = toks[p++].v; l = { t: 'bin', op: o, a: l, b: mul() }; } return l; }
      function mul() { var l = unary(); while (isOp('*') || isOp('/') || isOp('%')) { var o = toks[p++].v; l = { t: 'bin', op: o, a: l, b: unary() }; } return l; }
      function unary() {
        if (isOp('-') || isOp('+') || isOp('!')) { var o = toks[p++].v; return { t: 'un', op: o, a: unary() }; }
        return pow();
      }
      function pow() {
        var base = primary();
        if (isOp('^')) { p++; return { t: 'bin', op: '^', a: base, b: unary() }; }
        return base;
      }
      function primary() {
        var t = toks[p];
        if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
        if (t.k === 'id') {
          p++;
          if (isOp('(')) {
            p++;
            var args = [];
            if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { p++; args.push(ternary()); } }
            eat(')');
            if (!isFn(t.v)) throw new ExprError('Unknown function "' + t.v + '". Functions: ' + E.FUNCTIONS.join(', '), t.pos, 'EXPR_UNKNOWN_FN');
            var f = FUNCTIONS[t.v];
            if (args.length < f[0] || args.length > f[1]) {
              throw new ExprError('Function ' + t.v + ' takes ' + (f[0] === f[1] ? f[0] : f[0] + (f[1] === INF ? ' or more' : ' to ' + f[1])) + ' argument(s), got ' + args.length, t.pos, 'EXPR_ARITY');
            }
            fns[t.v] = true;
            return { t: 'call', fn: t.v, args: args };
          }
          if (Object.prototype.hasOwnProperty.call(CONSTANTS, t.v)) return { t: 'const', n: t.v, v: CONSTANTS[t.v] };
          ids[t.v] = true;
          return { t: 'id', n: t.v };
        }
        if (isOp('(')) { p++; var e = ternary(); eat(')'); return e; }
        throw new ExprError('Unexpected ' + describe(t) + ' at position ' + t.pos, t.pos);
      }
      var ast = ternary();
      if (toks[p].k !== 'end') throw new ExprError('Unexpected ' + describe(toks[p]) + ' at position ' + toks[p].pos, toks[p].pos);
      return { ast: ast, ids: Object.keys(ids), fns: Object.keys(fns), src: src };
    };

    // ---- compile to closures ----
    E.compile = function (ast) {
      function c(n) {
        switch (n.t) {
          case 'num': case 'const': { var v = n.v; return function () { return v; }; }
          case 'id': { var name = n.n; return function (env) { var x = env[name]; return x === undefined ? NaN : x; }; }
          case 'un': {
            var a = c(n.a);
            if (n.op === '-') return function (env) { return -a(env); };
            if (n.op === '+') return a;
            return function (env) { return a(env) ? 0 : 1; };
          }
          case 'bin': {
            var l = c(n.a), r = c(n.b);
            switch (n.op) {
              case '+': return function (env) { return l(env) + r(env); };
              case '-': return function (env) { return l(env) - r(env); };
              case '*': return function (env) { return l(env) * r(env); };
              case '/': return function (env) { return l(env) / r(env); };
              case '%': return function (env) { return l(env) % r(env); };
              case '^': return function (env) { return Math.pow(l(env), r(env)); };
              case '<': return function (env) { return l(env) < r(env) ? 1 : 0; };
              case '<=': return function (env) { return l(env) <= r(env) ? 1 : 0; };
              case '>': return function (env) { return l(env) > r(env) ? 1 : 0; };
              case '>=': return function (env) { return l(env) >= r(env) ? 1 : 0; };
              case '==': return function (env) { return l(env) === r(env) ? 1 : 0; };
              case '!=': return function (env) { return l(env) !== r(env) ? 1 : 0; };
              case '&&': return function (env) { return (l(env) && r(env)) ? 1 : 0; };
              case '||': return function (env) { return (l(env) || r(env)) ? 1 : 0; };
            }
            throw new ExprError('Unknown operator ' + n.op, 0);
          }
          case 'tern': { var cc = c(n.c), aa = c(n.a), bb = c(n.b); return function (env) { return cc(env) ? aa(env) : bb(env); }; }
          case 'call': {
            var fn = FUNCTIONS[n.fn][2], args = n.args.map(c), k = args.length;
            if (k === 1) { var a0 = args[0]; return function (env) { return fn(a0(env)); }; }
            if (k === 2) { var b0 = args[0], b1 = args[1]; return function (env) { return fn(b0(env), b1(env)); }; }
            return function (env) { var vals = new Array(k); for (var i = 0; i < k; i++) vals[i] = args[i](env); return fn.apply(null, vals); };
          }
        }
        throw new ExprError('Bad node ' + n.t, 0);
      }
      return c(ast);
    };

    // ---- pretty printer ----
    var PREC = { tern: 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, un: 8, '^': 9 };
    var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    function numText(v) {
      if (Number.isInteger(v) && Math.abs(v) < 1e9) return String(v);
      var s = Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2).replace(/\.?0+e/, 'e') : String(+v.toPrecision(5));
      return s;
    }
    E.toText = function (ast) {
      function pr(n, parent) {
        var s, p;
        switch (n.t) {
          case 'num': return numText(n.v);
          case 'const': return n.n === 'pi' ? 'π' : (n.n === 'tau' ? 'τ' : 'e');
          case 'id': return n.n;
          case 'un': s = (n.op === '!' ? '¬' : (n.op === '-' ? '−' : '+')) + pr(n.a, PREC.un); p = PREC.un; break;
          case 'bin':
            p = PREC[n.op];
            if (n.op === '^') {
              var ex = n.b;
              if (ex.t === 'num' && Number.isInteger(ex.v) && ex.v >= 0 && ex.v <= 99) s = pr(n.a, PREC['^'] + 1) + String(ex.v).split('').map(function (d) { return SUP[d]; }).join('');
              else s = pr(n.a, PREC['^'] + 1) + '^' + pr(ex, PREC['^'] + 1);
            } else {
              var op = n.op === '*' ? ' · ' : (n.op === '<=' ? ' ≤ ' : (n.op === '>=' ? ' ≥ ' : (n.op === '!=' ? ' ≠ ' : (n.op === '-' ? ' − ' : ' ' + n.op + ' '))));
              if (n.op === '/') op = '/';
              s = pr(n.a, p) + op + pr(n.b, p + 1);
            }
            break;
          case 'tern': s = pr(n.c, 2) + ' ? ' + pr(n.a, 1) + ' : ' + pr(n.b, 1); p = 1; break;
          case 'call':
            if (n.fn === 'sqrt' && n.args.length === 1) return '√(' + pr(n.args[0], 0) + ')';
            return n.fn + '(' + n.args.map(function (x) { return pr(x, 0); }).join(', ') + ')';
        }
        return p < parent ? '(' + s + ')' : s;
      }
      return pr(ast, 0);
    };

    // Which ids does an AST read?
    E.idsOf = function (ast) {
      var out = {};
      (function walk(n) {
        if (n.t === 'id') out[n.n] = true;
        else if (n.t === 'un') walk(n.a);
        else if (n.t === 'bin') { walk(n.a); walk(n.b); }
        else if (n.t === 'tern') { walk(n.c); walk(n.a); walk(n.b); }
        else if (n.t === 'call') n.args.forEach(walk);
      })(ast);
      return Object.keys(out);
    };

    G.Expr = E;
  }
  G.__player = G.__player || {};
  G.__player.expr = install;
  install(G);
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
