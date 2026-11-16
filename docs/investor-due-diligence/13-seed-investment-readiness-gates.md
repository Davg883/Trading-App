# 13 — Seed Investment Readiness Gates

**Programme:** Vectis ONE & AI Capital Intelligence — Independent Due Diligence Remediation Programme  
**Date:** 10 November 2026  
**Audience:** Founder / Owner, Prospective Seed Investors, Technical Due Diligence Assessors, Legal & Regulatory Advisers  
**Companion Documents:**  
- [11-remediation-plan.md](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/11-remediation-plan.md) — Staged engineering remediation plan, exact line-level code specifications, and owner runbooks  
- [12-verified-capability-register.md](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/12-verified-capability-register.md) — Reconciled capability and defect register (Opus findings `D1`–`D14` and `E-01`–`E-48`)  

---

## 1. Purpose & Governance Principles

Following the independent technical due diligence review ([opus-independent-technical-review.md](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/opus-independent-technical-review.md) and [opus-investor-red-flags-and-mitigations.md](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/opus-investor-red-flags-and-mitigations.md)), this document establishes the **six sequential Seed Investment Readiness Gates (`Gate 0` through `Gate 5`)** required to transition AI Capital Intelligence and the proposed Vectis ONE architecture from a founder-operated technical prototype to an investable, independently verifiable seed-stage company.

### Core Governance Rules

1. **No Self-Certification on High-Risk Claims:** Engineering changes can close code defects, enforce fail-closed authentication, and add CI gates, but AI agents cannot self-certify legal IP ownership, regulatory exemptions, independent penetration testing, or external customer willingness to pay.
2. **Staged, Auditable Execution:** Each gate has explicit entry criteria, deterministic verification evidence, an owner approval checkpoint, and clear separation between **Automated Engineering Verification** and **External Human Verification**.
3. **Preservation of Historical Audit Trail:** Earlier development reports containing superseded claims (`C1`–`C13`) are never silently edited or deleted; they are formally marked superseded with links to raw primary artefacts.
4. **No Premature Platform Generalisation:** Multi-tenant SaaS extraction and second-vertical engineering (`Phase B` / `Phase C` of the roadmap) are gated behind technical remediation (`Gates 0–3`), legal/regulatory clearance (`Gate 4`), and commercial customer discovery (`Gate 5`).

---

## 2. Summary Gate Matrix

| Gate | Title | Red Flags Closed | Remediation Stage | Primary Owner | External Sign-Off Required? | Current Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Gate 0** | **Immediate Security, Credential & Repository Containment** | `D5`, `E-30`, `E-34`, `E-35` | Stage 0 & Stage 1 (part) | Founder / Owner | Optional (Investor verification of private repo & revoked token) | **ACTION REQUIRED (Owner)** |
| **Gate 1** | **Access Control, Research-Only Boundary & Fail-Closed Runtime** | `D3`, `D4`, `D7`, `D8`, `E-26`, `E-29`, `E-31`, `E-32`, `E-39` | Stage 1 & Stage 2 | Founder + Engineering | Independent Technical Assessor (Convex & Vercel verification) | **PROPOSED — Awaiting Owner Approval** |
| **Gate 2** | **Forensic AI Evaluation & Primary-Source Data Integrity** | `D1`, `D2`, `D9`, `D10`, `D11`, `E-16`, `E-43`, `C1`–`C13` | Stage 4 | Founder + Engineering | Independent Technical Assessor (clean-checkout benchmark run) | **PROPOSED — Awaiting Owner Approval** |
| **Gate 3** | **Automated CI/CD Quality Gate, Zero-Error Lint & Operational Resilience** | `D6`, `D12`, `D13`, `E-08`, `E-21`, `E-23` | Stage 3 & Stage 5 | Founder + Engineering | Independent Technical Assessor (CI logs & backup drill review) | **PROPOSED — Awaiting Owner Approval** |
| **Gate 4** | **External Legal, Regulatory, Security & Financial Sign-Off** | `D14`, IP/Chain-of-Title, FCA Perimeter, Pen-Test | Post-Stage 5 | External Advisers | **Yes — Technology Solicitor, FCA Adviser, CREST Pen-Tester, Accountant** | **OPEN — Pre-Close Condition** |
| **Gate 5** | **Commercial Discovery & Second-Vertical Validation Gate** | Commercial & Multi-Tenancy Risk | Pre-Seed / Seed Tranche 1 | Founder | **Yes — Prospective Design Partners / Pilot Customers** | **OPEN — Commercial Milestone** |

---

## 3. Detailed Gate Definitions & Acceptance Criteria

### Gate 0 — Immediate Security, Credential & Repository Containment

**Objective:** Eliminate active credential exposure and unintentional public disclosure of source code, internal identifiers, and due diligence documents before any further repository pushes.

#### Required Actions
1. **GitHub OAuth Token Revocation (`E-35`):**
   - Owner revokes the exposed `gho_…` token in GitHub Settings ([https://github.com/settings/applications](https://github.com/settings/applications) and [https://github.com/settings/tokens](https://github.com/settings/tokens)), clears Windows Credential Manager (`cmdkey /delete:LegacyGeneric:target=git:https://github.com`), and re-authenticates via `gh auth login` outside agent logs, following [11-remediation-plan.md §1.2](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/11-remediation-plan.md#L33-L90).
2. **Repository Visibility Decision (`D5` / `E-34`):**
   - Owner transitions `https://github.com/Davg883/Trading-App` from **Public** to **Private** in GitHub repository settings (recommended), granting read access to prospective investors via controlled collaborator invitations or a curated data-room mirror.
3. **Sensitive Identifier Removal (`D5` / `E-30`):**
   - Remove the hard-coded Clerk user ID literal (`user_3B3...`) from [convex/graph.ts](file:///c:/GPT%205%20CODEX/Trading%20app/convex/graph.ts#L1162-L1163), requiring `process.env.RESEARCH_OWNER_ID` explicitly.
   - Replace literal Clerk user IDs, personal email addresses, and internal Convex deployment URLs (`cheery-sockeye-616`) in documentation with redacted placeholders (`<REDACTED_CLERK_USER_ID>`, `<REDACTED_OWNER_EMAIL>`, `<CONVEX_DEPLOYMENT_NAME>`).
4. **Third-Party Dependency & Licence Audit (`Stage 0.3`):**
   - Generate and archive `docs/investor-due-diligence/licence-inventory.json` confirming zero GPL/AGPL copyleft dependencies in the production application bundle and documenting the status of `@typedb/driver-http` (`0.1.3-alpha.0`).

#### Gate 0 Exit Criteria (Pass/Fail)
- [ ] Old `gho_…` token is verified revoked by the owner; `gh auth status` succeeds with a newly issued credential never printed in logs.
- [ ] Repository visibility is set to Private (or all internal identifiers are redacted prior to push).
- [ ] `rg "user_3B3"` across `convex/`, `lib/`, `app/`, `components/`, and `tests/` returns 0 matches.
- [ ] `licence-inventory.json` is committed and reviewed.

---

### Gate 1 — Access Control, Research-Only Boundary & Fail-Closed Runtime

**Objective:** Close all unauthenticated Convex telemetry fallbacks, enforce fail-closed authentication and database configuration in production, and convert the deployment into a strictly enforced **Research-Only & Read-Only Portfolio Monitoring** service.

#### Required Actions (Remediation Stages 1 & 2)
1. **Convex Public Query Access Control (`D3` / `E-29`):**
   - In [convex/operations.ts](file:///c:/GPT%205%20CODEX/Trading%20app/convex/operations.ts#L219-L253) (`publicOperationsOverview`), remove both the unauthenticated `process.env.RESEARCH_OWNER_ID` fallback and the unindexed table-scan fallback (`ctx.db.query('brokerConnections').order('desc').first()`). Return `brokerConnection: null`, `latestReadOnlySync: null`, and `portfolioSnapshotsCount: 0` whenever `ctx.auth.getUserIdentity()` is null.
   - In [convex/evidenceChat.ts](file:///c:/GPT%205%20CODEX/Trading%20app/convex/evidenceChat.ts#L353-L370) (`getChatOperationsTelemetry`), require an authenticated identity (`ctx.auth.getUserIdentity()`); return a zeroed, unauthenticated summary immediately when unauthenticated and delete the unindexed table scan (`ctx.db.query('evidenceChatAudit').order('desc').take(...)`).
   - In [convex/evidenceChat.ts](file:///c:/GPT%205%20CODEX/Trading%20app/convex/evidenceChat.ts#L557-L720), convert `consumeAcceptanceNonceAndGetContext` and `recordAcceptanceChatTurn` from public `mutation`s to `internalMutation`s, and replace `Math.random()` token generation in `mintServerAcceptanceTokenInternal` with `crypto.randomUUID()`.
2. **Fail-Closed Request Proxy (`D7` / `E-31`):**
   - Update [proxy.ts](file:///c:/GPT%205%20CODEX/Trading%20app/proxy.ts#L12-L35) so `catch` blocks return `503 Service Unavailable` JSON for `/api/*` routes and redirect browser routes to `/sign-in?error=auth_unavailable` rather than returning `NextResponse.next()`.
   - Enforce Clerk protection on sensitive routes (`/portfolio`, `/settings`, `/trading`, `/api/brokers`, `/api/trading`, `/api/portfolio`).
3. **Fail-Closed TypeDB Configuration & Accurate TLS Telemetry (`D8` / `E-32` / `E-39`):**
   - Update [lib/graph/typedb-driver-adapter.ts](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/typedb-driver-adapter.ts#L36-L44) to fail closed when `NODE_ENV === 'production'` if `TYPEDB_ADDRESS`, `TYPEDB_USERNAME`, or `TYPEDB_PASSWORD` are missing or if `TYPEDB_PASSWORD === 'password'`.
   - Update [app/data-room/page.tsx](file:///c:/GPT%205%20CODEX/Trading%20app/app/data-room/page.tsx#L30-L33) so `tlsEnabled` is derived strictly from `probe.address.startsWith('https://')`.
4. **Hard Research-Only Deployment Boundary (`D4` / `E-26`):**
   - Introduce `export const RESEARCH_ONLY_DEPLOYMENT = true as const;` in [lib/trading/server.ts](file:///c:/GPT%205%20CODEX/Trading%20app/lib/trading/server.ts) and [app/api/trading/route.ts](file:///c:/GPT%205%20CODEX/Trading%20app/app/api/trading/route.ts) so `POST /api/trading` rejects `save_trading_key`, `issue_confirmation`, `confirm`, `submit`, and `cancel` with HTTP `403 { error: 'research_only_deployment' }` regardless of environment variables.
   - Update [app/trading/page.tsx](file:///c:/GPT%205%20CODEX/Trading%20app/app/trading/page.tsx) to display a clear Research-Only Deployment notice while preserving Phase 002 modules in Git history and unit tests.

#### Gate 1 Exit Criteria (Pass/Fail)
- [ ] Dedicated unit and integration tests (`tests/remediation-stage-1-access-control.test.ts` and `tests/remediation-stage-2-research-only.test.ts`) pass 100%.
- [ ] Direct unauthenticated HTTP query to production Convex `operations:publicOperationsOverview` and `evidenceChat:getChatOperationsTelemetry` returns zero owner/telemetry data (`brokerConnection: null`, `totalQueries: 0`).
- [ ] `POST /api/trading` with any execution or key-storage action returns HTTP `403 research_only_deployment`.
- [ ] Read-only portfolio monitoring (`/portfolio`, `POST /api/brokers` action `sync`) continues to operate normally for the authenticated owner.

---

### Gate 2 — Forensic AI Evaluation & Primary-Source Data Integrity

**Objective:** Eliminate all benchmark fallback-masking, shared static provider response IDs, synthetic SHA-256 placeholders, and self-grading answer rubrics; establish a forensically verifiable live AI evaluation benchmark and formally supersede contaminated historical claims (`C1`–`C13`).

#### Required Actions (Remediation Stage 4)
1. **Supersession of Historical Claims (`D2`, `D9`, `C1`–`C13`):**
   - Prepend formal supersession banners to affected historical phase reports (`phase-g2-*`, `phase-g4-*`, `phase-g8-1-*`, `phase-g8-2-*`, and earlier `docs/investor-due-diligence/01`–`09` documents) referencing [12-verified-capability-register.md](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/12-verified-capability-register.md).
2. **Elimination of Fallback Masking & Hard-Coded Telemetry (`D1` / `E-16`):**
   - Remove the hard-coded `Tj3yaoqeGa6xuMYPoMuKoAk` response ID from [lib/graph/chat-benchmark-50.ts](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/chat-benchmark-50.ts#L905) and [lib/research-ratings/thesis-monitor.ts](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts#L790); relabel static fixtures explicitly as `generationMode: 'deterministic_fixture_offline'` with `providerResponseId: null`.
   - Refactor [lib/portfolio/portfolio-live-eval-5.ts](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/portfolio-live-eval-5.ts#L165-L215) and [lib/portfolio/portfolio-live-eval-15.ts](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/portfolio-live-eval-15.ts#L303-L335) so:
     - Any provider error, timeout, missing `responseId`, or missing `usageMetadata` sets `generationMode: 'failed_provider_call'` and fails the live evaluation gate (`overallPassed: false`).
     - Silent substitution of `q.independentBenchmarkAnswer` inside live evaluation mode is completely removed.
     - Synthetic `req-${Date.now()}` IDs, default token counts (`620`/`165`, `650`/`180`), and non-hex `bundle-sha256-...` strings are removed and replaced with real `crypto.createHash('sha256')` digests and raw provider metadata.
     - `citationValidityPassed` inspects `answerText` against retrieved evidence IDs and numeric claims against deterministic financial outputs.
3. **Held-Out Evaluation Dataset & Raw Provider Artefact Archive:**
   - Separate benchmark prompts (`tests/benchmarks/prompts-v2.json`) from held-out scoring rubrics (`tests/benchmarks/scoring-rubric-v2.ts`) so the prompt-construction code cannot read the scoring expectations.
   - Commit an immutable raw JSONL run artefact (`docs/investor-due-diligence/artifacts/live-eval-run-YYYYMMDD.jsonl`) containing distinct provider response IDs, timestamps, latencies, token counts, and SHA-256 hashes for every question.

#### Gate 2 Exit Criteria (Pass/Fail)
- [ ] `rg "Tj3yaoqeGa6xuMYPoMuKoAk"` across `lib/` returns 0 matches.
- [ ] Running the live evaluation suite without a valid `GEMINI_API_KEY` fails closed with `generationMode: 'failed_provider_call'` and `0%` live pass rate (proving fallback masking is impossible).
- [ ] Running the live evaluation suite with a valid `GEMINI_API_KEY` produces `N` unique provider response IDs across `N` questions, verified in the committed `.jsonl` artefact.
- [ ] All historical documents containing `C1`–`C13` carry explicit supersession headers.

---

### Gate 3 — Automated CI/CD Quality Gate, Zero-Error Lint & Operational Resilience

**Objective:** Enforce automated build, lint, typecheck, and test gates on every commit and pull request; eliminate all 52 ESLint problems; and verify operational collector freshness and database backup/restore procedures.

#### Required Actions (Remediation Stages 3 & 5)
1. **Zero-Error, Zero-Warning ESLint Gate (`D6` / `E-08`):**
   - Resolve all 31 ESLint errors and 21 ESLint warnings across the 18 files itemized in [11-remediation-plan.md §2 Stage 3](file:///c:/GPT%205%20CODEX/Trading%20app/docs/investor-due-diligence/11-remediation-plan.md) (`@typescript-eslint/no-explicit-any` in `sec-xbrl-expansion.ts` and live eval files, `react-hooks/purity` `Date.now()` calls during render, `react/no-unescaped-entities`, and unused variables).
2. **GitHub Actions Application CI Pipeline (`D13` / `E-21`):**
   - Add `.github/workflows/ci-quality-gate.yml` triggered on every `push` and `pull_request` to `main`, executing `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npm test`, `npm run build`, and `pytest worker/tests`.
   - Enable GitHub branch protection on `main` requiring `ci-quality-gate.yml` to pass before merge.
3. **Collector Freshness Alerting & Backup/Restore Verification (`D12` / `E-43`):**
   - Add deterministic freshness SLA evaluation (`checkCollectorFreshnessSla`) in `convex/operations.ts` flagging `degraded_stale` when collectors exceed maximum age thresholds (FX > 48h, Treasury/Gold > 96h, UK Rates > 7d, SEC > 24h).
   - Configure `OPERATIONS_SCHEDULER_SECRET` and `RESEARCH_APP_ORIGIN` in GitHub Actions repository secrets (or document Convex native cron jobs in [convex/crons.ts](file:///c:/GPT%205%20CODEX/Trading%20app/convex/crons.ts) as the sole primary scheduler).
   - Execute and record a point-in-time Convex export (`npx convex export`) and TypeDB schema/seed restore drill into an isolated test environment.

#### Gate 3 Exit Criteria (Pass/Fail)
- [ ] `npx eslint . --max-warnings=0`, `npx tsc --noEmit`, `npm test`, `npm run build`, and `pytest` all exit with code `0` locally and in GitHub Actions CI.
- [ ] GitHub Actions `ci-quality-gate.yml` is green on `main`.
- [ ] Backup and restore runbook (`docs/operations/backup-and-restore-runbook.md`) is verified with actual export/import execution timestamps and artifact checksums.

---

### Gate 4 — External Legal, Regulatory, Security & Financial Sign-Off

**Objective:** Obtain independent human professional sign-off on areas that neither the founder nor an AI agent can self-certify prior to closing an institutional or angel seed round.

| Workstream | Required Qualified Professional | Scope of Review & Deliverable | Pre-Investment Requirement |
| :--- | :--- | :--- | :--- |
| **4.1 IP Chain of Title & Open-Source / AI Licensing** | **UK Technology Solicitor** | Review founder IP assignment into the corporate vehicle; review terms of service of AI coding providers (Google Gemini, Anthropic Claude, OpenAI) regarding commercial ownership of generated code; audit `licence-inventory.json` and TypeDB driver licensing. | Executed Deed of IP Assignment + Legal Opinion / Disclosure Letter |
| **4.2 UK Regulatory Perimeter (FSMA / FCA)** | **FCA Regulatory Lawyer or Compliance Consultant** | Review AI Capital Intelligence's research ratings (`strong_buy` to `strong_sell`), thesis monitor, and portfolio risk analytics against FSMA 2000 Regulated Activities Order (Article 53 "advising on investments" vs general financial research) now that execution is disabled under `RESEARCH_ONLY_DEPLOYMENT`. | Written Regulatory Perimeter Memo & UI Disclaimer Sign-Off |
| **4.3 Independent Penetration Test & Cloud Config Audit** | **CREST-Accredited Security Assessor (or Independent Security Engineer)** | Perform black-box/grey-box testing of Next.js API routes, Clerk JWT validation, Convex query/mutation access controls, AES-256-GCM broker vault isolation, and direct out-of-band inspection of Vercel, Clerk, and Convex production consoles. | Independent Security Assessment Report with 0 Critical / 0 High open findings |
| **4.4 Unit Economics & Cloud Billing Verification** | **Chartered Accountant / Technical Financial Reviewer** | Reconcile actual invoices and usage dashboards from Vercel, Convex, Clerk, Google Cloud / Gemini API, and Hetzner against projected per-query and per-seat gross margins. | Verified Unit Economics Schedule |

#### Gate 4 Exit Criteria (Pass/Fail)
- [ ] Corporate vehicle incorporated with clean cap table and executed founder IP assignment.
- [ ] Written FCA perimeter confirmation for research-only operation (or B2B enterprise software licensing model).
- [ ] Independent technical assessor has directly inspected live Vercel/Convex/Clerk consoles and verified `Gates 0–3`.
- [ ] Historical provider billing invoices compiled in the investor data room.

---

### Gate 5 — Commercial Discovery & Second-Vertical Validation Gate

**Objective:** Validate external customer demand and prove whether the proposed Vectis ONE patterns warrant extraction into a multi-tenant platform before committing seed capital to multi-vertical engineering (`D14`).

#### Required Actions
1. **Structured Customer Discovery (15–20 Interviews):**
   - Conduct and record structured discovery interviews with prospective buyers across two candidate segments:
     - **Segment A (Vertical Application):** Family offices, independent wealth managers, or boutique fundamental research desks evaluating AI Capital Intelligence as a dedicated research and portfolio risk workbench.
     - **Segment B (Horizontal Architecture / Second Vertical):** Regulated research teams (e.g., pharmaceutical/clinical trial intelligence, energy infrastructure intelligence, or legal/compliance due diligence) evaluating an evidence-governed AI research workspace.
2. **Commercial Validation Milestone (LOIs / Paid Design Partners):**
   - Secure at least **2–3 signed Letters of Intent (LOIs)** or **1–2 paid design-partner pilot agreements** defining concrete acceptance criteria, data sources, and pricing.
3. **Disciplined Architecture Stop/Go Decision:**
   - **Path 1 (Vertical Focus):** If demand concentrates in Segment A, focus seed capital on hardening AI Capital Intelligence as a single-vertical institutional research & portfolio risk product without premature multi-tenant ontology extraction.
   - **Path 2 (Platform Extraction):** Only initiate Phase B/C multi-tenant extraction (`organizationId` row-level isolation across all Convex tables and dynamic TypeDB schema loader) after a second-vertical design partner signs a committed pilot agreement.

#### Gate 5 Exit Criteria (Pass/Fail)
- [ ] Customer discovery log (minimum 15 qualified buyer interviews) completed and shared with seed investors.
- [ ] At least 1 paid pilot or 2 qualified LOIs secured prior to initiating multi-tenant platform engineering.

---

## 4. Recommended Capital Tranching & Milestone Alignment

For prospective seed investors, the remediation and readiness gates above naturally map onto a milestone-gated funding structure:

1. **Pre-Close Conditions Precedent (`Gates 0, 1, 2, 3`):**
   - Completed by the founder and engineering workflow prior to investment completion (estimated **8–12 engineering days**, zero external capital required).
   - Independently verified on a clean checkout by the investor's technical assessor.
2. **Closing / Tranche 1 Conditions (`Gate 4`):**
   - Legal IP assignment, FCA perimeter memo, and initial security sign-off completed at or immediately following seed close.
3. **Tranche 2 / Series A Readiness (`Gate 5`):**
   - Commercial pilot revenue, multi-tenant `organizationId` isolation across Convex and TypeDB, and SOC 2 Type I / ISO 27001 readiness.
