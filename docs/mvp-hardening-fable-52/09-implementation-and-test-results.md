# 09 — Implementation and test results

All results below were produced on 10 November 2026 in a Linux container (Node 22.23.4, Python 3) from a clean `npm ci`. Verification level: **V2 (tested locally)** unless stated. Nothing was deployed. No trading call, no paid model call and no production data access occurred.

## 1. Commits on `claude/exciting-bardeen-f4y1iz`

| Commit | Work package | Summary |
|---|---|---|
| `55f91ef` | WP1 | Remove anonymous owner fallback and unscoped scans; allowlisted public status |
| `c35f961` | WP2 | Acceptance nonces: hashed, owner/question-bound, atomic, gateway-only; validated audit writes; honest fallback telemetry |
| `7a4b79b` | WP3 | Research-only execution boundary at route, client and Convex layers |
| `e7cdf97` | WP4 | Close anonymous graph actions; TypeDB fail-closed; TLS from scheme; proxy fail-closed; status labels; shared chat limit |
| `ebcb7fd` | WP5 | CI quality gate; Linux-reproducible tests; ESLint non-regression gate |
| `054f4b9` | WP6 | Evidence-locked evaluation harness; corrected legacy suites; telemetry provenance labels |
| `866d780` | WP8 | Fixture and illustrative-input labelling; deterministic arithmetic module |
| `d0c2e2e` | WP7 | Pipeline evidence ladder on the owner overview |
| `1671224` | WP1 | Provider probe action requires identity |

## 2. Defect reproduction (new tests run against the code before each fix)

| Suite | Failing before fix | Passing after |
|---|---|---|
| `security-convex-data-isolation` | 8 of 14 | 15 of 15 (one test added later) |
| `security-research-only-boundary` | 16 of 20 | 20 of 20 |
| `security-runtime-hardening` | 14 of 17 | 17 of 17 |
| `security-acceptance-nonce` | n/a — tests target the new design; the removed public mutations are asserted absent | 26 of 26 |
| `evaluation-harness` + legacy suites | Legacy tests passed only because they asserted the defects | 23 of 23, plus two replaced legacy tests |
| `financial-integrity` | Fixture-label and freshness cases target new inputs | 16 of 16 |
| `pipeline-stages` | New function | 4 of 4 |

## 3. Final state (commit `1671224`)

| Check | Baseline (`639a2ed`) | Final |
|---|---|---|
| `npm ci` → Vitest starts on Linux | No | Yes |
| TypeScript | Pass | Pass |
| Vitest | 521 passed, 7 failed (528) | **646 passed, 4 skipped** (650) |
| Python | 218 passed, 1 error | 218 passed, 1 skipped |
| ESLint | 31 errors | 29 errors, no new errors (gate) |
| `next build` | Pass | Pass |
| actionlint | Pass | Pass (two workflows) |
| `npm audit` | 8 moderate | 8 moderate, 0 high/critical |

Skipped tests: three need a live TypeDB server, one is the billable live evaluation. They are reported as skipped, not passed.

## 4. Evidence classification

| Claim | Level |
|---|---|
| The defects in 01 §5–6 exist in `639a2ed` | V1 + V2 (reproduced by failing tests) |
| The fixes behave as described | V2 |
| Concurrency safety of nonce consumption | V2 against convex-test's serial transaction model only — **not** against a real Convex backend |
| Anything about production | **Not verified (no V3)** |
| Independent review | **None (no V4)**. This work was done by an AI assistant; the tests are self-authored. |

## 5. Deployment requirements

New server-only variables: `EVIDENCE_CHAT_GATEWAY_SECRET` (Convex and Vercel), `TYPEDB_BRIDGE_SECRET` (Convex and Vercel, if Vercel lacks TypeDB credentials), optional `CONVEX_HTTP_ACTIONS_URL`. Schema changes are additive. Deployment order and rollback: 03 §6.
