# Consensus Validation 001 — evidence and research studies

This extension tests whether licensed analyst labels and estimate revisions add useful information beyond the same eligible price and fundamental evidence. A rating is a vendor-defined research classification, not a probability or an investment instruction. Retrospective studies must remain labelled retrospective; no registration may claim that newly imported evidence was available to this workspace at an earlier historical date.

## Source ingestion and historical eligibility

Trusted internal ingestion registers immutable source cases, preserving the vendor's publication/event and update times, recorded system receipt, licence/permitted-use declarations, units, currency, and rating definitions and analyst population. Actual workspace ingestion is recorded independently. Browser clients and models cannot promote their own source claims into licensed, verified data.

Only evidence published and received by a study's frozen cutoff may enter its analysis. Missing, contradictory, stale or unlicensed critical observations remain unavailable. A later revision can only replace an older observation after that revision itself becomes eligible. Licensed price observations remain separate from consensus labels, and a label or an article's price-change description cannot supply an executable quote. Configuring a vendor name or key does not by itself establish a tested live feed or redistribution permission.

An authenticated owner may register a research study from an already imported case. The cutoff cannot precede actual ingestion. The study retains one immutable eligible evidence snapshot and the same conventions across its comparisons. The initial study is a retrospective research registration, not an original historical forward prediction.

Internal `consensus:importCase` accepts `owner`, `externalId` and `caseJson`. Exact retries are idempotent, while changed evidence requires a new external version identifier. Imports are limited to 800,000 bytes. `consensus:list` and `consensus:detail` require Clerk authentication and return only records belonging to that identity. Both declared source receipts and actual ingestion are retained.

Public `consensus:registerResearchStudy` accepts an owned `caseId`, name, evidence `cutoff`, entry `startAt`, `benchmarkInstrumentId`, `priceBasis` and `adjustmentVersion`. The server supplies actual registration time. Exactly one equal-weight AI plan and one diversified ETF/cash plan must be eligible in the trusted case. Registered study JSON is immutable and limited to 850,000 bytes. This endpoint rejects forward-mode case registrations; authentic future experiments require a separate advance-registration protocol.

## Separate £500 research portfolios

Each study creates two independent £500 GBP research-plan records: an equal-weight NVIDIA/Microsoft/Apple plan and a global-equity ETF plus cash plan. They have separate starting capital; their capital must not be pooled or treated as a £1,000 balance available to either plan. The global ETF must be explicitly identified and supported by reliable instrument data. It is not assumed independent of the AI cycle.

Custom research plans are fully funded and long only. Positive weights must sum to 100%, using only eligible cash and supported unleveraged instruments in the frozen registry. Unknown, inverse, leveraged, derivative or unavailable instruments cannot bypass those restrictions. A new allocation creates a new immutable plan rather than editing an already reviewed allocation.

`consensus:addCustomPortfolio` accepts an owned `studyId` and strict `portfolioJson`, including a unique plan ID, name, `planType: custom`, £500 initial capital, source-compatible mode, weights, explicit cost assumptions and cash return assumption. Missing costs remain null. Its windows retain the original anchor, calendar and benchmark, while storing the new plan, frozen instrument specifications and the actual time the custom allocation was registered. Identical retries reuse the existing plan; changed weights or assumptions require a new ID.

These records are research plans and do not create positions, proposals or fills in the authoritative paper-trading ledger. The established minimum-capital and independent risk policy remains unchanged. In particular, £500 research plans do not lower the existing £5,000 paper-ledger threshold or widen the executable instrument allowlist. Broker connections remain read-only.

## Matched outcome windows and ablations

Register 1, 5, 20 and 60 trading-session windows with an explicit anchor, exchange calendar, session type, benchmark, price-adjustment convention, portfolio and quote currencies, FX treatment, and complete declared cost assumptions. Portfolio and benchmark endpoints must be aligned. Missing calendar dates, prices, FX conversions or cost inputs remain visible; they are not manufactured by a model.

Every incomplete window stays pending. A return or score requires completed, source-backed valid observations under the original frozen conventions. Later consensus or market outcomes cannot alter an earlier evidence snapshot. Unobserved hypothetical outcomes and synthetic demonstrations remain separate from observed historical outcomes.

Trusted internal `consensus:evaluateOutcome` accepts an owner, `portfolioId`, `observationCaseId`, `horizonSessions` and evaluation `asOf`. It recomputes the report from the registered window and separately imported compatible licensed observations; it does not accept a supplied return or score. The evaluation date cannot precede actual ingestion of the outcome observations. New observation versions and evaluations remain append only, preserving both pending and completed reports. A source-backed completed retrospective return is still not evidence of an original forward forecast.

The ablation protocol compares price/fundamental evidence alone, the same base evidence plus consensus labels, and the same base evidence plus labels and revisions. Register the evidence partition and evaluation protocol before accepting results. Retain missing and failed submissions, actual model versions, latency, token usage and reconciled costs rather than inventing model performance. This release must not imply that analyst labels caused returns, that an ablation study has already run, or that a retrospective replay measures authentic forward model skill.

## Human review and later forward work

An authenticated human reviewer can record a favourable or rejected research recommendation, the exact immutable plan, reasons, acknowledged risks and revalidation date. A signed human reviewer claim is required; a model cannot provide or alter that claim. Review history remains append only, and superseding a decision must explicitly identify the latest prior review for the same plan.

`consensus:reviewRecommendation` requires an owned research `portfolioId`, `decision`, reason, unique acknowledged risks and a future `reviewBy` date. A superseding decision must include the latest review's `supersedesId`. Favourable reviews are blocked when costs or cash assumptions are unknown, the registered entry calendar is unverified, licensed consensus evidence is absent, or an allocated instrument lacks a unique compatible licensed entry quote and explicit GBP FX where required. Rejections can retain these unresolved checks in the human reason. Review records include the exact selection and confer no execution authority.

A favourable research review cannot change the paper ledger, waive deterministic risk checks or create an order. Any later paper allocation still requires the existing authenticated proposal approval and independent execution-risk workflow. Expired reviews cannot be presented as current permissions, and no record grants brokerage execution authority.

A later forward experiment must be registered separately before its forecast deadline and outcome observations exist, using only evidence actually available at that new cutoff. Its protocol must identify future target definitions, benchmark, calendar, exact endpoints, model identities and costs in advance. The retrospective study cannot be relabelled into that forward experiment.
