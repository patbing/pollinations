"""Trade referee: ask Pollinations decision models whether a support/resistance
band will hold, log every answer, and score the answers against what happened.

Input is a JSONL file of candidate entries produced by your own rule engine.
The symbol, timestamps and absolute prices never leave this machine: the state
sent to the model is rebased so the band is 100.00 and volume is relative.

Usage:
  POLLINATIONS_KEY=sk_... python3 referee.py candidates.jsonl \
      --models typesafe/jev-1.14,microsoft/microsoft-decision-1 --cap 0.05 --out run
  python3 referee.py candidates.jsonl --dry-run      # print one request, no network
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

API = "https://gen.pollinations.ai"
KIND_TEXT = {
    "volume_profile_1": "the largest volume-profile band",
    "volume_profile_2": "the second-largest volume-profile band",
    "swing_low": "the previous swing low",
    "swing_high": "the previous swing high",
}


def build_state(c):
    """Anonymous text state for one candidate. Uses only bars up to the arrival bar."""
    band = float(c["band"])
    support = c["side"] == "support"

    def px(v):
        return f"{100 * float(v) / band:.2f}"

    vols = [float(b[4]) for b in c["bars"]]
    avg_vol = sum(vols) / len(vols) or 1
    rows = [
        f"{px(o)} {px(h)} {px(lo)} {px(cl)} {float(v) / avg_vol:.1f}x"
        for o, h, lo, cl, v in c["bars"]
    ]
    return "\n".join(
        [
            f"Anonymous stock, {c.get('timeframe', 'intraday')} bars. Prices are rebased so the band is 100.00.",
            f"The band is {KIND_TEXT.get(c.get('band_kind'), 'a price band')}.",
            f"Price has just come {'down to the band from above (support test)' if support else 'up to the band from below (resistance test)'}.",
            f"Average true range: {100 * float(c['atr']) / band:.2f}.",
            f"Last {len(rows)} bars, oldest first (open high low close, volume vs average):",
            *rows,
        ]
    )


def build_question(c):
    away = "up" if c["side"] == "support" else "down"
    through = "down" if c["side"] == "support" else "up"
    return {
        "bounce": {
            "type": "choice",
            "instructions": "From the last close, which comes first?",
            "criteria": {
                "yes": f"Price moves 1 ATR {away}, away from the band, first.",
                "no": f"Price moves 1 ATR {through}, through the band, first.",
            },
        }
    }


def read_p_yes(answers):
    """Probability of 'yes' from a choice answer, or None if it is unusable."""
    a = (answers or {}).get("bounce") or {}
    p = (a.get("probabilities") or {}).get("yes")
    return p if isinstance(p, (int, float)) and 0 <= p <= 1 else None


def post(path, body, key, timeout=30):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def prices(key):
    """Per-token Pollen prices for every decision model, from the live catalog."""
    out = {}
    for m in post("/v1/models", None, key)["data"]:
        if "/alpha/decisions" in (m.get("supported_endpoints") or []):
            p = m.get("pricing") or {}
            out[m["id"]] = (
                float(p.get("promptTextTokens") or 0),
                float(p.get("completionTextTokens") or 0),
            )
    return out


def ask(c, model, key):
    """One decision call with one retry on network/5xx. Never invents an answer."""
    body = {"model": model, "state": build_state(c), "questions": build_question(c)}
    for attempt in (1, 2):
        try:
            res = post("/alpha/decisions", body, key)
            return {"answers": res.get("answers"), "usage": res.get("usage"), "error": None}
        except urllib.error.HTTPError as e:
            err = f"HTTP {e.code}: {e.read()[:200].decode(errors='replace')}"
            if e.code < 500:
                break
        except (urllib.error.URLError, TimeoutError) as e:
            err = str(e)
        if attempt == 1:
            time.sleep(1.5)
    return {"answers": None, "usage": None, "error": err}


def run(cands, models, key, cap, out_dir, workers=4):
    rates = prices(key)
    missing = [m for m in models if m not in rates]
    if missing:
        sys.exit(f"Not decision models in /v1/models: {missing}")
    spent, lock, rows = 0.0, Lock(), []
    os.makedirs(out_dir, exist_ok=True)
    log = open(os.path.join(out_dir, "calls.jsonl"), "w")

    def job(pair):
        nonlocal spent
        c, model = pair
        with lock:
            if spent >= cap:
                return None
        r = ask(c, model, key)
        u = r["usage"] or {}
        cost = (u.get("input_tokens") or 0) * rates[model][0] + (u.get("output_tokens") or 0) * rates[model][1]
        row = {
            "id": c["id"],
            "model": model,
            "p_yes": read_p_yes(r["answers"]),
            "outcome": c.get("outcome"),
            "cost": cost,
            "error": r["error"],
            "answers": r["answers"],
        }
        with lock:
            spent += cost
            log.write(json.dumps(row) + "\n")
            log.flush()
            rows.append(row)
        return row

    pairs = [(c, m) for c in cands for m in models]
    with ThreadPoolExecutor(workers) as ex:
        skipped = sum(r is None for r in ex.map(job, pairs))
    log.close()
    return rows, spent, skipped


def score(rows):
    """Per model: Brier vs the base rate, and win rate / expectancy of the trades it would take."""
    out = {}
    for model in sorted({r["model"] for r in rows}):
        rs = [r for r in rows if r["model"] == model]
        ok = [r for r in rs if r["p_yes"] is not None and r["outcome"] in ("bounce", "break")]
        y = [1.0 if r["outcome"] == "bounce" else 0.0 for r in ok]
        n = len(ok)
        if not n:
            out[model] = {"answered": 0, "failed": len(rs)}
            continue
        base = sum(y) / n
        brier = sum((r["p_yes"] - t) ** 2 for r, t in zip(ok, y)) / n
        brier_base = sum((base - t) ** 2 for t in y) / n
        taken = [t for r, t in zip(ok, y) if r["p_yes"] >= 0.5]
        out[model] = {
            "answered": n,
            "failed": len(rs) - n,
            "bounce_rate_all": round(base, 3),
            "brier": round(brier, 4),
            "brier_base_rate": round(brier_base, 4),
            "skill": round(1 - brier / brier_base, 3) if brier_base else None,
            "taken": len(taken),
            "bounce_rate_taken": round(sum(taken) / len(taken), 3) if taken else None,
            # Symmetric 1 ATR target and stop: +1R on bounce, -1R on break, before costs.
            "exp_R_all": round(2 * base - 1, 3),
            "exp_R_taken": round(2 * sum(taken) / len(taken) - 1, 3) if taken else None,
        }
    return out


def report(scores, spent, skipped):
    lines = [
        "| model | answered | failed | bounce rate | Brier | Brier (base rate) | skill | taken (p>=0.5) | bounce rate taken | exp R all | exp R taken |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for m, s in scores.items():
        lines.append(
            f"| {m} | {s['answered']} | {s['failed']} | {s.get('bounce_rate_all')} | {s.get('brier')} | "
            f"{s.get('brier_base_rate')} | {s.get('skill')} | {s.get('taken')} | {s.get('bounce_rate_taken')} | "
            f"{s.get('exp_R_all')} | {s.get('exp_R_taken')} |"
        )
    lines += [
        "",
        f"Pollen spent: {spent:.6f}. Calls skipped by the cost cap: {skipped}.",
        "skill > 0 means the model beat always answering the base rate. exp R ignores fees and slippage.",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("candidates")
    ap.add_argument("--models", default="typesafe/jev-1.14,microsoft/microsoft-decision-1")
    ap.add_argument("--cap", type=float, default=0.05, help="Pollen cap for the whole run")
    ap.add_argument("--out", default="run")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    with open(a.candidates) as f:
        cands = [json.loads(line) for line in f if line.strip()]
    if a.dry_run:
        c = cands[0]
        print(json.dumps({"model": a.models.split(",")[0], "state": build_state(c), "questions": build_question(c)}, indent=2))
        return
    key = os.environ.get("POLLINATIONS_KEY")
    if not key:
        sys.exit("Set POLLINATIONS_KEY")
    rows, spent, skipped = run(cands, a.models.split(","), key, a.cap, a.out)
    text = report(score(rows), spent, skipped)
    with open(os.path.join(a.out, "report.md"), "w") as f:
        f.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
