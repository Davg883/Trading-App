---
name: aci-graph-intelligence
description: >-
  Enforces AI Capital Intelligence (ACI) standards for SEC filing ingestion,
  evidence provenance, quarantine and supersession governance, TypeDB 3.14.2
  TypeQL 3 schema and target-safe outbox projection, point-in-time temporal
  graph querying, question-aware Evidence-Locked Chat synthesis, and dashboard
  alignment. Activate this skill before inspecting, designing, modifying,
  testing, or auditing any graph, SEC/XBRL ingestion, staging/quarantine,
  /data-room, Evidence Chat, or NVIDIA/issuer intelligence workflow.
---

# ACI Graph Intelligence Development Skill

This skill governs the end-to-end ACI relationship and financial intelligence pipeline:

`Primary Source (SEC EDGAR / Official IR / Regulator) -> Convex Restricted Staging -> Deterministic & Governance Validation -> Human Reviewer Gate -> Convex Outbox -> Target-Safe TypeDB 3.14.2 Projection -> Allowlisted Point-in-Time Graph Query -> Question-Aware Synthesis & Independent Validator -> Investor UI (/ and /data-room)`

## 1. Progressive-Disclosure Reference Map

Read the specific reference manual matching your task before editing code or fixtures:

1. **[Graph Data Contracts](./references/graph-data-contracts.md)** — Pinned TypeDB `3.14.2` / driver versions, exact TypeQL 3 PERA entities, subtypes, relations, roles, and attributes (`data/graph/macro-intelligence-schema.tql`, `lib/graph/typedb-schema.ts`), Zod schemas (`lib/graph/contracts.ts`, `lib/graph/evidence-chat-contracts.ts`), allowlisted queries, `GraphSourceMode` rules, TypeDB database isolation targets, Convex outbox/audit tables, and legacy `docs/` drift reconciliation.
2. **[Evidence Governance](./references/evidence-governance.md)** — Source provenance, 4-clock chronology, canonical identity resolution (`SEC CIK` / `LEI`), SEC multi-filing discovery & XBRL/13F/8-K extraction boundaries, epistemic/contractual/accounting-class separation, prompt-injection defence, non-destructive quarantine & orphan/study invalidation, supersession lineage, reviewer approval, and `IMPLEMENTED` vs `VERIFIED` vs `PLANNED` matrix.
3. **[Acceptance & Regression Tests](./references/acceptance-tests.md)** — Mandatory build/bundle/test commands, the 5-point `LIVE_GRAPH` gate, the 10-probe (`0–30`) Investor Usefulness Scorecard, and the 7 permanent regression scenarios (NVIDIA Case 007-A/007-B, 7 invalid SEC/XBRL rows, 8th forward-frozen orphan propagation, synthetic Macro Case 001 leakage, undisclosed-fact abstention, historical forecast-vs-actual cutoff, and failure-path / unseen-issuer `ANET` tests).

**Relationship to Other Workspace Customizations:**
- **`.agents/rules/remote-research-safety.md`** (always-on workspace rule): Enforces `executionAuthority: "none"`, secret/credential prohibitions, deterministic price/calculation boundaries, and untrusted-content quarantine.
- **`.agents/skills/remote-research-agent/SKILL.md`** (workspace staging skill): Covers operational execution of the 10-step remote staging runner (`POST /api/research/staging`, `python -m worker.remote_research`). Any claim staged by that workflow must still pass the deterministic XBRL period/duration/form selectors and human reviewer gates documented in [evidence-governance.md](./references/evidence-governance.md) before entering `evidence` or TypeDB.

---

## 2. Capability Classification Rule (`IMPLEMENTED` vs `VERIFIED` vs `PLANNED`)

Never describe unbuilt features or draft prose in `docs/*.md` as active system guarantees. Label every capability accurately:

- **`IMPLEMENTED`**: Present in repository TypeScript/Python/TypeQL code and exercised by automated Vitest (`tests/*.test.ts`) or Python (`worker/test_*.py`) tests.
- **`VERIFIED`**: Proven against real primary filings, live TypeDB `3.14.2` read-back (local disposable or isolated TypeDB Cloud dev database), or read-only Convex environment audits with recorded artefact evidence.
- **`PLANNED`**: Approved follow-up design not yet wired into executable code (for example, general multi-accession claim-level quarantine tables beyond `0001045810-26-000078`, or automated LLM extraction of N-ary hyperedges from arbitrary unstructured `8-K` prose).

---

## 3. Mandatory Graph Rules (All 13 Invariants)

1. **Primary-Source Provenance:** Every promoted `MacroRelationship` and `GraphObservation` must cite `>= 1` immutable `GraphSourceDocument` (`https://` without embedded credentials, `64`-hex `contentSha256`, `authority`, `kind`, `publicationBasis`) linked in TypeDB via `evidential_support`.
2. **Multi-Clock Timestamp Preservation:** Preserve distinct timestamps (UTC epoch ms, never invented): reporting window (`periodStartMs`, `periodEndMs`), contractual validity (`effectiveFromMs`, `effectiveToMs`, `maturityAtMs`), publication/acceptance (`publishedAtMs`), trusted receipt (`receivedAtMs >= publishedAtMs`), and ingestion (`ingestedAtMs`).
3. **Claim-Type Separation:** Never confuse `forecast` (management guidance), `reported` (historical GAAP/Non-GAAP actuals), `derived` (deterministic variance/ratios), survey/secondary `reported_unverified`, `modelled_scenario`, or analytical `interpretation`.
4. **Proposed vs Completed Ownership:** Never represent a `proposed` investment, IPO-contingent placement, or pending M&A signing (`contractualStatus: "contingent_signed"`, `bindingObligation: false`) as completed `funded` ownership (`ownership_stake` with `epistemicStatus: "confirmed"` and `contractualStatus: "funded"`).
5. **Contingent Guarantees != Realised Losses or Funded Debt:** Keep credit/lease residual guarantees (`guarantee_arrangement`, maximum gross cap, `$0` paid unless drawn) in a separate accounting class from funded debt (`senior_notes_issuance`) and direct purchase/lease commitments.
6. **Anti-Double-Counting on Commitments:** Never sum overlapping umbrella envelopes and sub-tranches without `economicGroupId` / `parentCommitmentEnvelopeId` deduplication (`commitmentLedger.deduplicatedComputeCommitmentsUsd` vs `naiveComputeCommitmentsSumUsd`) and explicit qualification.
7. **Point-in-Time (`as-of`) Reconstruction:** Every graph query (`executeAllowlistedGraphQuery`), Evidence Bundle (`assembleEvidenceBundle`), and dashboard loader (`/` and `/data-room` via `?asOfMs=`) must enforce `publishedAtMs <= asOfMs` (plus `receivedAtMs <= asOfMs` when `temporalBasis === "receipt"`) and preserve superseded versions (`v1` -> `v2`) non-destructively for historical queries.
8. **Non-Destructive Quarantine Exclusion:** Quarantined `researchStagingItems` and `evidence` rows (including forward-frozen orphan rows outside `promotedEvidenceIds`) must never be deleted, and must be excluded from active research views, `morningBriefings`, `forwardResearchEvents`, `experiments`, `forecasts`, and Evidence Chat bundles.
9. **Idempotent, Reviewable & Target-Safe Projections:** Graph promotions require human `reviewer` approval (`graphRelationshipReviews`), deterministic `proj:<sha256>` idempotency in `graphProjectionOutbox`, prerequisite-complete TypeQL `put` compilation (`compileSelfContainedProjectionStatements`), and mandatory `assertExplicitTypeDbWriteTarget` verification before any TypeDB write.
10. **Strict `LIVE_GRAPH` Truthfulness:** Display `LIVE_GRAPH` **only** when `100%` of nodes, edges, and observations derive from live TypeDB concept hydration (`hydrateMacroDatasetFromLiveTypeDb`) and a live allowlisted TypeQL read succeeds. Mere server reachability or static fallback JSON can never carry `LIVE_GRAPH`; when `requireLiveGraph: true` fails, return `GRAPH_UNAVAILABLE` (or throw `TypeDbSchemaOrHydrationError` on schema/concept corruption).
11. **Question-Aware Synthesis & Honest Abstention:** Evidence Chat (`lib/graph/question-aware-evidence-synthesis.ts`, `lib/graph/evidence-answer-validator.ts`) must route to the focal entity earliest in the prompt, synthesise directly from retrieved `GraphObservation` and `MacroRelationship` records, bound every client-facing validation `detail` string (`<= 480` chars, logging full redacted diagnostics server-side), and return `supportStatus: "unsupported"` (`0` fabricated claims) whenever requested facts are undisclosed or out of scope.
12. **Zero Synthetic Fixture Leakage:** Synthetic demonstration datasets (`data/graph/initial-acceptance-dataset.json`, `lib/graph/macro-case-001.ts` — `Nscale`, `Loughton`, `EirGrid`, `$895.4B`) are restricted to isolated Case 001 tests/demos and must never be bootstrapped into verified TypeDB targets (`syncAndVerifyTypeDbCloud`) or rendered in NVIDIA / real-issuer views on `/` or `/data-room`.
13. **Zero Unauthorised Cloud, Execution, or Scheduler Changes:** Never deploy to Production, push `main`, execute non-dry-run cloud quarantines, write to shared TypeDB Cloud databases, enable schedulers, or touch broker/trading controls (`executionAuthority: "none"`) without explicit separate human approval.

---

## 4. Mandatory 10-Step Agent Workflow for Every Graph Change

Execute these 10 steps in order whenever working on graph, ingestion, quarantine, Evidence Chat, or dashboard intelligence tasks:

1. **Read Skill & References:** Read this `SKILL.md` and the relevant files in `./references/` (`graph-data-contracts.md`, `evidence-governance.md`, `acceptance-tests.md`).
2. **Inspect Implemented Code & Primary Contracts:** Read the live TypeQL schema (`data/graph/macro-intelligence-schema.tql`, `lib/graph/typedb-schema.ts`), Zod schemas (`lib/graph/contracts.ts`, `lib/graph/evidence-chat-contracts.ts`), and Convex table definitions (`convex/schema.ts`). Do not rely on memory or legacy `docs/*.md` prose.
3. **Specify Intended Data-Flow Change:** Map exact inputs and outputs across Staging -> Validation -> Reviewer Gate -> Outbox -> TypeDB Projection -> Gateway Retrieval -> Answer Synthesis/Validator -> UI.
4. **Assess Governance & Financial Blast Radius:** Explicitly evaluate impacts on:
   - Source provenance (`sourceDocIds`, `contentSha256`, claim-level vs accession-level blocks),
   - Chronology (`publishedAtMs`, `receivedAtMs`, `periodEndMs`, `asOfMs` hindsight safety),
   - Tenancy & data isolation (`visibility_scope`, `owner`, `assertNoBrokerOrPrivateAccountData`),
   - Financial semantics (actual vs forecast, proposed vs funded, direct commitment vs guarantee, double-counting).
5. **Implement the Smallest Safe Change:** Keep edits additive and non-destructive; preserve TypeQL `put` idempotency, strict Zod `.strict()` contracts, bounded error strings (`<= 500` chars), and `executionAuthority: "none"`.
6. **Run Targeted & Regression Suites:** Run the permanent regression tests in [acceptance-tests.md](./references/acceptance-tests.md) plus `npm run convex:fingerprint`, `npm run typecheck`, `npm run lint:baseline`, `npm run test:python`, `npm test`, `npm run build`, and `npm run check:server-bundle`.
7. **Verify Real TypeDB `3.14.2` Read-Back (Where Applicable):** For schema, compiler, adapter, or ingestion changes, project into an isolated disposable local TypeDB `3.14.2` database (`127.0.0.1:8000` / `127.0.0.1:1729`) and verify live TypeQL read-back counts and `queryBackendMode: "typedb_live"` before touching any cloud target.
8. **Verify Investor-Facing Output:** Confirm parity between `/` and `/data-room`, verify historical `?asOfMs=` reconstruction, check `GRAPH_UNAVAILABLE` behaviour when disconnected, and score affected Evidence Chat prompts against the 6-dimension (`0–30`) investor rubric.
9. **Report Limitations & `IMPLEMENTED` / `VERIFIED` / `PLANNED` Status:** State clearly what was verified locally vs live cloud, any unverified filings/tables, and any remaining blockers.
10. **Stop & Request Separate Authorisation for Shared Writes / Deploys:** Present backup hashes, dry-run diffs (`dryRun: true`), exact target database/deployment names, and rollback steps, then **stop** until explicit approval is granted.
