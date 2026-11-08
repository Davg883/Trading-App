# AI Capital Intelligence — Phase G.1: TypeQL 3 Schema & Canonical Identity Governance

## 1. Schema Overview (`macro-intelligence-graph-3.14-v1`)

The canonical TypeQL 3.14 schema is defined in [`data/graph/macro-intelligence-schema.tql`](../data/graph/macro-intelligence-schema.tql) and compiled by [`lib/graph/typedb-schema.ts`](../lib/graph/typedb-schema.ts).

### 1.1 Canonical Entity Hierarchy

| Entity Type | Key Attribute (`@key`) | Subtypes / Cardinality | Played Relation Roles |
|---|---|---|---|
| `organisation` | `org_id` | `organisation_subtype` (`public_company`, `private_company`, `ai_laboratory`, `hyperscaler`, `sovereign_entity`, `regulator`, `utility_operator`, `financial_sponsor`, `undisclosed_counterparty`); `sec_cik` (`0..1`), `lei_code` (`0..1`), `alias_name @card(0..)` | `supplier`, `customer`, `buyer`, `vendor`, `financier`, `borrower`, `issuer`, `lead_arranger`, `guarantor`, `beneficiary`, `parent_entity`, `subsidiary_entity`, `operator_entity`, `lessor`, `lessee`, `dependent_entity`, `dependency_provider`, `member_organisation` |
| `sector_classification` | `sector_id` | `sector_name`, `taxonomy_standard` (`ACI-Macro-2026`, `GICS`, `NAICS`) | `classified_sector` |
| `infrastructure_project` | `project_id` | `project_name`, `project_type`, `project_stage`, `planned_capacity_mw`, `energised_capacity_mw` | `target_project`, `backed_project`, `controlled_asset`, `leased_asset`, `dependent_entity`, `dependency_provider`, `located_subject` |
| `financial_instrument` | `instrument_id` | `instrument_type` (`convertible_note`, `delayed_draw_term_loan`, `lease_backstop_guarantee`, `project_debt_facility`, `equity_tranche`), `principal_amount`, `currency`, `maturity_date` | `instrument_used` |
| `energy_asset` | `energy_asset_id` | `energy_asset_type`, `nameplate_mw`, `grid_region` (`PJM`, `MISO`, `ERCOT`, `NYISO`, `NationalGrid-UK`) | `supplied_asset`, `controlled_asset`, `leased_asset`, `dependent_entity`, `dependency_provider`, `located_subject` |
| `geographical_location` | `location_id` | `country_code`, `region_code`, `grid_region` | `host_location` |
| `source_document` | `source_doc_id` | `source_tier` (`primary_filing`, `official_release`, `corroborated_news`, `unverified_secondary`), `canonical_url`, `content_hash`, `published_at_ms`, `received_at_ms` | `supporting_source` |
| `financial_observation` | `observation_id` | `metric_name`, `metric_value`, `metric_unit`, `period_label`, `published_at_ms`, `received_at_ms` | `observed_metric`, `supported_claim` |

---

## 2. Typed N-ary Hyperedge Relationships

Unlike binary property graphs that force artificial intermediate nodes or lossy edge splitting, TypeDB 3.14 natively models multi-participant (>2 role-player) financial contracts as typed relations inheriting from `relation macro_relationship @abstract`:

| Relation Type | Typed Roles (`relates`) | Example N-ary Usage in Initial Acceptance Dataset |
|---|---|---|
| `supply_relationship` | `supplier`, `customer`, `target_project`, `supplied_asset` | `rel-monarch-gpu-supply-r1`: NVIDIA (`supplier`) + Nscale (`customer`) + Monarch WV Campus (`target_project`) |
| `procurement_relationship` | `buyer`, `vendor`, `target_project` | `rel-loughton-msft-r1` / `rel-loughton-msft-r2` (superseded v1 → v2) & `rel-anthropic-google-tpu-r1` |
| `financing_arrangement` | `financier`, `borrower`, `issuer`, `lead_arranger`, `target_project`, `instrument_used` | `rel-nscale-nvda-convertible-r1` (**5 participants**): NVIDIA (`financier`), Nscale (`borrower`), Nscale (`issuer`), Monarch WV (`target_project`), USD 865M Convertible Note (`instrument_used`) |
| `guarantee_arrangement` | `guarantor`, `borrower`, `beneficiary`, `backed_project`, `instrument_used` | `rel-ward-county-guarantee-r1` (**4 participants**): NVIDIA (`guarantor`), Nscale (`borrower`), Ward County Landlord SPV (`beneficiary`), Ward County Campus (`backed_project`) |
| `ownership_stake` | `parent_entity`, `subsidiary_entity` | Parent-subsidiary & project SPV equity stakes |
| `operational_control` | `operator_entity`, `controlled_asset`, `host_location` | Campus operator to energy asset and grid region |
| `leasing_agreement` | `lessor`, `lessee`, `leased_asset`, `target_project` | `rel-polaris-forge-1-crwv-r1` (Applied Digital + CoreWeave + Polaris Forge 1) & conflicting Polaris Forge 2 claims |
| `project_dependency` | `dependent_entity`, `dependency_provider`, `host_location` | `rel-polaris-forge-1-grid-r1` (Polaris Forge 1 → Ellendale 400 MW Substation) & `rel-cayuga-ny-eo62-r1` (Cayuga NY → NY DEC EO 62) |
| `sector_participation` | `member_organisation`, `classified_sector` | Links organisations to `ACI-Macro-2026` sectors |
| `evidential_support` | `supporting_source`, `supported_claim`, `observed_metric` | Binds every `macro_relationship` and `financial_observation` to immutable `source_document` entities |
| `supersession_link` | `superseding_claim`, `superseded_claim` | Non-destructive version lineage (`rel-loughton-msft-r2` supersedes `rel-loughton-msft-r1`) |

### 2.1 Mandatory Provenance & Temporal Attributes on Every `macro_relationship`
Every `macro_relationship` owns:
- `relationship_id @key`
- `projection_key @unique` (SHA-256 over owner, visibility, schema version, relationship ID, version, participants, sources, and timestamps)
- `relationship_version` (integer `1, 2, ...`)
- `contractual_status` (`announced`, `proposed`, `in_negotiation`, `signed`, `active`, `delayed`, `cancelled`, `superseded`, `expired`)
- `epistemic_status` (`confirmed`, `reported`, `proposed`, `inferred`, `hypothetical`)
- `confidence_score` (`0.0` – `1.0`)
- `effective_start_date`, `effective_end_date`
- `published_at_ms`, `received_at_ms`
- `reviewer_status` (`approved`, `conflicting_pending_review`, `quarantined`)
- `visibility_scope` (`public_research`, `private_tenant`)
- `owner_id` (Clerk `tokenIdentifier` or `public`)
- `execution_authority` (always `"none"`)

---

## 3. Canonical Identity & Evidence Governance ([`lib/graph/identity-governance.ts`](../lib/graph/identity-governance.ts))

1. **Authoritative Identifier Priority (`resolveCanonicalOrganisation`)**:
   - **Priority 1**: Exact 10-digit zero-padded SEC CIK (`sec_cik`).
   - **Priority 2**: Exact 20-character ISO 17442 LEI (`lei_code`).
   - **Priority 3**: Exact registered legal name or verified SEC filing alias (`alias_name`).
2. **Strict Prohibition on Fuzzy Name Merging**:
   - If a candidate entity shares tokens with an existing organisation (e.g. `"CoreWeave Cloud Holdings LLC"` vs `"CoreWeave, Inc."`) without a matching SEC CIK or LEI, `resolveCanonicalOrganisation` returns `status: "blocked_fuzzy_name_only"` and forbids automatic merging.
3. **Primary Evidence Gate for Confirmed Contracts (`validateRelationshipGovernance`)**:
   - Relationships with `contractualStatus` in `{"signed", "active"}` or `epistemicStatus === "confirmed"` **must** be backed by at least one `primary_filing` or `official_release` source document. Secondary news speculation (`corroborated_news` / `unverified_secondary`) cannot be promoted to `confirmed` or `signed`.
4. **Non-Destructive Conflict Recording**:
   - When two disclosures conflict (e.g. Applied Digital’s Form 8-K disclosing an `"Unnamed US Investment-Grade Hyperscaler"` vs secondary press naming `"Oracle Corporation"` on Polaris Forge 2), both assertions are stored with shared `conflictGroupId: "conflict-polaris-forge-2-tenant"` and surfaced side-by-side.
5. **Non-Destructive Supersession & Point-in-Time Reconstruction (`reconstructGraphRelationshipsAtDate`)**:
   - When a relationship is amended or cancelled (e.g., `rel-loughton-msft-r2` cancelling `rel-loughton-msft-r1`), `v1` is never deleted. Point-in-time queries (`asOfMs`) reconstruct the exact state known at `asOfMs` under either `receipt` eligibility (`publishedAtMs <= asOfMs && receivedAtMs <= asOfMs`) or `publication` eligibility (`publishedAtMs <= asOfMs`).
