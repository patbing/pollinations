# Trade referee

Asks Pollinations decision models whether a support/resistance band will hold, logs every answer, and scores the answers against what actually happened. Python 3 standard library only.

Your rule engine finds the entries. The referee only answers one question per entry: from the arrival bar's close, does price move 1 ATR away from the band before it moves 1 ATR through it?

## Run

```bash
python3 -m unittest                                   # 4 tests, no network
python3 referee.py candidates.jsonl --dry-run         # print the first request, no network
POLLINATIONS_KEY=sk_... python3 referee.py candidates.jsonl \
  --models typesafe/jev-1.14,microsoft/microsoft-decision-1 --cap 0.05 --out run
```

Output: `run/calls.jsonl` (every call, answer and cost) and `run/report.md`.

## Candidate format (one JSON object per line)

```json
{"id": "005930-2026-10-14T10:35", "symbol": "005930", "time": "2026-10-14T10:35",
 "timeframe": "5-minute", "side": "support", "band": 181000, "band_kind": "volume_profile_1",
 "atr": 1810, "bars": [[184500, 184900, 183700, 183900, 120000], [183900, 184000, 181200, 181300, 360000]],
 "outcome": "break"}
```

- `side`: `support` (price arrives from above) or `resistance` (from below).
- `band_kind`: `volume_profile_1`, `volume_profile_2`, `swing_low` or `swing_high`.
- `bars`: `[open, high, low, close, volume]`, oldest first, ending with the arrival bar. Nothing after it.
- `outcome`: `bounce` or `break`, filled in by your backtest from later bars with the same 1 ATR rule. Never sent.

## What is sent

Only the rebased chart: the band is 100.00, prices are relative to it, volume is a multiple of the window average. The symbol, timestamps, absolute prices and the outcome stay on your machine (checked by `test_referee.py`). A failed call is logged as failed; it is never replaced by a guess.

## Reading the report

- `Brier` vs `Brier (base rate)`: `skill > 0` means the model beat always answering the overall bounce rate.
- `exp R`: +1R per bounce, −1R per break, before fees and slippage. `taken` = entries with p(yes) ≥ 0.5.
- Microsoft-Decision-1 returns probabilities on a coarse grid (logit steps of 0.125, e.g. 0.562 = sigmoid(0.25)).

Not investment advice.
