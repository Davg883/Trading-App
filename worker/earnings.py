"""Offline, auditable earnings snapshot -> provider artifacts -> observed-outcome bridge.

No market observations or publication times are inferred from articles. The CLI does
not execute trades and does not call model providers; model_runner is a separate step.
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .model_runner import canonical, validate_bundle, validate_forecast, validate_earnings_target, system_prompt, registered_earnings_baseline
from .research import number, timestamp, score_forecasts


def freeze_snapshot(request, now=None):
    """Keep historical system availability strict; late-imported facts stay excluded."""
    created = now or datetime.now(timezone.utc)
    cutoff = timestamp(request["cutoff"])
    release = timestamp(request["earningsPublishedAt"])
    if cutoff > created:
        raise ValueError("Cannot freeze a future evidence cutoff")
    if request["phase"] not in {"pre-earnings", "post-earnings"}:
        raise ValueError("Explicit pre-earnings or post-earnings phase required")
    if (request["phase"] == "pre-earnings" and cutoff >= release) or (request["phase"] == "post-earnings" and cutoff < release):
        raise ValueError("Experiment phase conflicts with the earnings publication time")
    target = validate_earnings_target(request["earningsTarget"], request["cutoff"])
    system_prompt(request)
    if request["symbol"] not in {"MSFT", "GOOGL", "AMZN", "NVDA", "CRWV"} or request["horizon"] not in {"1h", "1d", "5d"}:
        raise ValueError("Unsupported company or horizon")
    evidence, exclusions, seen = [], [], set()
    for record in request["claims"]:
        identity = record["id"]
        if not isinstance(identity, str) or not identity.strip() or identity in seen:
            raise ValueError("Claim IDs must be nonempty and unique")
        seen.add(identity)
        reasons = []
        if record.get("kind") not in {"company_fact", "analyst_opinion", "speculation", "market_outcome"}:
            raise ValueError("Unknown claim classification")
        if record["kind"] == "market_outcome":
            reasons.append("Market outcomes are excluded from forecast evidence")
        if record.get("verification") != "verified" and not (record["kind"] in {"analyst_opinion", "speculation"} and record.get("verification") == "sourced"):
            reasons.append("Source verification is incomplete")
        if not isinstance(record.get("source"), str) or not record["source"].strip():
            reasons.append("Source reference is missing")
        for field in ("publishedAt", "receivedAt"):
            if not record.get(field):
                reasons.append(f"{field} is unknown")
            elif timestamp(record[field]) > cutoff:
                reasons.append(f"{field} is after the frozen cutoff")
        if record.get("publishedAt") and record.get("receivedAt") and timestamp(record["receivedAt"]) < timestamp(record["publishedAt"]):
            reasons.append("Receipt precedes publication")
        if record.get("includesMarketReaction") is True:
            reasons.append("Article contains subsequent market reaction")
        if reasons:
            exclusions.append({"id": identity, "reasons": reasons})
        else:
            evidence.append(json.loads(canonical(record)))
    by_id = {record["id"]: record for record in request["claims"]}
    for record in request["claims"]:
        chain = {record["id"]}
        current = record
        while current.get("supersedes"):
            previous = current["supersedes"]
            if previous not in by_id or previous in chain:
                raise ValueError("Revision chains must reference existing records and cannot cycle")
            chain.add(previous)
            current = by_id[previous]
            if current.get("metric") != record.get("metric"):
                raise ValueError("A revision must refer to the same metric")
    superseded = {record["supersedes"] for record in evidence if record.get("supersedes")}
    for record in evidence:
        if record["id"] in superseded:
            exclusions.append({"id": record["id"], "reasons": ["Superseded by an eligible revision at this cutoff"]})
    evidence = [record for record in evidence if record["id"] not in superseded]
    # Return an explicit blocked snapshot, not a fabricated pre-release dataset.
    bundle = {"symbol": request["symbol"], "horizon": request["horizon"], "neutralBand": request["neutralBand"],
              "cutoff": request["cutoff"], "eventId": request["eventId"], "phase": request["phase"],
              "earningsPublishedAt": request["earningsPublishedAt"], "earningsTarget": target,
              "rulesBaseline": "neutral-abstention-v1",
              "experimentMode": "retrospective", "synthetic": request.get("synthetic") is True, "evidence": evidence}
    encoded = validate_bundle(bundle) if evidence else canonical(bundle)
    return {"protocolVersion": "earnings-001-v1", "status": "ready" if evidence else "blocked",
            "mode": "retrospective", "createdAt": created.isoformat(), "bundle": bundle,
            "evidenceSha256": hashlib.sha256(encoded.encode()).hexdigest(), "excluded": exclusions,
            "warning": "Historical replay cannot establish a forecast made before the event; later model training knowledge may contaminate conclusions."}


def quote_return(symbol, quotes, target, synthetic):
    picked = []
    for endpoint in (target["anchorAt"], target["endAt"]):
        matches = [q for q in quotes if q.get("symbol") == symbol and timestamp(q["observedAt"]) == timestamp(endpoint)]
        if len(matches) != 1:
            raise ValueError(f"Exactly one {symbol} observation is required at {endpoint}")
        quote = matches[0]
        if quote.get("kind") != "price_observation" or quote.get("verification") != "verified":
            raise ValueError("Outcome requires verified price observations, not media-reported moves")
        if (quote.get("synthetic") is True) != synthetic:
            raise ValueError("Synthetic and observed quotes cannot be mixed")
        if quote.get("session") != target["session"] or quote.get("priceBasis") != target["priceBasis"]:
            raise ValueError("Quote session or price basis differs from frozen target")
        if number(quote["price"]) <= 0 or not quote.get("source") or not quote.get("currency"):
            raise ValueError("Positive price, source and currency required")
        delay = (timestamp(quote["receivedAt"]) - timestamp(quote["observedAt"])).total_seconds()
        if delay < 0 or number(quote["delaySeconds"]) < 0:
            raise ValueError("Invalid quote publication/receipt order")
        # Historical outcome observations may be received late. Never use them as
        # executable fills; record the declared delay and actual receipt time.
        picked.append(quote)
    if picked[0]["currency"] != picked[1]["currency"]:
        raise ValueError("Price-return endpoints must use the same currency")
    return picked[1]["price"] / picked[0]["price"] - 1, picked


def paper_scenario(order, company_quotes, target):
    """Reconcile an explicitly approved long-only scenario; never creates an order."""
    if order.get("reviewDecision") != "approve" or not order.get("reviewer") or not order.get("reviewNote"):
        raise ValueError("Paper scenario requires an explicit human approval record")
    approval, executed = timestamp(order["approvedAt"]), timestamp(order["executedAt"])
    entry, exit_quote = company_quotes
    observed, received = timestamp(entry["observedAt"]), timestamp(entry["receivedAt"])
    if not approval <= observed <= received <= executed or (executed - approval).total_seconds() > 300 or (executed - observed).total_seconds() > 60:
        raise ValueError("Paper entry requires a fresh post-approval quote and unexpired approval")
    if number(entry["delaySeconds"]) > 60 or entry["currency"] != "USD" or exit_quote["currency"] != "USD":
        raise ValueError("Paper scenario requires fresh USD quotes with explicit GBP FX")
    quantity, capital, cash, existing = [number(order[k]) for k in ("quantity", "capitalGbp", "cashGbp", "existingExposureGbp")]
    if quantity <= 0 or capital <= 0 or cash < 0 or existing < 0:
        raise ValueError("Invalid paper account or quantity")
    # Fixed experiment cost policy, not parameters controlled by a research model.
    spread_half, slippage, fx_rate, fee = .0005, .0005, .0015, 1
    entry_fx, exit_fx = number(order["entryUsdToGbp"]), number(order["exitUsdToGbp"])
    if entry_fx <= 0 or exit_fx <= 0:
        raise ValueError("Positive timestamp-aligned FX observations required")
    if timestamp(order["entryFxAt"]) != timestamp(entry["observedAt"]) or timestamp(order["exitFxAt"]) != timestamp(exit_quote["observedAt"]):
        raise ValueError("FX timestamps must match their respective price observations")
    if not order.get("fxSource"):
        raise ValueError("FX source required")
    entry_gross = quantity * entry["price"] * (1 + spread_half + slippage) * entry_fx
    exit_gross = quantity * exit_quote["price"] * (1 - spread_half - slippage) * exit_fx
    debit, credit = entry_gross * (1 + fx_rate) + fee, exit_gross * (1 - fx_rate) - fee
    if debit > cash or existing + debit > capital * .25:
        raise ValueError("Paper scenario violates cash or fixed-capital position limit")
    return {"status": "scenario_evaluated", "realisedPnl": credit - debit, "currency": "GBP",
            "cashDebitGbp": debit, "cashCreditGbp": credit, "costPolicy": "10bps-spread-5bps-slippage-15bps-FX-GBP1-per-side-v1",
            "executionAuthority": "none", "approvalVerification": "supplied metadata; authenticated Convex journal remains authoritative",
            "reason": "Deterministic reconciliation of a supplied approved paper scenario; no broker or ledger mutation occurred."}


def evaluate_run(directory, observations):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    bundle = manifest["bundle"]
    encoded = validate_bundle(bundle)
    if hashlib.sha256(encoded.encode()).hexdigest() != manifest["evidenceSha256"]:
        raise ValueError("Frozen evidence hash mismatch")
    if bundle.get("experimentMode") != "retrospective" or "earningsTarget" not in bundle:
        raise ValueError("Report requires an earnings snapshot with an explicit retrospective target")
    if bundle.get("rulesBaseline") != "neutral-abstention-v1":
        raise ValueError("Rules baseline must be registered in the frozen evidence bundle")
    expected_baseline = {"version": bundle["rulesBaseline"], "forecast": registered_earnings_baseline(bundle)}
    if manifest.get("rulesParticipant") != expected_baseline:
        raise ValueError("Deterministic baseline must have been recorded in the original run manifest")
    target = bundle["earningsTarget"]
    if observations["eventId"] != bundle["eventId"]:
        raise ValueError("Outcome event does not match the experiment")
    evaluated_at = timestamp(observations["evaluatedAt"])
    if evaluated_at < timestamp(target["endAt"]):
        raise ValueError("Outcome horizon is not complete")
    if any(timestamp(q["receivedAt"]) > evaluated_at for q in observations["quotes"]):
        raise ValueError("Quote unavailable at evaluation time")
    actual, selected = quote_return(bundle["symbol"], observations["quotes"], target, bundle["synthetic"])
    paper_result = paper_scenario(observations["paperScenario"], selected, target) if "paperScenario" in observations else {
        "status": "not_executed", "realisedPnl": None, "reason": "Forecast accuracy does not imply an authorised or filled paper order."}
    benchmark = None
    if target["returnType"] == "excess":
        benchmark, benchmark_quotes = quote_return(target["benchmarkSymbol"], observations["quotes"], target, bundle["synthetic"])
        if selected[0]["currency"] != benchmark_quotes[0]["currency"]:
            raise ValueError("Company and benchmark returns require a common currency")
        selected += benchmark_quotes
    realised_target = actual if benchmark is None else actual - benchmark
    results = []
    for provider in ("openai", "anthropic", "rules-no-trade"):
        if provider == "rules-no-trade":
            record = {"status": "success", "forecast": manifest["rulesParticipant"]["forecast"], "actualBilledCost": 0, "usage": None}
        else:
            path = directory / f"{provider}.json"
            record = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"status": "missing", "actualBilledCost": None}
            if path.exists() and (record.get("evidenceSha256") != manifest["evidenceSha256"] or record.get("provider") != provider):
                raise ValueError("Provider artifact is not bound to this experiment and participant")
        scores = None
        if record["status"] == "success":
            forecast = validate_forecast(record["forecast"], bundle)
            scores = score_forecasts([{"probabilities": forecast["probabilities"], "expectedReturn": forecast["expectedReturn"],
                                       "interval": [forecast["lower"], forecast["upper"]], "actualReturn": realised_target}], bundle["neutralBand"])
        results.append({"participant": provider, "status": record["status"], "scores": scores,
                        "forecast": record.get("forecast"), "usage": record.get("usage"),
                        "actualBilledCost": record.get("actualBilledCost"), "costCurrency": record.get("costCurrency"),
                        "error": record.get("error"), "latencyMs": record.get("latencyMs")})
    return {"protocolVersion": "earnings-001-v1", "eventId": bundle["eventId"], "phase": bundle["phase"],
            "mode": "retrospective", "synthetic": bundle["synthetic"], "target": target,
            "evidenceSha256": manifest["evidenceSha256"], "companyReturn": actual, "benchmarkReturn": benchmark,
            "realisedTargetReturn": realised_target, "neutralBand": bundle["neutralBand"], "observations": selected,
            "participants": results, "economicAccuracy": None,
            "paperTrading": paper_result,
            "warning": "Retrospective research only; results do not establish predictive edge. Economic claims need separate adjudication. Costs remain unavailable until billing is reconciled."}


def main():
    parser = argparse.ArgumentParser(description="Freeze earnings evidence or evaluate provider artifacts against aligned observations")
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser("snapshot")
    snapshot.add_argument("input")
    snapshot.add_argument("--output", required=True)
    report = commands.add_parser("report")
    report.add_argument("run_directory")
    report.add_argument("observations")
    report.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.command == "snapshot":
            result = freeze_snapshot(json.loads(Path(args.input).read_text(encoding="utf-8-sig")))
        else:
            result = evaluate_run(args.run_directory, json.loads(Path(args.observations).read_text(encoding="utf-8-sig")))
        with Path(args.output).open("x", encoding="utf-8") as output:
            output.write(json.dumps(result, indent=2, allow_nan=False) + "\n")
        print(json.dumps({"output": args.output, "status": result.get("status", "evaluated"), "mode": "retrospective"}))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
