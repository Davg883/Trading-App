# Trading Research Lab 001 — overview and prerequisites

**Status: SPECIFICATION ONLY. Nothing here is implemented. Ready for formal registration review and FROZEN until then (`08` §8–9); all rules provisional until registration.**
**Date:** 11 November 2026 · **Author:** AI-assisted specification (Claude Code session), not independently reviewed.

## 1. Purpose

Lab 001 is a forward-recorded research experiment. It tests one question: does AI-assisted, evidence-governed research produce **repeatable, positive, risk-adjusted returns against QQQ (GBP-adjusted), after realistic transaction costs**, for short holding periods (intraday to five sessions) in liquid US AI, semiconductor and technology equities?

It is a laboratory, not a trading product:
- Capital is simulated (£500).
- Execution is unleveraged and long-only.
- Orders go to a **Trading 212 demo (paper) account** or a deterministic model ledger, **never to a live account**.

## 2. Hard prerequisites (do not start implementation before all are met)

| # | Prerequisite | Why |
|---|---|---|
| P1 | Security PR Davg883/Trading-App#1 has had an **independent** security review and has been **safely released** to production, with post-deployment checks recorded | The lab reuses its identity, audit, budget-reservation, evidence-validation and research-only boundary |
| P2 | Branch protection on `main` requires the CI gate | The lab adds order-capable code; nothing unreviewed may reach production |
| P3 | A licensed or otherwise permitted **news** feed and an **intraday price** source are contracted (see `03-data-source-assessment.md`) | Without them, three of the four signal inputs and every intraday entry are missing |
| P4 | ~~Owner decision on automated demo orders versus explicit approval~~ **Met (11 Nov 2026):** every demo order requires explicit human approval; no veto-window execution; separate autonomous-shadow and human-approved records (`08-owner-decision-p4.md`) | Specification updated; not implementation authority |
| P5 | Budget for data, model inference and engineering approved (see `04-cost-model.md` §4) | |

## 3. Deliverables in this folder

| File | Content |
|---|---|
| `01-implementation-specification.md` | Components, data model, flows, strategies, decision schema, phases |
| `02-risk-model.md` | Position sizing, exposure limits, loss limits, halts |
| `03-data-source-assessment.md` | Required inputs, current coverage, missing licensed data, latency |
| `04-cost-model.md` | Per-trade costs, breakeven analysis, implementation and running costs |
| `05-simulation-methodology.md` | Forward recording, ledgers, benchmark, metrics, statistics, NVIDIA case study |
| `06-security-architecture.md` | Separation from the research app, demo-only execution, journal integrity |
| `07-acceptance-test-plan.md` | Tests mapped to the 14 product requirements |
| `08-owner-decision-p4.md` | Owner decision P4: explicit approval of every demo order; shadow and human-approved records; Phases A–C |

## 4. Headline limitations, stated up front

- **30 sessions and 30 opportunities cannot establish profitability.**
  - Depending on the expectancy and dispersion assumed, distinguishing a positive net expectancy from zero needs roughly 90–780 trades per strategy, and more after correcting for testing three strategies (see `05` §6).
  - Three strategies tested at once need a multiple-testing correction.
  - The initial observation period is **exploratory** (see `05` §6).
- **Costs are material at this scale.** On a £100 position, Trading 212's FX conversion alone (0.15% each way, *to be confirmed against the current fee schedule*) is about 0.12R per round trip at a £2.50 risk budget.
- **Paper fills are not live fills.** Demo-account fills, and the model ledger's fills, will be compared with each other, but neither proves live execution quality.
- **No profitability claim** may be made from backtests, simulated fills or this experiment's sample size.
