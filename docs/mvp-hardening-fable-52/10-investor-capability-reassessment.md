# 10 — Investor capability reassessment

Written for a technically informed seed investor. It states what the repository now demonstrates, what it does not, and what remains before a first external pilot. It is not a valuation or a recommendation.

## 1. What the work demonstrates

| Area | Assessment | Basis |
|---|---|---|
| Secure engineering practices | **Improving, not yet established.** Material access-control defects existed in shipped code (anonymous reads of private telemetry, an anonymous graph-query action, unauthenticated audit writes). They are fixed locally with regression tests, but were not caught by the earlier process. | 02, 03 |
| Evidence-governed AI architecture | **Architecture is credible; evidence of it working live is absent.** Closed evidence bundles, deterministic validation and audit records exist. Earlier accuracy claims are not supported: the evaluations graded the expected answer against itself, and the "verified" live record is a hand-entered constant with internally inconsistent figures. | 05 |
| Reliable production development | **Not demonstrated.** Until this review CI ran no application tests and the suite could not run on Linux. A CI gate now exists; branch protection and Vercel gating are unverified. | 06 |
| Independent testing | **None yet.** All tests, including these, are self-authored; no human reviewer has verified them (no V4). | 09 |
| Honest model evaluation | **Harness ready; no results.** No live run has been performed; there is no verified accuracy figure. | 05 |
| Human control | **Present for research decisions** (reviewer grants, human-only actions). Execution authority is now enforced as `none` in the build. | 04 |
| Operational resilience | **Not demonstrated.** No restore drill, no alerting, freshness not yet surfaced in the UI. | 07 |
| Reusable components | **Some.** The evaluation harness, audit validation, nonce gateway pattern and execution boundary are reusable for the proposed Vectis ONE framework. | |
| Founder delivery capability | **High output; verification discipline was the gap.** The volume of functionality is substantial. Several acceptance reports recorded PASS on evidence that does not hold, which an investor should weigh. | 01 |

## 2. Claims that should not be made

- That the product is commercially multi-tenant (it has owner-scoped records only).
- Any model accuracy, hallucination-rate or citation-accuracy figure.
- That production data is live or fresh, or that backups are restorable.
- That the product has customers, product–market fit or protected IP (no evidence was reviewed).
- That trading execution is possible, or that the product gives advice.

## 3. Work required before a first external pilot

1. Owner-approved deployment of these changes, followed by the production checks in 03 §7 and 04 §5 (V3 evidence).
2. Branch protection requiring the CI gate; demonstrate the release-gating plan (06 §6).
3. A billable live evaluation within an approved budget, then an independent, held-out question set written and graded by someone outside the build team.
4. Concurrency test of nonce consumption against a real Convex deployment.
5. Alerting, stale-data indicators in the UI, and a performed restore drill.
6. Browser accessibility and mobile pass; error and loading states.
7. Redaction of identifiers in documentation; confirmation that the previously exposed GitHub OAuth token has been revoked.
8. An independent security review (V4) of WP1–WP4.
9. Decide whether to remove the execution code entirely (option B) for the pilot.
10. Data-licensing decision for market inputs currently labelled illustrative.
