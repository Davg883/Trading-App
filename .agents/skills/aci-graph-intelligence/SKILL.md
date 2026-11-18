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
metadata:
  version: "1.1.4"
  schemaVersion: "macro-intelligence-graph-3.14-v1"
  codeBaselineSha: "693f1aa"
  convexFingerprintSha256: "ac933f5056ea99acc2052203e906834c434248b35dfdbdf3c460753b452ea3f3"
  lastReviewedUtc: "2026-11-18"
  pathPatterns:
    - "data/graph/**"
    - "lib/graph/**"
    - "lib/remote-ops/**"
    - "convex/graph.ts"
    - "convex/remoteOpsCloud.ts"
    - "convex/operations.ts"
    - "convex/research.ts"
    - "app/data-room/**"
    - "app/api/graph/**"
    - "worker/graph_projection.py"
    - "worker/remote_research.py"
---

# ACI Graph Intelligence Development Skill (`v1.1.4`)

This skill governs the end-to-end ACI relationship and financial intelligence pipeline:

`Primary Source (SEC EDGAR / Official IR / Regulator) -> Convex Restricted Staging -> Deterministic & Governance Validation -> Human Reviewer Gate -> Convex Outbox -> Target-Safe TypeDB 3.14.2 Projection -> Allowlisted Point-in-Time Graph Query -> Question-Aware Synthesis & Independent Validator -> Investor UI (/ and /data-room)`

## 1. Progressive-Disclosure Reference Map

Read the specific reference manual matching your task before editing code or fixtures:

1. **[Graph Data Contracts](./references/graph-data-contracts.md)** — Pinned TypeDB `3.14.2` / driver versions, exact TypeQL 3 PERA entities, subtypes, relations, roles, and attributes (`data/graph/macro-intelligence-schema.tql`, `lib/graph/typedb-schema.ts`), Zod schemas (`lib/graph/contracts.ts`, `lib/graph/evidence-chat-contracts.ts`), allowlisted queries, `GraphSourceMode` rules, TypeDB database isolation targets, Convex outbox/audit tables, and legacy `docs/` drift reconciliation.
2. **[Evidence Governance](./references/evidence-governance.md)** — Source provenance, 4-clock chronology, canonical identity resolution (`SEC CIK` / `LEI`), SEC multi-filing discovery & XBRL/13F/8-K extraction boundaries, epistemic/contractual/accounting-class separation, prompt-injection defence, non-destructive quarantine & orphan/study invalidation, supersession lineage, reviewer approval, and environment-specific verification matrix.
3. **[Acceptance & Regression Tests](./references/acceptance-tests.md)** — Mandatory build/bundle/test commands, the 5-point `LIVE_GRAPH` gate, the 10-probe (`0–30`) Investor Usefulness Scorecard, open release blockers, and the 7 permanent regression scenarios.

**Portable Workspace Dependencies (Tracked in Git via `.gitignore` Allowlist):**
- **[.agents/rules/remote-research-safety.md](../../rules/remote-research-safety.md)** (always-on rule): Enforces `executionAuthority: "none"`, secret/credential prohibitions, deterministic price/calculation boundaries, and untrusted-content quarantine.
- **[.agents/skills/remote-research-agent/SKILL.md](../remote-research-agent/SKILL.md)**: Covers operational execution of the 10-step remote staging runner (`POST /api/research/staging`, `python -m worker.remote_research`). Any claim staged by that workflow must still pass the deterministic XBRL period/duration/form selectors and human reviewer gates documented in [evidence-governance.md](./references/evidence-governance.md) before entering `evidence` or TypeDB.

---

## 2. Environment-Specific Verification Levels & Open Release Blockers

Never use an unqualified `VERIFIED` label, and never classify local or disposable-database results as deployed cloud verification:

- **`IMPLEMENTED`**: Present in repository code with unit/schema contract coverage, not yet end-to-end runtime-verified.
- **`LOCALLY_VERIFIED`**: Proven in local Vitest/Python suites, disposable local TypeDB `3.14.2` (`127.0.0.1:8000` / `127.0.0.1:1729`), or local Convex backup dry runs — **not yet deployed to shared Development or Preview** (e.g. unseen `ANET` disposable local TypeDB E2E test and Python gRPC driver suite).
- **`DEV_VERIFIED`**: Proven against shared Convex Development (`dev:prestigious-dragon-8` at `3222376`, incl. non-destructive SEC/XBRL quarantine of `7` staging items + `8` `evidence` rows) and isolated Development TypeDB Cloud (`aci_case007_verified_dev`: `20` rels, `4` obs; `aci_case007b_verified_dev`: `30` stored `macro_relationship` rows [`28` active non-superseded / `27` 2-hop `org-nvda` focal-reachable / `<= 25` in `EvidenceBundleV1`], `24` observations, `16` stored sources [`<= 15` in `EvidenceBundleV1`], `77` `evidential_support` links).
- **`PREVIEW_VERIFIED`**: Proven end-to-end on deployed Vercel Preview (`3222376` at `https://trading-iqrskwacf-david-grannums-projects.vercel.app`: `COMPATIBLE` release health, live 10-probe `/api/graph/chat` `297/300` [`10/10` `validationValid: true`], `/` & `/data-room` SSR/RSC `LIVE_GRAPH` + `?asOf=` temporal parity, and controlled `TYPEDB_BRIDGE_SECRET` disconnect -> `GRAPH_UNAVAILABLE` + recovery; interactive signed-in Vercel SSO/Clerk browser click-through pending owner session).
- **`PRODUCTION_VERIFIED`**: Proven on `prod:benevolent-magpie-921` / `https://capital.aiguides.co.uk` (`main` at `639a2ed`: Clerk Production auth and `executionAuthority: "none"` boundary only; neither Case 007-A/B nor RC002 is `PRODUCTION_VERIFIED`).
- **`PLANNED`**: Approved follow-up design not yet wired into executable code (e.g. generic multi-accession claim-level quarantine tables beyond `0001045810-26-000078`, unassisted LLM prose-to-hyperedge promotion, public CDN rights-revocation purge).

**Active Open Release Blockers (`PRODUCTION = NO-GO`):**
1. **Interactive Signed-In Browser UI Walkthrough Pending Owner SSO Session:** Deployed Preview SSR/API & live TypeDB `3.14.2` checks at `3222376` passed, while interactive browser click-through paused cleanly at Vercel Deployment Protection (`AUTH_GATE_REQUIRES_OWNER_SESSION`) awaiting an active owner Vercel SSO + Clerk session.
2. **Production SEC/XBRL Contamination (`prod:benevolent-magpie-921`):** Phase A scheduler containment (`RESEARCH_SCHEDULER_ENV=disabled`) is `PRODUCTION_VERIFIED` for stopping unattended cron writes, **but** `7` baseline invalid staging rows (+ `4` legacy `639a2ed` Prod-only `8-K`/`10-Q` rows), `8`+`2` contaminated `evidence` rows (incl. forward-frozen orphan `ms71z2vm0nhq2850kvr3pym65s8hr3wb`), `9` contaminated `morningBriefings`, and `4` forward-study rows remain unquarantined in Production, and `639a2ed` still falsely reports `scheduler.status: "working"` from persisted DB settings.

---

## 3. Mandatory Graph Rules (All 14 Invariants)

1. **Primary-Source Provenance:** Every promoted `MacroRelationship` and `GraphObservation` must cite `>= 1` immutable `GraphSourceDocument` (`https://` without embedded credentials, `64`-hex `contentSha256`, `authority`, `kind`, `publicationBasis`) linked in TypeDB via `evidential_support`.
2. **Multi-Clock Timestamp Preservation:** Preserve distinct timestamps (UTC epoch ms, never invented): reporting window (`periodStartMs`, `periodEndMs`), contractual validity (`effectiveFromMs`, `effectiveToMs`, `maturityAtMs`), publication/acceptance (`publishedAtMs`), trusted receipt (`receivedAtMs >= publishedAtMs`), and ingestion (`ingestedAtMs`).
3. **Claim-Type Separation:** Never confuse `forecast` (management guidance), `reported` (historical GAAP/Non-GAAP actuals), `derived` (deterministic variance/ratios), survey/secondary `reported_unverified`, `modelled_scenario`, or analytical `interpretation`.
4. **Proposed vs Completed Ownership:** Never represent a `proposed` investment, IPO-contingent placement, or pending M&A signing (`contractualStatus: "contingent_signed"`, `bindingObligation: false`) as completed `funded` ownership (`ownership_stake` with `epistemicStatus: "confirmed"` and `contractualStatus: "funded"`).
5. **Contingent Guarantees != Realised Losses or Funded Debt:** Keep credit/lease residual guarantees (`guarantee_arrangement`, maximum gross cap, `$0` paid unless drawn) in a separate accounting class from funded debt (`senior_notes_issuance`) and direct purchase/lease commitments.
6. **Anti-Double-Counting on Commitments:** Never sum overlapping umbrella envelopes and sub-tranches without `economicGroupId` / `parentCommitmentEnvelopeId` deduplication (`commitmentLedger.deduplicatedComputeCommitmentsUsd` vs `naiveComputeCommitmentsSumUsd`) and explicit qualification.
7. **Point-in-Time (`as-of`) Reconstruction:** Every graph query (`executeAllowlistedGraphQuery`), Evidence Bundle (`assembleEvidenceBundle`), and dashboard loader (`/` and `/data-room` via `?asOf=`) must enforce `publishedAtMs <= asOfMs` (plus `receivedAtMs <= asOfMs` when `temporalBasis === "receipt"`) and preserve superseded versions (`v1` -> `v2`) non-destructively for historical queries.
8. **Non-Destructive Quarantine Exclusion:** Quarantined `researchStagingItems` and `evidence` rows (including forward-frozen orphan rows outside `promotedEvidenceIds`) must never be deleted, and must be excluded from active research views, `morningBriefings`, `forwardResearchEvents`, `experiments`, `forecasts`, and Evidence Chat bundles.
9. **Idempotent, Reviewable & Target-Safe Projections:** Graph promotions require human `reviewer` approval (`graphRelationshipReviews`), deterministic `proj:<sha256>` idempotency in `graphProjectionOutbox`, prerequisite-complete TypeQL `put` compilation (`compileSelfContainedProjectionStatements`), and mandatory `assertExplicitTypeDbWriteTarget` verification before any TypeDB write.
10. **Strict `LIVE_GRAPH` Truthfulness:** Display `LIVE_GRAPH` **only** when `100%` of nodes, edges, and observations derive from live TypeDB concept hydration (`hydrateMacroDatasetFromLiveTypeDb`) and a live allowlisted TypeQL read succeeds. Mere server reachability or static fallback JSON can never carry `LIVE_GRAPH`; when `requireLiveGraph: true` fails, return `GRAPH_UNAVAILABLE` (or throw `TypeDbSchemaOrHydrationError` on schema/concept corruption).
11. **Question-Aware Synthesis & Honest Abstention:** Evidence Chat (`lib/graph/question-aware-evidence-synthesis.ts`, `lib/graph/evidence-answer-validator.ts`) must route to the focal entity earliest in the prompt, synthesise directly from retrieved `GraphObservation` and `MacroRelationship` records, bound every client-facing validation `detail` string (`<= 480` chars, logging full redacted diagnostics server-side), and return `supportStatus: "unsupported"` (`0` fabricated claims) whenever requested facts are undisclosed or out of scope.
12. **Zero Synthetic Fixture Leakage:** Synthetic demonstration datasets (`data/graph/initial-acceptance-dataset.json`, `lib/graph/macro-case-001.ts` — `Nscale`, `Loughton`, `EirGrid`, `$895.4B`) are restricted to isolated Case 001 tests/demos and must never be bootstrapped into verified TypeDB targets (`syncAndVerifyTypeDbCloud`) or rendered in NVIDIA / real-issuer views on `/` or `/data-room`.
13. **Zero Unauthorised Cloud, Execution, or Scheduler Changes:** Never deploy to Production, push `main`, execute non-dry-run cloud quarantines, write to shared TypeDB Cloud databases, enable schedulers, or touch broker/trading controls (`executionAuthority: "none"`) without explicit separate human approval.
14. **Five-State Operational-Status Separation:** Health and operations views (`lib/remote-ops/health-monitor.ts`, `convex/operations.ts`) must strictly distinguish **(a) configured** (credentials/endpoints present, e.g. `configured_not_tested`), **(b) enabled** (persisted DB toggles `systemEnabled`, `job.enabled`, `activeEnvironment`), **(c) effectively running** (`scheduled === true` & `status === "working"` only when `cronGateOpen` — including runtime `RESEARCH_SCHEDULER_ENV !== "disabled"` — AND a recent tick within `SCHEDULER_OVERDUE_AFTER_MS` is observed), **(d) paused** (`!cronGateOpen` or `pausedReason !== null`, reporting exact pause source such as `RESEARCH_SCHEDULER_ENV=disabled`), and **(e) last-successful** (`lastSuccessAt` / `freshness`, never using historical `lastRunAt !== null` to mask a disabled or overdue scheduler).

---

## 4. Mandatory 10-Step Agent Workflow for Every Graph Change

Execute these 10 steps in order whenever working on graph, ingestion, quarantine, Evidence Chat, or dashboard intelligence tasks:

1. **Read Skill & References:** Read this `SKILL.md` and the relevant files in `./references/` (`graph-data-contracts.md`, `evidence-governance.md`, `acceptance-tests.md`).
2. **Inspect Implemented Code & Primary Contracts:** Read the live TypeQL schema (`data/graph/macro-intelligence-schema.tql`, `lib/graph/typedb-schema.ts`), Zod schemas (`lib/graph/contracts.ts`, `lib/graph/evidence-chat-contracts.ts`), and Convex table definitions (`convex/schema.ts`). Do not rely on memory or legacy `docs/*.md` prose.
3. **Specify Intended Data-Flow Change:** Map exact inputs and outputs across Staging -> Validation -> Reviewer Gate -> Outbox -> TypeDB Projection -> Gateway Retrieval -> Answer Synthesis/Validator -> UI.
4. **Assess Governance & Financial Blast Radius:** Explicitly evaluate impacts on provenance (`sourceDocIds`, `contentSha256`, claim-level vs accession-level blocks), chronology (`publishedAtMs`, `receivedAtMs`, `periodEndMs`, `asOfMs` hindsight safety), tenancy (`visibility_scope`, `owner`, `assertNoBrokerOrPrivateAccountData`), and financial semantics (actual vs forecast, proposed vs funded, direct commitment vs guarantee, double-counting).
5. **Implement the Smallest Safe Change:** Keep edits additive and non-destructive; preserve TypeQL `put` idempotency, strict Zod `.strict()` contracts, bounded error strings (`<= 500` chars), and `executionAuthority: "none"`.
6. **Run Targeted & Regression Suites:** Run the permanent regression tests in [acceptance-tests.md](./references/acceptance-tests.md) plus `npm run convex:fingerprint`, `npm run typecheck`, `npm run lint:baseline`, `npm run test:python`, `npm test`, `npm run build`, and `npm run check:server-bundle`.
7. **Verify Real TypeDB `3.14.2` Read-Back (Where Applicable):** For schema, compiler, adapter, or ingestion changes, project into an isolated disposable local TypeDB `3.14.2` database (`127.0.0.1:8000` / `127.0.0.1:1729`) and verify live TypeQL read-back counts (`LOCALLY_VERIFIED`) before proposing any cloud target write.
8. **Verify Investor-Facing Output:** Confirm parity between `/` and `/data-room`, verify historical `?asOf=` reconstruction, check `GRAPH_UNAVAILABLE` behaviour when disconnected, and score affected Evidence Chat prompts against the 6-dimension (`0–30`) investor rubric.
9. **Report Limitations & Exact Verification Level:** Label each result strictly as `IMPLEMENTED`, `LOCALLY_VERIFIED`, `DEV_VERIFIED`, `PREVIEW_VERIFIED`, `PRODUCTION_VERIFIED`, or `PLANNED`, noting any unverified filings or open blockers.
10. **Stop & Request Separate Authorisation for Shared Writes / Deploys:** Present backup hashes, dry-run diffs (`dryRun: true`), exact target database/deployment names, and rollback steps, then **stop** until explicit approval is granted.

---

## 5. Drift-Prevention Triggers & Skill Maintenance Checklist

Whenever a pull request or commit modifies **any** trigger below, update this skill (`metadata.version`, `metadata.codeBaselineSha`, `metadata.convexFingerprintSha256`, `metadata.lastReviewedUtc`, and affected `references/*.md` tables) in the **same branch** before merge:

| Contract Domain | Monitored Files / Constants | Required Documentation Review |
| :--- | :--- | :--- |
| **TypeQL 3 & Driver Contracts** | `data/graph/macro-intelligence-schema.tql`, `lib/graph/typedb-schema.ts`, `lib/graph/contracts.ts`, `lib/graph/typedb-driver-adapter.ts`, `worker/graph_projection.py` | Update entity/relation/attribute tables, pinned versions, allowlisted query types, or database target constants in [graph-data-contracts.md](./references/graph-data-contracts.md). |
| **SEC Discovery, XBRL/13F Parsing & Identity** | `lib/remote-ops/sec-filing-graph-extractor.ts`, `lib/remote-ops/sec-xbrl-fact-selector.ts`, `lib/graph/identity-governance.ts`, `worker/remote_research.py` | Update form support, XBRL duration/period-end gates, CIK/LEI priority, or supersession rules in [evidence-governance.md](./references/evidence-governance.md). |
| **Quarantine, Staging, Reviewer & Operational Health** | `lib/remote-ops/xbrl-quarantine-remediation.ts`, `lib/remote-ops/staging-validator.ts`, `lib/remote-ops/health-monitor.ts`, `lib/remote-ops/pipeline-stages.ts`, `convex/operations.ts`, `convex/research.ts`, `convex/graph.ts`, `convex/schema.ts` | Update quarantine rule inventory, orphan/study invalidation tables, 5-state operational-status invariants (`configured` vs `enabled` vs `effectively running` vs `paused` vs `last-successful`), Convex schema summary, or claim-level quarantine status in [evidence-governance.md](./references/evidence-governance.md), [graph-data-contracts.md](./references/graph-data-contracts.md), and [acceptance-tests.md](./references/acceptance-tests.md). |
| **Evidence-Locked Chat & Dashboard Alignment** | `lib/graph/evidence-chat-contracts.ts`, `lib/graph/evidence-retrieval-gateway.ts`, `lib/graph/question-aware-evidence-synthesis.ts`, `lib/graph/evidence-answer-validator.ts`, `lib/graph/nvidia-dashboard-alignment.ts`, `app/page.tsx`, `app/data-room/page.tsx` | Update retrieval/budget ceilings, validator checks, diagnostic bounds, `/` vs `/data-room` parity rules, and the 10-probe benchmark in [graph-data-contracts.md](./references/graph-data-contracts.md) and [acceptance-tests.md](./references/acceptance-tests.md). |
| **Environment Promotion Milestones** | Verified Convex Dev / TypeDB Cloud Dev / Vercel Preview / Production promotions | Promote affected capability labels (`LOCALLY_VERIFIED` -> `DEV_VERIFIED` -> `PREVIEW_VERIFIED` -> `PRODUCTION_VERIFIED`) only after independent read-back evidence is recorded; update Open Release Blockers. |

**Maintenance Sign-Off Checklist (Run Before Committing Skill Updates):**
- [ ] `hasCurrentAgentRules(process.cwd()) === true` in `AGENTS.md` (Next.js managed markers intact).
- [ ] Every markdown link across `AGENTS.md` and `.agents/skills/aci-graph-intelligence/**` resolves to a Git-tracked file (`git ls-files`) with zero machine-local paths.
- [ ] Zero bare `VERIFIED` labels remain; every capability uses one of the 6 environment-specific levels, and unbuilt designs remain `PLANNED`.
- [ ] `.gitignore` narrow allowlist keeps `.agents/*` ignored except audited `rules/` and `skills/` entries (`git status --ignored` clean of session/secret leakage).
