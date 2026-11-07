# Benchmark 001 — implementation acceptance review

Latest extension: [Benchmark 001.1 acceptance report](stress-acceptance.md). This document retains the earlier milestone history.

Historical review note: the 29 October earnings update subsequently implemented an offline snapshot-to-model-artifact-to-outcome bridge and a report viewer. See [earnings-benchmark.md](earnings-benchmark.md). The missing-chain list below records the earlier milestone; it does not describe all current functionality. Live credentials, licensed outcome data and deployment remain unverified.

Review scope: the supplied development-milestone checklist. Inspected the actual package manifest, six-module dashboard, authenticated workspace, Convex schema/functions, TypeScript engine and tests, Python evaluator/importer/model runner and project documentation. Two independent agents cross-reviewed the backend and worker. No feature expansion, paid model calls, live trades or external deployment was performed.

## Verdict

The local prototype is demonstrated; a complete experiment using real observations is not. Six checklist items have local evidence, and two remain partially verified. This is not an 8/8 production acceptance.

After corrections: **18 TypeScript tests and 22 Python tests pass (40 total)**. The production build and lint checks pass. The strengthened browser check also passed, including rejection of corrupt saved demo state and persistence of exactly one costed paper approval. Existing installed packages were inspected with `npm ls --depth=0`; dependencies were not upgraded during this acceptance review.

| Acceptance item | Result | Evidence and limit |
|---|---|---|
| Build integrity | Local pass | Production build, TypeScript and automated test suite executed against source |
| Numerical accuracy | Local pass | Brier, MAE, interval coverage, drawdown, cached-token cost, importer and model-runner tests pass for supplied cases |
| Evidence controls | Local pass | Future publication/receipt and late forecast tests; source truth itself still needs validation |
| Reproducibility | Local pass | Same evaluation fixture produced identical canonical output twice |
| Trading accounting | Local pass | Costed fills, FX, cash reconciliation and duplicate-safe execution tested; long-only fixed-capital policy only |
| Model comparison | Partial | Two provider requests share frozen evidence and deadlines in mocked tests; no integrated rules participant, real outcome alignment or live provider comparison |
| Security | Partial | Authenticated owner isolation tested in Convex test runtime; real Clerk login and deployed two-user access not exercised |
| Dashboard clarity | Local pass | All six screens exercised; synthetic labels, approval persistence, desktop/mobile layout and disconnected workspace checked in a browser |

## Defects corrected during review

1. Credential-bearing provider calls followed redirects. Provider requests now reject redirects instead of risking forwarding keys to a different host or insecure destination.
2. Forecasts lacked a frozen neutral-band definition. Model evidence bundles now require an explicit band and both prompts carry the same rule used for class interpretation.
3. A newer synthetic quote could mask an eligible observed quote. Quote selection now includes portfolio mode before choosing the latest observation.
4. Reusing a forecast idempotency key with different content silently returned an unrelated existing forecast. Conflicting retries are now rejected while exact retries retain their original result.
5. The connected page could attempt authentication with only public keys configured. Readiness now also requires the server-side Clerk secret, matching the proxy gate.

Regression tests cover the backend and model-runner corrections. These changes do not connect new providers or widen trading scope.

## Reproducibility evidence

For `worker/example.json`, canonical sorted JSON evaluation output had SHA-256:

`5bb1e10038569b937731e009c71568da29a8e9dc0f6a02451c51386d756af64d`

Selected synthetic outputs: Brier 0.24, MAE 0.002 (decimal return), estimated inference cost 0.0049 in the supplied rate currency. These are fixture calculations, not model performance claims.

## The remaining complete-experiment gate

The proposed earnings-to-scorecard experiment is not yet connected end to end. The missing chain is:

1. Ingest one original earnings release and licensed price observations with retained raw sources, timestamps and revision identity.
2. Register a machine-readable protocol with neutral band, horizon anchor, trading calendar, participants, baseline, budgets and costs.
3. Run both real providers and a deterministic rules participant against that evidence. Preserve unsuccessful submissions.
4. Link the resulting forecasts to a reviewed internal paper proposal and eligible post-approval quote.
5. Collect session-aligned observed outcomes; translate runner `lower`/`upper` fields into the evaluator's interval contract and link returns to forecast IDs.
6. Reconcile usage and actual costs, compute the aligned rules/passive comparisons, and display the stored report in the authenticated dashboard.

The worker currently writes files; it does not submit those artifacts to Convex. The authenticated screen shows forecast counts but not a full observed-outcome performance report. The main dashboard replays fixtures. Market-data licensing, provider credentials and Clerk/Convex deployment remain necessary; credentials alone do not implement the missing bridges.

Retain the independent internal ledger. Trading 212 should remain a future execution adapter, with Revolut outside this research automation. A real-money release is outside this milestone.
