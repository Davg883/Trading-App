# Benchmark 001.1 implementation acceptance

Reviewed 30 October 2026. This is acceptance of the local implementation and its supplied test cases, not certification of a live investment research service.

## Delivered

- `/stress`, linked from Market Radar, with Alphabet, Amazon, Microsoft, NVIDIA, Intel and CoreWeave; the six established modules and `/earnings` are retained.
- Observed-data mode starts without fabricated quotes. A separate synthetic demonstration exercises all price windows. Licensed JSON imports retain source, currency, session, timestamps, delay and adjustment metadata.
- Versioned valuation/earnings comparisons, prior observation controls, source exports, a seven-part research review and explicit researcher classification. A share-price decline has no authority to classify or create an order.
- Registered 1/5/20/60-session outcome windows. Incomplete windows and missing compatible observations remain pending; no probabilistic score is fabricated.
- An offline experiment bridge from the browser draft to two independent provider adapters, neutral abstention, a deterministic valuation checklist and passive QQQ. Results return to the browser with company/window identity, probabilities, expected returns, intervals, sources, risks, failures and latency. Economic factual adjudication is a separate versioned human rubric.
- Owner-scoped Convex imports, frozen eligible evidence and append-only outcome results. Paper review carries thesis, counterevidence, risks, proposed sizing, planned-loss assumptions, freshness, uncertainty and disagreement; existing approval and independent execution checks remain in force.
- Python calculations, a network-free demonstration, source-provenance notes, KPI definitions and architecture documentation. Established earnings, scoring and paper-accounting formulas were not modified.

## Verification

| Check | Result |
| --- | --- |
| TypeScript/Vitest suite | 65 tests passed across 9 files, including all existing research, earnings, backend/security and accounting regressions |
| Python suite | 50 tests passed, including existing research, earnings and model-runner tests |
| Type checking | Passed |
| ESLint | Passed |
| Production Next.js build | Passed; `/`, `/earnings`, `/stress` and `/workspace` compile |
| Original dashboard browser check | Passed: all six modules, search, synthetic experiment, costed approval persistence, corrupt-state recovery and mobile layout |
| Earnings browser check | Passed: sourced KPIs, historical evidence exclusions, snapshot export, article intake, report import and mobile layout |
| Stress browser check | Passed: six companies, observed nulls, separate demo, complete/pending windows, invalid import rejection, draft export, researcher review, report mode isolation and rejection of scores on pending outcomes |
| Browser-to-worker bridge | Actual browser export prepared and evaluated through two mocked provider adapters, five participants and a completed five-session outcome; zero network requests |

Desktop and mobile monitor screenshots were inspected. The monitor has no horizontal page overflow at a 390px viewport; its wide tables scroll within their panels.

## Required acceptance cases

| Requirement | Evidence |
| --- | --- |
| A decline alone cannot produce a buy/opportunity | TypeScript/Python classification tests; browser remains insufficient until an explicit evidence review; no order-writing path from the monitor |
| Reject incompatible consensus/accounting | Period, scope, vendor, currency, unit, accounting basis and adjustment-version tests; ambiguous revisions are rejected |
| Missing valuation inputs stay null | P/E, EPS, EV components and cash-flow tests; observed browser starts without quotes or consensus |
| Identical trading windows for relative returns | Exact instrument/QQQ endpoint, exchange-session and full-lookback coverage tests |
| Corporate actions and currency remain consistent | Mixed-basis/currency rejection tests plus a sourced, time-aligned close-only FX conversion test; no converted intraday high is invented |
| Deterministic KPIs reproduce | Repeated-source equality tests and TypeScript/Python contract cross-review |
| Later news cannot enter an earlier forecast | Publication and receipt cutoff tests, nested price-history eligibility checks and preserved earnings historical exclusion tests |
| Unfinished future windows stay pending | Engine, worker, backend and browser tests; pending report import cannot carry forecast scores |
| Synthetic and observed cannot silently mix | Import, financial, outcome and browser report-isolation checks |
| Models cannot bypass risk/human approval | Unauthorized approval and unapproved execution rejected; even an approved oversized model-style proposal fails the independent risk gate and creates no fill |

Independent implementation agents cross-reviewed the TypeScript/Convex and Python contracts. Review corrected ambiguous financial revision ordering, adjustment-version mismatches, direct price validation, credential-bearing source URLs and the browser draft's large-history preparation path.

## Outstanding integrations and limitations

1. **No licensed market feed or authoritative consensus dataset is configured.** Provider-specific live polling, entitlements, calendar/holiday data and corporate-action substantiation need integration testing. The adapter currently accepts supplied files and trusted internal imports.
2. **The real October sell-off is an investigation premise.** The existing reviewed Alphabet SEC extraction is reused, but no observed six-company price history, comprehensive news timeline, verified causal attribution or investment opportunity is asserted. The other companies' unsupplied financial and event data stays unavailable.
3. **Production Clerk/Convex is not exercised.** Ownership and approval are tested in the local Convex test runtime. A deployed two-user login test, trusted ingestion service and operational monitoring remain required. The public monitor uses local file review; its forward registration API is not presented as a live connection.
4. **No paid model comparison was run.** Provider responses in acceptance are mocks. Inference usage/latency and missing-result fields are implemented; actual billed cost remains null without a billing-backed integration. Deterministic baseline probabilities and intervals are documented, uncalibrated research controls.
5. **Local files do not prove authentic forward prediction.** Hashes detect inconsistent artifacts, but a user controlling all files can replace them. Forward claims require independently trusted registration and source receipts. Historical replay also carries possible model-training contamination.
6. **Research review remains a human judgement.** A local verification checkbox or adjudicator name is self-reported, not independently authenticated source verification. It does not authorize a trade. Planned stops do not guarantee a maximum realized loss or create a stop order.
7. **Pilot scope is bounded.** JSON size limits and calendar coverage are explicit; missing values fail closed. The monitor accepts USD financial inputs. FX conversion must retain provenance; no automatic multi-currency portfolio normalization is claimed.

No live brokerage execution, new brokerage permissions or automatic purchase based on a price decline was added.

## Reproduce

```powershell
npm test
python -m unittest discover -s worker -p test_*.py
npm run lint
npm run build
python -m worker.stress_demo --output-dir test-results/stress-end-to-end
# With the app running at localhost:3000:
npm run test:browser
npm run test:browser:earnings
npm run test:browser:stress
```

The demo refuses to overwrite an existing output directory; use a fresh directory for another run and adjust the report fixture path in the browser check if needed. See [workflow](stress-benchmark.md), [KPI definitions](stress-kpis.md) and [source provenance](../data/stress/SOURCES.md).
