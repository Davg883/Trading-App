# ACI Evidence Governance, SEC Ingestion, Chronology & Quarantine Standards

**Skill Version:** `1.1.3`  
**Authoritative Code Sources:**
- Canonical Identity & Supersession Governance: `lib/graph/identity-governance.ts`
- General-Purpose SEC Discovery & Extractor: `lib/remote-ops/sec-filing-graph-extractor.ts` & `lib/remote-ops/sec-xbrl-fact-selector.ts`
- Staging & Prompt-Injection Validator: `lib/remote-ops/staging-validator.ts` & `lib/graph/evidence-retrieval-gateway.ts`
- SEC/XBRL Quarantine & Study Invalidation: `lib/remote-ops/xbrl-quarantine-remediation.ts`, `lib/remote-ops/evidence-integrity.ts`, `convex/operations.ts`, `convex/research.ts`
- Reviewer Gate & Outbox Promotion: `convex/graph.ts`, `convex/remoteOpsCloud.ts`, `lib/graph/projection-engine.ts`

---

## 1. Provenance, Rights & Source Integrity

1. **HTTPS & Credential-Free Canonical URLs (`DEV_VERIFIED` / `PREVIEW_VERIFIED`):**
   - `sourceDocumentSchema` (`lib/graph/contracts.ts`) requires `url.startsWith("https://")` and rejects any URL containing `username` or `password` credentials.
   - `worker.remote_research.canonicalize_source_url` normalises URLs before SHA-256 deduplication (`LOCALLY_VERIFIED` in `worker/test_remote_research.py`).
2. **Immutable Content Digests (`DEV_VERIFIED` / `PREVIEW_VERIFIED`):**
   - Every `GraphSourceDocument` and `researchStagingItems` row records a lowercase `64`-character hex `contentSha256` (`sha256Hex`).
3. **Authority & Kind Stratification (`DEV_VERIFIED` / `PREVIEW_VERIFIED`):**
   - `authority: "primary"` + `kind` in `{"filing", "company", "regulator"}` is required for `epistemicStatus: "confirmed"` and for `contractualStatus` in `{"signed", "funded", "contingent_signed"}` (`validateRelationshipGovernance`).
   - Secondary press (`kind: "news"`, `authority: "secondary"`) may record `reported` / `reported_discussion` or `conflicting_pending_review` assertions, **never** `confirmed`, `signed`, or `funded`.
4. **Market Data & Licensing Rights (`DEV_VERIFIED`):**
   - `marketObservations` (`convex/schema.ts`) tracks `usage` (`'public_reference' | 'licensed'`), `licensed`, `permittedUse`, `declaredDelayMs`, and `isTrading212PositionPrice: false`.
   - Delayed public reference closes must never be labelled as live real-time quotes, and AI agents must never submit equity price, index, or FX claims (`staging-validator.ts`).
   - Public visitor-page CDN tag-based rights-revocation purge hooks remain **`PLANNED`** (ACI research views are Clerk-authenticated dynamic routes).

---

## 2. Multi-Clock Chronology & Point-in-Time Reconstruction

Never collapse timestamps into a single date field or invent missing timestamps:

| Timestamp Field | Meaning | Governing Rule & Verification Level |
| :--- | :--- | :--- |
| `periodStartMs` / `periodEndMs` | Financial statement reporting window (e.g. `Q3 FY2027` ended `2026-10-25`) | `periodEndMs >= periodStartMs` (`financialObservationSchema`, `DEV_VERIFIED`). |
| `effectiveFromMs` / `effectiveToMs` / `maturityAtMs` | Contractual start, end/cancellation, and debt/facility maturity | Preserved separately from filing publication date (`macroRelationshipSchema`, `DEV_VERIFIED`). |
| `publishedAtMs` | Authoritative source publication / SEC EDGAR `acceptanceDateTime` | Basis recorded in `publicationBasis` (`sec_edgar_acceptance`, `exact_utc`, `updated_utc`, `date_upper_bound`, `retrieval_upper_bound`, `DEV_VERIFIED`). |
| `receivedAtMs` (`serverReceivedAt`) | Trusted ACI receipt timestamp | **Hard invariant:** `receivedAtMs >= publishedAtMs` (`DEV_VERIFIED`). Agent-asserted metadata cannot backdate server receipt. |
| `ingestedAtMs` | Pipeline normalisation/projection timestamp | Audit timestamp only; never used to backdate historical availability (`DEV_VERIFIED`). |

**Point-in-Time (`asOfMs`) Eligibility (`isRelationshipEligibleAtCutoff` & `reconstructGraphRelationshipsAtDate`):**
- Under `temporalBasis = "receipt"` (default in `graphQueryRequestSchema`): requires `publishedAtMs <= asOfMs && receivedAtMs <= asOfMs`.
- Under `temporalBasis = "publication"`: requires `publishedAtMs <= asOfMs`.
- Both relationships and `GraphObservation` records published/received after `asOfMs` are withheld (`DEV_VERIFIED` & `PREVIEW_VERIFIED` on `/data-room?focal=org-nvda&asOf=1794949170000`, `/?asOf=1794949170000` RSC payload, and live Preview `Q1b` `/api/graph/chat` at `3222376`).

---

## 3. Canonical Entity Identity Governance (`DEV_VERIFIED` / `LOCALLY_VERIFIED`)

`resolveCanonicalOrganisation` (`lib/graph/identity-governance.ts`) resolves organisations strictly in this order:
1. **10-digit zero-padded SEC CIK** (`secCik`, e.g. `0001045810` for NVIDIA `DEV_VERIFIED`, `0001596532` for Arista Networks `LOCALLY_VERIFIED`).
2. **20-character ISO 17442 LEI** (`leiCode`).
3. **Explicit verified `orgId`** (`explicitOrgId`).

**Fuzzy-Merge Prohibition:** If a candidate lacks a matching CIK, LEI, or explicit `orgId` and shares a normalised name stem or alias with an existing organisation (e.g. subsidiary vs parent SPV), `resolveCanonicalOrganisation` returns `status: "blocked_fuzzy_name_only"` and blocks automatic entity merging. Unnamed SEC concentration disclosures (e.g. NVIDIA `EX-99.3` `14%`, `11%`, `11%` direct customers) must remain anonymised observations rather than guessed legal entities.

---

## 4. SEC Filing Discovery & Deterministic Extraction Boundaries

Implemented in `lib/remote-ops/sec-filing-graph-extractor.ts` and `lib/remote-ops/sec-xbrl-fact-selector.ts`:

| Filing / Step | Verification Status | Exact Deterministic Behaviour & Refusal Rules |
| :--- | :---: | :--- |
| **Multi-filing EDGAR window (`discoverSecFilingWindow`)** | `DEV_VERIFIED` (code deployed at `3222376`); `LOCALLY_VERIFIED` (unseen `ANET` E2E) | Scans up to `maxFilingsPerCik` (`1..100`, default `25`) across `filings.recent` **plus** bounded `filings.files` overflow JSON pages (`CIK*-submissions-*.json`, `maxOverflowPages` `0..3`), skipping non-allowlisted noise (`Form 4` at `recent[0]`) and deduplicating seen accessions/URLs. |
| **Periodic `10-Q` / `10-K` XBRL (`extractPeriodicXbrlGraphCandidates`)** | Selector `DEV_VERIFIED`; unseen-issuer extractor `LOCALLY_VERIFIED` | Extracts current-period `GraphObservation`s (revenue, operating income, net income, operating cash flow, capex, cash) via `selectCurrentSecXbrlFact`. **Refuses:** (a) facts from non-periodic forms (`8-K`), (b) comparative prior-year facts (`|end - reportDate| > 15`d or `filed - end > 190`d), and (c) YTD cumulative facts (`160–295`d `cumulative_ytd`) mislabelled as single-quarter (`70–110`d `three_month` for quarterly flow metrics, `340–380`d `full_year` for annual `10-K`). |
| **Form `13F-HR` XML (`extractForm13fXmlGraphCandidates`)** | Case 007 `DEV_VERIFIED`; general XML parser `LOCALLY_VERIFIED` | Parses `infoTable` XML positions, verifies monetary scale (`1x` post-2023 SEC XML standard vs legacy `x1000` anomalies), emits portfolio fair-value `GraphObservation` + `pending_review` `ownership_stake` candidates (`SH` / `PRN` share counts, voting authority). |
| **Form `8-K` / `8-K/A` headers (`registerForm8kReviewCandidate`)** | `DEV_VERIFIED` (deployed at `3222376`); `LOCALLY_VERIFIED` (`ANET` E2E) | Classifies SEC items (`1.01`, `2.02`, `2.03`, `5.02`, `8.01`, etc.) and registers `pending_human_factual_review` source candidates **without** extracting XBRL `companyfacts` capex or hallucinating counterparties/amounts from unstructured prose. |
| **Curated multi-exhibit earnings/contract extraction (Case 007-A / 007-B)** | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`30` stored rels [`28` active / `27` 2-hop focal / `<= 25` bundle], `24` obs, `16` stored sources [`<= 15` bundle]) | Primary-source manifests (`data/graph/case-007-*.json`, `case-007-nvidia-ingestor.ts`) backed by exact SEC exhibit SHA-256 digests (`EX-99.1`, `EX-99.2`, `EX-99.3`, `13F-HR`, `SC 13G`, `8-K`). |
| **Unassisted LLM hyperedge extraction from arbitrary unstructured `8-K` / `S-1` prose** | **`PLANNED`** | Not permitted to auto-promote. Any prose-derived N-ary relationship requires explicit structured extraction + human `reviewer` approval before entering `graphProjectionOutbox`. |

---

## 5. Financial & Epistemic Classification Rules

1. **Reported Actual vs Forecast vs Derived vs Scenario vs Interpretation (`DEV_VERIFIED` / `PREVIEW_VERIFIED` at `3222376`):**
   - `GraphObservation.observationKind`: `'reported'` (filed historical actual), `'forecast'` (management outlook, e.g. Q4 FY27 `$130.0B +/- 3%`), `'derived'` (deterministic calculation, e.g. Free Cash Flow or beat variance `+$7.844B / +7.26%`).
   - `SupportingClaimItem.distinction`: `'source_fact'`, `'deterministic_arithmetic'`, `'modelled_scenario'`, `'reported_unverified'`, `'interpretation'`.
   - In `evidence-answer-validator.ts`, deterministic variance between an `'observed'` actual and `'proposed'` forecast in the same bundle is verified arithmetically (`collectAllowedNumbers`, `PREVIEW_VERIFIED` on live `Q1`).
2. **Proposed / Contingent Deals vs Completed Ownership (`DEV_VERIFIED` / `PREVIEW_VERIFIED`):**
   - Pending acquisitions (e.g. Hugging Face Item `8.01` `principalAmount: null`) or IPO-contingent placements (e.g. Anthropic Class N) must carry `epistemicStatus: "proposed"` and `contractualStatus: "contingent_signed"` (`bindingObligation: false`).
   - `validateRelationshipGovernance` rejects `epistemicStatus === "proposed"` paired with `contractualStatus === "funded"`.
3. **Three-Class Commitment & Guarantee Separation (`DEV_VERIFIED` / `PREVIEW_VERIFIED` at `3222376`):**
   - **Class 1 — Funded Debt & Direct Contractual Commitments:** Recognised debt (`senior_notes_issuance`, e.g. `$25.0B` notes) and scheduled supply/uncommenced lease purchase obligations (`$518.0B` total / `$390.0B` supply).
   - **Class 2 — Contingent Off-Balance-Sheet Commitments:** Conditioned on counterparty financing and capacity acceptance (`bindingObligation: false`, e.g. `$32.0B` neocloud cap).
   - **Class 3 — Maximum Gross Credit / Lease Residual Guarantees:** Off-balance-sheet guarantee exposure (`guarantee_arrangement` / `leasing_agreement` `lease_guarantor`, e.g. `$118.0B` gross cap incl. `$105.0B` SB Energy / OpenAI Ohio lease guarantee, `$0` paid). Recorded in `commitmentLedger.signedGuaranteesUsd`, never added to recognised debt or treated as realised loss.
4. **Umbrella Envelope vs Tranche Deduplication (`DEV_VERIFIED`):**
   - Overlapping multi-year compute/investment envelopes share `economicGroupId` / `parentCommitmentEnvelopeId`. `evidence-retrieval-gateway.ts` computes `naiveComputeCommitmentsSumUsd`, `deduplicatedComputeCommitmentsUsd`, and `doubleCountPreventedUsd`; `evidence-answer-validator.ts` (`deterministic_arithmetic_verified`) blocks presenting naive un-deduplicated sums as true totals.

---

## 6. Untrusted Content, Quarantine & Study Invalidation

1. **Prompt-Injection Quarantine (`DEV_VERIFIED` / `PREVIEW_VERIFIED`):**
   - `validateStagedItem` (`lib/remote-ops/staging-validator.ts`) and `detectAdversarialContent` (`lib/graph/evidence-retrieval-gateway.ts`) inspect untrusted text for instruction overrides (`ignore previous instructions`, `system prompt`, role mutations, trading commands) and block/quarantine immediately.
2. **Non-Destructive SEC/XBRL Quarantine (`DEV_VERIFIED` on `dev:prestigious-dragon-8` at `3222376`; Production Execution Pending Separate Authorisation):**
   - Originals are **never deleted** (`rowsDeletedCount === 0`).
   - `operations:quarantineStagedEvidenceInternal` supports `dryRun: true` and `dryRun: false`: executed and independently read-back verified on `dev:prestigious-dragon-8` (`7` staging items + `8` `evidence` rows quarantined, `7` `evidenceQuarantines` ledger rows, `0` rows deleted); **not yet executed on `prod:benevolent-magpie-921`** (`NO-GO` pending separate Production authorisation).
   - Patches `quarantinedAt` and `quarantineId` onto **both** `researchStagingItems` (`7` items in Dev; `11` items in RC002.1 Prod scope) and **all** matching `evidence` rows (`8` rows in Dev; `10` rows in RC002.1 Prod scope) — including **orphaned forward-frozen `evidence` rows** created by `storeForwardResearchEventInternal` outside `promotedEvidenceIds` (`md7ah8t1nmryeqt0c06wjq9c6x8hpgsb` quarantined in Dev; `ms71z2vm0nhq2850kvr3pym65s8hr3wb` still active in Prod).
   - Records affected `morningBriefings`, `forwardResearchEvents`, `experiments`, and `forecasts` on the `evidenceQuarantines` ledger and withholds/flags invalidated facts and studies in `operations:overview`, `operations:getMorningBriefing`, `research:dashboard`, and `research:getStudyRecord` (`SAFE_WITHHELD_PENDING_QUARANTINE` enforced on read prior to ledger execution, `LOCALLY_VERIFIED` in `tests/rc0021-hardening-and-11item-quarantine.test.ts`).
3. **Claim-Level vs Accession-Level Quarantine:**
   - **NVIDIA `0001045810-26-000078` Policy (`DEV_VERIFIED` at `3222376`):** `evaluateNvidia000078ClaimPolicy` blocks XBRL `capital_expenditures` claims (`$0.24B` / `$1.07B`) on Form 8-K `0001045810-26-000078` while permitting SHA-256-verified (`17fe107f9113be5c57673d0a591ea49e87a667ea357de3959eeb91142c49280c`) Item `8.01` pending M&A relationship evidence strictly as `proposed` / `contingent_signed` (`principalAmount: null`, `bindingObligation: false`).
   - **NVIDIA `0001045810-26-000082` & CoreWeave `0001769628-26-000465` Claim-Level Policies (`LOCALLY_VERIFIED` in RC002.1):** `evaluateNvidia000082ClaimPolicy` blocks XBRL `capital_expenditures` (`$0.24B` Q2 2020) on Form 8-K `0001045810-26-000082` while permitting SHA-256-verified Item `5.02` CEO transition disclosures (`doc-nvda-8k-20261112`), and `rc0021-invalid-crwv-000465-10q-comparative-2025-capex` matches only the `$6.25B` prior-year comparative claim while preserving valid `$23.56B Q3 2026 (YTD)` disclosures on the same accession.
   - **General Multi-Accession Claim-Level Table (`PLANNED`):** A generic Convex table parameterising per-claim quarantine predicates across arbitrary future accessions without code-defined rules is not yet implemented.

---

## 7. Non-Destructive Supersession, Reviewer Gate & Outbox Projection

1. **Supersession Lineage (`DEV_VERIFIED`):**
   - Amended or cancelled relationships increment `version = prior.version + 1`, set `supersedesRelationshipId = prior.relationshipId` under the same `logicalEventId`, require `publishedAtMs >= prior.publishedAtMs`, keep `prior` intact in Convex and TypeDB, and emit a `supersession_link` relation.
2. **Human Reviewer Gate (`convex/graph.ts` `reviewAndPromoteRelationship` — `DEV_VERIFIED` at `3222376`; Unseen-Issuer E2E `LOCALLY_VERIFIED`):**
   - Requires `reviewer` role (`convex/authz.ts`), resolves primary sources from approved staged items or canonical registries (rejecting quarantined sources via `isQuarantined`), runs `validateRelationshipGovernance`, logs to `graphRelationshipReviews`, and enqueues `graphProjectionOutbox` only when `decision === "approved"`.
3. **Target-Safe Idempotent Projection (`DEV_VERIFIED` on `aci_case007b_verified_dev` at `3222376`; Unseen-Issuer E2E `LOCALLY_VERIFIED`):**
   - `computeDeterministicProjectionKey` (`proj:<sha256>`) prevents duplicate outbox rows (`by_projection_key`).
   - `compileSelfContainedProjectionStatements` compiles idempotent TypeQL `put` statements for all prerequisite sectors, organisations, executives, projects, instruments, sources, observations, and relationships **without** bootstrapping synthetic Macro Case 001 data (`syncAndVerifyTypeDbCloud`).
   - Every live TypeDB write calls `assertExplicitTypeDbWriteTarget(config, expectedDatabase)` before opening a `WRITE` or `SCHEMA` transaction.
