# ACI Evidence Governance, SEC Ingestion, Chronology & Quarantine Standards

**Authoritative Code Sources:**
- Canonical Identity & Supersession Governance: `lib/graph/identity-governance.ts`
- General-Purpose SEC Discovery & Extractor: `lib/remote-ops/sec-filing-graph-extractor.ts` & `lib/remote-ops/sec-xbrl-fact-selector.ts`
- Staging & Prompt-Injection Validator: `lib/remote-ops/staging-validator.ts` & `lib/graph/evidence-retrieval-gateway.ts`
- SEC/XBRL Quarantine & Study Invalidation: `lib/remote-ops/xbrl-quarantine-remediation.ts`, `lib/remote-ops/evidence-integrity.ts`, `convex/operations.ts`, `convex/research.ts`
- Reviewer Gate & Outbox Promotion: `convex/graph.ts`, `convex/remoteOpsCloud.ts`, `lib/graph/projection-engine.ts`

---

## 1. Provenance, Rights & Source Integrity (`IMPLEMENTED` & `VERIFIED`)

1. **HTTPS & Credential-Free Canonical URLs:**
   - `sourceDocumentSchema` (`lib/graph/contracts.ts`) requires `url.startsWith("https://")` and rejects any URL containing `username` or `password` credentials.
   - `worker.remote_research.canonicalize_source_url` normalises URLs before SHA-256 deduplication.
2. **Immutable Content Digests:**
   - Every `GraphSourceDocument` and `researchStagingItems` row records a lowercase `64`-character hex `contentSha256` (`sha256Hex`).
3. **Authority & Kind Stratification:**
   - `authority: "primary"` + `kind` in `{"filing", "company", "regulator"}` is required for `epistemicStatus: "confirmed"` and for `contractualStatus` in `{"signed", "funded", "contingent_signed"}` (`validateRelationshipGovernance`).
   - Secondary press (`kind: "news"`, `authority: "secondary"`) may record `reported` / `reported_discussion` or `conflicting_pending_review` assertions, **never** `confirmed`, `signed`, or `funded`.
4. **Market Data & Licensing Rights:**
   - `marketObservations` (`convex/schema.ts`) tracks `usage` (`'public_reference' | 'licensed'`), `licensed`, `permittedUse`, `declaredDelayMs`, and `isTrading212PositionPrice: false`.
   - Delayed public reference closes must never be labelled as live real-time quotes, and AI agents must never submit equity price, index, or FX claims (`staging-validator.ts`).
   - *Capability note:* Next.js CDN tag-based rights-revocation purge across public visitor pages is **`PLANNED`** (ACI research routes are authenticated Clerk/research-gated views using dynamic/no-store Convex & gateway queries).

---

## 2. Multi-Clock Chronology & Point-in-Time Reconstruction (`IMPLEMENTED` & `VERIFIED`)

Never collapse timestamps into a single date field or invent missing timestamps:

| Timestamp Field | Meaning | Governing Rule |
| :--- | :--- | :--- |
| `periodStartMs` / `periodEndMs` | Financial statement reporting window (e.g. `Q3 FY2027` ended `2026-10-25`) | `periodEndMs >= periodStartMs` (`financialObservationSchema`). |
| `effectiveFromMs` / `effectiveToMs` / `maturityAtMs` | Contractual start, end/cancellation, and debt/facility maturity | Preserved separately from filing publication date (`macroRelationshipSchema`). |
| `publishedAtMs` | Authoritative source publication / SEC EDGAR `acceptanceDateTime` | Basis recorded in `publicationBasis` (`sec_edgar_acceptance`, `exact_utc`, `updated_utc`, `date_upper_bound`, `retrieval_upper_bound`). |
| `receivedAtMs` (`serverReceivedAt`) | Trusted ACI receipt timestamp | **Hard invariant:** `receivedAtMs >= publishedAtMs`. Agent-asserted metadata cannot backdate server receipt. |
| `ingestedAtMs` | Pipeline normalisation/projection timestamp | Audit timestamp only; never used to backdate historical availability. |

**Point-in-Time (`asOfMs`) Eligibility (`isRelationshipEligibleAtCutoff` & `reconstructGraphRelationshipsAtDate`):**
- Under `temporalBasis = "receipt"` (default in `graphQueryRequestSchema`): requires `publishedAtMs <= asOfMs && receivedAtMs <= asOfMs`.
- Under `temporalBasis = "publication"`: requires `publishedAtMs <= asOfMs`.
- Both relationships and `GraphObservation` records published/received after `asOfMs` are withheld (`excludedByCutoffCount` / `excludedByHistoricalCutoffCount`), and `evidence-answer-validator.ts` (`historical_cutoff_respected`) blocks any claim whose `periodOrAsOf` exceeds `historicalCutoffIso`.

---

## 3. Canonical Entity Identity Governance (`IMPLEMENTED` & `VERIFIED`)

`resolveCanonicalOrganisation` (`lib/graph/identity-governance.ts`) resolves organisations strictly in this order:
1. **10-digit zero-padded SEC CIK** (`secCik`, e.g. `0001045810` for NVIDIA, `0001596532` for Arista Networks).
2. **20-character ISO 17442 LEI** (`leiCode`).
3. **Explicit verified `orgId`** (`explicitOrgId`).

**Fuzzy-Merge Prohibition:** If a candidate lacks a matching CIK, LEI, or explicit `orgId` and shares a normalised name stem or alias with an existing organisation (e.g. subsidiary vs parent SPV), `resolveCanonicalOrganisation` returns `status: "blocked_fuzzy_name_only"` and blocks automatic entity merging. Unnamed SEC concentration disclosures (e.g. NVIDIA `EX-99.3` `14%`, `11%`, `11%` direct customers) must remain anonymised observations rather than guessed legal entities.

---

## 4. SEC Filing Discovery & Deterministic Extraction Boundaries

Implemented in `lib/remote-ops/sec-filing-graph-extractor.ts` and `lib/remote-ops/sec-xbrl-fact-selector.ts`:

| Filing / Step | Capability Status | Exact Deterministic Behaviour & Refusal Rules |
| :--- | :---: | :--- |
| **Multi-filing EDGAR window (`discoverSecFilingWindow`)** | `VERIFIED` | Scans up to `maxFilingsPerCik` (`1..100`, default `25`) across `filings.recent` **plus** bounded `filings.files` overflow JSON pages (`CIK*-submissions-*.json`, `maxOverflowPages` `0..3`), skipping non-allowlisted noise (such as `Form 4` at `recent[0]`) and deduplicating seen accessions/URLs. |
| **Periodic `10-Q` / `10-K` XBRL (`extractObservationsFromPeriodicXbrl`)** | `VERIFIED` | Extracts current-period `GraphObservation`s (revenue, operating income, net income, operating cash flow, capex, cash) via `selectCurrentSecXbrlFact`. **Refuses:** (a) facts from non-periodic forms (`8-K`), (b) comparative prior-year facts whose `end` date != filing `reportDate`, and (c) YTD cumulative facts (`~180d` / `~273d`) mislabelled as single-quarter (`requires 75–105` days for quarterly flow metrics, `350–380` days for annual `10-K`). |
| **Form `13F-HR` XML (`extractHoldingsFromForm13fXml`)** | `VERIFIED` | Parses `infoTable` XML positions, verifies monetary scale (`1x` post-2023 SEC XML standard vs legacy `x1000` anomalies), emits portfolio fair-value `GraphObservation` + `pending_review` `ownership_stake` candidates (`SH` / `PRN` share counts, voting authority). |
| **Form `8-K` / `8-K/A` headers (`registerForm8kReviewCandidate`)** | `IMPLEMENTED` / `VERIFIED` | Classifies SEC items (`1.01`, `2.02`, `2.03`, `5.02`, `8.01`, etc.) and registers `pending_human_factual_review` source candidates **without** extracting XBRL `companyfacts` capex or hallucinating counterparties/amounts from unstructured prose. |
| **Curated multi-exhibit earnings/contract extraction (Case 007-A / 007-B)** | `VERIFIED` | Primary-source verified manifests (`data/graph/case-007-*.json`, `case-007-nvidia-ingestor.ts`) backed by exact SEC exhibit SHA-256 digests (`EX-99.1`, `EX-99.2`, `EX-99.3`, `13F-HR`, `SC 13G`, `8-K`). |
| **Unassisted LLM hyperedge extraction from arbitrary unstructured `8-K` / `S-1` prose** | **`PLANNED`** | Not permitted to auto-promote. Any prose-derived N-ary relationship requires explicit structured extraction + human `reviewer` verification before entering `graphProjectionOutbox`. |

---

## 5. Financial & Epistemic Classification Rules (`IMPLEMENTED` & `VERIFIED`)

1. **Reported Actual vs Forecast vs Derived vs Scenario vs Interpretation:**
   - `GraphObservation.observationKind`: `'reported'` (filed historical actual), `'forecast'` (management outlook, e.g. Q4 FY27 `$130.0B +/- 3%`), `'derived'` (deterministic calculation, e.g. Free Cash Flow or beat variance `+$7.844B / +7.26%`).
   - `SupportingClaimItem.distinction`: `'source_fact'`, `'deterministic_arithmetic'`, `'modelled_scenario'`, `'reported_unverified'`, `'interpretation'`.
   - In `evidence-answer-validator.ts`, deterministic variance between an `'observed'` actual and `'proposed'` forecast in the same bundle is verified arithmetically (`collectAllowedNumbers`).
2. **Proposed / Contingent Deals vs Completed Ownership:**
   - Pending acquisitions (e.g. Hugging Face Item `8.01` `principalAmount: null`) or IPO-contingent placements (e.g. Anthropic Class N) must carry `epistemicStatus: "proposed"` and `contractualStatus: "contingent_signed"` (`bindingObligation: false`).
   - `validateRelationshipGovernance` rejects `epistemicStatus === "proposed"` paired with `contractualStatus === "funded"`.
3. **Three-Class Commitment & Guarantee Separation (Never Summed into Funded Debt):**
   - **Class 1 — Funded Debt & Direct Contractual Commitments:** Recognised debt (`senior_notes_issuance`, e.g. `$25.0B` notes) and scheduled supply/uncommenced lease purchase obligations (`$518.0B` total / `$390.0B` supply).
   - **Class 2 — Contingent Off-Balance-Sheet Commitments:** Conditioned on counterparty financing and capacity acceptance (`bindingObligation: false`, e.g. `$32.0B` neocloud cap).
   - **Class 3 — Maximum Gross Credit / Lease Residual Guarantees:** Off-balance-sheet guarantee exposure (`guarantee_arrangement` / `leasing_agreement` `lease_guarantor`, e.g. `$118.0B` gross cap incl. `$105.0B` SB Energy / OpenAI Ohio lease guarantee, `$0` paid). Recorded in `commitmentLedger.signedGuaranteesUsd`, never added to recognised debt or treated as realised loss.
4. **Umbrella Envelope vs Tranche Deduplication:**
   - Overlapping multi-year compute/investment envelopes share `economicGroupId` / `parentCommitmentEnvelopeId`. `evidence-retrieval-gateway.ts` computes `naiveComputeCommitmentsSumUsd`, `deduplicatedComputeCommitmentsUsd`, and `doubleCountPreventedUsd`; `evidence-answer-validator.ts` (`deterministic_arithmetic_verified`) blocks presenting naive un-deduplicated sums as true totals.

---

## 6. Untrusted Content, Quarantine & Study Invalidation (`IMPLEMENTED` & `VERIFIED`)

1. **Prompt-Injection Quarantine:**
   - `validateStagedItem` (`lib/remote-ops/staging-validator.ts`) and `detectAdversarialContent` (`lib/graph/evidence-retrieval-gateway.ts`) inspect untrusted text for instruction overrides (`ignore previous instructions`, `system prompt`, role mutations, trading commands) and block/quarantine immediately.
2. **Non-Destructive SEC/XBRL Quarantine (`lib/remote-ops/xbrl-quarantine-remediation.ts` & `convex/operations.ts`):**
   - Originals are **never deleted** (`rowsDeletedCount === 0`).
   - `operations:quarantineStagedEvidenceInternal` supports `dryRun: true` (mandatory pre-execution impact report) and `dryRun: false` (requires pre-remediation Convex snapshot).
   - Patches `quarantinedAt` and `quarantineId` onto **both** `researchStagingItems` and **all** matching `evidence` rows — including **orphaned forward-frozen `evidence` rows** created by `storeForwardResearchEventInternal` outside `promotedEvidenceIds` (`md7ah8t1nmryeqt0c06wjq9c6x8hpgsb` in Dev; `ms71z2vm0nhq2850kvr3pym65s8hr3wb` in Prod).
   - Records affected `morningBriefings`, `forwardResearchEvents`, `experiments`, and `forecasts` on the `evidenceQuarantines` ledger and withholds/flags invalidated facts and studies in `operations:overview` and `research:dashboard`.
3. **Claim-Level vs Accession-Level Quarantine:**
   - **Implemented & Verified (`0001045810-26-000078`):** `evaluateNvidia000078ClaimPolicy` blocks XBRL `capital_expenditures` claims (`$0.24B` / `$1.07B`) on NVIDIA Form 8-K `0001045810-26-000078` while permitting SHA-256-verified (`17fe107f9113be5c57673d0a591ea49e87a667ea357de3959eeb91142c49280c`) Item `8.01` pending M&A relationship evidence strictly as `proposed` / `contingent_signed` (`principalAmount: null`, `bindingObligation: false`).
   - **Planned Generalisation:** A general Convex table parameterising arbitrary per-claim quarantine predicates across any future filing accession without code-defined rules is **`PLANNED`**.

---

## 7. Non-Destructive Supersession, Reviewer Gate & Outbox Projection (`VERIFIED`)

1. **Supersession Lineage:**
   - Amended or cancelled relationships increment `version = prior.version + 1`, set `supersedesRelationshipId = prior.relationshipId` under the same `logicalEventId`, require `publishedAtMs >= prior.publishedAtMs`, keep `prior` intact in Convex and TypeDB, and emit a `supersession_link` relation.
2. **Human Reviewer Gate (`convex/graph.ts` `reviewAndPromoteRelationship`):**
   - Requires `reviewer` role (`convex/authz.ts`), resolves primary sources from approved staged items or verified registries (rejecting quarantined sources via `isQuarantined`), runs `validateRelationshipGovernance`, logs to `graphRelationshipReviews`, and enqueues `graphProjectionOutbox` only when `decision === "approved"`.
3. **Target-Safe Idempotent Projection:**
   - `computeDeterministicProjectionKey` (`proj:<sha256>`) prevents duplicate outbox rows (`by_projection_key`).
   - `compileSelfContainedProjectionStatements` compiles idempotent TypeQL `put` statements for all prerequisite sectors, organisations, executives, projects, instruments, sources, observations, and relationships **without** bootstrapping synthetic Macro Case 001 data (`syncAndVerifyTypeDbCloud`).
   - Every live TypeDB write calls `assertExplicitTypeDbWriteTarget(config, expectedDatabase)` before opening a `WRITE` or `SCHEMA` transaction.
