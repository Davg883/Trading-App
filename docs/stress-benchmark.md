# Benchmark 001.1 offline research workflow

The existing earnings architecture remains intact. `worker/stress.py` supplies deterministic calculations and calendar outcomes. `worker/stress_runner.py` supplies separately versioned frozen research experiments and reuses the existing safe model transport and scoring formulas. Both independent API providers receive byte-identical eligible evidence and the same prompt. No broker API or order writer is imported.

## Run without credentials or network

```powershell
python -m unittest discover -s worker -v
python -m worker.stress_demo --output-dir .tmp/stress-demo-new
```

The demo creates a new directory containing synthetic market data, a retrospective experiment, immutable-by-convention manifest and separate model artifacts, and a report. Both provider responses are mocked; no API requests occur. It is an illustrative October 2026 stress research case, **not observed October prices, a claim about actual company fundamentals, a historical model replay or an authentic prediction**. Missing fundamental evidence yields insufficient evidence and no trade. The example calendar is explicitly synthetic and must never be reused as an observed exchange calendar.

## From Market Stress to an offline experiment

Export a frozen local draft from the Analyst Lab on `/stress`, with at least one eligible source and a registered outcome window. Prepare one chosen horizon:

```powershell
python -m worker.stress_runner prepare stress-draft.json --horizon 5 --output stress-bundle.json
python -m worker.stress_runner run stress-bundle.json --output-dir .tmp/stress-run-new
python -m worker.stress_runner report .tmp/stress-run-new licensed-market.json --as-of 1793394000000 --output stress-report.json
```

The prepare command supports the UI's `retrospective_study` and `historical_replay` drafts. It uses the earlier of the draft cutoff and selected window's evidence cutoff, re-filters publication/event and receipt eligibility, and selects the company and QQQ records. It groups complete eligible price histories by instrument/provider/source/definition into citation blocks, preserving every original row ID and provenance. Source citations may reference block IDs or their original row IDs. Preparation metadata discloses original and selected counts. No eligible selected price row is silently discarded. It does not promote a draft to a forward prediction. Empty evidence, more than 100 citation blocks, or more than 750,000 canonical UTF-8 bytes is rejected explicitly. Inspect payload size and your selected models' context limits/pricing before paid runs: the size cap is not a token or spending guarantee. Provider provenance and importer verification declarations are preserved; preparing a file is not independent source verification. Configure the existing `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` only when paid calls are intended. Missing credentials yield recorded unconfigured submissions without a network call; the run CLI exits with code 3 if either participant fails while retaining the report artifacts.

Market imports use the same `stress-001.1-v1` shape as `lib/market-data.ts`, including licensed-use description, provider, source URLs, full exchange calendar, feed delay, currency, session, adjustment version and explicit synthetic flag. Financial imports use `lib/stress.ts` definitions. Run `python -m worker.stress input.json` for standalone market/valuation calculations; a request can contain `market`, `symbol`, `asOf`, `financials`, `price`, optional `prior`, `review` and `window`.

## Frozen experiments and pending outcomes

Each bundle freezes version, symbol, mode (`retrospective`, `historical-model-replay`, `forward`), data mode, cutoff, registration, neutral band, baseline version, eligible evidence, baseline review, and one complete calendar registration. The registration retains 1/5/20/60-session horizon, start/end, calendar source, regular session, provider, currency, price basis, adjustment version and nullable spread/slippage/trading costs. A 60-session outcome requires a calendar extending that far even when observed prices have not yet arrived. Missing endpoints or unfinished windows remain pending with null scores.

The runner creates a new directory exclusively, hashes the frozen bundle, records model identities, prompt, baselines, raw responses, usage, latency and failures. Existing output paths cannot be overwritten by the CLI. Offline files are not tamper-proof storage: hashes detect mismatches but users controlling all local files could replace them. Convex ownership and server-time registration are the authenticated application boundary. Authentic forward claims require trusted immutable registration before the target window and actual pre-cutoff source receipts. The runner rejects backdated forward execution and deadlines that extend into the target window; it does not claim that local timestamps prove authenticity. Historical replay also needs independent review for model-training contamination and retrospective source selection.

Actual billed inference cost stays null unless supplied by a billing-backed workflow; token usage and latency are preserved. Timeout, missing, invalid and failed submissions remain visible and do not get fabricated forecast scores. Return scores use the frozen relative-return target only after valid endpoints complete. Costs are retained assumptions, not silently applied net returns. The passive QQQ realized return remains in the outcome, separate from probabilistic forecast accuracy. Offline reports identify symbol, benchmark, registration window and run creation time, and retain the full validated forecast. Their outcome envelope uses `status: complete` with flat return fields; the TypeScript calculation API uses `status: completed` and a nested `result`.

## Separate human economic interpretation review

Optionally place `economic-adjudication.json` alongside the manifest before generating a fresh report:

```json
{
  "version": "economic-factual-rubric-v1",
  "evidenceSha256": "copy the exact manifest evidenceSha256",
  "reviewer": "named independent reviewer",
  "reviewerType": "human",
  "reviewedAt": 1793394000000,
  "participants": {
    "openai": [
      {"statement": "A specific economic claim in the forecast", "verdict": "correct", "evidenceIds": ["registered-source-id"]}
    ]
  }
}
```

Review time must follow the run and not be in the future. The artifact must match the frozen evidence hash and cite registered evidence IDs. Reports show the factual rubric independently of Brier/return errors. This offline identity is explicitly unauthenticated. The authenticated Human Review risk gate remains required for every paper order; model output and research classification cannot authorize execution.

## Deployment limits

Licensed historical/live price ingestion, authoritative consensus entitlements, observed October case evidence, production Convex configuration, actual provider calls and end-to-end Clerk approval require separately configured and tested integrations. No integration should be described as live merely because its adapter exists. SEC disclosures supply financial filings, not a general price or consensus feed. Trading 212 demo remains a separate optional broker integration and is not used here as market data.
