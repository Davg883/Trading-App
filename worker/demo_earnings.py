"""Network-free acceptance replay. Every claim, quote and model response is synthetic."""
import argparse
import json
from pathlib import Path
from .earnings import freeze_snapshot, evaluate_run
from .model_runner import run_tournament


def run_demo(output_dir):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=False)
    fixtures = Path(__file__).parent / "fixtures"
    request = json.loads((fixtures / "earnings-synthetic-request.json").read_text())
    snapshot = freeze_snapshot(request)
    (output / "snapshot.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    pre = freeze_snapshot({**request, "phase": "pre-earnings", "cutoff": "2026-01-02T20:59:00Z"})
    (output / "pre-snapshot.json").write_text(json.dumps(pre, indent=2), encoding="utf-8")
    forecast = {"symbol": "GOOGL", "horizon": "1d", "probabilities": {"up": .2, "down": .6, "neutral": .2},
                "expectedReturn": -.03, "lower": -.08, "upper": .02, "evidenceIds": ["release-revenue"],
                "explanation": "Synthetic cash pressure example", "invalidation": "Cash conversion improves", "decision": "no-trade"}

    def synthetic_transport(endpoint, headers, payload, timeout):
        if "openai" in endpoint:
            return {"model": "synthetic-analyst-a", "usage": {"prompt_tokens": 100}, "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(forecast)}}]}
        other = {**forecast, "probabilities": {"up": .3, "down": .4, "neutral": .3}, "expectedReturn": -.01}
        return {"model": "synthetic-analyst-b", "usage": {"input_tokens": 99}, "stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(other)}]}

    environment = {"OPENAI_API_KEY": "synthetic-unused", "OPENAI_MODEL": "synthetic-analyst-a", "ANTHROPIC_API_KEY": "synthetic-unused", "ANTHROPIC_MODEL": "synthetic-analyst-b"}
    run_tournament(snapshot["bundle"], output / "run", environment, transport=synthetic_transport)
    report = evaluate_run(output / "run", json.loads((fixtures / "earnings-synthetic-observations.json").read_text()))
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return {"synthetic": True, "networkCalls": 0, "preSnapshot": pre["status"], "postSnapshot": snapshot["status"],
            "report": str(output / "report.json"), "scores": {p["participant"]: p["scores"] for p in report["participants"]}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    print(json.dumps(run_demo(parser.parse_args().output_dir), indent=2))
