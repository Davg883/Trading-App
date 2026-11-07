# Recovery Case 006 — registered research experiments

Case 006 evaluates recovery evidence without turning a rebound, analyst label or model interpretation into a trading instruction. An imported event remains retrospective research. Its original publication dates and actual source receipt times are preserved, while workspace ingestion and experiment registration are recorded independently. A newly imported retrospective event cannot be represented as a forecast registered before that event.

## Immutable source and protocol records

Trusted internal ingestion imports source cases. Browser clients and models cannot mark their own inputs authoritative, licensed or approved. Exact retries are idempotent; changed facts, corrections or source versions require a new immutable import identifier. Source publication/event time, receipt time, reporting period, currency, financial definition and market-price adjustment conventions remain explicit.

Authenticated owners can inspect their cases and register Case 006 from an eligible cutoff. The cutoff cannot precede actual workspace ingestion, and future receipts cannot be claimed as already known. Classification criteria, invalidation conditions, comparison capital, staged deployment schedule and outcome conventions are frozen with the registration. Later evidence can be evaluated separately; it cannot rewrite an earlier classification or protocol.

The classification is a research assessment under fixed versioned rules. Missing, contradictory or ineligible critical evidence remains a visible block. Human review cannot waive an invalidation, fill a missing source with a model estimate, change the original criteria or retrospectively promote an experiment into a forward prediction.

## Import the observed Case 006 package

The source case is [data/recovery/november-3-2026.json](../data/recovery/november-3-2026.json); the corresponding offline request is [november-3-2026-request.json](../data/recovery/november-3-2026-request.json). Review [source provenance](../data/recovery/SOURCES.md) before using either. The supplied public history ends on **2 November**, while the requested research anchor is **3 November 2026 at 21:00 UTC**. An unavailable anchor close must remain unavailable. Public unadjusted ETF closes do not become licensed total-return observations, and undisclosed costs or GBP conversion assumptions remain null.

After configuring the established Clerk and Convex deployment and publishing the additive schema/functions, trusted server ingestion should read the source JSON as UTF-8, validate it with `parseRecoveryCase`, and call internal `recovery:importCase` with:

```json
{
  "owner": "THE_AUTHENTICATED_CLERK_TOKEN_IDENTIFIER",
  "externalId": "recovery-006-2026-11-03-source-v1",
  "caseJson": "THE_EXACT_SOURCE_FILE_CONTENTS"
}
```

The placeholders describe server-side arguments, not a command containing credentials. Resolve the owner from the authenticated server identity; do not accept an arbitrary browser-supplied owner. Source files contain no provider credentials. Do not alter their recorded receipt times to match a desired historical entry. The import adds its own actual ingestion timestamp and accepts exact retries; a correction requires a new external source-version ID. Imports are limited to 800,000 bytes.

`recovery:list` and `recovery:detail` require authentication and expose only that owner's records. The private Recovery interface can call `recovery:registerCase006` with the owned `caseId`, a name, eligible cutoff, `anchorAt`, `benchmarkInstrumentId`, `priceBasis` and `adjustmentVersion`. For the supplied request, the anchor is `2026-11-03T21:00:00Z` and the comparison benchmark is VT. The placeholder adjustment version in the request deliberately does not assert a licensed adjusted feed. The server supplies actual registration time; the cutoff must be at or after actual ingestion. Registration is capped at 850,000 bytes and creates exactly three experiment records and twelve windows, even when outcomes remain pending because required observations are absent.

## Three independent £500 comparisons

Registration creates three distinct research experiment records: immediate allocation, staged allocation and diversified allocation. Each starts with £500 GBP and uses the same registered anchor, horizon, pricing basis, calendar, currency conversion and declared cost conventions. The capital of one comparison cannot fund another.

The staged comparison uses one £500 budget across all tranches. It does not receive £500 for every stage. A tranche cannot deploy before its registered timestamp, and later untriggered or future tranches remain cash or pending under the frozen protocol. A missing future tranche price must never be replaced by an earlier quote or a model estimate. No research allocation creates an order or fill in the authoritative paper ledger.

Version `recovery-006-v1` fixes the staged schedule at the common anchor and offsets of 5 and 20 trading sessions, with one-third of the same budget per tranche. Immediate and diversified controls enter at offset zero. The diversified control is 50% sourced global ETF exposure and 50% GBP cash. Fees are funded inside each tranche's budget, and future undeployed tranches do not incur fabricated entry fees. The source protocol explicitly preserves these choices for later review.

Register 1, 5, 20 and 60 trading-session outcome windows for each of the three comparisons. Preserve exact portfolio and benchmark endpoints, exchange calendar, regular-session definition, market-data source, adjustment basis, currency/FX treatment and declared costs. Net performance includes all declared costs; unavailable prices, incomplete windows, incompatible FX or missing cost assumptions remain pending rather than producing a fabricated return.

## Human review and subsequent observations

An authenticated human reviewer may record a favourable or rejected research permission with reasons, acknowledged risks and a revalidation date. A signed human reviewer claim is required. Decisions retain the exact immutable experiment and evidence selection; revising a decision requires explicitly superseding its latest prior review. Rejections and expired decisions remain in the audit history.

`recovery:reviewExperiment` accepts the owned experiment ID, decision, reason, unique acknowledged risks and a future revalidation date; a later decision must include the latest prior `supersedesId`. A favourable decision requires both the original frozen research gate and the current independently calculated gate to pass. Any recorded triggered invalidation for that experiment remains terminal for research permission even if later observations recover. Human approval cannot erase that history; a new experiment registration is required. Rejection remains available for recording missing inputs and failed checks.

These decisions grant no brokerage or paper execution capability. The existing paper-ledger capital minimum, instrument allowlist, deterministic risk checks and authenticated paper-order approval remain unchanged. In particular, the £500 research comparisons do not reduce the existing paper-ledger minimum or authorise leverage. Broker connections remain read-only.

Trusted ingestion can add later compatible observations and request an independent outcome reevaluation. The system computes the report from the original frozen experiment and the new source version; callers cannot submit their own returns, scores or invalidation waivers. Pending and completed evaluations are appended immutably with actual ingestion/evaluation times. Later market outcomes and revised fundamentals cannot leak back into the earlier evidence snapshot.

Internal `recovery:evaluateOutcome` accepts `owner`, `experimentId`, `observationCaseId`, `horizonSessions` (1, 5, 20 or 60) and `asOf`. Outcome observations must have entered the workspace by that evaluation cutoff, and it cannot be future-dated. The report is recomputed under the frozen window, portfolio schedule and pricing conventions and includes a separately computed current risk gate. Exact reevaluation retries are idempotent; changed source observations or evaluation times append new records. Each report is limited to 200,000 bytes and each experiment retains at most 100 outcome records. This function has no public client equivalent accepting arbitrary scores.

A later genuine forward experiment requires a separate advance registration, future target definition and submission deadline, with only evidence actually published and received at that new cutoff. A retrospective Case 006 comparison cannot be relabelled into that future experiment. No model runs or market results are fabricated when integrations are unconfigured.

## Source v2 result (5 November 2026 re-capture)

[november-3-2026-v2-request.json](../data/recovery/november-3-2026-v2-request.json) is a separate retrospective import of the same 3 November 21:00 UTC anchor. It contains the anchor close, which was unavailable at v1 receipt. See [SOURCES.md](../data/recovery/SOURCES.md#source-version-2-5-november-2026-re-capture). Import it as a new external ID (`recovery-006-2026-11-03-source-v2`); never overwrite v1.

**Engine fix (`recovery-confirmation-v1` criteria unchanged):** `recoveryMomentum` / `recovery_momentum` take an optional end bound. The classifier now ends momentum at the registered anchor instead of at the latest close received before the cutoff. Before this fix, any cutoff after the anchor measured the 4 November close and then reported the anchor as "unavailable". An anchor close that is genuinely missing is still never replaced by an earlier one.

| Ending 3 Nov | 1-session | 5-session | 20-session | Max drawdown 5 / 20 | Up sessions in 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| COMP | +0.83% | −4.18% | −8.07% | −5.22% / −8.82% | 2 |
| NDX | +0.68% | −4.96% | −9.75% | −6.12% / −10.36% | 2 |
| SOX | +2.63% | −7.68% | −19.80% | −11.60% / −21.86% | 2 |

Classification: **`unconfirmed`**. The engine reports only two critical gaps: licensed breadth and licensed sector participation. Even if favourable breadth and sector data were supplied, the observed rebound could not reach `developing` or `confirmed`. It has 2 of 5 positive sessions (3 required), negative 5-session returns, a VIX rise of +3.31 against a +2 guard and an HY spread widening of +22 bp against a +20 bp guard. This is tested in `tests/recovery-case-v2.test.ts`. Invalidation is not met: COMP's 5-session −4.18% is above −5%, its 20-session −8.07% is above −10%, VIX is below 35 and the spread widening is below 50 bp.

All twelve £500 windows (immediate, staged, diversified × 1/5/20/60 sessions) remain **pending**. Costs are undisclosed, prices are public-reference rather than licensed, and no licensed close-aligned GBP FX exists. No GBP net return, FX cost or portfolio drawdown is reported. All three risk gates fail, and execution authority is `none`.
