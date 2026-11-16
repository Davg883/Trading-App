# 10 — Technical Evidence Register

**Assessment:** Vectis ONE / AI Capital Intelligence — Seed Technical Due Diligence
**Assessment date:** 10 November 2026 (all "last verified" dates are 10 Nov 2026 unless stated)
**Repository:** `github.com/Davg883/Trading-App`, branch `main`, HEAD at time of audit `639a2ed`
**Assessor's position:** AI coding assistant acting as independent assessor. This is the same assistant that wrote several of the earlier reports and commits under review, so it is not a fully independent third party. Every claim below was re-derived from code, Git, test output or live HTTP observation during this assessment, not copied from earlier reports.

## Verification levels

| Level | Meaning |
|---|---|
| **V1 – Code inspected** | Behaviour inferred from reading source. Not executed. |
| **V2 – Tested locally** | Executed on the developer workstation during this assessment. |
| **V3 – Production observed** | Observed against `https://capital.aiguides.co.uk` or GitHub's live API during this assessment (anonymous or read-only). |
| **V4 – Independently verified** | Verified by a party other than the founder or the AI tools. **No claim currently reaches V4.** |
| **CLAIMED** | Stated in an earlier project report; not re-verified. |
| **NOT VERIFIED** | No evidence available to the assessor. |
| **CONTRADICTED** | Evidence conflicts with an earlier claim. |

Credentials, environment files, user identifiers and brokerage data were not read or reproduced. Identifiers found in the repository are shown as `[REDACTED]`.

---

## A. Repository, history and build

| ID | Claim | Evidence type | Location / proof | Commit | Level | Limitations | Confidence |
|---|---|---|---|---|---|---|---|
| E-01 | Git history has 60 commits from 7 Nov 2026 15:20 to 10 Nov 2026 15:58, all by one author identity. | Git | `git rev-list --count HEAD`, `git shortlog -sne` | `1698386`…`639a2ed` | V2 | Author identity is self-declared Git metadata. | High |
| E-02 | The first commit ("Phase 005") imported 341 files and 113,073 lines. Phases 001–004 and the earlier case studies predate version control. | Git | `git show --stat 1698386` | `1698386` | V2 | Pre-Git history cannot be audited. | High |
| E-03 | Work started no later than 29 Oct 2026: local test artefacts carry that date. | File timestamps | `test-results/earnings-demo-worker-check` (29/10/2026) | — | V2 | File timestamps can be changed; these artefacts are untracked. | Medium |
| E-04 | Source size: 172 `.ts` files (45,752 lines), 56 `.tsx` (7,515), 39 `.py` (7,458), 21 `.mjs` (1,772). Curated JSON data: 37 files (102,616 lines). | Line count | `git ls-files` + line count | HEAD | V2 | Raw line counts include generated and data-like code (for example, a 3,392-line TypeScript file of hard-coded portfolio data). They are not a measure of product value. | High |
| E-05 | Since the import commit: 145 files changed, 65,921 lines inserted, 190 deleted. | Git | `git diff --shortstat 1698386 HEAD` | — | V2 | Very low deletion ratio suggests additive, AI-generated growth with little refactoring. | High |
| E-06 | Vitest: 58 files, 528 tests passed (10 Nov 15:47). | Test run | `npm test` | `481eb92` working tree | V2 | Some tests need a live TypeDB server, so the suite is environment-dependent. Several tests assert hard-coded constants (see E-16). **Not run in CI.** | High that the tests pass; Low that they prove production behaviour |
| E-07 | Python worker tests: 219 passed. | Test run | `npm run test:python` | HEAD | V2 | Only 8 of these run in CI (`test_remote_research.py`). | High |
| E-08 | ESLint reports 52 problems (31 errors, 21 warnings). | Lint | `npx eslint .` | HEAD | V2 | Lint is not enforced in CI or the build. | High |
| E-09 | `npm audit --omit=dev`: 0 known vulnerabilities in production dependencies. | Supply chain | `npm audit` at 16:03 | HEAD | V2 | Point-in-time only. No automated dependency scanning (no Dependabot or Renovate configuration in the repository). | Medium |
| E-10 | The production build (`next build`, Next.js 16.4.3 with Turbopack) succeeds. | Build | `npm run build` at 15:46 | `150339e` | V2 | Two Turbopack warnings about dynamic filesystem tracing in `lib/research-packages.ts`. | High |
| E-11 | The largest and most-changed files indicate tight coupling: `lib/portfolio/multi-asset-risk-pilot.ts` (3,392 lines), `lib/research-ratings/thesis-monitor.ts` (2,482), `lib/graph/gemini-provider-adapter.ts` (1,581; 24 commits; 2,044 lines of churn). | Git + line count | `git log --numstat` | — | V2 | — | High |
| E-12 | The repository contains no LICENSE file, contributor agreement or IP assignment record. `package.json` is marked `"private": true`. | File inspection | repository root | HEAD | V2 | Ownership may be documented outside the repository. Legal review required. | High |
| E-13 | **The GitHub repository is public.** | GitHub API | `GET /repos/Davg883/Trading-App` → `"private": false` | — | V3 | — | High |

## B. Production and deployment

| ID | Claim | Evidence type | Location / proof | Commit | Level | Limitations | Confidence |
|---|---|---|---|---|---|---|---|
| E-14 | Anonymous GET requests return HTTP 200 for `/`, `/portfolio`, `/data-room`, `/research-chat`, `/settings/brokers`, `/trading`, `/workspace` and `/stress`. `/dev/command-centre` returns 404. | HTTP probe | `Invoke-WebRequest` at 16:03 | deployed build containing `150339e` | V3 | A 200 response shows only that the page renders. Data on these pages may be client-gated or static. | High |
| E-15 | The production `/data-room` serves the evidence-drawer fix, verified by Playwright at 1440×900, 1280×720 and 390×844. | Browser test | `scripts/test-evidence-drawer-scrolling.mjs` against production | `150339e` | V3 | Anonymous session; it does not test authenticated features. | High |
| E-16 | **Hard-coded "live" telemetry.** The provider request ID `Tj3yaoqeGa6xuMYPoMuKoAk` is a literal in source code and tests, attached to two different supposed Gemini calls with different token counts (3,103 in / 527 out in `lib/graph/chat-benchmark-50.ts:905,966`; 6,983 in / 772 out in `lib/research-ratings/thesis-monitor.ts:790`). Tests assert these constants (`tests/ai-capex-moderation-thesis-monitor.test.ts:220`, `tests/phase-g7-1-financial-integrity-and-g8-pilot.test.ts:205`). The same ID is cited as live evidence in four phase reports. | Code inspection | cited lines | HEAD | **CONTRADICTED** | At most one of these records can describe a real upstream call. Passing tests prove nothing about live inference. | High |
| E-17 | Earlier reports cite Convex audit IDs for live Gemini turns (for example `tn719…`, 7,473 tokens, £0.001117). | Prior report | `docs/ai-capital-intelligence-full-mvp-technical-and-commercial-review.md:26` | `9430942` | CLAIMED / NOT VERIFIED | Checking would need an authenticated read of production Convex, which was out of scope. | Low |
| E-18 | Convex cron jobs are defined: a 15-minute `remote-research-operations-cycle` and two weekday briefing triggers. | Code | `convex/crons.ts` | HEAD | V1 | **Whether they run in production, and how fresh SEC, market and risk data is, were NOT VERIFIED in this assessment.** | Medium (defined); unknown (operating) |
| E-19 | Earlier reports claim five production collectors were "fresh" with specific last-run times on 9 Nov. | Prior report | same document, lines 54–60 | — | CLAIMED | Not re-verified. | Low |
| E-20 | Every push-triggered run of `.github/workflows/remote-research-operations.yml` failed from 7 to 10 Nov 2026 (57 runs reported by the API). Cause: an invalid `secrets` expression in a step `if:` condition. Fixed in `04f12a6`. A second failure (trading flags rejected by the least-privilege check) was fixed in `7970ac6`. | GitHub API | runs `42848116421`, `42849478456`, `42849757669` | `04f12a6`, `7970ac6` | V3 | See E-21. | High |
| E-21 | Follow-up run `42849757669` succeeded, but its production scheduler step **was skipped**: `OPERATIONS_SCHEDULER_SECRET` and `RESEARCH_APP_ORIGIN` are not configured in GitHub. The workflow currently runs only Python checks; it triggers no production work. | GitHub job log | job `129946865310` | `7970ac6` | V3 | The earlier incident report overstated this outcome. | High |
| E-22 | CI does not run the Vitest suite, the TypeScript type check, ESLint or the build. Vercel deploys on push without a test gate. | Workflow inspection | `.github/workflows/remote-research-operations.yml` (only workflow) | HEAD | V2 | Vercel project settings were not inspected (no CLI credentials). | High |
| E-23 | No error-monitoring, tracing or uptime dependency is present (no Sentry, OpenTelemetry, `@vercel/otel` or Datadog). Operational status relies on in-app panels and Convex tables. | Code search | `git grep` | HEAD | V2 | Vercel or Convex dashboard monitoring may exist outside the code. | Medium |
| E-24 | No evidence of backups, restore testing or a documented disaster-recovery process. | Search | repository | HEAD | NOT VERIFIED | Convex and Vercel platform defaults were not inspected. | — |

## C. Security, identity and data boundaries

| ID | Claim | Evidence type | Location / proof | Level | Limitations | Confidence |
|---|---|---|---|---|---|---|
| E-25 | Broker credentials are encrypted with AES-256-GCM and additional authenticated data that binds the ciphertext to owner, environment, key version and purpose (`read` or `orders`). Ciphertext fails to decrypt for another owner, and a self-test is included. | Code + tests | `lib/brokers/vault.ts`; `tests/broker-vault.test.ts` (7 tests) | V1 + V2 | The key is a single environment variable (`BROKER_VAULT_KEY_B64`): no KMS, HSM or rotation procedure. Server-side persistence encryption was not independently verified. | High (design); Medium (operation) |
| E-26 | **Order-execution code exists.** `lib/brokers/trading212-orders.ts` sends POST requests to Trading 212 order endpoints and DELETE requests to cancel orders. `/api/trading` (`lib/trading/server.ts`) exposes saving a trading key, drafting, approving and submitting orders. Submission is gated by owner sign-in, a reviewer role, an approved order, a passed risk check, a fresh price, one-time confirmation, the server flags `LIVE_TRADING_ENABLED` / `DEMO_TRADING_ENABLED` (must equal `'true'`), a Live kill switch that defaults to engaged, and a separately opted-in trading key. | Code | cited files; `convex/trading.ts:56-112` | V1 | **"Execution authority = none" is a runtime configuration state, not an architectural absence.** Production flag values were not verified. | High |
| E-27 | Research agents and the CI worker refuse to start if broker, vault or trading variables are present (`FORBIDDEN_ENV_KEYS_FOR_AGENT`). | Code + CI | `worker/remote_research.py:53-95`; run `42849757669` | V1 + V3 | Applies to the Python worker only. | High |
| E-28 | Isolation is per user: 68 of 69 Convex tables carry an `owner` field. There is **no tenant or organisation entity**. Scheduled cloud collection runs for a single owner set by the `RESEARCH_OWNER_ID` environment variable. | Code | `convex/schema.ts`; `convex/remoteOpsCloud.ts:187` | V1 | — | High |
| E-29 | **Anonymous fallback to the owner's data.** The public Convex queries `evidenceChat:getChatOperationsTelemetry` (`convex/evidenceChat.ts:357`) and `operations:publicOperationsOverview` (`convex/operations.ts:687`) use `RESEARCH_OWNER_ID` when the caller is unauthenticated. An anonymous caller may therefore receive the owner's recent chat audit telemetry and operations overview. | Code | cited lines | V1 | Not exploited or tested in production. Exactly which fields are returned needs review. | High (code path exists) |
| E-30 | The owner's token identifier is hard-coded in `convex/graph.ts:1165`. Clerk user identifiers appear in at least 10 committed documents in a **public** repository. | Code | `git grep` (values redacted) | V1 | An identifier is not a credential, but it supports targeting and correlation. | High |
| E-31 | The Next.js proxy (`proxy.ts`) runs Clerk middleware but **fails open** on any exception (`catch { return NextResponse.next(); }`) and protects no routes. Authorisation sits in API handlers and Convex functions. | Code | `proxy.ts` | V1 | Server-side checks in Convex mitigate this. Defence in depth is reduced. | High |
| E-32 | The TypeDB adapter falls back to `admin` / `password` and `http://127.0.0.1:8000` when environment variables are missing. | Code | `lib/graph/typedb-driver-adapter.ts:38-41` | V1 | Mitigated in production only if the variables are set. | High |
| E-33 | The Gemini chat rate limiter is an in-memory `Map` held per serverless instance. | Code | `lib/graph/gemini-provider-adapter.ts:51-65` | V1 | Not effective across instances or cold starts. | High |
| E-34 | A pattern scan of tracked files for API keys, OAuth tokens, private keys and JWTs found no matches. | Redacted scan | regex scan of `git ls-files` | V2 | Pattern scanning is not exhaustive. Git history was not scanned. | Medium |
| E-35 | **Credential exposure during this engagement:** in the preceding CI task, the assistant ran `git credential fill`, which printed the user's GitHub OAuth token (`gho_…`, scopes `repo`, `workflow`, `gist`) into the assistant's tool logs. The token was then embedded in a later command. | Session record | conversation transcript, 10 Nov 15:53 | V2 | **Remediation: revoke the token and re-authenticate.** | High |

## D. AI, evidence and data integrity

| ID | Claim | Evidence type | Location / proof | Level | Limitations | Confidence |
|---|---|---|---|---|---|---|
| E-36 | Evidence bundles are assembled from six allowlisted query templates and hashed with SHA-256. Model output passes a deterministic validator (schema, bundle hash, citation IDs, numbers, double-counting, injection). | Code + tests | `lib/graph/evidence-retrieval-gateway.ts` (834 lines); `lib/graph/evidence-answer-validator.ts` (540); `tests/evidence-locked-chat.test.ts` (13 tests) | V1 + V2 | Validated against a curated demonstration dataset only. | Medium–High |
| E-37 | The "deterministic evidence synthesiser" produces **templated answers keyed to specific demonstration-dataset identifiers** (`anthropic`, `nscale`, `loughton`, `ireland`), including a fixed "$895.4B" narrative. | Code | `lib/graph/gemini-provider-adapter.ts:395-830` | V1 | Benchmark passes in deterministic mode measure the templates, not model quality. This is not general-purpose. | High |
| E-38 | Model cost is calculated at fixed Gemini 2.5 Flash rates (£0.117 / £0.468 per million input / output tokens) whichever model is used. The allowlist includes 3.x models. | Code | `gemini-provider-adapter.ts:43-46,74` | V1 | Reported costs for other models are approximations. Provider prices were not verified. | High |
| E-39 | The `/data-room` page renders from a static JSON dataset (`data/graph/initial-acceptance-dataset.json`). TypeDB is only probed for status. The "TLS enabled" badge is also set true when the database name equals the staging name. | Code | `app/data-room/page.tsx` | V1 | The graph UI is not driven by live graph queries. The TLS label can be misleading. | High |
| E-40 | One test reached a TypeDB 3.14.2 server from the workstation (`tests/typedb-graph.test.ts` test 7). | Test | Vitest run | V2 | Which server it reached (local or cloud) was not determined without reading environment files. | Medium |
| E-41 | Macro rates (Bank Rate 4.00%, SONIA 3.9852) and instrument yields are **hard-coded literals** in `lib/portfolio/multi-asset-risk-pilot.ts:1042-1050,1172`. | Code | cited lines | V1 | Values are not fetched at runtime and will go stale. Their accuracy was **NOT VERIFIED** against the Bank of England in this assessment. | High (hard-coded); unknown (accuracy) |
| E-42 | In G.8.1, the founder's challenge found that the AI-generated code and reports contained an incorrect Bank Rate (stated as a cut to 4.75% when the official 5 Nov 2026 decision was an increase to 4.00%) and deterministic tests mislabelled as live model calls. | Session record | G.8.1 challenge prompt; `docs/phase-g8-1-independent-financial-integrity-challenge.md` | V2 (record exists) | Shows that human review caught material AI errors. | High |
| E-43 | Live Trading 212 synchronisation: G.8.2 reports `BLOCKED / PENDING_OWNER_AUTHORISATION`, with 0 live snapshots. Earlier G.5 records claimed a live read-only connection. | Prior reports | `docs/phase-g8-2-final-live-connection-gate.md:23,96,106`; G.5 review line 13 | CLAIMED, internally inconsistent | No authenticated broker data was read during this assessment. | Medium that no live snapshot currently exists |

## E. Commercial and productivity evidence

| ID | Claim | Level | Notes |
|---|---|---|---|
| E-44 | Customers, revenue, letters of intent, pilots, grants or investors. | NOT VERIFIED (none found) | No commercial records in the repository. None are claimed in this assessment. |
| E-45 | Provider bills (Vercel, Convex, TypeDB, Clerk, Google AI). | NOT VERIFIED | No invoices or usage exports available. All cost figures in document 07 are planning assumptions. |
| E-46 | Which AI model produced which commit (Gemini "Argon 4.0", Gemini Flash 3.8, Claude, OpenAI Codex). | NOT VERIFIED | No IDE telemetry is available. The workspace path (`GPT 5 CODEX`) and the `AGENTS.md` / `.agents/` conventions suggest several tools were used. Attribution is not measurable. |
| E-47 | Third-party data licences (Stooq, SEC EDGAR fair access, Benzinga, FMP and others). | NOT VERIFIED | `data/consensus/licence-template.json` and several `SOURCES.md` files exist, but no executed licences. |
| E-48 | The Gemini adapter needed five corrective "Phase G.5 restore/fix" commits on 9 Nov (token limits, timeouts, JSON parsing). | V2 | Measured instability in the model integration. |

---

## Summary of verification coverage

| Level | Count of material claims |
|---|---|
| V3 Production observed | 6 |
| V2 Tested locally | 17 |
| V1 Code inspected only | 19 |
| V4 Independently verified | **0** |
| CLAIMED / NOT VERIFIED / CONTRADICTED | 12 |
