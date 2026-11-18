# ACI Graph Data Contracts (`TypeDB 3.14.2` & TypeScript/Convex Schemas)

**Skill Version:** `1.1.1` (`macro-intelligence-graph-3.14-v1`)  
**Authoritative Code Sources:**
- Canonical TypeQL 3 Schema: `data/graph/macro-intelligence-schema.tql` & `lib/graph/typedb-schema.ts` (`EMBEDDED_PINNED_TYPEQL_SCHEMA` + `ADDITIVE_CASE_007_SCHEMA_EXTENSION`)
- Core Graph Zod Contracts: `lib/graph/contracts.ts`
- Evidence-Locked Chat Contracts: `lib/graph/evidence-chat-contracts.ts`
- Driver & Target Isolation Guards: `lib/graph/typedb-driver-adapter.ts` & `worker/graph_projection.py`
- Convex Durability & Audit Ledger: `convex/schema.ts` & `convex/graph.ts`

---

## 1. Pinned Platform & Schema Versions

| Component | Pinned Constant / Package | Value | Verification Status |
| :--- | :--- | :--- | :--- |
| TypeDB Server | `PINNED_TYPEDB_SERVER_VERSION` | `3.14.2` (CE local `127.0.0.1:1729` gRPC / `127.0.0.1:8000` HTTP; TypeDB Cloud HTTPS) | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`bd38833`); not `PRODUCTION_VERIFIED` |
| TypeScript HTTP Driver | `PINNED_TYPEDB_HTTP_DRIVER_VERSION` | `@typedb/driver-http@3.14.0` (sessionless `schema` / `write` / `read` transactions) | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`bd38833`) |
| Python gRPC Driver | `PINNED_TYPEDB_PYTHON_DRIVER_VERSION` | `typedb-driver==3.14.0` | `LOCALLY_VERIFIED` (`worker/test_graph_projection.py` on local TypeDB `3.14.2`) |
| Primary Schema Version | `MACRO_GRAPH_SCHEMA_VERSION` | `macro-intelligence-graph-3.14-v1` (also accepts `macro-intelligence-graph-3.14-v1.1` in `SUPPORTED_MACRO_GRAPH_SCHEMA_VERSIONS`) | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`aci_case007_verified_dev`, `aci_case007b_verified_dev`) |
| Dataset Envelope Version | `MACRO_GRAPH_DATASET_VERSION` | `macro-graph-dataset-g1-v1` | `DEV_VERIFIED` / `PREVIEW_VERIFIED` |
| Evidence Bundle Version | `EVIDENCE_BUNDLE_VERSION` | `evidence-bundle-g4-v1` | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`3222376`: live API & SSR/RSC) |
| Evidence Answer Version | `EVIDENCE_LOCKED_ANSWER_VERSION` | `evidence-locked-answer-g4-v1` | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`3222376`: question-aware synthesis & `<= 480`-char validator bound) |

### TypeQL 3.14 Syntax Mandates
1. **No TypeDB 2.x syntax:** Never emit `Session` lifecycles, `rule` blocks inside `define`, or role bindings without `links`.
2. **Explicit `links (...)`:** Relation role bindings require `$rel isa <relation_type>, links (role_a: $a, role_b: $b)`.
3. **`@abstract` super-relation:** `relation macro_relationship @abstract` owns shared attributes without declaring abstract roles directly (prevents TypeDB `3.14.2` `[SVL41]`).
4. **Injection-safe literal binding:** All TypeQL string/int/double/bool interpolations must pass through `escapeTypeQlString` (rejects `\0`, `\r`, `\n`, and strings `> 4000` chars) and `formatTypeQlInt` (`Number.isSafeInteger`). Raw user-supplied TypeQL is strictly forbidden (`graphQueryRequestSchema` uses `.strict()`).

---

## 2. TypeDB Environment & Database Isolation Contracts

Defined in `lib/graph/typedb-driver-adapter.ts`:

| Constant | Database Name | Purpose & Write Guard | Verification Status |
| :--- | :--- | :--- | :--- |
| `PRODUCTION_TYPEDB_DATABASE` | `aci_macro_intelligence_prod` | Production graph target. Blocked by `assertExplicitTypeDbWriteTarget` unless `allowProductionWrite === true`, and unconditionally blocked from `assertCanRecreateTypeDbDatabase`. | `IMPLEMENTED` / `LOCALLY_VERIFIED` (guard); **NO-GO** for Production Case 007 / RC002 writes |
| `STAGING_TYPEDB_DATABASE` | `aci_macro_intelligence_staging` | Legacy shared staging database containing `23` synthetic Macro Case 001 relationships (`owner = public_research`). Preserved non-destructively; blocked from silent targeting by `assertExplicitTypeDbWriteTarget`. | `DEV_VERIFIED` (read-back); `LOCALLY_VERIFIED` (RC002 explicit target guard) |
| `CASE_007_VERIFIED_DEV_DATABASE` | `aci_case007_verified_dev` | Immutable NVIDIA Case 007-A pre-earnings dev snapshot (`20` relationships, `4` observations). Guarded by `assertIsolatedCase007WriteTarget`; blocked from `assertCanRecreateTypeDbDatabase`. | `DEV_VERIFIED` / `PREVIEW_VERIFIED` |
| `CASE_007B_VERIFIED_DEV_DATABASE` | `aci_case007b_verified_dev` | Isolated NVIDIA Case 007-A + 007-B post-earnings dev database (`30` stored `macro_relationship` rows = `20` Case 007-A + `10` Case 007-B; `28` active non-superseded edges after `2` preserved `v1` rows; `27` 2-hop `org-nvda` focal-reachable active edges; `<= 25` selected in `EvidenceBundleV1`; `24` `financial_observation` rows; `16` stored `source_document` rows / `<= 15` in `EvidenceBundleV1`; `77` `evidential_support` links). Guarded by `assertIsolatedCase007BWriteTarget`. | `DEV_VERIFIED` / `PREVIEW_VERIFIED` (`3222376`, `24` obs & `30` stored rels) |
| *(Disposable Local Test DBs)* | e.g. `aci_rc002_unseen_disposable_test` | Ephemeral local TypeDB `3.14.2` databases (`127.0.0.1:8000` / `127.0.0.1:1729`) created and dropped inside test `try / finally` blocks. | `LOCALLY_VERIFIED` |

**Connection Fail-Closed Rules (`defaultTypeDbConfig` & `createTypeDbDriver` — `DEV_VERIFIED` / `PREVIEW_VERIFIED`):**
- Required env vars on hosted runtimes (`NODE_ENV === "production"`, `VERCEL_ENV` in `{"production", "preview"}`, or `CONVEX_CLOUD_URL` set): `TYPEDB_HTTP_ADDRESS`, `TYPEDB_USERNAME`, `TYPEDB_PASSWORD`, and `TYPEDB_DATABASE`.
- Loopback CE defaults (`http://127.0.0.1:8000`, `admin` / `password`) are allowed **only** on non-hosted loopback development; hosted runtimes or non-loopback addresses with missing credentials or `password === "password"` set `blockedReason` and throw `TypeDbConfigurationError`.
- Server-to-Convex bridge (`resolveConvexCloudBridge` -> `convex/graph.ts` `assertBridgeKey`) requires `NEXT_PUBLIC_CONVEX_URL` (`https://`) and a dedicated `TYPEDB_BRIDGE_SECRET` (`>= 32` chars, distinct from `OPERATIONS_SCHEDULER_SECRET`, `RESEARCH_STAGING_TOKEN`, and `EVIDENCE_CHAT_GATEWAY_SECRET`).

---

## 3. Canonical TypeQL 3 Entity Contracts (`DEV_VERIFIED` on TypeDB Cloud `3.14.2`)

Every entity key uses `@key`. Do **not** reference non-existent attribute names from early Phase G.1 drafts.

| TypeQL Entity | `@key` Attribute | Owned Attributes (`macro-intelligence-schema.tql`) | Subtypes / Notes |
| :--- | :--- | :--- | :--- |
| `organisation` | `org_id` | `legal_name`, `display_name`, `org_subtype_label`, `sec_cik`, `lei_code`, `ticker_symbol`, `incorporation_jurisdiction`, `tenant_owner`, `visibility_scope` | Subtypes (`ORGANISATION_SUBTYPES`): `public_company`, `private_company`, `hyperscaler` (`sub public_company`), `semiconductor_supplier` (`sub public_company`), `specialist_compute_provider`, `ai_laboratory` (`sub private_company`), `utility_provider`, `government_body`. *(Note: `aliases` and `sectorIds` live on Zod `organisationSchema`; sector links project as `sector_participation` relations).* |
| `executive_person` | `person_id` | `full_name`, `display_name`, `affiliated_org_id`, `tenant_owner`, `visibility_scope` | Additive Case 007-B entity (`ADDITIVE_CASE_007_SCHEMA_EXTENSION`, `DEV_VERIFIED` / `PREVIEW_VERIFIED`); plays `leadership_appointment:officer` and `predecessor_officer`. |
| `sector_classification` | `sector_id` | `sector_name`, `industry_group`, `economic_layer` | Plays `sector_participation:target_sector` and `project_dependency:impacted_sector`. |
| `infrastructure_project` | `project_id` | `project_name`, `project_type`, `project_stage`, `planned_capacity_mw` (`double`), `energised_capacity_mw` (`double`), `tenant_owner`, `visibility_scope` | Linked to `geographical_location` via `location_placement`. |
| `financial_instrument` | `instrument_id` | `instrument_type`, `instrument_currency`, `ticker_symbol`, `figi_code` | Zod `figiCode` matches `/^BBG[A-Z0-9]{9}$/` or `null`; `instrumentCurrency` matches `/^[A-Z]{3}$/`. |
| `energy_asset` | `asset_id` | `asset_name`, `energy_source_type`, `nameplate_capacity_mw` (`double`) | Linked to `geographical_location` via `location_placement`. |
| `geographical_location` | `location_id` | `location_name`, `country_code`, `region_or_state`, `municipality`, `grid_zone` | `countryCode` matches ISO-2 `/^[A-Z]{2}$/`. |
| `source_document` | `source_doc_id` | `source_title`, `source_url`, `source_kind`, `source_authority`, `content_sha256`, `publication_basis`, `published_at_ms`, `received_at_ms`, `ingested_at_ms`, `tenant_owner`, `visibility_scope` | Zod enums: `kind` in `['filing', 'company', 'news', 'regulator']`; `authority` in `['primary', 'secondary']`; `publicationBasis` in `['sec_edgar_acceptance', 'exact_utc', 'updated_utc', 'date_upper_bound', 'retrieval_upper_bound']`. |
| `financial_observation` | `observation_id` | `metric_name`, `metric_value` (`double`), `metric_unit`, `currency_code`, `reporting_period_label`, `period_start_ms`, `period_end_ms`, `accounting_basis`, `metric_definition`, `observation_kind`, `published_at_ms`, `received_at_ms`, `tenant_owner`, `visibility_scope` | Zod enums: `metricUnit` in `['currency', 'MW', 'GPU', 'ratio']`; `observationKind` in `['reported', 'derived', 'forecast']`. Linked via `observation_attribution` and `evidential_support`. |

---

## 4. Canonical TypeQL 3 Relation Contracts (`DEV_VERIFIED` on TypeDB Cloud `3.14.2`)

### 4.1 Abstract Super-Relation: `macro_relationship @abstract`

Owned attributes on every concrete `macro_relationship` subtype:
- **Identity & Versioning:** `relationship_id @key`, `logical_event_id`, `relationship_version` (`integer`), `supersedes_relationship_id`, `projection_key`.
- **Classification & Governance:** `relationship_category`, `contractual_status`, `epistemic_status`, `extraction_status`, `reviewer_status`, `reviewed_by`, `conflict_group_id`, `economic_group_id`.
- **Financial & Physical Quantities:** `principal_amount` (`double`), `currency_code`, `capacity_unit` (`MW` | `GPU` | `SHARES` in Zod), `capacity_quantity` (`double`), `conditions_summary`, `binding_obligation` (`boolean`).
- **Temporal & Tenancy:** `effective_from_ms`, `effective_to_ms`, `maturity_at_ms`, `published_at_ms`, `received_at_ms`, `tenant_owner`, `visibility_scope`.
- **Played Roles:** `evidential_support:supported_claim`, `supersession_link:prior_assertion`, `supersession_link:superseding_assertion`.

**Zod Enum Values (`lib/graph/contracts.ts`):**
- `EPISTEMIC_STATUSES`: `'confirmed' | 'reported' | 'proposed' | 'inferred' | 'hypothetical'`
- `CONTRACTUAL_STATUSES`: `'reported_discussion' | 'announced' | 'contingent_signed' | 'signed' | 'funded' | 'cancelled' | 'expired' | 'inferred_architecture'`
- `extractionStatus`: `'verified_primary_filing' | 'verified_company_release' | 'corroborated_secondary_news' | 'inferred_from_filing_context' | 'hypothetical_scenario'`
- `REVIEWER_STATUSES`: `'pending_review' | 'approved' | 'rejected' | 'conflicting_pending_review' | 'quarantined'`
- `VISIBILITY_SCOPES`: `'public_research' | 'private_tenant'`

### 4.2 Concrete `macro_relationship` Subtypes (`MACRO_RELATION_TYPES`)

| Relation Type | Exact `relates` Roles (Allowed Role-Player Entities) | Extra Owned Attributes |
| :--- | :--- | :--- |
| `supply_relationship` | `supplier` (`organisation`), `recipient` (`organisation`), `target_project` (`infrastructure_project`) | — |
| `procurement_relationship` | `buyer` (`organisation`), `vendor` (`organisation`), `target_project` (`infrastructure_project`) | — |
| `financing_arrangement` | `financier` (`organisation`), `borrower` (`organisation`), `issuer` (`organisation`), `arranger` (`organisation`), `target_project` (`infrastructure_project`), `issued_instrument` (`financial_instrument`) | — |
| `guarantee_arrangement` | `guarantor` (`organisation`), `borrower` (`organisation`), `beneficiary` (`organisation`), `target_project` (`infrastructure_project`) | — |
| `ownership_stake` | `owner_entity` (`organisation`), `owned_entity` (`organisation`), `owned_project` (`infrastructure_project`), `held_instrument` (`financial_instrument`) | — |
| `operational_control` | `operator` (`organisation`), `operated_project` (`infrastructure_project`), `operated_energy_asset` (`energy_asset`) | — |
| `leasing_agreement` | `lessor` (`organisation`), `lessee` (`organisation`), `lease_guarantor` (`organisation`), `leased_project` (`infrastructure_project`) | — |
| `project_dependency` | `dependent_project` (`infrastructure_project`), `dependent_organisation` (`organisation`), `prerequisite_project` (`infrastructure_project`), `prerequisite_energy_asset` (`energy_asset`), `impacted_sector` (`sector_classification`), `regulatory_jurisdiction` (`geographical_location`) | — |
| `leadership_appointment` | `governed_organisation` (`organisation`), `officer` (`executive_person`), `predecessor_officer` (`executive_person`) | `executive_title`, `governance_action`, `is_interim` (`boolean`) |

### 4.3 Structural, Attribution & Provenance Relations (Not `sub macro_relationship`)

| Relation Type | `@key` & Owned Attributes | Exact `relates` Roles |
| :--- | :--- | :--- |
| `sector_participation` | `relationship_id @key`, `relationship_version`, `epistemic_status`, `published_at_ms`, `received_at_ms`, `tenant_owner`, `visibility_scope` | `participant_organisation` (`organisation`), `target_sector` (`sector_classification`) |
| `location_placement` | `relationship_id @key` | `located_asset` (`infrastructure_project` \| `energy_asset`), `host_location` (`geographical_location`) |
| `observation_attribution` | `relationship_id @key` | `recorded_observation` (`financial_observation`), `subject_organisation` (`organisation`), `subject_project` (`infrastructure_project`), `counterparty_organisation` (`organisation`) |
| `evidential_support` | `relationship_id @key`, `contractual_status`, `binding_obligation`, `extraction_status`, `reviewer_status`, `received_at_ms` | `supporting_document` (`source_document`), `supported_claim` (`macro_relationship` \| `financial_observation` \| `sector_participation`) |
| `supersession_link` | `relationship_id @key`, `effective_from_ms` | `prior_assertion` (`macro_relationship`), `superseding_assertion` (`macro_relationship`) |

---

## 5. Query Gateway, Provenance Modes & Evidence-Locked Chat Contracts

### 5.1 Allowlisted Graph Queries (`ALLOWLISTED_QUERY_TYPES` — `DEV_VERIFIED` / `PREVIEW_VERIFIED`)
Raw TypeQL queries from clients or agents are rejected. Only these 6 parameter-bound query types exist:
1. `organisation_relationship_summary` (`organisationId`, `maxDepth` `1..2`)
2. `project_dependency_network` (`projectId`, `maxDepth` `1..2`)
3. `shared_counterparty_exposure` (`organisationId`)
4. `sector_connections` (`sectorId`)
5. `as_known_at_date_graph` (`asOfMs`, `temporalBasis`: `'receipt' | 'publication'`, optional `organisationId` / `projectId`)
6. `relationship_source_evidence` (`relationshipId`)

**Bounds:** `maxDepth` `1..2` (default `2`), `maxNodes` `1..50` (default `25`), `maxEdges` `1..100` (default `50`), process-local burst limiter `60` req / `60s` per `callerId` (`checkGraphGatewayRateLimit` — process-local per warm instance; shared per-owner turn/cost ceilings live in Convex `chatBudgetReservations`).

### 5.2 Graph Provenance Modes (`GRAPH_SOURCE_MODES`)
- **`LIVE_GRAPH`**: Returned **only** when `hydrateMacroDatasetFromLiveTypeDb` succeeds (`backendMode = "typedb_live"`) **and** `executeReadOnlyTypeQlOnLiveServer` succeeds (`DEV_VERIFIED` & `PREVIEW_VERIFIED` on `/data-room` and `/` RSC payload at `3222376`; interactive signed-in Clerk/Vercel SSO browser UI check pending owner session).
- **`HISTORICAL_MIRROR`**: Returned only when `requireLiveGraph` is `false` and static/mirror datasets are explicitly permitted.
- **`GRAPH_UNAVAILABLE`**: Returned when `requireLiveGraph: true` and TypeDB is unreachable or uninitialised (`nodes: []`, `edges: []`, `observations: []`; `DEV_VERIFIED` & `PREVIEW_VERIFIED` via controlled `TYPEDB_BRIDGE_SECRET` rotation on `/data-room?focal=org-nvda` and `/`). If TypeDB is reachable but schema version or concept hydration is corrupt, `TypeDbSchemaOrHydrationError` fails closed.

### 5.3 Evidence-Locked Chat (`lib/graph/evidence-chat-contracts.ts` & `evidence-answer-validator.ts`)
- **Retrieval & Cost Ceilings (`EVIDENCE_RETRIEVAL_LIMITS`, `DEV_VERIFIED` / `PREVIEW_VERIFIED`):** `maxTraversalDepth: 2`, `maxRelationships: 25` (selecting `<= 25` out of `30` stored / `28` active non-superseded / `27` 2-hop `org-nvda` focal-reachable Case 007-B edges), `maxEvidenceDocuments: 15` (selecting `<= 15` out of `16` stored Case 007-B sources), `maxExcerptCharsPerDoc: 600`, `maxTotalInputTokens: 6000`, `maxRequestDurationMs: 15000`, `maxRequestCostGbp: 0.05`, `defaultDailyBudgetCeilingGbp: 2.0`.
- **Integer Micro-GBP Accounting (`DEV_VERIFIED`):** `ACCOUNTING_UNITS_PER_GBP = 1_000_000` (`£0.000001`). Charges round **up** (`costToAccountingUnits` via `Math.ceil`), ceilings round **down** (`ceilingToAccountingUnits` via `Math.floor`).
- **Bundle & Answer Binding (`DEV_VERIFIED` / `PREVIEW_VERIFIED`):** `EvidenceLockedAnswer` (`evidence-locked-answer-g4-v1`) binds `bundleId` + `bundleSha256`, enforces `executionAuthority: "none"`, tags every claim with `distinction` (`source_fact` | `deterministic_arithmetic` | `modelled_scenario` | `reported_unverified` | `interpretation`), and sets `supportStatus` (`fully_supported` | `partially_supported` | `unsupported`).
- **9 Independent Validator Checks (`answerValidationCheckSchema`, `DEV_VERIFIED` / `PREVIEW_VERIFIED`):** `schema_valid`, `bundle_hash_bound`, `evidence_ids_in_bundle`, `relationship_ids_in_bundle`, `historical_cutoff_respected`, `numerical_claims_verified`, `deterministic_arithmetic_verified`, `no_private_or_broker_leakage`, `no_prompt_injection_override`.
- **Diagnostic Length Invariant (`B-001`, `DEV_VERIFIED` / `PREVIEW_VERIFIED` at `3222376`):** Every `checks[i].detail` is capped at `z.string().max(500)` in Zod; validator formatters truncate client-facing `detail` to `<= 480` chars with JWT/API-key redaction while logging up to `3,800` chars server-side via `logProtectedValidatorDiagnostics`.

---

## 6. Convex Durability, Outbox & Quarantine Tables (`convex/schema.ts`)

| Convex Table | Role in Graph & Evidence Pipeline | Verification Status |
| :--- | :--- | :--- |
| `researchStagingItems` | Restricted staging intake (`validationStatus`, `contentSha256`, `publishedAt`, `receivedAt`, `promotedEvidenceIds`, `quarantinedAt`, `quarantineId`, `executionAuthority: "none"`). | `DEV_VERIFIED` (`7` invalid items quarantined on `dev:prestigious-dragon-8`, `0` deleted); `PRODUCTION_VERIFIED` (base schema only; Prod quarantine pending) |
| `evidence` | Promoted flat metric records (`status`: `'reported' | 'estimated' | 'measured'`, `quarantinedAt`, `quarantineId`, `supersedes`). | `DEV_VERIFIED` (`8` rows incl. forward-frozen orphan quarantined on `dev:prestigious-dragon-8`); `PRODUCTION_VERIFIED` (base schema only) |
| `evidenceQuarantines` | Append-only quarantine ledger (`quarantineKey`, `stagingItemId`, `evidenceIds`, `affectedBriefingIds`, `affectedForwardEventIds`, `affectedExperimentIds`, `affectedForecastIds`, `affectedBriefingFactIds`, `reasonCode`, `claimedJson`, `expectedJson`). | `DEV_VERIFIED` (`7` ledger rows + `affectedExperimentIds`/`affectedForecastIds` verified on `dev:prestigious-dragon-8` at `3222376`) |
| `graphRelationshipReviews` | Human `reviewer` approval/rejection audit log (`decision`, `reviewer`, `sourceEvidenceIds`, `sourceDocumentApproved`, `promotedOutboxId`, `projectionKey`). | `DEV_VERIFIED` (deployed on `dev:prestigious-dragon-8` at `3222376`; unseen-issuer dynamic staged-source E2E `LOCALLY_VERIFIED`) |
| `graphProjectionOutbox` | Append-only TypeDB projection queue (`sequence`, `projectionKey`, `payloadJson`, `typeqlJson`, `status`: `'pending' | 'retrying' | 'projected' | 'dead_letter'`, `attemptCount`, `maxAttempts`, `nextAttemptAtMs`). | `DEV_VERIFIED` (`30` Case 007-A/B rows `projected` on `dev:prestigious-dragon-8`; unseen-issuer prerequisite bundle `LOCALLY_VERIFIED`) |
| `graphProjectionCheckpoints` | Per-owner sequence & staleness tracker (`lastProjectedSequence`, `projectedCount`, `pendingCount`, `retryingCount`, `deadLetterCount`, `maxProjectionLagMs` with `15`-min staleness threshold). | `DEV_VERIFIED` |
| `graphQueryAudit` | Read-only gateway audit (`queryType`, `asOfMs`, `nodeCount`, `edgeCount`, `backendMode`, `latencyMs`). | `DEV_VERIFIED` / `PREVIEW_VERIFIED` |
| `evidenceChatAudit` & `chatBudgetReservations` | Full immutable bundle/answer/validation audit trail and pre-call atomic micro-GBP cost reservations. | `DEV_VERIFIED` / `PREVIEW_VERIFIED` |

---

## 7. Reconciliation with Legacy `docs/graph-*.md` Files

Early Phase G.1 markdown files in `docs/` contain pre-implementation draft names that **must not** be copied into new TypeQL or TypeScript code:

| Legacy File | Stale Draft Term in `docs/` | Actual Implemented Contract in Code |
| :--- | :--- | :--- |
| `docs/graph-schema-and-identity.md` | `energy_asset_id`, `source_tier`, `canonical_url`, `content_hash`, `confidence_score`, `projection_key @unique`, `alias_name @card(0..)` | `asset_id`, `source_authority` + `source_kind`, `source_url`, `content_sha256`, no `confidence_score`, `owns projection_key` (unkeyed string; uniqueness enforced in Convex `by_projection_key`), `aliases` in Zod `organisationSchema`. |
| `docs/graph-schema-and-identity.md` | Roles `customer`, `lead_arranger`, `instrument_used`, `backed_project`, `parent_entity`/`subsidiary_entity`, `member_organisation`/`classified_sector`, `supporting_source`, `superseding_claim`/`superseded_claim` | Actual roles: `recipient`, `arranger`, `issued_instrument`, `target_project`, `owner_entity`/`owned_entity`/`owned_project`/`held_instrument`, `participant_organisation`/`target_sector`, `supporting_document`/`supported_claim`, `superseding_assertion`/`prior_assertion`; plus `executive_person` & `leadership_appointment`. |
| `docs/graph-architecture.md` | `TYPEDB_HTTP_URL` and silent mirror fallback on live views | `TYPEDB_HTTP_ADDRESS` (`lib/graph/typedb-driver-adapter.ts`); live views set `requireLiveGraph: true` and fail closed to `GRAPH_UNAVAILABLE`. |
| `docs/graph-ingestion-protocol.md` | Retry formula `min(2000 * 2^(attempt - 1), 300000)` | `computeRetryBackoffMs` (`lib/graph/projection-engine.ts`) uses `5000 * 2^min(max(0, attemptCount - 1), 6)` (`5s`..`320s`). |
