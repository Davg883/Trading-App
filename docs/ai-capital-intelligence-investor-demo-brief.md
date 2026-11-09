# AI Capital Intelligence — Investor Demo Brief & Vectis ONE Reference Architecture

- **Document Version**: Phase G.5 Production Acceptance Edition (`2026-11-09`)
- **Live Production URL**: `https://capital.aiguides.co.uk`
- **Reference Architecture**: Vectis ONE Control-First AI Architecture
- **Production Stack**: Next.js 15 App Router (Vercel Production) · Clerk Production (`clerk.capital.aiguides.co.uk`) · Convex Cloud (`benevolent-magpie-921`, AWS `eu-west-1`) · TypeDB Cloud `3.14.2` (`aci_macro_intelligence_prod`) · Google GenAI SDK (`@google/genai`) · Trading 212 Read-Only Portfolio Sync

---

## 1. Problem Statement

Institutional research teams, family offices, and sovereign/macro risk desks face three structural failure modes when applying generative AI to capital allocation and systemic risk intelligence:

1. **Unverified Hallucinations & Pre-Training Contamination**: Standard RAG and chat assistants blend retrieved snippets with stale pre-training priors, fabricating figures, dates, and counterparty links when evidence is incomplete.
2. **Double-Counting in Multi-Party Financial Graphs**: In complex supply-chain and capital-commitment structures (such as hyperscaler-to-AI-lab compute envelopes vs downstream data-centre sub-allocations, or dual investor/supplier circularity), naive summarisation sums overlapping parent envelopes and child sub-contracts—inflating $895.4B of deduplicated compute commitments into a false $940.0B headline figure.
3. **Lack of Epistemic & Temporal Governance**: Conventional AI tools cannot separate audited SEC filing facts from secondary journalism or modelled central-bank stress scenarios, cannot reconstruct what was known on a historical publication vs receipt date without hindsight leakage, and cannot guarantee hard isolation between untrusted web research and brokerage execution credentials.

---

## 2. Concise Product Explanation

**AI Capital Intelligence** is an evidence-governed financial and macroeconomic intelligence platform—built as the flagship reference implementation of the **Vectis ONE** control-first AI architecture.

Instead of treating an LLM as an autonomous oracle, AI Capital Intelligence enforces a strict five-stage pipeline:

1. **Deterministic & Autonomous Ingestion**: Scheduled Convex Cloud workers ingest primary SEC EDGAR filings (`10-K`, `10-Q`, `8-K`, `S-1/A`), central-bank macroeconomic publications, and allowlisted financial news, classifying every claim with dual timestamps (`publishedAt` and `receivedAt`) and screening untrusted text for prompt-injection payloads.
2. **Human-Reviewed Graph Projection**: Approved canonical relationships are projected idempotently into a strongly typed hypergraph on **TypeDB Cloud (`3.14.2`)**, preserving n-ary counterparty roles (`investor`, `compute_supplier`, `compute_offtaker`, `credit_arranger`), epistemic statuses (`verified`, `reported`, `modelled`, `contradicted`), and parent-envelope links (`parent_commitment_envelope`).
3. **Allowlisted Graph Retrieval & Deterministic Arithmetic**: User questions are mapped only to six allowlisted TypeQL query templates. Before any LLM sees the context, a deterministic ledger engine computes parent-envelope deduplication ($895.4B deduplicated vs $940.0B naive sum; $44.6B Nscale Monarch sub-allocation excluded from additive totals).
4. **Evidence-Locked AI Synthesis & 9-Check Validator**: The model answers solely from a SHA-256-hashed `EvidenceBundleV1` payload. Every generated response must pass a 9-check deterministic validator verifying schema conformance, bundle hash binding, `evidenceIds` and `relationshipIds` membership, historical cutoff compliance, quantitative claim accuracy, non-double-counting arithmetic, zero private/broker leakage, and prompt-injection immunity.
5. **Fail-Closed Abstention & Read-Only Portfolio Overlay**: If a question is unsupported by approved evidence—or if an upstream model provider experiences capacity throttling—the system never fabricates an answer; it returns an audited, schema-valid abstention. Authenticated owners can synchronise read-only Trading 212 account holdings via an AES-256-GCM server vault while `executionAuthority` remains permanently locked to `"none"` across all AI and research routes.

---

## 3. Technical Differentiators (Why This Is Not a Generic LLM Wrapper)

| Capability | Generic RAG / Prompt Wrapper | AI Capital Intelligence (Vectis ONE Architecture) |
| :--- | :--- | :--- |
| **Knowledge Representation** | Flat vector chunks with cosine similarity | Strongly typed **TypeDB 3.14.2** n-ary hypergraph (`aci_macro_intelligence_prod`) with explicit role players and provenance links |
| **Financial Arithmetic** | Delegated to LLM token prediction (prone to summing overlapping figures) | **Deterministic Commitment Ledger** deduplicating child sub-allocations (`parentCommitmentEnvelopeId`) before prompt construction |
| **Epistemic Discipline** | Blends primary filings, press rumours, and scenarios into uniform prose | Enforces 5-class claim taxonomy (`source_fact`, `deterministic_arithmetic`, `modelled_scenario`, `reported_unverified`, `interpretation`) |
| **Temporal Reconstruction** | Vulnerable to hindsight bias and undated training knowledge | Dual-clock (`publication` vs `receipt`) point-in-time cutoff filter (`historicalCutoffMs`) verified by automated hindsight checks |
| **Post-Generation Governance** | Unchecked streaming text output | **9-Check Deterministic Validator** (`validateEvidenceLockedAnswer`) that strips or quarantines any unverified number or unlinked citation |
| **Failure Mode** | Hallucinates plausible prose or silently degrades | **Fail-Closed Abstention** recorded in an immutable Convex `evidenceChatAudit` ledger with token/cost telemetry |
| **Execution Boundary** | Tool-calling agents often share runtime with API credentials | Cryptographic vault isolation (`AES-256-GCM`, Clerk JWT owner binding) and hard-coded `executionAuthority: "none"` |

---

## 4. Five-Minute Live Investor Demo Script

### Preparation (Before Screen Share)
- Open `https://capital.aiguides.co.uk` signed in via Clerk Production (`clerk.capital.aiguides.co.uk`).
- Have three tabs ready:
  1. **Agent Operations** (`/operations`)
  2. **Macro Data Room — Case 001** (`/macro-data-room`)
  3. **Evidence-Locked Research Chat** (`/research-chat`)

---

### Minute 0:00–1:00 — Live Cloud Operations & Zero-Trust Architecture (`/operations`)
- **Action**: Show the **Agent Operations** dashboard on `https://capital.aiguides.co.uk/operations`.
- **Talking Points**:
  - Point to the **Service Readiness Matrix**: Convex Cloud (`benevolent-magpie-921`), Clerk Production, SEC EDGAR Collector, TypeDB Cloud `3.14.2` (`23/23` relationships projected, `0` pending, `0` dead-letter, `0 ms` lag), Gemini Provider Adapter, and Trading 212 Read-Only Vault.
  - Highlight the **Scheduled Research Job Matrix**: show that five unattended cloud cron jobs (`market_data_collect`, `sec_filings_collect`, `news_discovery_agent`, `portfolio_risk_refresh`, `daily_intelligence_briefing`) run autonomously in Convex Cloud while local machines are off.
  - Emphasise the security banner: `executionAuthority: "none"`—research agents and LLMs cannot read broker credentials or place orders.

### Minute 1:00–2:30 — TypeDB Hypergraph & Non-Double-Counting Ledger (`/macro-data-room`)
- **Action**: Switch to **Macro Data Room (`/macro-data-room`)** showing **Case 001: US-to-Ireland AI Infrastructure Contagion**.
- **Talking Points**:
  - Walk through **View 1 (Counterparty Network)** and **View 2 (Compute Commitment Ledger)**.
  - Show how Anthropic's S-1/A filings, Amazon's $100B+ compute/investment relationship, Alphabet's cloud commitments, and Microsoft/Nscale's $44.6B Monarch data-centre lease are modelled as multi-role hypergraph relations in TypeDB.
  - Point to the **$895.4B deduplicated total vs $940.0B naive sum**: explain how TypeDB's `parent_commitment_envelope` linkage prevents double-counting the $44.6B Nscale sub-allocation inside Microsoft's parent envelope.
  - Briefly show **View 3 (Ireland Macro Contagion)** separating observed Irish corporate tax receipts (€38.8B ex-Apple) from modelled Central Bank of Ireland COSMO stress scenarios (-1.6% and -3.25% Modified Domestic Demand).

### Minute 2:30–4:00 — Evidence-Locked AI Chat & Point-in-Time Reconstruction (`/research-chat`)
- **Action**: Open **Evidence-Locked Research Chat (`/research-chat`)** (or View 6 inside the Macro Data Room).
- **Step A (Multi-Party Grounded Query)**:
  - Click the starter question: *"Which AI infrastructure investments share documented financial counterparties?"*
  - Show the live **TypeDB Query Inspector** (`organisation_relationship_summary`, `typedb_live`, ~300 ms latency, 16 live graph rows) and the **9/9 Validation Badge** (`bundle_hash_bound`, `evidence_ids_in_bundle`, `deterministic_arithmetic_verified`).
  - Expand the **Source Citations** drawer to show clickable provenance badges (`Tier 1 Primary Filing` vs `Tier 3 Financial Journalism`) with both publication and receipt timestamps.
- **Step B (Historical Cutoff / Time-Travel Proof)**:
  - Set the **Historical Cutoff** date picker to `2026-07-31` (`Publication` clock) and ask: *"What did our system know about Anthropic on 31 July 2026?"*
  - Show that the retrieved bundle contains **0 post-July 2026 relationships**—proving zero hindsight leakage—and the assistant returns a clean, validated historical abstention explaining that the October 2026 S-1/A disclosures had not yet been published.
- **Step C (Unsupported Question Abstention)**:
  - Ask: *"What will NVIDIA's closing share price be next Friday?"*
  - Show that the system refuses to speculate, returning `supportStatus: "unsupported"` with `9/9` governance checks passed.

### Minute 4:00–5:00 — Staging Graph-Addition Proof & Read-Only Broker Isolation
- **Action**: Click **"Run Staging Graph-Addition Demo"** in View 6 of `/macro-data-room`, then briefly show `/settings/brokers`.
- **Talking Points**:
  - Show that projecting a new approved relationship (`rel-coreweave-ireland-dublin-grid-demo-r1`, 180 MW EirGrid Dublin West connection) into `aci_macro_intelligence_staging` makes it immediately discoverable with citations while leaving `aci_macro_intelligence_prod` (`23/23` relationships) completely untouched.
  - Show `/settings/brokers`: confirm that the owner's Live Trading 212 Read-Only account (`GBP`, `6` positions synced) is encrypted via `AES-256-GCM` in Convex and completely isolated from the AI research assistant.

---

## 5. Commercial Hypotheses

1. **Target Beachhead Segments**:
   - **Boutique Macro & Credit Funds / Family Offices (£2k–£5k/month per seat/desk)**: Need institutional-grade filing synthesis, supply-chain contagion mapping, and point-in-time auditability without building an internal 10-person data engineering team.
   - **Regulated Financial Institutions & Sovereign Risk Teams (£50k–£150k/year enterprise licence)**: Require an AI architecture (Vectis ONE) that satisfies UK FCA / EU AI Act / SEC examination standards for explainability, non-fabrication, and strict separation of research from execution.
   - **Corporate Treasury & Strategic Counterparty Risk Desks**: Monitoring customer-supplier-investor circularity across technology, energy, and infrastructure capex commitments.
2. **Core Value Proposition**:
   - Reduces multi-filing counterparty due diligence from days to seconds while guaranteeing **zero unverified numbers** and **deterministic multi-party deduplication**.

---

## 6. Known Limitations (Transparent Investor Disclosure)

1. **Upstream Gemini API Preview Model Capacity Volatility**:
   - Google AI Studio recently retired `gemini-2.5-flash` for new projects (`HTTP 404 NOT_FOUND`) and directs requests to `gemini-3.8-flash`. Under live testing, `gemini-3.8-flash` passes authentication, billing, and schema generation (~19.7s latency) but intermittently experiences upstream Google AI Studio capacity spikes (`HTTP 503 UNAVAILABLE` / `HTTP 504 DEADLINE_EXCEEDED`). When this occurs, AI Capital Intelligence's fail-closed governance layer catches the provider error and returns a validated abstention (`providerStatus: "provider_error"`) rather than fabricating an answer. Moving to a provisioned Vertex AI enterprise endpoint eliminates public AI Studio queue contention.
2. **Curated Graph Scope (Case 001 Focus)**:
   - The production TypeDB hypergraph (`aci_macro_intelligence_prod`) currently models **Macro Case 001** (11 organisations, 23 canonical relationships, 15 primary/secondary sources, 14 quantitative claims, and 2 Ireland macro scenarios). Automated news and SEC collectors ingest live feeds into Convex staging, but promotion into TypeDB intentionally requires human reviewer sign-off (`Human Review` gate).
3. **Single-Owner MVP Tenancy**:
   - While Clerk RBAC (`owner`, `reviewer`, `operator`, `viewer`) and per-user Convex row isolation are implemented and tested, the live production workspace is currently operated as a single-owner environment with daily (`£2.00/day`) and per-request (`£0.05/turn`) AI cost ceilings.

---

## 7. Next Validation Milestones (30 / 60 / 90 Days)

- **30 Days (Reliability & Multi-Provider Failover)**:
  - Migrate Gemini inference from public Google AI Studio to regional **Google Cloud Vertex AI** (`europe-west2` / `europe-west1`) with provisioned throughput or automatic secondary failover to Anthropic Claude / OpenAI structured outputs under the same 9-check `EvidenceBundleV1` validator.
- **60 Days (Automated Entity Resolution & Graph Expansion)**:
  - Expand `aci_macro_intelligence_prod` from Case 001 (23 relationships) to 250+ relationships covering European utilities, semiconductor equipment bottlenecks, and sovereign fiscal exposure, with assisted SEC `10-K`/`10-Q` table extraction into the Human Review queue.
- **90 Days (External Design-Partner Pilot)**:
  - Onboard 3–5 external institutional analysts or family-office design partners into isolated multi-tenant workspaces, measuring weekly active research queries, reviewer promotion velocity, and audit-export usage.
