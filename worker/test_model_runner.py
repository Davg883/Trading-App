import copy
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request
from unittest.mock import patch, MagicMock
from worker.model_runner import run_tournament, run_provider, validate_bundle, validate_forecast, RejectRedirects, http_post
from worker.research import score_forecasts

BUNDLE = {"symbol":"MSFT", "horizon":"1d", "neutralBand":0.002, "cutoff":"2026-01-02T12:00:00Z", "evidence":[
    {"id":"fact-1", "source":"synthetic fixture", "publishedAt":"2026-01-01T10:00:00Z", "receivedAt":"2026-01-01T10:01:00Z"}]}
FORECAST = {"symbol":"MSFT", "horizon":"1d", "probabilities":{"up":0.5,"down":0.3,"neutral":0.2},
            "expectedReturn":0.01, "lower":-0.02, "upper":0.04, "evidenceIds":["fact-1"],
            "explanation":"Synthetic example", "invalidation":"Revenue misses", "decision":"no-trade"}
ENV = {"OPENAI_API_KEY":"test-secret-a", "OPENAI_MODEL":"pinned-a", "ANTHROPIC_API_KEY":"test-secret-b", "ANTHROPIC_MODEL":"pinned-b"}


class ModelRunnerTests(unittest.TestCase):
    def test_same_evidence_concurrent_and_raw_usage(self):
        seen, prompts = [], []
        barrier = threading.Barrier(2)
        def transport(endpoint, headers, payload, timeout):
            seen.append(payload["messages"][-1]["content"])
            prompts.append(payload["system"] if "system" in payload else payload["messages"][0]["content"])
            barrier.wait(timeout=2)
            if "openai" in endpoint:
                return {"model":"returned-a", "usage":{"prompt_tokens":123}, "choices":[{"finish_reason":"stop", "message":{"content":json.dumps(FORECAST)}}]}
            return {"model":"returned-b", "usage":{"input_tokens":122, "cache_read_input_tokens":3}, "stop_reason":"end_turn", "content":[{"type":"text", "text":json.dumps(FORECAST)}]}
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)/"run"
            result = run_tournament(BUNDLE, directory, ENV, transport=transport)
            self.assertEqual(result["statuses"], {"openai":"success", "anthropic":"success"})
            self.assertEqual(seen[0],seen[1])
            manifest = json.loads((directory/"manifest.json").read_text())
            self.assertEqual(prompts, [manifest["systemPrompt"], manifest["systemPrompt"]])
            self.assertIn("neutralBand is 0.002", prompts[0])
            self.assertEqual(manifest["bundle"]["neutralBand"], 0.002)
            raw = json.loads((directory/"openai.json").read_text())
            self.assertEqual(raw["usage"]["prompt_tokens"],123)
            self.assertIsNone(raw["actualBilledCost"])
            self.assertNotIn("test-secret",(directory/"openai.json").read_text())
            with self.assertRaises(FileExistsError):
                run_tournament(BUNDLE,directory,ENV,transport=transport)

    def test_missing_credentials_no_http(self):
        def forbidden(*args):
            self.fail("Network called with missing credentials")
        record = run_provider("openai",validate_bundle(BUNDLE),{},2000,1,forbidden)
        self.assertEqual(record["status"],"configuration_missing")

    def test_future_information_rejected(self):
        bad = copy.deepcopy(BUNDLE)
        bad["evidence"][0]["receivedAt"]="2026-01-03T00:00:00Z"
        with self.assertRaises(ValueError):
            validate_bundle(bad)

    def test_invalid_evidence_citation_rejected(self):
        bad = copy.deepcopy(FORECAST)
        bad["evidenceIds"]=["invented"]
        with self.assertRaises(ValueError):
            validate_forecast(bad,BUNDLE)

    def test_invalid_model_output_retains_raw(self):
        def transport(*args):
            return {"choices":[{"finish_reason":"stop", "message":{"content":"not JSON"}}],"usage":{"prompt_tokens":10}}
        result = run_provider("openai",validate_bundle(BUNDLE),ENV,2000,1,transport)
        self.assertEqual(result["status"],"invalid")
        self.assertIsNotNone(result["rawResponse"])

    def test_global_deadline_does_not_wait_for_slow_worker(self):
        def transport(*args):
            time.sleep(2)
            return {}
        with tempfile.TemporaryDirectory() as temp:
            started = time.monotonic()
            result = run_tournament(BUNDLE,Path(temp)/"run",ENV,deadline_seconds=1,transport=transport)
            self.assertLess(time.monotonic()-started,1.8)
            self.assertEqual(result["statuses"],{"openai":"timeout","anthropic":"timeout"})

    def test_insecure_endpoint_is_blocked(self):
        env = {**ENV,"OPENAI_ENDPOINT":"http://example.com"}
        result = run_provider("openai",validate_bundle(BUNDLE),env,2000,1)
        self.assertEqual(result["status"],"configuration_missing")

    def test_redirects_block_cross_host_downgrade_and_same_host(self):
        handler = RejectRedirects()
        request = Request("https://provider.example/v1", data=b"{}", method="POST",
                          headers={"Authorization":"Bearer test-only", "x-api-key":"test-only"})
        for target in ("https://other.example/collect", "http://provider.example/collect", "https://provider.example/v2"):
            for code in (301, 302, 303, 307, 308):
                with self.subTest(target=target, code=code), self.assertRaises(HTTPError):
                    getattr(handler, f"http_error_{code}")(request, None, code, "Redirect", {"location":target})

    def test_http_transport_installs_redirect_rejection(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = b'{"ok":true}'
        with patch("worker.model_runner.build_opener", return_value=opener) as factory:
            self.assertEqual(http_post("https://provider.example/v1", {"Authorization":"Bearer test-only"}, {}, 1), {"ok":True})
            self.assertIsInstance(factory.call_args.args[0], RejectRedirects)

    def test_neutral_band_required_finite_and_nonnegative(self):
        missing = copy.deepcopy(BUNDLE)
        del missing["neutralBand"]
        with self.assertRaises(KeyError):
            validate_bundle(missing)
        for band in (-0.001, float("nan"), float("inf"), True, "0.002"):
            with self.subTest(band=band), self.assertRaises(ValueError):
                validate_bundle({**BUNDLE, "neutralBand":band})

    def test_frozen_band_matches_evaluation_boundaries(self):
        band = json.loads(validate_bundle(BUNDLE))["neutralBand"]
        for actual in (-band, band):
            result = score_forecasts([{"actualReturn":actual, "expectedReturn":0,
                                       "interval":[-band,band], "probabilities":{"up":0,"down":0,"neutral":1}}], band)
            self.assertEqual(result["brier"], 0)


if __name__ == "__main__":
    unittest.main()
