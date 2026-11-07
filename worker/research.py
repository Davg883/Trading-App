"""Financial calculations use decimal returns (0.01 = 1%), never percent points."""
import math
from datetime import datetime


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Expected a finite number")
    return value


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamps require an explicit timezone")
    return parsed


def eligible_evidence(records, cutoff):
    """Retain revisions known publicly AND ingested by the forecast cutoff."""
    when = timestamp(cutoff)
    return [r for r in records if timestamp(r["publishedAt"]) <= when
            and timestamp(r["receivedAt"]) <= when]


def brier(probabilities, outcome):
    """Unnormalised multiclass Brier score, range 0..2; lower is better."""
    labels = ("up", "down", "neutral")
    if set(probabilities) != set(labels) or outcome not in labels:
        raise ValueError("Expected up/down/neutral probabilities and outcome")
    values = [number(probabilities[k]) for k in labels]
    if any(p < 0 or p > 1 for p in values) or not math.isclose(sum(values), 1, abs_tol=1e-8):
        raise ValueError("Probabilities must be in [0,1] and sum to one")
    return sum((probabilities[k] - int(k == outcome)) ** 2 for k in labels)


def score_forecasts(forecasts, neutral_band=0.002):
    if number(neutral_band) < 0:
        raise ValueError("Neutral band must be nonnegative")
    if not forecasts:
        return {"count": 0, "brier": None, "mae": None, "intervalCoverage": None,
                "meanIntervalWidth": None}
    scores, errors, covered, widths = [], [], [], []
    for f in forecasts:
        actual, expected = number(f["actualReturn"]), number(f["expectedReturn"])
        low, high = number(f["interval"][0]), number(f["interval"][1])
        if low > high:
            raise ValueError("Reversed interval")
        outcome = "up" if actual > neutral_band else "down" if actual < -neutral_band else "neutral"
        scores.append(brier(f["probabilities"], outcome))
        errors.append(abs(expected - actual))
        covered.append(int(low <= actual <= high))
        widths.append(high - low)
    n = len(forecasts)
    return {"count": n, "brier": sum(scores)/n, "mae": sum(errors)/n,
            "intervalCoverage": sum(covered)/n, "meanIntervalWidth": sum(widths)/n}


def inference_cost(usage, rates):
    """Rates are currency units per million tokens; cached input is a subset."""
    counts = {k: number(usage.get(k, 0)) for k in ("input", "cachedInput", "output")}
    prices = {k: number(rates[k]) for k in counts}
    if any(v < 0 for v in [*counts.values(), *prices.values()]):
        raise ValueError("Usage and prices must be nonnegative")
    if any(int(v) != v for v in counts.values()) or counts["cachedInput"] > counts["input"]:
        raise ValueError("Invalid token counts")
    return ((counts["input"]-counts["cachedInput"])*prices["input"] +
            counts["cachedInput"]*prices["cachedInput"] + counts["output"]*prices["output"])/1_000_000


def portfolio_metrics(equity, benchmark, research_cost=0):
    if len(equity) < 2 or len(equity) != len(benchmark):
        raise ValueError("Aligned equity and benchmark series need at least two observations")
    if any(number(v) <= 0 for v in [*equity, *benchmark]):
        raise ValueError("Equity values must be positive")
    if number(research_cost) < 0:
        raise ValueError("Research cost must be nonnegative")
    peak, drawdown = equity[0], 0
    for value in equity:
        peak = max(peak, value)
        drawdown = max(drawdown, 1-value/peak)
    trading_return = equity[-1]/equity[0]-1
    net_return = (equity[-1]-research_cost)/equity[0]-1
    benchmark_return = benchmark[-1]/benchmark[0]-1
    return {"tradingReturn": trading_return, "returnAfterResearch": net_return,
            "benchmarkReturn": benchmark_return, "excessReturnAfterResearch": net_return-benchmark_return,
            "maxDrawdown": drawdown}


def evaluate(request):
    result = {"calculationVersion": "benchmark-001-v1", "returnUnit": "decimal",
              "forecastScores": score_forecasts(request.get("forecasts", []), request.get("neutralBand", 0.002))}
    if "evidence" in request:
        result["eligibleEvidence"] = eligible_evidence(request["evidence"], request["cutoff"])
    if "usage" in request:
        result["inferenceCost"] = inference_cost(request["usage"], request["rates"])
    if "equity" in request:
        result["portfolio"] = portfolio_metrics(request["equity"], request["benchmark"], request.get("researchCost", 0))
    return result
