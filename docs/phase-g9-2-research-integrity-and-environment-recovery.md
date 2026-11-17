# AI Capital Intelligence — Sprint G9.2: Research Integrity & Environment Recovery

**Document reference:** `docs/phase-g9-2-research-integrity-and-environment-recovery.md`
**Baseline:** G9.1 report, candidate `9e58c85`; branch `verify/combined-release-candidate` at `091a1bb`
**Status of this document:** pre-deployment report. **Nothing has been committed, pushed or deployed**, and no
development or production data, credential, Clerk issuer, scheduler setting or WAF rule has been changed. The
quarantine, re-ingestion, issuer and scheduler actions below are prepared and tested but await explicit owner
authorisation (§9).
**Assessment window:** 2026-11-16 23:40 UTC → 2026-11-17 UTC

---

## 1. Verdicts

| Scope | Verdict | Reason |
| :- | :-: | :- |
| **Preview** | **NO-GO** | The development Convex backend still runs pre-G9 functions (release gate: `BACKEND_UNVERSIONED`), still holds seven promoted invalid SEC facts, rejects the Clerk identity that owns all data, and has its scheduler disabled. All four are fixed in code and tooling here but need the authorised deployment and data steps in §9. |
| **Production** | **NO-GO** | Not assessed for promotion; Production is untouched. Production must not be promoted until Preview passes the release gate and owner acceptance. |

---

## 2. Root causes

1. **Frontend and backend drifted apart silently.** Vercel builds only Next.js (`next build`); Convex functions are deployed separately and were last deployed from a pre-G9 revision. Function names were identical (159 = 159), so nothing detected that the backend ran the old SEC selector.
2. **The SEC selector promoted re-reported comparative facts.** `companyfacts` repeats every prior-period value under each later filing's accession. The pre-G9 selector sorted across concepts by `filed` and could bind a 2016, 2019, 2020 or prior-year comparative value to a 2026 filing. Nothing downstream re-checked that a promoted claim named its own filing and that filing's current period.
3. **Re-ingestion was impossible by design.** The discovery agent skips any filing URL it has already staged, so even a corrected selector could never replace a bad record.
4. **Scheduler health was inferred from configuration, not execution.** "Scheduler working" meant "operations enabled"; the cron gate `RESEARCH_SCHEDULER_ENV=disabled` and the absence of any run were never consulted. The workspace matrix also printed "15-minute unattended cloud scheduler verified" and substituted today's date for a briefing that did not exist.
5. **The briefing fallback was unlabelled.** Anyone who is not the pipeline owner (including the owner signed in through a different Clerk instance) silently saw the bundled 2026-11-05 build-time briefing, and its time fed the "Last refreshed" pill.
6. **Identity split across Clerk development instances.** Preview and the Convex dev backend accept `complete-bunny-8662`; every owner record, `RESEARCH_OWNER_ID` and the encrypted broker credentials belong to `harmless-akita-9211`.

---

## 3. Invalid-evidence impact (B2, B4, B5, B9)

Ten SEC-derived staging items exist on `prestigious-dragon-8`. Each was re-validated by running the committed selector on the live `companyfacts` of the filing named in its own URL and cross-checking the raw XBRL row that carries the claimed value. **Seven are invalid, three are valid.** Full machine-readable record: `docs/evidence/sprint-g9-2-sec-capex-validation.json`.

### 3.1 The seven invalid items

| Staging id / external id | Ticker | Ingested (UTC) | Filing in URL | Stored (wrong) value | Where that value really comes from | Correct current-period value | Dependent records |
| :- | :- | :- | :- | :- | :- | :- | :- |
| `ss703rpdxnqe8fbp7sbw385tbs8j8gbj` / `staged-7f5da1f3fb6a672d` | NVDA | 2026-11-15 16:49:21 | 10-Q `0001045810-26-000075` | $0.37bn "Q2 2020 (YTD)", cites accession `0001045810-20-000147` | Six months to 2020-07-26, 10-Q filed 2020-08-19 | **$4.434bn**, 2026-01-26 → 2026-07-26 (FY27 H1, YTD), `PaymentsToAcquireProductiveAssets` | evidence `md7ccmyj02g4f5wbxysvh4kg758j9vvb`; briefing 2026-11-15 `s97ebx9w…` |
| `ss79cpn06rc1xnpkfns5vtaxjx8hpnnp` / `staged-dcf44b009199d49a` | AMZN | 2026-11-06 17:03:15 | 10-Q `0001018724-26-000040` | $4.9bn "2026" (title "Q1 2017") | Twelve months to 2016-03-31, 10-Qs filed 2016/2017 | **$77.259bn**, 2026-07-01 → 2026-09-30 (Q3, three months), `PaymentsToAcquireProductiveAssets` | evidence `md7402mdfykyf330rnj9h4p4c98hq9hx`; briefing 2026-11-06 `s9759rb0…` |
| `ss79a2a4f59fxg9f7yk0heq7z18hqaf6` / `staged-adfd0a710e5538b2` | AMD | 2026-11-06 17:04:27 | 10-Q `0000002488-26-000191` | $0.75bn "Q3 2026" | Nine months to 2025-09-27 comparative column of the same 10-Q | **$1.845bn**, 2025-12-28 → 2026-09-26 (nine months) | evidence `md718n2qxb22cfw0ga68dvn5ax8hpba0` |
| `ss7b8fm4yv03b75trn2trxqw9s8hqd93` / `staged-39bf33eb27445eee` | INTC | 2026-11-06 17:04:27 | 10-Q `0000050863-26-000191` | $11.16bn "Q3 2026" | Nine months to 2025-09-27 comparative column of the same 10-Q | **$10.216bn**, 2025-12-28 → 2026-09-26 (nine months) | evidence `md7a79f73kdsfknh9w06eq6hss8hpjnc` |
| `ss72cby9a9wfxt9fbt85b9arc58hp9wn` / `staged-98c25c92c7ca82e7` | GOOGL | 2026-11-06 17:03:15 | 8-K `0001193125-26-449835` | $63.6bn "Q3 2026" | Nine months to 2025-09-30 comparative of 10-Q `0001652044-26-000084` | Already stored validly: **$131.95bn**, nine months to 2026-09-30 (10-Q) | evidence `md75wq3011eqzje9zyhzg0perx8hp7px`; briefing 2026-11-06 |
| `ss7919q80bjb818aq2cg2hnpr98hpqtm` / `staged-c135441d25ee1df9` | MSFT | 2026-11-06 17:03:15 | 8-K `0001193125-26-448357` | $19.39bn "Q1 2027" | Quarter to 2025-09-30 (FY26 Q1) comparative of 10-Q `0001193125-26-436133` | Already stored validly: **$39.37bn**, quarter to 2026-09-30 (10-Q) | evidence `md77dsjwmbs4g6hbq34svrj5kn8hp65p`; briefing 2026-11-06 |
| `ss7cxe4kynkz3nz01syfffwyfd8hqzj1` / `staged-e2523ed83a7c0247` | NVDA | 2026-11-06 17:03:15 | 8-K `0001045810-26-000078` | $0.24bn "2026" (title "Q2 2020") | Six months to 2019-07-28, 10-Qs filed 2019/2020 | Superseded by the NVDA 10-Q fact above | evidence `md7bd53b7yj928k7hkm8zc6ky98hq1zw`; briefing 2026-11-06; frozen forward event `forward-004-nvda-qqq-5d-2026-11-05` (context only) |

Valid and untouched: GOOGL $131.95bn (10-Q `0001652044-26-000084`), MSFT $39.37bn (10-Q `0001193125-26-436133`), CRWV $23.56bn (10-Q `0001769628-26-000465`).

### 3.2 Independent verification against the filed documents (B5)

The corrected figures were not taken from the selector. They were read from the filed 10-Q documents and XBRL instance files in SEC Archives:

| Ticker | Issuer (dei) | XBRL fact | Context period | Unit / decimals | Value | Cash-flow statement line |
| :- | :- | :- | :- | :- | :- | :- |
| NVDA | NVIDIA CORP, CIK 0001045810; 10-Q, period end 2026-07-26, FY2027 Q2 | `us-gaap:PaymentsToAcquireProductiveAssets`, `f-334`, `c-1`, undimensioned | 2026-01-26 → 2026-07-26 | `iso4217:USD`, −6 | 4,434,000,000 | "Purchases related to property and equipment and intangible assets (4,434) (3,122)" — six months; **no three-month capex fact exists in this filing**, so YTD is the correct label |
| AMZN | AMAZON.COM, INC., CIK 0001018724; 10-Q, period end 2026-09-30, FY2026 Q3 | `us-gaap:PaymentsToAcquireProductiveAssets`, `f-145`, `c-23`, undimensioned | 2026-07-01 → 2026-09-30 | `iso4217:USD`, −6 | 77,259,000,000 | "Purchases of property and equipment (35,095) (77,259) …" — three months 2025 / 2026 |
| AMD | ADVANCED MICRO DEVICES, INC; 10-Q, period end 2026-09-26 | `PaymentsToAcquirePropertyPlantAndEquipment` | 2025-12-28 → 2026-09-26 | USD, −6 | 1,845,000,000 | "Purchases of property and equipment (1,845) (752)" |
| INTC | Intel Corporation; 10-Q, period end 2026-09-26 | `PaymentsToAcquirePropertyPlantAndEquipment` | 2025-12-28 → 2026-09-26 | USD, −6 | 10,216,000,000 | XBRL instance (comparative 11,158,000,000 beside it) |

### 3.3 Downstream impact (B9)

- **Ratings and scores: not affected.** `lib/research-ratings` and the thesis monitor read the static SEC dataset in `data/sec-xbrl/`, never Convex evidence or staging rows.
- **Chat retrieval: not affected.** Evidence chat reads the TypeDB graph and static bundles. The graph outbox only ever projected `infrastructureCases` (37 rows); no evidence or staging row was projected.
- **Briefings: affected.** 2026-11-06 cites four invalid facts; 2026-11-15 cites the NVDA "Q2 2020" fact.
- **Frozen forward event `forward-004-nvda-qqq-5d-2026-11-05`:** lists the NVDA 8-K item as context; its outcome is a five-session NVDA-vs-QQQ price return and does not use the capex value. Not rewritten.
- **Job run history:** cursor strings contain valid filing accessions only; audit history, unchanged.

---

## 4. Changes made (code only, uncommitted)

All changes are in the working tree of `verify/combined-release-candidate` (based on `091a1bb`); nothing is staged or committed.

**Research integrity (B3, B6, B8)**
- `lib/remote-ops/evidence-integrity.ts` (new): the filing-integrity rule. A claim attached to an EDGAR filing is **rejected** when it cites another accession, its period ends after the filing, its period ended more than 190 days before filing, or its period label names a year older than the prior fiscal year; it is **held** (not promoted) when it is not from a 10-Q/10-K or states no period end.
- `lib/remote-ops/staging-validator.ts`: applies the rule to every SEC claim before promotion.
- `convex/schema.ts`: additive only. New `evidenceQuarantines` ledger; optional `quarantinedAt` / `quarantineId` on `evidence` and `researchStagingItems`.
- `convex/operations.ts`: `quarantineStagedEvidenceInternal` (internal, idempotent, dry-run capable, writes audit rows); quarantined rows excluded from seen-URL / content-hash / fact-key dedupe sets, the owner overview, pending counts and forward-study registration; a corrected re-ingestion of the same URL is linked as the replacement with its own audit row; quarantined facts in a stored briefing are withheld from display with their reason; latest briefing date and generation time exposed publicly (content stays owner-only); real `RESEARCH_SCHEDULER_ENV` and per-job source observation times passed to health.
- `convex/remoteOpsCloud.ts`: a discovered SEC fact reaches a briefing only if it passes the same integrity rule.

**Scheduler and source health (E)**
- `lib/remote-ops/health-monitor.ts`: "working" now requires an open cron gate and a tick within 45 minutes; distinct paused / disabled / overdue labels; per-job `scheduled`, `nextRunOverdue`, `latestSourceObservationAt`; `externalNewsIngestion` status (NOT_IMPLEMENTED today); the discovery agent is named for what it is (SEC filing discovery).
- `lib/remote-ops/workspace-connections.ts`: removed "15-minute unattended cloud scheduler verified" and the invented "Briefing <today> (0 confirmed facts)".
- `components/command-centre/agent-operations-panel.tsx`: neutral layer headings (the old headings asserted success), cron gate and last/next tick, last attempt and source observation per job, "Not scheduled" / "Overdue" next-run cells, external-news row.

**Briefing provenance (F)**
- `lib/remote-ops/briefing-provenance.ts` (new), `components/command-centre/command-centre.tsx`, `components/command-centre/morning-brief-panel.tsx`, `lib/portfolio/research-feed.ts`, `app/page.tsx`, `lib/remote-ops/contracts.ts`: the owner sees the latest stored briefing; the bundled build-time briefing is titled "Historical bundled briefing (2026-11-05) — not current research", carries a notice with the latest stored briefing's date or time, and never feeds the executive synthesis.

**Release consistency (A)**
- `scripts/lib/convex-fingerprint.mjs`, `scripts/write-convex-fingerprint.mjs`, `convex/deploymentFingerprint.ts` (generated): SHA-256 over the Convex functions' full import closure (89 files including lib/ and data/ JSON) and imported package versions.
- `convex/release.ts`: public `release:fingerprint` query (no user data).
- `lib/release/fingerprint-compatibility.ts`, `app/api/health/release/route.ts`: frontend git SHA, expected and actual backend fingerprint, verdict COMPATIBLE / INCOMPATIBLE / BACKEND_UNVERSIONED / BACKEND_UNREACHABLE.
- `scripts/release-fingerprint-check.mjs` (`npm run release:check`): exits non-zero unless compatible; local or `--app-url` mode.

**Verification tooling (G)**
- `vitest.config.ts`: 30 s test and hook budget; `npm run test:serial` as the deterministic fallback.
- `tests/sprint-g9-2-research-integrity.test.ts` (24 tests), `scripts/sprint-g9-2-browser-acceptance.mjs`.
- Evidence: `docs/evidence/sprint-g9-2-sec-capex-validation.json`, `docs/screenshots/g9-2-local-build-*`.

---

## 5. Test results

| Check | Result |
| :- | :- |
| `npm run lint` | **PASS** — 0 errors, 19 warnings (all pre-existing unused-variable warnings) |
| `npx tsc --noEmit` | **PASS** after one fix. Two failures during the sprint were mine: an unused `@ts-expect-error` and a too-narrow cast in the new test file. |
| `npx tsc --noEmit -p convex/tsconfig.json` | **PASS** |
| `npm run test:python` | **PASS** — 219 tests, 1 skipped |
| `npx vitest run` (full, parallel) | **PASS** on every full run after the timeout fix: 804/804, 804/804, then 813/813 three times with the extended suite (4 skipped), the last after the final edits. |
| `next build` | **PASS** on retry. Two different failures occurred: (1) Next.js's **security-advisory gate** (`SecurityFatalError: Your version of Next.js is affected by a known security vulnerability`), which stops one build and lets the retry through; this caused the first G9.2 build failure. (2) The test typing error above, which `next build` also catches because tests are in the TypeScript scope. |

**Flaky tests.** In G9.1, 2–4 convex-test security suites timed out at the 5 s default under 81 parallel workers and passed alone. Cause: each suite's first test cold-imports the whole Convex module graph. With the 30 s budget in `vitest.config.ts`, five consecutive full parallel runs had **zero** timeouts and zero failures. No other flaky test was observed.

**Dependency advisory (finding, not acted on).** Next.js `16.4.3` reports a known security advisory (npm bulk advisories endpoint). No upgrade was run; it is listed as an owner decision in §9.

---

## 6. Requested demonstrations

| # | Request | Evidence | Result |
| :- | :- | :- | :- |
| 1 | Results of every suite | §5 | PASS |
| 2 | Diff review for shell-edit damage | Full `git diff` reviewed file by file; `git diff --check` clean; no truncated, duplicated or mangled blocks; CRLF/LF differences normalised by git (`core.autocrlf=true`). Two shell-quoting incidents were caught before any file was written and rewritten with the file tool. | PASS |
| 3 | Inventory of the seven invalid items | §3.1 and `docs/evidence/sprint-g9-2-sec-capex-validation.json` | DONE |
| 4 | Quarantined evidence excluded from every consumer | Staging dedupe and seen-URL sets, owner overview research lists and counts, forward-study registration, cloud briefing generation (overview list and freshly discovered facts), stored-briefing display (withheld with reason): covered by code and tests. Ratings, thesis monitor and chat retrieval never read Convex evidence or staging rows (§3.3). | PASS (code + tests); live data step pending §9 |
| 5 | Re-ingestion without duplicate active records, audit trail retained | convex-test: legacy NVDA record seeded exactly as in dev → dry run writes nothing → quarantine → idempotent repeat → URL leaves the seen set → corrected NVDA $4.43bn re-ingested and linked as replacement → **exactly one active promoted row and one active evidence value (4.43)**, original row and value 0.37 retained → re-submitting the same filing creates **nothing** and leaves the link unchanged → audit holds `evidence_quarantined` and `evidence_quarantine_replaced`. Other users see no quarantine data. | PASS |
| 6 | Scheduler display in five conditions | Rendered `AgentOperationsPanel` tests: **enabled** ("Scheduler working", env remote, last attempt, source observed); **disabled** ("Scheduler disabled (RESEARCH_SCHEDULER_ENV=disabled)", "no tick expected", jobs "Enabled · not scheduled (cron disabled)", next run "Not scheduled"); **overdue** ("Scheduler overdue … configured but not executing", next run "Overdue"); **failed** (job "Failed", `sec_edgar_unreachable`, "Collectors failing"); **unchanged source** ("cursor unchanged (0 model calls)", "7 reqs", "latest cycle skipped unchanged sources via cursor"). External news reads "NOT IMPLEMENTED" in all five. The test exposed and fixed headings that read "Scheduler working" even when disabled. | PASS |
| 7 | Owner sees latest briefing; fallback labelled historical | Unit tests of `resolveDisplayedBriefing` (owner → `owner_latest`; signed-out and signed-in non-owner → `bundled_reference`, excluded from the executive synthesis) and rendered panel tests (owner title plain; fallback "Historical bundled briefing (2026-11-05) — not current research" with the latest stored date; withheld quarantined facts listed). Browser: the local build shows the historical label and notice (screenshot below). **Owner UI with real data not verified**: the owner's stored data is only readable by a `harmless-akita` session, which the backend currently rejects (§8). | PASS (logic + render + anonymous browser); owner browser BLOCKED |
| 8 | Release compatibility check and repeatable browser evidence | §7 | PASS (gate correctly reports incompatible) |

---

## 7. Release compatibility and browser evidence

**Release gate, local mode** (`npm run release:check`, 2026-11-17 00:4x UTC):

```
RELEASE GATE FAIL: backend https://prestigious-dragon-8.eu-west-1.convex.cloud has no usable release:fingerprint ([Request ID: 6e52d3f00e3a202e] Server Error); it predates fingerprinting or is unreachable.
```

**Browser acceptance** (`node scripts/sprint-g9-2-browser-acceptance.mjs http://localhost:3000 g9-2-local-build docs/screenshots`), local production build of the working tree against the unchanged development backend, 2026-11-17 00:58 UTC, no page errors:

| Check | Observed |
| :- | :- |
| `GET /api/health/release` | 200; frontend expects Convex sources `764ccc52a033…` (89 files, 4 packages); backend error "Could not find public function for 'release:fingerprint'"; verdict **BACKEND_UNVERSIONED**, `compatible:false` |
| Briefing panel | `data-briefing-source="bundled_reference"`; title "Historical bundled briefing (2026-11-05) — not current research"; notice "Latest stored briefing: generated 2026-11-15 16:49 UTC" |
| Executive briefing | "Research as of 2026-11-13"; "Last refreshed 2026-11-15 16:49 UTC" (stored briefing time, no longer the bundled 2026-11-05 time) |
| Scheduler layer | Still "Scheduler working … RESEARCH_SCHEDULER_ENV: unset" — this text is computed by the **old backend**, which is exactly the mismatch the gate reports. The new behaviour is proven by the rendered-panel tests in §6 and will appear once the backend is deployed. |
| Refresh / navigation | Two reloads and `/stress` → back: heading and briefing source unchanged (`stable: true`) |

Screenshots: `docs/screenshots/g9-2-local-build-market-radar.png`, `docs/screenshots/g9-2-local-build-market-radar-operations.png`; report `docs/screenshots/g9-2-local-build-report.json`. After deployment, the same script against the Preview with `--require-compatible` is the release gate.

**Interactive Preview with Clerk: not run in G9.2.** The new code is not on any Preview deployment (nothing pushed), and the Preview's own backend is the undeployed one above.

---

## 8. Clerk identity and broker connection (C, D)

**Inventory of development records by Clerk issuer** (`prestigious-dragon-8`, backup of 2026-11-16 23:46 UTC):

| Issuer | Principals | Rows | What they are |
| :- | -: | -: | :- |
| `https://harmless-akita-9211.clerk.accounts.dev` | 1 | 467 | The owner `user_3LjSsuJX398YIJRdss5Q7PqsSH9`: broker connections and encrypted credentials, schedule, market observations, staging, evidence, briefings, job history, `RESEARCH_OWNER_ID` |
| `https://complete-bunny-8662.clerk.accounts.dev` | 0 | 0 | The instance Preview and the Convex backend accept. The owner's account there (`user_3MBf3i3DwR8wReuh0KNUvs1x7iS`) owns nothing. |
| `https://dev-acceptance.clerk.accounts.dev` | 31 | 345 | Synthetic principals written by automated acceptance tests (not a real Clerk instance) |
| `dev-verification` | 1 | 8 | Synthetic activation check |

Both real instances publish JWKS (`complete-bunny-8662`: kid `ins_3LmnLPim2bLQJQQzQzE3P6nfNbT`; `harmless-akita-9211`: kid `ins_3LjPcEuinGUcufjZpd1ajbq50AR`).

**Intended Preview identity:** `complete-bunny-8662` is what Vercel Preview and the Convex backend are configured for; `harmless-akita-9211` is what owns the data and local development. They must be reconciled.

**Options (none executed):**
1. **Recommended — additive issuer.** Set `CLERK_JWT_ISSUER_DOMAIN` on `prestigious-dragon-8` to both instances (`convex/auth.config.ts` already supports a comma-separated list). Removes access from nobody (complete-bunny has no data; synthetic issuers are unaffected), restores the owner's access, keeps per-owner isolation, and is reversible. It is still a change to authentication on a shared backend, so it needs your authorisation.
2. **Migrate rows to the complete-bunny principal — not recommended.** Broker credentials are encrypted with the owner identity bound into the AES-GCM associated data; moving them makes them undecryptable. Research data could be re-collected under a new owner instead, but the owner would have to re-enter the Trading 212 key.
3. **Isolated acceptance backend.** A separate Convex development deployment with `harmless-akita` only, used by a dedicated Preview. Cleanest separation; needs an owner action in the Convex dashboard.

**Two-principal isolation:** proven in code by convex-test (owner and a second principal; the second sees no quarantine, staging or briefing data). On the real backend it is **BLOCKED** until option 1 or 3 exists, because only one real principal (the complete-bunny owner, with no data) is currently accepted.

**Broker (D).** Live and Demo remain separate rows and badges. `BROKER_VAULT_KEY_B64` is absent from Vercel Preview (Production only), so Preview reports `brokerStorageReady:false`. If Preview broker testing is wanted, generate a new Preview-only key and use non-production test credentials; the Production key and the stored Live credentials must not be copied. The stored Live credential was encrypted with the local development key and belongs to the harmless-akita owner, so read-only sync can only be tested locally after option 1, with the owner signing in. `executionAuthority` remains `none` and both trading flags remain disabled; nothing here touches them.

---

## 9. Remaining blockers and proposed commit and deployment plan

### 9.1 Remaining blockers

| # | Blocker | Owner action needed |
| :- | :- | :- |
| 1 | Dev Convex runs pre-G9 functions (`BACKEND_UNVERSIONED`) | Authorise deploy of the committed functions to `prestigious-dragon-8` (schema change is additive) |
| 2 | Seven invalid facts are still active in dev | Authorise the quarantine (dry run first) and the on-demand re-ingestion |
| 3 | Owner identity not accepted by the backend | Choose option 1, 2 or 3 in §8 |
| 4 | Scheduler disabled on dev (`RESEARCH_SCHEDULER_ENV=disabled`) | Decide whether to run a controlled cron window (enable, observe one cycle, restore) |
| 5 | Preview vault key missing | Decide whether Preview should support broker tests |
| 6 | Next.js `16.4.3` security advisory | Decide whether to upgrade Next.js (separate change) |
| 7 | Production unchanged and not assessed | Promotion only after the Preview passes the gate with `--require-compatible` and owner acceptance |

### 9.2 Proposed commits (none made yet)

1. `fix(research-integrity): reject comparative and misattributed SEC facts; add quarantine ledger with auditable re-ingestion` — `lib/remote-ops/evidence-integrity.ts`, `lib/remote-ops/staging-validator.ts`, `convex/schema.ts`, `convex/operations.ts`, `convex/remoteOpsCloud.ts`, `lib/remote-ops/contracts.ts`.
2. `fix(ops-health): report scheduler from the real cron gate and observed ticks; show per-job attempts and source times; state external news NOT IMPLEMENTED` — `lib/remote-ops/health-monitor.ts`, `lib/remote-ops/workspace-connections.ts`, `components/command-centre/agent-operations-panel.tsx`.
3. `fix(briefing): owner sees the latest stored briefing; label the bundled briefing as historical` — `lib/remote-ops/briefing-provenance.ts`, `components/command-centre/command-centre.tsx`, `components/command-centre/morning-brief-panel.tsx`, `lib/portfolio/research-feed.ts`, `app/page.tsx`.
4. `feat(release): Convex deployment fingerprint, /api/health/release and release gate` — `scripts/lib/convex-fingerprint.mjs`, `scripts/write-convex-fingerprint.mjs`, `scripts/release-fingerprint-check.mjs`, `convex/deploymentFingerprint.ts`, `convex/release.ts`, `lib/release/fingerprint-compatibility.ts`, `app/api/health/release/route.ts`, `package.json`.
5. `test(g9.2): research-integrity, scheduler and briefing suite; Vitest timeout strategy; browser acceptance script` — `tests/sprint-g9-2-research-integrity.test.ts`, `vitest.config.ts`, `scripts/sprint-g9-2-browser-acceptance.mjs`.
6. `docs(g9.2): remediation report, SEC capex validation evidence, local-build screenshots` — `docs/phase-g9-2-research-integrity-and-environment-recovery.md`, `docs/evidence/`, `docs/screenshots/g9-2-local-build-*`.

Because commits 1 and 4 both touch Convex sources, `npm run convex:fingerprint` must be rerun and `convex/deploymentFingerprint.ts` amended into commit 4 (or commit 4 made last among the code commits) so every commit's fingerprint matches its sources.

### 9.3 Proposed deployment sequence (each step needs your go-ahead)

1. Push the branch; Vercel builds a new Preview.
2. `npx convex deploy` of the same commit to `prestigious-dragon-8`, then set `CONVEX_DEPLOYED_GIT_SHA` and `CONVEX_DEPLOYED_AT`.
3. `npm run release:check` and `/api/health/release` on the Preview must both report **COMPATIBLE**.
4. Run `operations:quarantineStagedEvidenceInternal` with `dryRun:true`, review, then for real (seven items, prepared with exact reasons).
5. Run the cloud cycle on demand (`forceOnDemand`) for SEC, discovery and briefing jobs; verify four replacement facts (NVDA 4.434, AMZN 77.259, AMD 1.845, INTC 10.216) and a new 2026-11-17 briefing without quarantined facts.
6. Apply the chosen identity option; test two accepted principals; owner verifies the latest briefing in the browser.
7. Optional controlled cron window; then restore `RESEARCH_SCHEDULER_ENV`.
8. Re-run `scripts/sprint-g9-2-browser-acceptance.mjs <preview> preview docs/screenshots --require-compatible` and the G9.1 script; update this report and the GO/NO-GO.
