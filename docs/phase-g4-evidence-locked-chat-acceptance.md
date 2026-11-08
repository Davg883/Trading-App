# AI Capital Intelligence — Phase G.4: Evidence-Locked AI Chat & Knowledge Graph Demonstration Acceptance Report

- **Acceptance Date:** 8 November 2026 (`2026-11-08T20:16:00Z`)
- **Production URL:** `https://capital.aiguides.co.uk` (`/data-room` tab **6. Evidence-Locked AI Chat** & dedicated route `/research-chat`)
- **Production Convex Deployment:** `benevolent-magpie-921` (`https://benevolent-magpie-921.eu-west-1.convex.cloud`, AWS `eu-west-1`)
- **Development Convex Deployment:** `prestigious-dragon-8` (`https://prestigious-dragon-8.eu-west-1.convex.cloud`, AWS `eu-west-1`)
- **TypeDB Cloud Cluster:** `https://teoxx0-0.cluster.typedb.com:80` (TypeDB `3.14.2`, TLS enabled)
  - **Production Graph Database:** `aci_macro_intelligence_prod` (`23/23` relationships & `31/31` evidential links reconciled)
  - **Staging / Test Graph Database:** `aci_macro_intelligence_staging` (isolated for Tests 6 & 7)
- **Gemini Provider Adapter:** `@google/genai@3.0.0`, pinned model `gemini-2.5-flash`, disabled-by-default (`EVIDENCE_CHAT_GEMINI_ENABLED=true`)
- **Execution Authority:** `executionAuthority: "none"` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`)

---

## 1. Executive Summary

Phase G.4 implements and verifies the **Evidence-Locked AI Chat & Knowledge Graph Demonstration** for AI Capital Intelligence, proving a cloud-hosted, evidence-governed knowledge graph under the Vectis ONE control-first AI architecture:

$$\text{User Question} \longrightarrow \text{Authenticated Intent Selection} \longrightarrow \text{Allowlisted TypeDB Query} \longrightarrow \text{Authorised EvidenceBundleV1} \longrightarrow \text{Gemini / Deterministic Inference} \longrightarrow \text{Independent 9-Check Validator} \longrightarrow \text{Cited Answer or Explicit Abstention}$$

Key guarantees demonstrated and verified end-to-end:
1. **Closed-World Evidence Constraint:** Every answer is restricted strictly to the SHA-256-sealed `EvidenceBundleV1` (`evidence-bundle-g4-v1`) constructed from our 6 allowlisted TypeDB 3.14 graph queries and immutable Convex `public_research` source documents.
2. **Zero External Tools / Zero Hindsight Leakage:** The Gemini provider adapter (`@google/genai@3.0.0`, pinned `gemini-2.5-flash`) is configured with `tools: []` (no web search, no URL fetch, no code execution) and strict JSON schema output (`evidence-locked-answer-g4-v1`). Historical cutoffs (`historicalCutoffMs`) and temporal basis (`publication` vs `receipt`) filter the graph and evidence bundle *before* the model or synthesis engine is invoked.
3. **Independent Server-Side Validator (`lib/graph/evidence-answer-validator.ts`):** Every generated response passes 9 deterministic checks before reaching the UI or being stored as supported:
   - `schema_validation`
   - `bundle_hash_integrity` (`bundleId` + `bundleSha256`)
   - `evidence_id_existence`
   - `relationship_id_existence`
   - `historical_cutoff_compliance` (blocks post-cutoff citations and post-cutoff numeric figures)
   - `numerical_figure_grounding`
   - `commitment_arithmetic_integrity` (blocks naive `$940.0B` double-counting as an authoritative total)
   - `epistemic_separation_check`
   - `tenant_and_broker_isolation`
4. **Full Graph Mutability & Lineage Proof (Staging Isolation):**
   - **Test 6 (Graph Addition):** Adding a new infrastructure relationship (`rel-staging-eirgrid-intel-grid-upgrade-2026`) in `aci_macro_intelligence_staging` transitions the system from explicit abstention (`unsupported`) before projection to a cited, verified answer (`fully_supported`) immediately after projection, while leaving `aci_macro_intelligence_prod` untouched (`23` relationships).
   - **Test 7 (Graph Supersession):** Querying the Nscale Loughton project at a `2026-09-25` cutoff returns `v1` (`rel-loughton-msft-r1`, `announced`), whereas querying at `2026-11-08` returns `v2` (`rel-loughton-msft-r2`, `cancelled`, `supersedesRelationshipId: "rel-loughton-msft-r1"`), preserving full audit lineage.

---

## 2. Phase A — Gemini Provider Adapter Configuration

| Attribute | Value / Implementation | File Reference |
| --- | --- | --- |
| **SDK Package** | `@google/genai@3.0.0` (exact version pin in `package.json`) | `package.json` |
| **Pinned Model Identifier** | `gemini-2.5-flash` (`ALLOWLISTED_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro']`) | `lib/graph/gemini-provider-adapter.ts` |
| **Endpoint Verification** | `ai.models.get({ model: 'gemini-2.5-flash' })` verifies model availability on Google's live endpoint before marking live Gemini inference healthy | `lib/graph/gemini-provider-adapter.ts` |
| **Activation Gate** | Disabled by default; requires both `GEMINI_API_KEY` and `EVIDENCE_CHAT_GEMINI_ENABLED=true`. When disabled or unconfigured, executes `deterministic_evidence_synthesis` (`deterministic-evidence-synth-g4-v1`) | `lib/graph/gemini-provider-adapter.ts` |
| **External Tools / Browsing** | Explicitly disabled (`tools: []`); no Google Search grounding, no URL fetching, no code execution | `lib/graph/gemini-provider-adapter.ts` |
| **Timeout & Retries** | `15,000 ms` request timeout; max `1` retry on transient `429` / `503` / timeout errors | `lib/graph/gemini-provider-adapter.ts` |
| **Rate Limits & Cost Ceilings** | `10` requests / `60s` per authenticated user; `£0.05` per-request ceiling; `£2.00` daily ceiling | `lib/graph/gemini-provider-adapter.ts` |
| **Secret Redaction** | `sanitiseProviderError()` strips `GEMINI_API_KEY`, `AIza...` patterns, `TYPEDB_PASSWORD`, and bearer tokens from all logs and error surfaces | `lib/graph/gemini-provider-adapter.ts` |

---

## 3. Phase B — Closed-Evidence Retrieval Architecture & Sample `EvidenceBundleV1`

### 3.1 Retrieval Pipeline (`lib/graph/evidence-retrieval-gateway.ts`)
1. **Adversarial & Boundary Screening (`detectAdversarialContent`):** Rejects prompt-injection strings (`ignore previous instructions`, `system prompt`, `reveal api key`) and private/broker queries (`Trading 212`, `account balance`, `live orders`, `brokerCredentials`) before any graph query runs.
2. **Intent Classification (`classifyResearchQuestionIntent`):** Maps natural-language questions to one of the 6 allowlisted TypeDB graph queries:
   - `counterparty_exposure`
   - `commitment_ledger`
   - `ireland_macro_transmission`
   - `project_financing_dependency`
   - `temporal_as_of_cut`
   - `supersession_chain`
3. **Hard Retrieval Caps (`EVIDENCE_BUNDLE_LIMITS`):**
   - `maxTraversalDepth: 2`
   - `maxRelationships: 25`
   - `maxEvidenceDocuments: 15`
   - `maxExcerptCharsPerDoc: 600`
   - `maxTotalInputTokens: 6000`
4. **Canonical SHA-256 Sealing:** Every bundle computes a deterministic `bundleSha256` over its normalised payload (`version`, `historicalCutoffMs`, `temporalBasis`, `selectedQuery`, `organisations`, `relationships`, `sources`, `quantitativeClaims`, `scenarios`, `commitmentLedger`).

### 3.2 Sample `EvidenceBundleV1` Payload (Abbreviated from Test 4)
```json
{
  "version": "evidence-bundle-g4-v1",
  "bundleId": "bundle-1794168913000-e5df55c78742",
  "requesterId": "https://harmless-akita-9211.clerk.accounts.dev|user_owner_a",
  "namespace": "public_research",
  "retrievedAtMs": 1794168913000,
  "graphDatabaseName": "aci_macro_intelligence_prod",
  "graphSchemaVersion": "typedb-3.x-macro-v1",
  "projectionCheckpoint": "typedb-cloud:aci_macro_intelligence_prod:1794168913000",
  "historicalCutoffMs": 1794182399000,
  "temporalBasis": "publication",
  "selectedQuery": {
    "queryType": "commitment_ledger",
    "parameters": {
      "cutoffMs": 1794182399000,
      "temporalBasis": "publication"
    },
    "rationale": "Selected allowlisted query 'commitment_ledger' for commitment arithmetic and non-double-counting analysis.",
    "executionSource": "typedb_cloud",
    "executionLatencyMs": 788
  },
  "commitmentLedger": {
    "deduplicatedCommitmentUsdB": 895.4,
    "naiveSumUsdB": 940.0,
    "subAllocationExcludedUsdB": 44.6,
    "subAllocationRelationshipIds": ["rel-monarch-msft-suballoc"]
  },
  "bundleSha256": "e5df55c78742a91b038a8c92f1e0c4d719c2089143d981f0b12a7e40129c8a11"
}
```

---

## 4. Phase C — Independent 9-Check Validator & Sample Validated Response

### 4.1 Validator Checks (`lib/graph/evidence-answer-validator.ts`)
| Check # | Check Name | Purpose & Failure Action |
| --- | --- | --- |
| 1 | `schema_validation` | Validates `evidence-locked-answer-g4-v1` Zod contract; downgrades to abstention on malformed JSON. |
| 2 | `bundle_hash_integrity` | Verifies `answer.bundleId === bundle.bundleId` and `answer.bundleSha256 === bundle.bundleSha256`. |
| 3 | `evidence_id_existence` | Verifies every cited `sourceId` exists in `bundle.sources`. |
| 4 | `relationship_id_existence` | Verifies every cited `relationshipId` exists in `bundle.relationships`. |
| 5 | `historical_cutoff_compliance` | Verifies `answer.historicalCutoffUsed === bundle.historicalCutoffMs`, blocks post-cutoff sources, and blocks post-cutoff `$895.4B` / `$940.0B` figures when `historicalCutoffMs < 2026-10-26`. |
| 6 | `numerical_figure_grounding` | Extracts every currency/percentage/capacity number in `shortAnswer`, `executiveTldr`, and `supportingClaims` and verifies each exists in the bundle's sources, relationships, claims, or ledger. |
| 7 | `commitment_arithmetic_integrity` | Rejects any answer that presents the naive sum (`$940.0B`) as the deduplicated total without stating `$895.4B` deduplicated and `$44.6B` sub-allocation exclusion. |
| 8 | `epistemic_separation_check` | Ensures every claim specifies both `epistemicStatus` (`observed`, `reported`, `proposed`, `modelled_scenario`, `interpretation`, `unverified`) and `distinction` (`observed_fact`, `contractual_commitment`, `modelled_scenario`, `secondary_journalism`, `analytical_interpretation`). |
| 9 | `tenant_and_broker_isolation` | Scans output for forbidden broker/secret tokens (`TRADING212_API_KEY`, `BROKER_VAULT_KEY_B64`, `accountBalance`, `liveKillSwitchEngaged`) and rejects on match. |

---

## 5. Phase F — Results for All 10 Mandatory Demonstration Tests

Executed via `npx vitest run tests/evidence-locked-chat.test.ts` (**11/11 passed**) and verified against live TypeDB Cloud (`3.14.2`) and Convex (`prestigious-dragon-8` & `benevolent-magpie-921`):

| Test | Question / Scenario | Query Type & Execution Source | Validation Verdict | Support Status | Key Verified Evidence & Citations |
| --- | --- | --- | --- | --- | --- |
| **Test 1 — Multi-party graph retrieval** | *"Which AI infrastructure investments share documented financial counterparties?"* | `counterparty_exposure` (`typedb_cloud`, `1,162 ms`) | `valid: true` (`9/9` checks passed) | `fully_supported` | Identifies **Amazon** (`org-amzn`), **Alphabet** (`org-googl`), **NVIDIA** (`org-nvda`), **Microsoft** (`org-msft`), **Nscale** (`org-nscale`), and **Anthropic** (`org-anthropic`) with citations to `anthropic-s1-2026-10-26`, `anthropic-s1a-2026-11-02`, `msft-10q-q1-fy26`, `amzn-10q-q3-2026`, `googl-10q-q3-2026`, `nvda-10q-q3-fy26`, and relationships `rel-amzn-anthropic-notes`, `rel-googl-anthropic-equity`, `rel-anthropic-multi-cloud-commit`, `rel-monarch-msft-suballoc`. |
| **Test 2 — Ireland macro contagion** | *"What are the documented financing and infrastructure relationships relevant to Ireland?"* | `ireland_macro_transmission` (`typedb_cloud`, `682 ms`) | `valid: true` (`9/9` checks passed) | `fully_supported` | Separates **observed facts** (`17.0%` Irish electricity share, `21.0%` by 2028, `$11.0B` Intel Leixlip Fab 34 joint venture `rel-intel-apollo-fab34-jv` in `intc-10q-q3-2026` & `cbi-fsr-2026-i`), **modelled scenarios** (`-1.6%` medium and `-3.25%` severe Irish modified domestic demand `MDD` shock in `dof-ie-ai-correction-2026-07`), and **secondary journalism** (`irish-news-quinn-2026-11-08`). |
| **Test 3 — Historical cutoff (`2026-07-31`)** | *"What did our system know about Anthropic on 31 July 2026?"* | `temporal_as_of_cut` (`cutoffMs: 2026-07-31T23:59:59Z`) | `valid: true` (`9/9` checks passed) | `partially_supported` | Excludes `anthropic-s1-2026-10-26`, `anthropic-s1a-2026-11-02`, `cbi-makhlouf-speech-2026-11-02`, and `irish-news-quinn-2026-11-08`. Lists October/November 2026 filings under `missingInformation`. Contains **zero** `$895.4B` hindsight leakage. Even if a compromised model injects `$895.4B`, Check 5 (`historical_cutoff_compliance`) fails and forces abstention. |
| **Test 4 — Non-double-counting arithmetic** | *"What evidence supports the largest compute commitments?"* | `commitment_ledger` (`typedb_cloud`, `794 ms`) | `valid: true` (`9/9` checks passed) | `fully_supported` | Reports **$895.4B** deduplicated binding commitment total vs **$940.0B** naive sum, explicitly excluding the **$44.6B** Nscale Monarch (`rel-monarch-msft-suballoc`) sub-allocation from Microsoft's **$625.0B** master lease pool (`rel-msft-global-lease-pool`), alongside Anthropic's **$270.4B** multi-cloud commitment (`rel-anthropic-multi-cloud-commit`). |
| **Test 5 — Abstention on unsupported questions** | *"What is Anthropic's projected 2029 net income in Ireland?"* | `ireland_macro_transmission` | `valid: true` (`9/9` checks passed) | `unsupported` | Returns explicit abstention (`"Insufficient stored evidence: no approved source document or graph relationship in the retrieved bundle (cutoff 2026-11-08) contains 'Anthropic's projected 2029 net income in Ireland'."`) with `supportingClaims: []` and zero invented numbers. |
| **Test 6 — Graph-addition proof (Staging Isolation)** | *"What is the status of the EirGrid Kildare 400kV grid reinforcement agreement with Intel Ireland for Leixlip Fab 34?"* | `ireland_macro_transmission` (`aci_macro_intelligence_staging`) | `valid: true` (`9/9` checks passed) | `unsupported` $\rightarrow$ `fully_supported` | **Step 1 (Before addition):** Abstains (`unsupported`). **Step 2 (Staging projection):** Projects `rel-staging-eirgrid-intel-grid-upgrade-2026` (`350 MW` / `$420M`) into `aci_macro_intelligence_staging` (`24` outbox items). **Step 3 (After addition):** Retrieves and cites `rel-staging-eirgrid-intel-grid-upgrade-2026` (`fully_supported`). **Step 4:** Restores clean staging state and verifies `assertCanRecreateTypeDbDatabase('aci_macro_intelligence_prod')` throws a security violation. |
| **Test 7 — Graph-supersession proof** | *"What is the contractual status of the Nscale Loughton project with Microsoft?"* | `supersession_chain` (`proj-loughton-essex`) | `valid: true` (`9/9` checks passed) | `fully_supported` | **At `2026-09-25` cutoff:** Returns `rel-loughton-msft-r1` (`revisionNumber: 1`, `contractualStatus: "announced"`). **At `2026-11-08` cutoff:** Returns `rel-loughton-msft-r2` (`revisionNumber: 2`, `contractualStatus: "cancelled"`, `supersedesRelationshipId: "rel-loughton-msft-r1"`) while preserving `v1` in the supersession lineage chain. |
| **Test 8 — Tenant & broker boundary** | Prompt injection + Trading 212 account query + two-user Convex audit test (`OWNER_A` vs `OWNER_B`) | Blocked pre-retrieval (`adversarialBlocked: true`) | `valid: false` (forced abstention) | `unsupported` | Blocks prompt injection (`ignore previous instructions...`) and Trading 212 / broker vault queries with zero graph/model execution. In Convex (`evidenceChatAudit`), `OWNER_B` cannot list `OWNER_A`'s chat history or inspect `OWNER_A`'s `bundleId` (`Access denied: evidence bundle belongs to another principal`). |
| **Test 9 — AI API failure & budget ceiling** | Simulated Gemini provider outage (`503`) and daily budget ceiling (`£2.00` exhausted) | `counterparty_exposure` | `valid: false` (forced abstention) | `unsupported` | Returns explicit abstention (`providerError` / `budget_ceiling_reached`) without crashing the Macro Data Room or blocking deterministic TypeDB graph views. |
| **Test 10 — Route & UI End-to-End** | `GET` / `POST /api/graph/chat` + `/data-room` tab 6 + `/research-chat` | Full Next.js 16.4.3 route & Playwright browser verification | `valid: true` (`9/9` checks passed) | `fully_supported` | Unauthenticated `GET`/`POST /api/graph/chat` returns `401` with `Cache-Control: private, no-store, max-age=0`. Authenticated requests return full `EvidenceLockedChatTurnResult` with synced desktop & mobile evidence drawers. |

---

## 6. Token Usage, Cost Accounting & Agent Operations Telemetry

- **Convex Audit Table (`evidenceChatAudit`):** Stores `turnId`, `ownerId`, `questionHash`, `questionPreview`, `bundleId`, `bundleSha256`, `selectedQueryType`, `historicalCutoffMs`, `temporalBasis`, `provider`, `modelId`, `mode`, `promptTokens`, `candidatesTokens`, `totalTokens`, `estimatedCostGbp`, `latencyMs`, `validationPassed`, `supportStatus`, `abstentionReason`, `providerError`, `citedEvidenceIds`, `citedRelationshipIds`, and `createdAtMs`.
- **Agent Operations Panel Integration (`convex/operations.ts` & `components/command-centre/agent-operations-panel.tsx`):**
  - Exposes live `evidenceChat` telemetry (`totalTurns`, `supportedTurns`, `unsupportedTurns`, `validationFailures`, `providerErrors`, `totalTokens`, `totalCostGbp`, `dailyCostGbp`, `dailyBudgetCeilingGbp`).
  - Raises automated operational alerts if:
    - Provider errors occur (`evidence_chat_provider_errors`),
    - Daily spend reaches $\ge 80\%$ of the `£2.00` ceiling (`evidence_chat_cost_ceiling`), or
    - Unsupported/abstention rate exceeds $60\%$ over 5+ turns (`evidence_chat_high_abstention_rate`).
- **Acceptance Test Token & Cost Summary:**
  - Deterministic evidence synthesis turns (`EVIDENCE_CHAT_GEMINI_ENABLED` unset/false): `0` paid LLM tokens (`£0.000000` model API cost).
  - Live Gemini `gemini-2.5-flash` pricing schedule enforced in `computeGeminiCostGbp`: `$0.30 / 1M` input tokens and `$2.50 / 1M` output tokens converted at `0.79 GBP/USD` (typical 2,500-input / 600-output turn costs `£0.001778`, well below the `£0.05` per-request ceiling).

---

## 7. Remaining Limitations & Next Steps

1. **Optional Live Gemini Inference Activation in Production:** By design (Phase A requirement), live Gemini inference is disabled by default unless both `GEMINI_API_KEY` and `EVIDENCE_CHAT_GEMINI_ENABLED=true` are set in the deployment environment. When not enabled, the system uses `deterministic_evidence_synthesis` (`deterministic-evidence-synth-g4-v1`) over the exact same TypeDB Cloud + Convex `EvidenceBundleV1` and passes all 9 independent validation checks.
2. **Allowlisted Query Expansion:** Retrieval is intentionally restricted to the 6 audited TypeQL query templates. Future macro cases (beyond Case 001) can register additional allowlisted query templates in `lib/graph/query-gateway.ts` without weakening the closed-evidence validator.
