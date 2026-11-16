# Vectis ONE — Investor Red Flags & Mitigations (one page)

*Independent technical review, 10 November 2026. Evidence IDs refer to [10-technical-evidence-register.md](10-technical-evidence-register.md). Full analysis is in [opus-independent-technical-review.md](opus-independent-technical-review.md).*

**Bottom line:** a real, deployed single-user AI research application with a credible "evidence-locked AI" design, built very quickly by one founder using Gemini tools. It is **not** yet production-ready for third parties, **not** a multi-tenant platform, and **not** commercially validated. Several earlier AI-generated "PASS" reports overstate what was verified.

| # | Red flag | Severity | Evidence | Mitigation before or as a condition of investment |
|---|---|---|---|---|
| 1 | "Live Gemini" telemetry is hard-coded or synthesised; fallback answers are labelled live; no trustworthy AI-quality benchmark exists. | Critical | E-16; review C10–C13 | Rebuild the evaluation harness with real provider IDs and stored raw responses; an independent party re-runs it. |
| 2 | Phase reports systematically overstate verification (live broker, cron freshness, CI fixed, 100% isolation). | Critical | Review §3 (5 FAIL, 14 PARTIAL, 3 NOT VERIFIED of 30 claims) | Base investor materials only on independently verified evidence; adopt a separate verification step. |
| 3 | Anonymous callers can receive the owner's chat and operations telemetry through public queries. | High | E-29 | Remove the `RESEARCH_OWNER_ID` fallback; add denial tests; external security review. |
| 4 | A gated live-trading order pathway exists; "execution authority = none" depends on environment flags. | High | E-26 | Remove it or formally govern it; evidence the production flag state; FCA-regulatory advice. |
| 5 | The source code is public, with no licence, IP assignment or contributor record; user identifiers appear in public docs. | High | E-12, E-13, E-30 | Solicitor review of ownership (including AI-generated code); decide on private repository or deliberate licensing; scrub identifiers. |
| 6 | No CI test gate; the only workflow failed for three days unnoticed; 31 lint errors. | High | E-08, E-20, E-22 | Required CI checks (tests, type check, lint, build) before deploy; alert on failure. |
| 7 | No monitoring, alerting, backup or restore evidence; collector freshness unverified. | High | E-18, E-23, E-24 | External monitoring; documented restore drill; freshness alarms. |
| 8 | Single-user design: no tenant model, scheduler bound to one owner. | High (for the platform thesis) | E-28 | Tenancy as the first platform milestone, only after second-vertical demand is evidenced. |
| 9 | Financial inputs (Bank Rate, SONIA, yields) are hard-coded; an AI-introduced rate error occurred previously. | Medium | E-41, E-42 | Automated primary-source fetch and reconciliation; finance-professional spot check. |
| 10 | Vault key is a single environment variable (no KMS or rotation); TypeDB defaults to `admin` / `password`; proxy fails open. | Medium | E-25, E-31, E-32 | KMS or rotation runbook; remove defaults; fail closed. |
| 11 | No customers, pilots, LOIs or provider invoices. | High (commercial) | E-44, E-45 | Customer discovery with 5–10 interviews; one paid or LOI pilot as a stop/go gate. |
| 12 | Dependency on one founder and five third-party services (Vercel, Convex, Clerk, TypeDB Cloud, Google Gemini). | Medium | Architecture | Documentation, a second engineer, and a provider-exit assessment for each service. |
| 13 | A GitHub OAuth token was exposed in agent tool logs during this engagement. | High (immediate) | E-35 | **Revoke now**; restrict agent access to credential helpers. |

**What is genuinely valuable:**

- The evidence-locked answer pattern: six allowlisted queries, SHA-256 evidence bundles and a nine-check deterministic validator.
- Careful credential and trading gating.
- Least-privilege research agents.
- Demonstrated founder speed and specification skill.
- Roughly 25–33% component reuse toward an IsleConnect or SME pilot (estimate; method in review §7.4).

**Recommended funding order:**

1. Verification and security hardening.
2. Customer discovery and one second-vertical pilot.
3. Platform generalisation only after evidenced demand.

**Must be checked by qualified humans:**

- Technology solicitor: IP, licensing.
- FCA-regulatory adviser.
- CREST-accredited penetration tester.
- Independent engineer: production consoles, AI benchmark re-run.
- Data-licensing adviser.
- Accountant: actual provider bills.
