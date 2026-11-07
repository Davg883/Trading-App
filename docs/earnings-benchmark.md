# Earnings Intelligence benchmark update

The Alphabet case is an imported, retrospective research record. It is not a forecast made on 28 October. The SEC-reported financial values and their receipt times are retained in `data/earnings/alphabet-q3-2026.json`. The price reaction in a news story is not an executable quote or a scored market observation.

## Real case snapshot acceptance

The real-case pre/post request files are `data/earnings/alphabet-q3-2026-pre-request.json` and `alphabet-q3-2026-post-request.json`. Generated snapshots are alongside them. **Both are blocked:** all imported records were received after their proposed historical forecast cutoffs. The result is intentional. Neither the engine nor the model runner backdates receipt times to manufacture a pre-release forecast.

The event's publication time is the SEC filing acceptance proxy, not a claim to know the exact earlier press-release timestamp. The proposed outcome window is explicitly labelled `manual-user-window-unverified`. QQQ is a chosen Nasdaq-100 ETF proxy, not the Nasdaq Composite index. No QQQ or GOOGL outcome prices are supplied for this real case, and no provider call or paper order was made.

## Run the offline acceptance demonstration

```powershell
python -m worker.demo_earnings --output-dir test-results/earnings-demo
python -m unittest worker.test_earnings -v
```

Use a new output directory for each run. The demo sends no network requests and uses synthetic evidence, two different synthetic model responses and synthetic prices. It writes a blocked pre-release snapshot, a ready post-release snapshot, an immutable model-run directory and a deterministic evaluation report. The report demonstrates the bridge, not actual model skill.

## Snapshot → independent runs → observed-outcome report

```powershell
python -m worker.earnings snapshot worker/fixtures/earnings-synthetic-request.json --output test-results/my-snapshot.json
# With actual provider credentials, the next command incurs API usage. It accepts a ready snapshot envelope.
python -m worker.model_runner test-results/my-snapshot.json --output-dir test-results/my-run
python -m worker.earnings report test-results/my-run worker/fixtures/earnings-synthetic-observations.json --output test-results/my-report.json
```

The commands above use synthetic input files. Replace them with reviewed source data for research; do not merge synthetic observations with real records. Python reads process environment variables, not `.env.local` automatically. Missing credentials are recorded as missing configurations; the report retains failed participants with null scores rather than inventing results. No paid calls were made in implementation or tests.

## Frozen contract and leakage controls

Each request freezes `eventId`, `symbol`, `phase`, `earningsPublishedAt`, `cutoff`, `horizon`, `neutralBand`, and `earningsTarget`. The target explicitly identifies absolute company return or company return minus benchmark return, a benchmark instrument when needed, anchor/end timestamps, regular/after-hours session, calendar reference and price basis. Calendar references and windows are caller-provided; this tool does not certify exchange calendar correctness.

Claims preserve source, publication and receipt times and classification (`company_fact`, `analyst_opinion`, `speculation`, `market_outcome`). Verified facts and explicitly sourced opinions/speculation are eligible only if both timestamps meet the cutoff. Unknown times, unverified claims, late articles, later market-reaction commentary and market outcomes are excluded with reasons. Revision chains cannot cycle; older facts are superseded only when their replacement is itself eligible. The snapshot remains a retrospective replay even when evidence was historically available: model training may include later events.

The raw model-runner input validator independently enforces earnings provenance and excludes market outcomes, preventing a manually composed bundle from bypassing snapshot controls. Both provider records carry the frozen evidence hash; report assembly rejects records from another experiment or participant. This protects accidental artifact mix-ups, not an administrator deliberately editing all hashes and records.

The registered baseline is `neutral-abstention-v1`: forecast neutral with expected target return zero and place no trade. Its definition is frozen in the bundle; its full forecast is recorded in the run manifest before provider calls. It is a simple abstention baseline, not a tuned earnings strategy. The observed company and benchmark returns are reported separately. A more sophisticated trading baseline must be registered and implemented before its outcomes are observed.

## Outcome and paper accounting

Outcome reports require one verified price observation per exact target endpoint and instrument. All observations must have source, currency, session, price basis, publication/receipt timing, declared feed delay and matching synthetic/observed mode. Endpoint sessions, bases and currencies must agree; excess returns require a separate aligned benchmark. Media percentage changes are rejected. Historical delayed observations can measure outcomes, but are never silently used as executable fills.

An optional `paperScenario` can reconcile an explicitly approved long-only scenario. It requires a supplied reviewer/note, approval timestamp, fresh post-approval entry, aligned FX sources/timestamps, available cash, position size and fixed-capital position checks. The cost policy is fixed: 10 bps spread, 5 bps slippage, 15 bps FX and £1 per side. Output is `scenario_evaluated` with execution authority `none`; it does not authenticate imported approval metadata or create a trade. The authenticated Convex journal remains authoritative. Without a scenario, paper P&L remains null. Forecast direction and forecast accuracy are not paper authorisation.

Provider forecast `lower`/`upper` fields are translated to the evaluator's interval contract. Scores refer to the frozen absolute/excess target and neutral band; excess returns are not artificially restricted to a −100% lower bound. Economic interpretation accuracy remains separately unscored pending adjudication. Raw usage is retained; actual provider cost remains null until billing and currency are reconciled.

## Remaining deployment boundary

The CLI now connects frozen earnings evidence, model artifacts, a registered baseline and aligned outcome scores. It does not automatically ingest articles, retrieve licensed prices, certify the calendar, reconcile billing or synchronise artifacts into Convex. Real credentials, reviewed evidence and a complete observed outcome window are still required. A retrospective result must never be advertised as an original forward prediction.
