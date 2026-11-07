import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from worker.earnings import freeze_snapshot, evaluate_run, paper_scenario
from worker.model_runner import run_tournament, validate_forecast, validate_bundle

TARGET = {"returnType": "excess", "benchmarkSymbol": "QQQ", "anchorAt": "2026-01-05T14:30:00Z",
          "endAt": "2026-01-05T21:00:00Z", "session": "regular", "calendar": "synthetic-XNAS-v1", "priceBasis": "unadjusted"}
SPEC = {"eventId": "SYNTHETIC-GOOGL-Q4", "symbol": "GOOGL", "horizon": "1d", "neutralBand": .002,
        "phase": "post-earnings", "cutoff": "2026-01-02T21:10:00Z", "earningsPublishedAt": "2026-01-02T21:00:00Z",
        "earningsTarget": TARGET, "synthetic": True, "claims": [
            {"id": "release-revenue", "kind": "company_fact", "verification": "verified", "source": "synthetic release",
             "publishedAt": "2026-01-02T21:00:00Z", "receivedAt": "2026-01-02T21:01:00Z", "value": 100},
            {"id": "later-article", "kind": "analyst_opinion", "verification": "sourced", "source": "synthetic article",
             "publishedAt": "2026-01-03T09:00:00Z", "receivedAt": "2026-01-03T09:01:00Z", "text": "Commentary"},
            {"id": "reaction", "kind": "market_outcome", "verification": "verified", "source": "synthetic quote",
             "publishedAt": "2026-01-02T21:02:00Z", "receivedAt": "2026-01-02T21:03:00Z", "value": -.12}]}
FORECAST = {"symbol": "GOOGL", "horizon": "1d", "probabilities": {"up": .2, "down": .6, "neutral": .2},
            "expectedReturn": -.03, "lower": -.08, "upper": .02, "evidenceIds": ["release-revenue"],
            "explanation": "Synthetic cash pressure example", "invalidation": "Cash conversion improves", "decision": "no-trade"}
ENV = {"OPENAI_API_KEY": "test-a", "OPENAI_MODEL": "test-a", "ANTHROPIC_API_KEY": "test-b", "ANTHROPIC_MODEL": "test-b"}


def observations():
    quotes = []
    for symbol, prices in (("GOOGL", [100, 90]), ("QQQ", [100, 98])):
        for when, price in zip((TARGET["anchorAt"], TARGET["endAt"]), prices):
            quotes.append({"symbol": symbol, "observedAt": when, "receivedAt": when, "price": price,
                           "kind": "price_observation", "verification": "verified", "source": "synthetic licensed-feed fixture",
                           "currency": "USD", "session": "regular", "priceBasis": "unadjusted", "synthetic": True, "delaySeconds": 0})
    return {"eventId": SPEC["eventId"], "evaluatedAt": "2026-01-06T00:00:00Z", "quotes": quotes}


def transport(endpoint, headers, payload, timeout):
    if "openai" in endpoint:
        return {"model": "test-a", "usage": {"prompt_tokens": 100}, "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(FORECAST)}}]}
    return {"model": "test-b", "usage": {"input_tokens": 99}, "stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(FORECAST)}]}


class EarningsTests(unittest.TestCase):
    def test_costed_paper_scenario_requires_approval_and_fresh_entry(self):
        quotes = observations()["quotes"][:2]
        order = {"reviewDecision": "approve", "reviewer": "synthetic human", "reviewNote": "Fixture review",
                 "approvedAt": "2026-01-05T14:29:30Z", "executedAt": "2026-01-05T14:30:01Z",
                 "quantity": 10, "capitalGbp": 10000, "cashGbp": 10000, "existingExposureGbp": 0,
                 "entryUsdToGbp": .8, "exitUsdToGbp": .8, "entryFxAt": TARGET["anchorAt"], "exitFxAt": TARGET["endAt"], "fxSource": "synthetic FX"}
        report = paper_scenario(order, quotes, TARGET)
        self.assertLess(report["realisedPnl"], -80)
        self.assertEqual(report["executionAuthority"], "none")
        for changes in ({"reviewDecision": "reject"}, {"executedAt": "2026-01-05T14:32:00Z"}, {"cashGbp": 10}, {"existingExposureGbp": 2400}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                paper_scenario({**order, **changes}, quotes, TARGET)

    def test_snapshot_excludes_late_article_and_market_reaction(self):
        snap = freeze_snapshot(SPEC)
        self.assertEqual([e["id"] for e in snap["bundle"]["evidence"]], ["release-revenue"])
        self.assertEqual(len(snap["excluded"]), 2)
        self.assertEqual(snap["mode"], "retrospective")

    def test_pre_earnings_cannot_see_release(self):
        snap = freeze_snapshot({**SPEC, "phase": "pre-earnings", "cutoff": "2026-01-02T20:59:00Z"})
        self.assertEqual(snap["status"], "blocked")
        self.assertEqual(snap["bundle"]["evidence"], [])

    def test_phase_and_unknown_receipt_fail_closed(self):
        with self.assertRaises(ValueError):
            freeze_snapshot({**SPEC, "phase": "pre-earnings"})
        bad = copy.deepcopy(SPEC)
        bad["claims"][0]["receivedAt"] = None
        self.assertEqual(freeze_snapshot(bad)["status"], "blocked")

    def test_newly_imported_old_fact_is_not_historical_system_evidence(self):
        bad = copy.deepcopy(SPEC)
        bad["claims"][0]["receivedAt"] = "2026-02-01T00:00:00Z"
        self.assertEqual(freeze_snapshot(bad)["status"], "blocked")

    def test_evidence_hash_reproducible(self):
        a = freeze_snapshot(SPEC, datetime(2026, 1, 10, tzinfo=timezone.utc))
        b = freeze_snapshot(SPEC, datetime(2026, 1, 11, tzinfo=timezone.utc))
        self.assertEqual(a["evidenceSha256"], b["evidenceSha256"])

    def test_revision_only_replaces_known_fact_after_receipt(self):
        spec = copy.deepcopy(SPEC)
        revision = {**spec["claims"][0], "id": "revised", "supersedes": "release-revenue", "value": 101,
                    "receivedAt": "2026-01-02T21:11:00Z"}
        spec["claims"].append(revision)
        self.assertEqual(freeze_snapshot(spec)["bundle"]["evidence"][0]["id"], "release-revenue")
        spec["cutoff"] = "2026-01-02T21:12:00Z"
        self.assertEqual(freeze_snapshot(spec)["bundle"]["evidence"][0]["id"], "revised")

    def test_complete_mocked_pipeline_and_deterministic_scores(self):
        snap = freeze_snapshot(SPEC)
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp) / "run"
            run_tournament(snap["bundle"], run, ENV, transport=transport)
            a = evaluate_run(run, observations())
            manifest = json.loads((run / "manifest.json").read_text())
            self.assertEqual(manifest["rulesParticipant"]["version"], "neutral-abstention-v1")
            self.assertEqual(a, evaluate_run(run, observations()))
            self.assertAlmostEqual(a["companyReturn"], -.1)
            self.assertAlmostEqual(a["benchmarkReturn"], -.02)
            self.assertAlmostEqual(a["realisedTargetReturn"], -.08)
            self.assertEqual(len(a["participants"]), 3)
            self.assertAlmostEqual(a["participants"][0]["scores"]["mae"], .05)
            self.assertIsNone(a["participants"][0]["actualBilledCost"])
            self.assertEqual(a["participants"][2]["forecast"]["decision"], "no-trade")
            self.assertIsNone(a["paperTrading"]["realisedPnl"])

    def test_failures_retained_without_fake_forecast_scores(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp) / "run"
            run_tournament(freeze_snapshot(SPEC)["bundle"], run, {}, transport=transport)
            result = evaluate_run(run, observations())
            self.assertEqual(result["participants"][0]["status"], "configuration_missing")
            self.assertIsNone(result["participants"][0]["scores"])

    def test_bad_session_delay_media_and_currency_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp) / "run"
            run_tournament(freeze_snapshot(SPEC)["bundle"], run, {}, transport=transport)
            for field, value in (("session", "after-hours"), ("kind", "media_move"), ("delaySeconds", -1), ("currency", "GBP"), ("synthetic", False)):
                bad = observations()
                bad["quotes"][0][field] = value
                with self.subTest(field=field), self.assertRaises(ValueError):
                    evaluate_run(run, bad)

    def test_hash_tampering_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp) / "run"
            run_tournament(freeze_snapshot(SPEC)["bundle"], run, {}, transport=transport)
            manifest = json.loads((run / "manifest.json").read_text())
            manifest["bundle"]["neutralBand"] = .1
            (run / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                evaluate_run(run, observations())

    def test_short_action_rejected_but_bearish_forecast_allowed(self):
        bundle = freeze_snapshot(SPEC)["bundle"]
        validate_forecast(FORECAST, bundle)
        with self.assertRaises(ValueError):
            validate_forecast({**FORECAST, "decision": "short"}, bundle)
        validate_forecast({**FORECAST, "lower": -2, "expectedReturn": -1.5}, bundle)

    def test_raw_bundle_cannot_bypass_outcome_filter(self):
        bundle = freeze_snapshot(SPEC)["bundle"]
        bundle["evidence"][0]["kind"] = "market_outcome"
        with self.assertRaises(ValueError):
            validate_bundle(bundle)

    def test_swapped_provider_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp) / "run"
            run_tournament(freeze_snapshot(SPEC)["bundle"], run, ENV, transport=transport)
            record = json.loads((run / "openai.json").read_text())
            record["evidenceSha256"] = "other-experiment"
            (run / "openai.json").write_text(json.dumps(record))
            with self.assertRaises(ValueError):
                evaluate_run(run, observations())


if __name__ == "__main__":
    unittest.main()
