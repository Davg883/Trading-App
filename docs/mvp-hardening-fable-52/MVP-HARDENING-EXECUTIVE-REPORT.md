# AI Capital Intelligence — MVP hardening: executive report

**Date:** 10 November 2026 · **Baseline:** `639a2ed` · **Branch:** `claude/exciting-bardeen-f4y1iz` · **Final commit reviewed:** see `09-implementation-and-test-results.md`
**Prepared by:** an AI engineering assistant (Claude Code). This is self-review, not independent verification.

## Executive verdict

The repository contained confirmed, material security and integrity defects, most of which earlier reports had marked as passed. They are now **fixed in code and covered by regression tests, locally**. **Nothing has been deployed.** Production remains in its original state until the owner approves the release in `03-acceptance-nonce-security-design.md` §6.

The product is not yet ready for an external pilot. The main gaps are production verification, release gating, a genuine live model evaluation, and operational resilience.

## Baseline condition

- Anonymous callers could read the research owner's chat telemetry, spend, staged research and broker connection status; when that owner had no rows, the query scanned other users' records.
- An anonymous Convex action ran arbitrary read-only TypeQL against the whole graph database with the deployment's credentials (not in the earlier audits).
- Public acceptance-nonce mutations allowed unauthenticated reads of owner context and unvalidated audit writes; nonces were `Math.random` values stored in clear.
- Order execution could be switched on with two environment strings.
- Earlier "100 % conformance" evaluations graded the expected answer against itself; telemetry was fabricated or hand-entered.
- CI ran no application tests; the suite could not run on a clean Linux checkout.
- A hard-coded £250 balance was labelled as live Trading 212 data.

Full classification: `01-repository-baseline.md`.

## Verified fixes (locally, V2)

| Area | Outcome |
|---|---|
| Data isolation | Owner-only reads; anonymous status is an explicit allowlist; no fallback scans |
| Acceptance nonces | CSPRNG, hashed at rest, bound to owner and question, atomic single use, gateway-only with a dedicated secret; validated audit writes |
| Execution | Build-level research-only boundary at three layers; flags set to `true` cannot place, confirm or cancel orders |
| Runtime | Graph actions closed; TypeDB fails closed; TLS reported from the address scheme; proxy fails closed for API routes; honest status labels |
| CI | Hermetic quality gate with a single required check; reproducible on Linux |
| Evaluation | Evidence-locked harness with separated modes and authentic telemetry; legacy suites corrected |
| Financial integrity | Fixture and illustrative inputs labelled; deterministic, tested arithmetic |
| Operations | Per-stage pipeline evidence on the owner overview |

## Tests and evidence

Vitest **646 passed, 4 skipped** (baseline 521 passed, 7 failed); Python 218 passed, 1 skipped; typecheck, build, actionlint and high-severity audit pass; ESLint 29 errors, none new. New security suites failed against the original code (8/14, 16/20, 14/17) and pass now.

## Production verification status

**None.** All changes: **IMPLEMENTED LOCALLY / PENDING DEPLOYMENT.**

## Security posture

Materially improved in code. Residual: no real-backend concurrency test; some legacy modules admit automation actors through `signedIn`; identifiers in documentation and history; no independent review; previously exposed GitHub OAuth token must be confirmed revoked by the owner (not touched).

## Investment readiness

See `10-investor-capability-reassessment.md`. In short: the architecture is credible and output is high, but security, evaluation and operational claims made before this review should be disregarded, and post-review claims are unverified in production.

## Decision table

| Finding | Fix | Test evidence | Deployment status | Remaining risk | Owner approval required |
|---|---|---|---|---|---|
| Anonymous owner fallback and unscoped scans (operations, chat telemetry) | `55f91ef` | 8/14 failed before; 15/15 pass | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Production unverified | Deploy Convex |
| Anonymous TypeQL / graph actions; spoofable `callerId` | `e7cdf97` | 14/17 failed before; 17/17 pass | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Bridge needs `TYPEDB_BRIDGE_SECRET` or the probe shows unreachable | Deploy; set secret |
| Public acceptance-nonce mutations; unvalidated audit writes | `c35f961` | 26/26 pass (old functions asserted absent) | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Real-backend concurrency untested; brief acceptance outage at release | Deploy Convex then Vercel; set gateway secret |
| Order execution enabled by environment flags | `7a4b79b` | 16/20 failed before; 20/20 pass | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Code still in bundle; stored trading keys not reviewed | Deploy; review and revoke stored keys |
| TypeDB default credentials; TLS badge; proxy fail-open; fabricated verification times | `e7cdf97` | Included above | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Hosted-runtime detection to confirm after deploy | Deploy |
| Anonymous provider probe | `1671224` | 1 test | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | — | Deploy |
| No CI quality gate; non-reproducible suite | `ebcb7fd` | Local reproduction of every job | Committed; first GitHub run not yet observed | Branch protection not configured | Enable required check |
| Self-graded evaluations; fabricated telemetry | `054f4b9` | 23 harness tests + corrected legacy tests | Code only (no deployment needed) | No live evaluation yet; small, non-independent set | Approve a budgeted live run |
| Fixture labelled live; illustrative inputs labelled verified | `866d780` | 16/16 | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Inputs remain illustrative | Data-licensing decision |
| Health conflated across pipeline stages | `d0c2e2e` | 4/4 | IMPLEMENTED LOCALLY / PENDING DEPLOYMENT | Not yet shown in UI; no alerting or restore drill | — |

## Recommended next steps

1. Review the draft pull request for this branch; approve deployment using 03 §6; run the post-deployment checks.
2. Enable branch protection with the **CI gate** check and run the release-gating test (06 §6).
3. Confirm revocation of the exposed GitHub OAuth token.
4. Approve a small, budgeted live evaluation; commission an independent held-out question set.
5. Commission an independent security review of WP1–WP4.

## Documents

`01-repository-baseline.md` · `02-security-findings-and-access-matrix.md` · `03-acceptance-nonce-security-design.md` · `04-research-only-execution-boundary.md` · `05-ai-evaluation-integrity.md` · `06-ci-cd-release-gating.md` · `07-data-freshness-and-operations.md` · `08-financial-and-interface-integrity.md` · `09-implementation-and-test-results.md` · `10-investor-capability-reassessment.md`
