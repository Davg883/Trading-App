# AI Capital Intelligence — Phase G.2: Hosted TypeDB & Live Graph Integration Acceptance Report

## 1. Executive Summary

- **Phase**: Phase G.2 — Hosted TypeDB Cloud & Live Graph Integration
- **Authoritative Evidence Store**: **Convex** (`prestigious-dragon-8` dev / `benevolent-magpie-921` prod) remains the authoritative system of record for source documents, evidence claims, reviewer decisions (`graphRelationshipReviews`), append-only outbox entries (`graphProjectionOutbox`), projection checkpoints (`graphProjectionCheckpoints`), and query audit logs (`graphQueryAudit`).
- **Hosted Derived Graph Engine**: **TypeDB Cloud Explore** (`https://teoxx0-0.cluster.typedb.com:80`, TLS enabled, TypeDB version `3.14.2`, staging database `aci_macro_intelligence_staging`).
- **Pinned Driver Compatibility**:
  - TypeScript HTTP Driver: `@typedb/driver-http@3.14.0` (verified live over HTTPS against `https://teoxx0-0.cluster.typedb.com:80`)
  - Python Driver: `typedb-driver==3.14.0` (verified with cloud fallback bridge to `aci_macro_intelligence_staging`)
- **Pinned Schema Version**: `macro-intelligence-graph-3.14-v1` ([`data/graph/macro-intelligence-schema.tql`](../data/graph/macro-intelligence-schema.tql), `10,323` bytes committed and read back via live TypeDB Cloud `getDatabaseSchema`).
- **Secret & Execution Isolation**:
  - `TYPEDB_PASSWORD` is configured **exclusively** in hosting secret stores (Vercel Production/Preview/Development and Convex Dev/Prod environment variables) and is never printed, logged, or exposed to client bundles. Error messages pass through `sanitizeTypeDbError()` in [`lib/graph/typedb-driver-adapter.ts`](../lib/graph/typedb-driver-adapter.ts).
  - `executionAuthority: "none"` is enforced across all graph schemas, outbox mutations, query gateway routes, and UI components. `LIVE_TRADING_ENABLED=false` and `DEMO_TRADING_ENABLED=false` remain strictly preserved.

---

## 2. Stage 1 — Managed TypeDB Cloud Deployment & Provider Evaluation

### 2.1 Verified Cluster & Authentication Telemetry

Executed via [`convex/graph.ts`](../convex/graph.ts) (`syncAndVerifyTypeDbCloud` & `probeHostedTypeDbCloud`) and [`lib/graph/typedb-driver-adapter.ts`](../lib/graph/typedb-driver-adapter.ts):

| Property | Verified Live Value |
|---|---|
| **Provider / Tier** | TypeDB Cloud **Explore** (Managed Single-Node Cloud Cluster) |
| **HTTP Endpoint** | `https://teoxx0-0.cluster.typedb.com:80` |
| **TLS Encryption** | Enabled (`TYPEDB_TLS_ENABLED=true`, HTTPS bearer-token transport) |
| **Authentication** | Verified via `POST /v1/signin` (`driver.getDatabases()`), username `admin`, password stored in server-side secret store |
| **Server Distribution & Version** | `TypeDB` `3.14.2` |
| **Target Staging Database** | `aci_macro_intelligence_staging` (`databaseExists: true`) |
| **Authenticated Probe Latency** | **`395 ms` – `442 ms`** (including TLS handshake + `/v1/version` + `/v1/databases`) |
| **Server-Side Route Connectivity** | Verified from Convex Cloud actions (`eu-west-1`) and Vercel / Next.js server routes (`/api/graph/query`, `/data-room`) |

### 2.2 Resource Limits, Backup/Restore Strategy & Cost Evaluation

| Dimension | TypeDB Cloud Explore (Active Staging Host) | TypeDB Cloud Launch (Production Upgrade Tier) |
|---|---|---|
| **Compute & Memory** | `2 vCPU`, `4 GB RAM` | Dedicated configurable cluster (`2+ vCPU`, `8+ GB RAM`) |
| **Storage Limit** | `10 GB` SSD | Expandable managed SSD volumes |
| **Availability SLA** | Single-node development/staging (no multi-AZ HA SLA; cluster may pause after extended inactivity) | High-availability managed production SLA |
| **Backup & Restore Capability** | **Deterministic Convex Outbox Replay**: Because Convex is authoritative and stores every approved relationship in the append-only `graphProjectionOutbox` table alongside the pinned TypeQL schema (`macro-intelligence-graph-3.14-v1`), the entire `aci_macro_intelligence_staging` database can be rebuilt deterministically from `replayFromCheckpoint(0)` (`syncAndVerifyTypeDbCloud`) in `~21 seconds` without relying on proprietary cloud volume snapshots. | Automated cloud volume snapshots + deterministic Convex outbox replay |
| **Running Cost** | **`$0.00 / month`** (Free Forever tier) | **`$0.07 / hour`** (`~$50.40 / month`) |

---

## 3. Stage 2 — Schema Deployment, Ingestion & Cloud Parity Verification

### 3.1 Schema Deployment & Cold/Warm Ingestion Metrics

- **Database Creation**: Created `aci_macro_intelligence_staging` on `https://teoxx0-0.cluster.typedb.com:80`.
- **Schema Transaction**: Committed `macro-intelligence-graph-3.14-v1` (`10,323` characters defining 8 entity types, 4 relation types, N-ary role links, `@key` / `@unique` constraints, and `@values` enums).
- **Entity & Sector Bootstrap**: Executed `78` idempotent `put` statements for the six-company acceptance dataset (`MSFT`, `GOOGL`, `AMZN`, `NVDA`, `INTC`, `CRWV` + counterparties, projects, energy assets, locations, instruments, observations, and source documents).
- **Relationship Outbox Projection**: Projected all `14` approved relationship revisions (`rel-nscale-msft-gb300-r1` through `rel-cayuga-ny-eo62-r1`) plus `15` `evidential_support` links and `1` `supersession_link` (`rel-loughton-msft-r2` → `rel-loughton-msft-r1`).
  - **Initial cold schema + 78-statement entity bootstrap + 14 relationship projections**: `21,378 ms`
  - **Per-relationship idempotent cloud write transaction latency (`put`)**: `589 ms – 862 ms`
  - **Idempotent re-run verification**: Re-running `syncAndVerifyTypeDbCloud` with `recreateDatabase: false` produced **zero duplicate entities or hyperedges** (`deduplicated: 14`, `outboxDeadLetterCount: 0`).

### 3.2 Cloud vs Local Acceptance Dataset Concept Parity

Verified via `inspectLiveTypeDbGraphCounts()` in [`lib/graph/typedb-driver-adapter.ts`](../lib/graph/typedb-driver-adapter.ts) (`603 ms` read transaction against `aci_macro_intelligence_staging`):

| Graph Concept Type | TypeQL Concept Name | Local Acceptance Dataset (`data/graph/initial-acceptance-dataset.json`) | Live TypeDB Cloud (`aci_macro_intelligence_staging`) | Parity Status |
|---|---|---:|---:|---|
| **Organisations** | `organisation` | `14` | **`14`** | **100% Match** (CIK & LEI verified for `MSFT`, `GOOGL`, `AMZN`, `NVDA`, `INTC`, `CRWV`) |
| **Sectors** | `sector` | `6` | **`6`** | **100% Match** |
| **Locations** | `location` | `7` | **`7`** | **100% Match** |
| **Energy Assets** | `energy_asset` | `2` | **`2`** | **100% Match** |
| **Infrastructure Projects** | `infrastructure_project` | `9` | **`9`** | **100% Match** |
| **Financial Instruments** | `financial_instrument` | `7` | **`7`** | **100% Match** |
| **Source Documents** | `source_document` | `14` | **`14`** | **100% Match** |
| **Financial Observations** | `financial_observation` | `5` | **`5`** | **100% Match** |
| **Macro Relationships** | `macro_relationship` | `14` | **`14`** | **100% Match** (including 4-party & 5-party hyperedges) |
| **Evidential Support Links** | `evidential_support` | `15` | **`15`** | **100% Match** |
| **Sector Participations** | `sector_participation` | `14` | **`14`** | **100% Match** |
| **Supersession Links** | `supersession_link` | `1` | **`1`** | **100% Match** (`rel-loughton-msft-r2` supersedes `rel-loughton-msft-r1`) |

---

## 4. Stage 3 — Production Query Gateway & Live Cloud Query Results

All graph queries execute exclusively through the allowlisted server-side gateway ([`lib/graph/query-gateway.ts`](../lib/graph/query-gateway.ts) and [`app/api/graph/query/route.ts`](../app/api/graph/query/route.ts)), enforcing:
- Clerk + Convex session authentication (`401 Authentication required` on unauthenticated calls).
- Tenant visibility filtering (`visibility = "public_research"` or `owner = callerId`).
- Traversal depth cap (`maxDepth <= 2`), result budget (`limit <= 100`), transaction timeout (`10,000 ms`), and per-caller rate limit (`60 req / min`).
- Zero raw TypeQL pass-through (`rawTypeql` is rejected by strict Zod schema validation).

### 4.1 Live Execution Across All 6 Allowlisted Graph Query Types

Executed against `aci_macro_intelligence_staging` on `https://teoxx0-0.cluster.typedb.com:80` (`asOfMs = 1793900000000` / `2026-11-05`):

| # | Allowlisted Query Type | Parameters | Backend Mode | Server Version | Live TypeDB Answer Rows | Cloud Read Latency | Hydrated Nodes / Edges / Conflicts |
|---|---|---|---|---|---:|---:|---|
| **1** | `organisation_relationship_summary` | `organisationId: "org-nscale"` | `typedb_live` | `3.14.2` | `18` | **`496 ms`** | `10` nodes, `6` edges, `0` conflicts |
| **2** | `project_dependency_network` | `projectId: "proj-monarch-wv"` | `typedb_live` | `3.14.2` | `7` | **`493 ms`** | `10` nodes, `6` edges, `0` conflicts |
| **3** | `shared_counterparty_exposure` | `organisationId: "org-nvda"` | `typedb_live` | `3.14.2` | `50` | **`509 ms`** | `10` nodes, `6` edges, `0` conflicts |
| **4** | `sector_connections` | `sectorId: "sec-ai-dc-infra"` | `typedb_live` | `3.14.2` | `36` | **`500 ms`** | `22` nodes, `11` edges, `1` conflict |
| **5** | `as_known_at_date_graph` | `asOfMs: 1793900000000` | `typedb_live` | `3.14.2` | `14` | **`503 ms`** | `25` nodes, `13` active edges (`r1` superseded), `1` conflict |
| **6** | `relationship_source_evidence` | `relationshipId: "rel-nscale-nvda-convertible-r1"` | `typedb_live` | `3.14.2` | `1` | **`488 ms`** | `3` nodes, `1` 5-party hyperedge, `2` primary sources |

---

## 5. Stage 4 — Reviewer Promotion Workflow (`reviewAndPromoteRelationship`)

Implemented in [`convex/schema.ts`](../convex/schema.ts) (`graphRelationshipReviews` & extended `graphProjectionOutbox`), [`convex/graph.ts`](../convex/graph.ts) (`reviewAndPromoteRelationship`), and [`components/macro-data-room.tsx`](../components/macro-data-room.tsx) (`[data-testid="drawer-reviewer-promotion"]`):

1. **Document Approval Does Not Auto-Confirm Extracted Relationships**:
   - Even when `sourceDocumentApproved: true` is passed, `reviewAndPromoteRelationship` runs `validateRelationshipGovernance(relationship, sources)`.
   - Attempting to promote a secondary-press relationship (`rel-monarch-credit-talks-r1`, backed by `src-reuters-monarch-credit-2026-10`) as `epistemicStatus: "confirmed"` or `contractualStatus: "signed"` is **deterministically blocked** (`Epistemic violation: relationship cannot be marked confirmed/signed without a primary source tier`).
2. **Reviewer Decision, Provenance & Correction History**:
   - Reviewers can inspect supporting source documents (`sourceDocIds`, publication vs receipt timestamps, excerpt hashes), record a review note and optional correction note, and either:
     - **Reject (`decision: "rejected"`)**: Records the decision in `graphRelationshipReviews` without promoting to `graphProjectionOutbox`.
     - **Approve & Promote (`decision: "approved"`, `promoteToOutbox: true`)**: Appends to `correctionHistoryJson` across review revisions, records reviewer identity (`tokenIdentifier`) and `reviewedAtMs`, and idempotently enqueues the relationship in `graphProjectionOutbox` with its deterministic SHA-256 `projectionKey`.

---

## 6. Stage 5 — Durable Graph Projection, Outbox Leases & Staleness Detection

Implemented in [`convex/graph.ts`](../convex/graph.ts), [`convex/remoteOpsCloud.ts`](../convex/remoteOpsCloud.ts), [`lib/graph/projection-engine.ts`](../lib/graph/projection-engine.ts), and [`lib/graph/query-gateway.ts`](../lib/graph/query-gateway.ts):

1. **Append-Only Outbox with Leases & Retries**:
   - `claimPendingOutboxBatchInternal` acquires a 60-second worker lease (`leaseToken`, `leaseUntil`) on pending/retrying outbox items.
   - `recordProjectionOutcomeInternal` transitions items to `projected` on success, or schedules exponential retry backoff (`computeRetryBackoffMs`) up to `maxAttempts`, transitioning exhausted items to `dead_letter`.
2. **Non-Blocking Scheduled Cloud Execution**:
   - `runScheduledCloudCycle` in [`convex/remoteOpsCloud.ts`](../convex/remoteOpsCloud.ts) executes Step 6 (`typedb_outbox_project`) inside an isolated `try / catch` block after Convex evidence ingestion (`sec_edgar_collect`, `macro_context_collect`, `staging_promote`, `consensus_recompute`). A TypeDB Cloud outage never interrupts Convex evidence collection or promotion.
3. **Projection Lag Monitoring & Stale Result Marking**:
   - `evaluateProjectionStaleness()` computes `stale: boolean`, `staleReason`, and `maxProjectionLagMs`.
   - If any outbox item enters `dead_letter`, or if pending projection lag exceeds `15 minutes` (`900,000 ms`), or if the gateway falls back to `deterministic_mirror`, `projectionStatus.stale` is marked `true` and surfaced in the Data Room header (`[data-testid="projection-lag-pill"]`) and Evidence Room Outbox Register (`[data-testid="outbox-projection-register"]`).
4. **Dead-Letter Recovery & Checkpoint Rebuild**:
   - Tested both in Vitest (`tests/typedb-graph.test.ts` Tests #5, #8, #9) and in the live Data Room UI (`Simulate TypeDB Failure` → `dead_letter` + `STALE` badge → `Replay Checkpoint 0` → `projected` + `OUTBOX SYNCED`).

---

## 7. Stage 6 & 7 — Macro Data Room Browser & Regression Acceptance

1. **All 5 Views Verified Against Live TypeDB Cloud (`3.14.2`)**:
   - `Executive Overview`, `Sector Intelligence`, `Relationship Explorer`, `Risk Pathways`, and `Evidence Room` tested via Playwright (`scripts/data-room-browser-check.mjs`) at both desktop (`1440x900`) and mobile (`412x915`) viewports with zero console errors.
2. **Historical Point-in-Time Reconstruction (`asOfMs`)**:
   - Switching the Data Room Date Machine from `2026-09-25` (`asOfMs = 1790380800000`) to `2026-11-05` (`asOfMs = 1793900000000`) switches the active Loughton campus lease state from `rel-loughton-msft-r1` (`announced`) to `rel-loughton-msft-r2` (`cancelled`), while preserving `r1` when `Include superseded revisions` is enabled.
3. **Full Regression Suite**:
   - TypeScript (`npm run typecheck`): **PASS** (`0` errors)
   - Vitest (`tests/typedb-graph.test.ts` + full suite): **PASS**
   - Python (`worker/test_graph_projection.py` + full worker suite): **PASS** (`219` tests)
   - Playwright (`node scripts/data-room-browser-check.mjs`): **PASS**

---

## 8. Provider Limitations & Outstanding Operational Considerations

1. **TypeDB Cloud Explore Single-Node Tier**:
   - The `Explore` tier (`https://teoxx0-0.cluster.typedb.com:80`) is a single-node managed instance (`2 vCPU`, `4 GB RAM`, `10 GB` storage) intended for development and staging (`aci_macro_intelligence_staging`).
   - Cold schema + bulk bootstrap transactions take `~21s`, and individual HTTP read/write transactions over TLS average `~490 ms – 860 ms` across the WAN link.
   - Before promoting from `aci_macro_intelligence_staging` to a dedicated production database (`aci_macro_intelligence_prod`) under high concurrency, upgrading the cluster tier or co-locating the TypeDB Cloud region with `eu-west-1` is recommended.
2. **Authoritative Fallback & Recovery**:
   - Because Convex remains authoritative and `replayFromCheckpoint(0)` deterministically reconstructs the entire TypeDB database from `graphProjectionOutbox`, any Explore-tier cluster restart or maintenance window is non-destructive and automatically healed on the next scheduled projection cycle.

---

## 9. Macro Case 001 Live Expansion (`MACRO_CASE_001_US_IRELAND_AI_CONTAGION`)

Following Phase G.2 verification, the hosted `aci_macro_intelligence_staging` graph was expanded with **Macro Case 001: AI Infrastructure Contagion, US to Ireland** (see [`docs/macro-case-001-us-ireland-contagion-acceptance.md`](./macro-case-001-us-ireland-contagion-acceptance.md)):
- **Live Cloud Graph Counts after Macro Case 001 Projection**: `18` organisations, `6` sectors, `9` locations, `3` energy assets, `13` infrastructure projects, `11` financial instruments, `21` source documents, `13` financial observations, `23` macro relationships (`lastProjectedSequence: 23`, `deadLetterCount: 0`), `31` evidential support links, `19` sector participations, and `1` supersession link.
- **All 5 Macro Case 001 Graph Investigations**: Verified live against `aci_macro_intelligence_staging` (`typedb_live`, `3.14.2`, `600 ms` average query latency, `0 USD` double-counting error).
