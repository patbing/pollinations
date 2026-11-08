/* Glassbox.Cost: price parsing and spend estimates. Prices are optional: unknown prices are shown as such and the
 * per-lesson cap plus the Connect budget still limit spending. */
(function (G) {
  'use strict';
  var Cost = {};
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) && n >= 0 ? n : null; }
  Cost.parsePricing = function (m) {
    var p = (m && m.pricing) || {}, out = { inTok: null, outTok: null, perImage: null, perChar: null, known: false };
    Object.keys(p).forEach(function (k) {
      var v = num(p[k]); if (v === null) return;
      if (/image/i.test(k) && /completion|output|per_?image|image$/i.test(k) && !/prompt/i.test(k)) out.perImage = v;
      else if (/char/i.test(k)) out.perChar = v;
      else if (/prompt|input/i.test(k) && !/image|audio/i.test(k)) out.inTok = v > 0.001 ? v / 1e6 : v;
      else if (/completion|output/i.test(k) && !/image|audio/i.test(k)) out.outTok = v > 0.001 ? v / 1e6 : v;
    });
    out.known = out.inTok !== null || out.outTok !== null || out.perImage !== null || out.perChar !== null;
    return out;
  };
  Cost.tokens = function (chars) { return Math.ceil(chars / 3.5); };
  Cost.fromUsage = function (usage, pricing, fallbackChars) {
    if (!pricing || (pricing.inTok === null && pricing.outTok === null)) return 0;
    var pin = usage && (usage.prompt_tokens || usage.input_tokens), pout = usage && (usage.completion_tokens || usage.output_tokens);
    if (!pin && !pout) { pin = Cost.tokens((fallbackChars && fallbackChars.in) || 0); pout = Cost.tokens((fallbackChars && fallbackChars.out) || 0); }
    return (pin || 0) * (pricing.inTok || 0) + (pout || 0) * (pricing.outTok || 0);
  };
  function textCost(pr, tin, tout) { return pr && pr.known ? tin * (pr.inTok || 0) + tout * (pr.outTok || 0) : null; }
  Cost.estimateLesson = function (o) {
    var wp = o.writer ? Cost.parsePricing(o.writer) : null, cp = o.critic ? Cost.parsePricing(o.critic) : null, ip = o.image ? Cost.parsePricing(o.image) : null;
    var inTok = Cost.tokens(o.promptChars || 12000), lines = [];
    var write = { key: 'write', label: 'Write lesson', model: o.writer && o.writer.id, typical: textCost(wp, inTok, 4500), worst: textCost(wp, inTok, 8000) };
    var repair = { key: 'repair', label: 'Fix issues (0–2×)', model: o.writer && o.writer.id, typical: 0, worst: textCost(wp, 7500, 8000) === null ? null : 2 * textCost(wp, 7500, 8000) };
    lines.push(write, repair);
    if (o.withCritic !== false) lines.push({ key: 'review', label: 'Reviewer', model: o.critic && o.critic.id, typical: textCost(cp, 3500, 800), worst: textCost(cp, 3500, 1500) });
    if (o.withCover !== false) { var ic = ip && ip.perImage !== null ? ip.perImage : null; lines.push({ key: 'cover', label: 'Cover illustration', model: o.image && o.image.id, typical: ic, worst: ic }); }
    var typical = 0, worst = 0, unknown = false;
    lines.forEach(function (l) { if (l.worst === null || l.typical === null) { unknown = true; l.known = false; } else { l.known = true; typical += l.typical; worst += l.worst; } });
    return { lines: lines, typical: typical, worst: worst, unknown: unknown };
  };
  Cost.format = function (v) { if (v === null || v === undefined) return 'price not published'; if (v === 0) return '0'; return v < 0.001 ? '< 0.001' : (v < 0.1 ? v.toFixed(3) : v.toFixed(2)); };
  G.Cost = Cost;
})(typeof window !== 'undefined' ? (window.Glassbox = window.Glassbox || {}) : (globalThis.Glassbox = globalThis.Glassbox || {}));
