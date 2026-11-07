import json
import unittest

from referee import build_question, build_state, read_p_yes, score

CAND = {
    "id": "005930-2026-10-14T10:35",
    "symbol": "005930",
    "time": "2026-10-14T10:35",
    "timeframe": "5-minute",
    "side": "support",
    "band": 181000,
    "band_kind": "volume_profile_1",
    "atr": 1810,
    "bars": [[184500, 184900, 183700, 183900, 120000], [183900, 184000, 181200, 181300, 360000]],
    "outcome": "break",
}


class Anonymity(unittest.TestCase):
    def test_request_hides_symbol_time_prices_and_outcome(self):
        sent = json.dumps({"state": build_state(CAND), "questions": build_question(CAND)})
        for secret in ("005930", "2026", "10-14", "181000", "184500", "183900", "120000"):
            self.assertNotIn(secret, sent)
        self.assertNotIn('"break"', sent)

    def test_prices_are_rebased_to_the_band(self):
        state = build_state(CAND)
        self.assertIn("101.93 102.15 101.49 101.60 0.5x", state)
        self.assertIn("Average true range: 1.00.", state)
        self.assertIn("support test", state)


class Scoring(unittest.TestCase):
    def test_reads_only_valid_probabilities(self):
        self.assertEqual(read_p_yes({"bounce": {"probabilities": {"yes": 0.7, "no": 0.3}}}), 0.7)
        self.assertIsNone(read_p_yes({"bounce": {"probabilities": {"yes": 1.2}}}))
        self.assertIsNone(read_p_yes(None))

    def test_brier_skill_and_expectancy(self):
        rows = [
            {"model": "m", "p_yes": 0.8, "outcome": "bounce"},
            {"model": "m", "p_yes": 0.6, "outcome": "bounce"},
            {"model": "m", "p_yes": 0.3, "outcome": "break"},
            {"model": "m", "p_yes": 0.7, "outcome": "break"},
            {"model": "m", "p_yes": None, "outcome": "bounce"},
        ]
        s = score(rows)["m"]
        self.assertEqual((s["answered"], s["failed"]), (4, 1))
        self.assertEqual(s["bounce_rate_all"], 0.5)
        self.assertEqual(s["brier"], round((0.04 + 0.16 + 0.09 + 0.49) / 4, 4))
        self.assertEqual(s["brier_base_rate"], 0.25)
        self.assertEqual(s["taken"], 3)
        self.assertEqual(s["exp_R_all"], 0.0)
        self.assertEqual(s["exp_R_taken"], round(2 * 2 / 3 - 1, 3))


if __name__ == "__main__":
    unittest.main()
