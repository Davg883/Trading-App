# ACI Permanent Source-to-Dashboard & Research-Answer Acceptance Requirements

**Skill Version:** `1.1.0`

Every graph, ingestion, quarantine, Evidence-Locked Chat, or dashboard alignment change must pass the permanent verification gates and regression scenarios documented below before any shared Development write or Preview deployment is proposed.

---

## 1. Current Verification Baseline & Open Release Blockers

| Capability / Environment | Current Status | Notes & Open Blockers |
| :--- | :---: | :--- |
| **RC002 Local Remediations (`B-001`–`B-005`, `c6c1a62..f43c313`)** | `LOCALLY_VERIFIED` | Passed all 7 CLI gates, disposable local TypeDB `3.14.2` (`ANET` unseen ingestion), local `dev:prestigious-dragon-8` backup quarantine dry run, and local `293/300` investor rubric. **Blocker 1:** Not yet deployed or re-scored on shared Convex Development, `aci_case007b_verified_dev` (`21 -> 24` obs), or Vercel Preview. |
| **Case 007-A / 007-B Graph (`bd38833`)** | `DEV_VERIFIED` / `PREVIEW_VERIFIED` | `aci_case007_verified_dev` (`20` rels, `4` obs) and `aci_case007b_verified_dev` (`27` rels, `21` obs) verified on TypeDB Cloud + `/data-room` Preview (`LIVE_GRAPH` + disconnect -> `GRAPH_UNAVAILABLE`). |
| **Production (`main` `639a2ed`, `prod:benevolent-magpie-921`)** | **NO-GO** (`PRODUCTION_VERIFIED` for Clerk auth & `executionAuthority: "none"` only) | **Blocker 2:** Read-only audit confirmed `7` active invalid SEC/XBRL staging items, `8` active contaminated `evidence` rows (incl. forward-frozen orphan `ms71z2vm0nhq2850kvr3pym65s8hr3wb`), `9` contaminated `morningBriefings` (unattended daily cron still active on `2026-11-18`), and `4` contaminated forward-study rows. |

---

## 2. Mandatory Pre-Deployment Command Gates (`LOCALLY_VERIFIED`)

Run all 7 commands from the repository root:

1. `npm run convex:fingerprint` — Verify `convex/deploymentFingerprint.ts` matches `sourceSha256` across all Convex files.
2. `npm run typecheck` — `tsc --noEmit` must exit `0` (`0` errors).
3. `npm run lint:baseline` — `node scripts/eslint-baseline-check.mjs` must report `0` ESLint errors and zero new warnings above baseline.
4. `npm run test:python` — `python -m unittest discover -s worker -p test_*.py` must pass (`worker/test_graph_projection.py`, `worker/test_remote_research.py`, etc.).
5. `npm test` — `vitest run` must pass all active suites (`0` failures), including the 7 permanent regression suites in Section 5.
6. `npm run build` — Full production `next build` must compile cleanly.
7. `npm run check:server-bundle` — `node scripts/check-server-bundle-client-refs.mjs` must report `SERVER BUNDLE CHECK PASS` across all server API routes, including `/api/graph/chat` claim-validation markers.

---

## 3. Mandatory 5-Point `LIVE_GRAPH` Acceptance Gate

Before claiming `DEV_VERIFIED` or `PREVIEW_VERIFIED` live TypeDB graph status in any deployed environment:

1. **True Hydration Only:** Verify `graphSourceMode === "LIVE_GRAPH"` and `backendMode === "typedb_live"` occur **only** when nodes, edges, and observations are hydrated from live TypeDB `3.14.2` concept rows (`hydrateMacroDatasetFromLiveTypeDb`) and `executeReadOnlyTypeQlOnLiveServer` succeeds.
2. **Zero Silent Static Fallback:** Prove `data/graph/initial-acceptance-dataset.json` (`Macro Case 001`) cannot populate or merge into a response labelled `LIVE_GRAPH`.
3. **Independent Read-Back Reconciliation:** Compare UI/gateway values (e.g. relationship `principalAmount`, `contractualStatus`, observation `metricValue`) against an independent read-only TypeQL query against the target database.
4. **Controlled Disconnect / Invalid-Credential Test:** Invalidate bridge/TypeDB access under `requireLiveGraph: true` and verify both `/` and `/data-room` render `GRAPH_UNAVAILABLE` (or `HISTORICAL_MIRROR` only where `requireLiveGraph: false`), **never** `LIVE_GRAPH`.
5. **Credential-Free Provenance Record:** Record target database name, UTC query timestamp, TypeDB server version (`3.14.2`), returned concept/answer counts, and `graphSourceMode` without printing passwords, tokens, or personal Clerk IDs.

---

## 4. Permanent Investor Usefulness Rubric (`10`-Probe Benchmark)

Any change to `lib/graph/evidence-retrieval-gateway.ts`, `lib/graph/question-aware-evidence-synthesis.ts`, `lib/graph/gemini-provider-adapter.ts`, or `lib/graph/evidence-answer-validator.ts` must be evaluated against the 10-probe investor benchmark across 6 dimensions (`0–5` each, max `30`):

- **Scoring Dimensions:** (1) Factual Accuracy, (2) Primary-Source Grounding, (3) Question Relevance, (4) Material Completeness, (5) Fact vs Forecast/Interpretation Separation, (6) Institutional Decision Usefulness.
- **Pass Thresholds & Live Re-Scoring Rule:**
  - Every answerable in-scope probe (`Q1`, `Q1b`, `Q2`, `Q3`, `Q4`, `Q5`, `Q5b`, `Q6`) must score **`>= 24/30`** with `validator.valid === true`, `0` HTTP 500 / `ZodError` exceptions, and `executionAuthority === "none"`.
  - Every out-of-scope or within-scope undisclosed probe (`Q7`, `Q7b`) must return `supportStatus === "unsupported"`, `supportingClaims.length === 0`, and explicit `missingInformation` / `abstentionReason` without citing legacy `"Macro Case 001"` boilerplate.
  - Legacy 50-question G7.1 financial-integrity chat benchmark (`tests/phase-g7-1-financial-integrity-and-g8-pilot.test.ts`) must remain `50/50` passing.
  - **Never carry forward a `LOCALLY_VERIFIED` score as a `PREVIEW_VERIFIED` result:** the full 10-probe scorecard must be re-executed against deployed Preview + live TypeDB database after promotion.

---

## 5. The 7 Permanent Regression Scenarios

Never delete, skip, or weaken assertions covering these 7 historical failure modes:

### Scenario 1 — NVIDIA Case 007-A (Pre-Earnings) & Case 007-B (Post-Earnings) Intelligence (`DEV_VERIFIED` `21` obs / `LOCALLY_VERIFIED` `24` obs)
- **Suites:** [case-007-nvidia-typedb.test.ts](../../../../tests/case-007-nvidia-typedb.test.ts), [rc002-evidence-chat-integrity.test.ts](../../../../tests/rc002-evidence-chat-integrity.test.ts), [rc002-dashboard-alignment.test.ts](../../../../tests/rc002-dashboard-alignment.test.ts).
- **Required Proofs:**
  - Exact primary-filing provenance across `15` SEC/IR sources (`0001045810-26-000073`, `13F-HR`, `SC 13G`, `0001045810-26-000083`, `0001045810-26-000088` `EX-99.1`/`99.2`/`99.3`), `27` relationships, and `24` observations (`$115,844M` Q3 rev, `74.8%` GAAP GM, `$43,777M` FCF, `$4,422M` capex, `$518.0B` direct commitments, `36%` top-3 customer rev share, `35%` top-2 AR share, `$130.0B +/- 3%` Q4 outlook).
  - Proposed/IPO-contingent Anthropic Class N placements (`~$10B` / `~$5B`) remain `proposed` / `contingent_signed`, never completed ownership.
  - Three-class separation preserved between `$518.0B` direct commitments + `$25.0B` funded notes, `$32.0B` contingent neocloud cap (`bindingObligation: false`), and `$118.0B` max gross guarantee cap (`$105.0B` SB Energy / OpenAI Ohio lease guarantee, `$0` paid).
  - Leadership transition (`executive_person` + `leadership_appointment`: Jensen Huang resignation `2026-11-11`, Colette Kress Interim CEO + CFO, Harvey C. Jones Board Chair) and ongoing board committee investigation risk surfaced accurately (`Q4` `partially_supported` because investigation scope is undisclosed).

### Scenario 2 — The 7 Invalid SEC/XBRL Disclosures (`B-003`, `LOCALLY_VERIFIED` — Cloud Execution Pending)
- **Suites:** [rc002-xbrl-quarantine-remediation.test.ts](../../../../tests/rc002-xbrl-quarantine-remediation.test.ts), [sprint-g9-2-research-integrity.test.ts](../../../../tests/sprint-g9-2-research-integrity.test.ts), [phase-g7-1-sec-xbrl-and-thesis-gate.test.ts](../../../../tests/phase-g7-1-sec-xbrl-and-thesis-gate.test.ts).
- **Required Proofs:**
  - Deterministic rejection on ingestion **and** non-destructive quarantine discovery across both Development and Production `externalId`s for all 7 historical misattributions:
    1. `NVDA` `10-Q` `0001045810-26-000075` (`staged-7f5da1f3fb6a672d`, obsolete Q2 2020 `$0.37B` capex)
    2. `NVDA` `8-K` `0001045810-26-000078` (`staged-e2523ed83a7c0247`, comparative `$0.24B` / `$1.07B` capex on Item `8.01` M&A 8-K; claim-level policy blocks XBRL capex while allowing SHA-256-verified Item `8.01` pending M&A as `proposed`/`contingent_signed`)
    3. `AMZN` `10-Q` `0001018724-26-000040` (`staged-dcf44b009199d49a`, obsolete Q1 2017 `$4.9B` capex)
    4. `GOOGL` `8-K` `0001193125-26-449835` (`staged-98c25c92c7ca82e7`, non-periodic 8-K `$63.6B` comparative capex)
    5. `MSFT` `8-K` `0001193125-26-448357` (`staged-c135441d25ee1df9`, non-periodic 8-K `$19.39B` comparative capex)
    6. `INTC` `10-Q` `0000050863-26-000191` (`staged-adfd0a710e5538b2` Dev / `staged-84349400e88f3423` Prod, 9M YTD `$11.16B` mislabelled as single-quarter Q3)
    7. `AMD` `10-Q` `0000002488-26-000191` (`staged-39bf33eb27445eee` Dev / `staged-e28936b38824c3e3` Prod, 9M YTD `$0.75B` mislabelled as single-quarter Q3)

### Scenario 3 — Orphaned Forward-Frozen Evidence & Downstream Study Invalidation (`LOCALLY_VERIFIED`)
- **Suite:** [rc002-xbrl-quarantine-remediation.test.ts](../../../../tests/rc002-xbrl-quarantine-remediation.test.ts).
- **Required Proofs:**
  - Quarantine discovery catches forward-frozen `evidence` rows not referenced in `researchStagingItems.promotedEvidenceIds` (`md7ah8t1nmryeqt0c06wjq9c6x8hpgsb` in Dev / `ms71z2vm0nhq2850kvr3pym65s8hr3wb` in Prod, `$1.07B` NVDA `sec_xbrl_primary_disclosure`).
  - Dependent `morningBriefings`, `forwardResearchEvents` (`forward-004-nvda-qqq-5d-2026-11-05`), `experiments`, and `forecasts` are recorded on `evidenceQuarantines`, flagged/withheld in `operations:overview` and `research:dashboard`, and `rowsDeletedCount === 0`.

### Scenario 4 — Synthetic Macro Case 001 Leakage Prevention (`B-002`, `B-004`, `B-005`, `LOCALLY_VERIFIED`)
- **Suites:** [rc002-dashboard-alignment.test.ts](../../../../tests/rc002-dashboard-alignment.test.ts), [rc002-unseen-filing-ingestion.test.ts](../../../../tests/rc002-unseen-filing-ingestion.test.ts), [rc002-evidence-chat-integrity.test.ts](../../../../tests/rc002-evidence-chat-integrity.test.ts).
- **Required Proofs:**
  - `syncAndVerifyTypeDbCloud` never bootstraps `MACRO_CASE_001` into target TypeDB databases.
  - NVIDIA views on `/` and `/data-room` and Evidence Chat answers (`Q1`–`Q7b`, including `Q5b` shared-counterparty routing) contain zero synthetic Case 001 strings (`Nscale`, `Loughton`, `EirGrid`, `Monarch`, `$895.4B`).

### Scenario 5 — Unsupported & Within-Scope Undisclosed Investor Questions (`LOCALLY_VERIFIED`)
- **Suites:** [rc002-evidence-chat-integrity.test.ts](../../../../tests/rc002-evidence-chat-integrity.test.ts), [evidence-locked-chat.test.ts](../../../../tests/evidence-locked-chat.test.ts).
- **Required Proofs:**
  - Out-of-scope prompts (`Q7`: FY2028 net income, 2028 share-price target) and within-scope undisclosed prompts (`Q7b`: legal names of anonymised `14%/11%/11%` Customers A/B/C and confirmed Hugging Face purchase price) return `supportStatus: "unsupported"` and `supportingClaims: []` — never returning `fully_supported` over unrelated bundle observations.

### Scenario 6 — Historical Point-in-Time Forecast-vs-Actual Reconstruction (`DEV_VERIFIED` `/data-room` / `LOCALLY_VERIFIED` `/` & `Q1b`)
- **Suites:** [rc002-evidence-chat-integrity.test.ts](../../../../tests/rc002-evidence-chat-integrity.test.ts), [rc002-dashboard-alignment.test.ts](../../../../tests/rc002-dashboard-alignment.test.ts), [typedb-graph.test.ts](../../../../tests/typedb-graph.test.ts).
- **Required Proofs:**
  - At `asOfMs = 1794949170000` (`2026-11-17T20:59:30Z`, pre-Q3 release), `/` (`?asOfMs=1794949170000`), `/data-room`, and Evidence Chat (`Q1b`) report `FY2027 Q2` actual revenue (`$96,221M`) and `FY2027 Q3` forecast (`$108,000M +/- 2%`), withholding all `11` post-cutoff Case 007-B relationships and `20` post-earnings observations (`0` hindsight leakage).
  - Post-release (`>= 2026-11-18T01:35:00Z`), `/` and `/data-room` align on `FY2027 Q3` actuals (`$115,844M`, `74.8%` GM, `$43,777M` FCF, `$4,422M` capex) while retaining the preserved `$108.0B` forecast for variance comparison (`+$7.844B / +7.26%`).

### Scenario 7 — Failure-Path, Validator Bounds & Unseen-Issuer End-to-End Ingestion (`B-001`, `B-004`, `LOCALLY_VERIFIED`)
- **Suites:** [rc002-unseen-filing-ingestion.test.ts](../../../../tests/rc002-unseen-filing-ingestion.test.ts), [rc002-evidence-chat-integrity.test.ts](../../../../tests/rc002-evidence-chat-integrity.test.ts), [rc002-dashboard-alignment.test.ts](../../../../tests/rc002-dashboard-alignment.test.ts), [security-chat-route-fail-closed.test.ts](../../../../tests/security-chat-route-fail-closed.test.ts), [security-evidence-validation.test.ts](../../../../tests/security-evidence-validation.test.ts).
- **Required Proofs:**
  - **Oversized Validator Failure Stress Test (`B-001`):** `12` bad claims + `27` out-of-bundle relationship IDs downgrade cleanly to abstention with every `checks[i].detail.length <= 500` (`<= 480` target) and `0` `ZodError` / HTTP 500 crashes.
  - **Unseen SEC Issuer Disposable Local TypeDB `3.14.2` Proof (`B-004`):** Previously unseen issuer (**Arista Networks, Inc., `ANET`, `CIK 0001596532`**) passes multi-filing discovery (`Form 4` skipped at `recent[0]`, `8-K` + `10-Q` + overflow `13F-HR` discovered), rejects comparative `2019` XBRL capex trap, enforces `reviewer` gate, blocks wrong-target TypeDB writes (`assertExplicitTypeDbWriteTarget`), projects into a disposable local TypeDB `3.14.2` database with `0` Case 001 entities, and answers live Evidence Chat queries (`typedb_live`, `validatorValid: true`).
  - **Disconnected TypeDB / Audit Failure Fail-Closed:** `/` and `/data-room` display explicit `GRAPH UNAVAILABLE` banners without falling back to stale `FY2027 Q2` or synthetic Case 001 figures; `/api/graph/chat` fails closed on budget or audit write failures.
