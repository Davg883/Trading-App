# Phase G.1: Macro Intelligence Graph — Initial Acceptance Dataset Provenance

Dataset Version: `macro-graph-dataset-g1-v1`
Schema Version: `macro-intelligence-graph-3.14-v1`

This document records the authoritative identifier resolution, source provenance, temporal timestamps, and epistemic classifications for every entity and relationship in `data/graph/initial-acceptance-dataset.json`.

---

## 1. Core Six SEC-Reporting Companies & Counterparty Registry

| Internal ID | Legal Name | Ticker | SEC CIK | LEI | Subtype | Primary Sector |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `org-msft` | Microsoft Corporation | `MSFT` | `0000789019` | `INR2EJN1ERAN0W5ZP974` | `hyperscaler` | `sec-cloud-hyperscalers` |
| `org-googl` | Alphabet Inc. | `GOOGL` | `0001652044` | `5493006MHB84DD0ZWV18` | `hyperscaler` | `sec-cloud-hyperscalers` |
| `org-amzn` | Amazon.com, Inc. | `AMZN` | `0001018724` | `ZXTILKJKG63JELOEG630` | `hyperscaler` | `sec-cloud-hyperscalers` |
| `org-nvda` | NVIDIA Corporation | `NVDA` | `0001045810` | `549300S4KLFTLO7GSQ80` | `semiconductor_supplier` | `sec-ai-semiconductors` |
| `org-intc` | Intel Corporation | `INTC` | `0000050863` | `KNX4USFC9V2296P82J66` | `semiconductor_supplier` | `sec-ai-semiconductors` |
| `org-crwv` | CoreWeave, Inc. | `CRWV` | `0002046517` | — | `specialist_compute_provider` | `sec-specialist-neoclouds` |
| `org-nscale` | Nscale Holdings Inc. | — | `0002110365` | — | `specialist_compute_provider` | `sec-specialist-neoclouds` |
| `org-apld` | Applied Digital Corporation | `APLD` | `0001144879` | — | `specialist_compute_provider` | `sec-specialist-neoclouds` |
| `org-wulf` | TeraWulf Inc. | `WULF` | `0001083301` | — | `specialist_compute_provider` | `sec-specialist-neoclouds` |
| `org-orcl` | Oracle Corporation | `ORCL` | `0001341439` | — | `hyperscaler` | `sec-cloud-hyperscalers` |
| `org-anthropic` | Anthropic PBC | — | — | — | `ai_laboratory` | `sec-frontier-ai-labs` |
| `org-unnamed-ig-hyperscaler` | Disclosed Investment-Grade Hyperscaler Tenant (Unnamed in Form 8-K) | — | — | — | `hyperscaler` | `sec-cloud-hyperscalers` |

---

## 2. Documented Relationships & Source Evidence

| Relationship ID | Type | Participants & Roles | Status / Epistemic Label | Principal / Capacity | Source ID(s) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `rel-anthropic-monarch-services-r1` | `procurement_relationship` | `buyer`: `org-anthropic`, `vendor`: `org-nscale`, `target_project`: `proj-monarch-wv` | `signed` / `confirmed` | `$44.6B USD` (TCV cap) | `nscale-s1-sep18` |
| `rel-monarch-credit-talks-r1` | `guarantee_arrangement` (4-ary) | `guarantor`: `org-nvda`, `borrower`: `org-nscale`, `beneficiary`: `org-anthropic`, `target_project`: `proj-monarch-wv` | `reported_discussion` / `reported` | `null` (undisclosed) | `reuters-credit-oct30` |
| `rel-ward-county-guarantee-r1` | `guarantee_arrangement` (4-ary) | `guarantor`: `org-nvda`, `borrower`: `org-nscale`, `beneficiary`: `org-ward-lessor`, `target_project`: `proj-ward-county-texas` | `signed` / `confirmed` | `$860.3M USD` | `nscale-s1-sep18` |
| `rel-nscale-nvda-convertible-r1` | `financing_arrangement` (5-ary) | `financier`: `org-nvda`, `borrower`: `org-nscale`, `issuer`: `org-nscale`, `target_project`: `proj-nscale-corporate-financing`, `issued_instrument`: `inst-nscale-conv-note-2026` | `signed` / `confirmed` | `$1.0B USD` | `nscale-s1-sep18` |
| `rel-loughton-msft-r1` | `procurement_relationship` | `buyer`: `org-msft`, `vendor`: `org-nscale`, `target_project`: `proj-loughton-essex` | `announced` / `reported` (v1) | `50 MW` (planned) | `nscale-loughton-sep2025` |
| `rel-loughton-msft-r2` | `procurement_relationship` | `buyer`: `org-msft`, `vendor`: `org-nscale`, `target_project`: `proj-loughton-essex` | `cancelled` / `reported` (v2, supersedes v1) | `50 MW` (terminated) | `nscale-loughton-sep2025`, `reuters-loughton-oct19` |
| `rel-nvda-nscale-gpu-arch` | `supply_relationship` | `supplier`: `org-nvda`, `recipient`: `org-nscale`, `target_project`: `proj-monarch-wv` | `inferred_architecture` / `inferred` | `null` | `nscale-s1-sep18` |
| `rel-crwv-apld-polaris1-lease` | `leasing_agreement` | `lessor`: `org-apld`, `lessee`: `org-crwv`, `leased_project`: `proj-polaris-forge-1-nd` | `signed` / `confirmed` | `400 MW` | `apld-8k-2026-10-07` |
| `rel-polaris1-grid-dependency` | `project_dependency` | `dependent_project`: `proj-polaris-forge-1-nd`, `dependent_organisation`: `org-crwv`, `prerequisite_energy_asset`: `asset-ellendale-substation`, `impacted_sector`: `sec-specialist-neoclouds` | `signed` / `confirmed` | `400 MW` | `apld-8k-2026-10-07` |
| `rel-polaris-forge-2-filing` | `leasing_agreement` | `lessor`: `org-apld`, `lessee`: `org-unnamed-ig-hyperscaler`, `leased_project`: `proj-polaris-forge-2-nd` | `announced` / `confirmed` (`conflicting_pending_review`) | `300 MW` | `apld-8k-2026-10-07` |
| `rel-polaris-forge-2-press` | `leasing_agreement` | `lessor`: `org-apld`, `lessee`: `org-orcl`, `leased_project`: `proj-polaris-forge-2-nd` | `reported_discussion` / `reported` (`conflicting_pending_review`) | `300 MW` | `press-polaris-forge-2-tenant` |
| `rel-amzn-wilmington-zoning-dep` | `project_dependency` | `dependent_project`: `proj-aws-wilmington-oh`, `dependent_organisation`: `org-amzn`, `regulatory_jurisdiction`: `loc-wilmington-oh`, `impacted_sector`: `sec-cloud-hyperscalers` | `reported_discussion` / `reported` | `null` | `wyso-wilmington-court` |
| `rel-wulf-ny-eo62-dep` | `project_dependency` | `dependent_project`: `proj-lake-mariner-ny`, `dependent_organisation`: `org-wulf`, `prerequisite_energy_asset`: `asset-somerset-hydro-interconnect`, `regulatory_jurisdiction`: `loc-somerset-ny`, `impacted_sector`: `sec-specialist-neoclouds` | `signed` / `confirmed` | `50 MW` (moratorium threshold) | `ny-eo62` |
| `rel-intc-ohio-one-control` | `operational_control` | `operator`: `org-intc`, `operated_project`: `proj-intel-ohio-one` | `signed` / `confirmed` | `null` | `intc-10q-q3-2026` |
