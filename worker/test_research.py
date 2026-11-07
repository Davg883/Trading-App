import csv
import tempfile
import sqlite3
from contextlib import closing
import unittest
from pathlib import Path
from worker.research import brier, eligible_evidence, inference_cost, portfolio_metrics, score_forecasts
from worker.store import import_prices


class ResearchTests(unittest.TestCase):
    def test_brier_perfect_and_wrong(self):
        self.assertEqual(brier({"up":1,"down":0,"neutral":0}, "up"), 0)
        self.assertEqual(brier({"up":1,"down":0,"neutral":0}, "down"), 2)

    def test_invalid_probability(self):
        with self.assertRaises(ValueError):
            brier({"up":0.7,"down":0.7,"neutral":0}, "up")

    def test_future_receipt_excluded(self):
        records = [{"publishedAt":"2026-01-01T09:00:00Z", "receivedAt":"2026-01-01T11:00:00Z"}]
        self.assertEqual(eligible_evidence(records, "2026-01-01T10:00:00Z"), [])

    def test_timestamp_timezone_required(self):
        with self.assertRaises(ValueError):
            eligible_evidence([], "2026-01-01T10:00:00")

    def test_scores_interval(self):
        score = score_forecasts([{"probabilities":{"up":1,"down":0,"neutral":0}, "actualReturn":0.02, "expectedReturn":0.01, "interval":[0,0.02]}])
        self.assertAlmostEqual(score["mae"], 0.01)
        self.assertEqual(score["intervalCoverage"], 1)

    def test_empty_not_zero_accuracy(self):
        self.assertIsNone(score_forecasts([])["brier"])

    def test_cached_tokens_not_double_counted(self):
        self.assertAlmostEqual(inference_cost({"input":1000000,"cachedInput":500000,"output":0}, {"input":2,"cachedInput":1,"output":8}), 1.5)

    def test_equity_and_cost(self):
        result = portfolio_metrics([100,120,90,110],[100,100,100,105],5)
        self.assertAlmostEqual(result["maxDrawdown"], 0.25)
        self.assertAlmostEqual(result["excessReturnAfterResearch"], 0)

    def test_import_idempotent_and_conflict(self):
        with tempfile.TemporaryDirectory() as temp:
            source, db = Path(temp)/"prices.csv", str(Path(temp)/"prices.db")
            header = "symbol,timestamp,receivedAt,source,currency,close\n"
            record = "TEST,2026-01-01T10:00:00Z,2026-01-01T10:01:00Z,test,GBP,100\n"
            source.write_text(header+record)
            self.assertEqual(import_prices(source,db)["inserted"],1)
            self.assertEqual(import_prices(source,db)["duplicates"],1)
            source.write_text(header+record.replace(",100",",101"))
            with self.assertRaises(ValueError):
                import_prices(source,db)

    def test_equivalent_timezone_import_is_duplicate(self):
        with tempfile.TemporaryDirectory() as temp:
            source, db = Path(temp)/"prices.csv", str(Path(temp)/"prices.db")
            header = "symbol,timestamp,receivedAt,source,currency,close\n"
            source.write_text(header+"TEST,2026-01-01T10:00:00Z,2026-01-01T10:01:00Z,test,GBP,100\n")
            import_prices(source,db)
            source.write_text(header+"TEST,2026-01-01T11:00:00+01:00,2026-01-01T11:01:00+01:00,test,GBP,100\n")
            self.assertEqual(import_prices(source,db)["duplicates"],1)

    def test_conflicting_batch_rolls_back_earlier_new_row(self):
        with tempfile.TemporaryDirectory() as temp:
            source, database = Path(temp)/"prices.csv", str(Path(temp)/"prices.db")
            header = "symbol,timestamp,receivedAt,source,currency,close\n"
            existing = "TEST,2026-01-01T10:00:00Z,2026-01-01T10:01:00Z,test,GBP,100\n"
            source.write_text(header+existing)
            import_prices(source,database)
            source.write_text(header+"NEW,2026-01-01T10:00:00Z,2026-01-01T10:01:00Z,test,GBP,200\n"+existing.replace(",100",",101"))
            with self.assertRaises(ValueError):
                import_prices(source,database)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT symbol,close FROM prices").fetchall(), [("TEST",100.0)])


if __name__ == "__main__":
    unittest.main()
