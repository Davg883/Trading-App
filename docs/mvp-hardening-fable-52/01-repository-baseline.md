# 01 — Repository baseline

**Review date:** 10 November 2026
**Baseline revision:** `639a2ed` (`main` and the working branch were identical at the start)
**Working branch:** `claude/exciting-bardeen-f4y1iz` (the session's designated branch; the brief suggested `security/mvp-hardening-fable-review`, but this environment may only push to the designated branch)
**Verification level of this document:** V1 (code inspected) and V2 (commands run locally). Nothing here was observed in production (V3).

## 1. Required background documents

| Document | Present in repository? |
|---|---|
| `docs/investor-due-diligence/opus-independent-technical-review.md` | **No** |
| `docs/investor-due-diligence/opus-investor-red-flags-and-mitigations.md` | **No** |
| `docs/investor-due-diligence/10-technical-evidence-register.md` | **No** |
| `docs/investor-due-diligence/11-remediation-plan.md` | **No** |
| `docs/investor-due-diligence/12-verified-capability-register.md` | **No** |
| `docs/investor-due-diligence/13-seed-investment-readiness-gates.md` | **No** |
| `docs/github-actions-startup-failure-reconciliation.md` | Yes |
| Gemini Argon "Stage 1A" pre-implementation design / Convex acceptance-token architecture | **Not found** in any branch or file |

The `docs/investor-due-diligence/` directory does not exist on any branch, and no commit has ever touched it. The findings attributed to the Opus and Argon reviews in the brief were therefore verified directly against the code; their contents were not assumed. The Argon proposal was assessed only as it is described in the brief.

## 2. Deployment architecture (as found in code)

| Component | Role | Evidence |
|---|---|---|
| Next.js 16.4.3 on Vercel | Web tier, API routes (`app/api/*`), session proxy (`proxy.ts`) | `package.json`, `app/` |
| Clerk | Authentication; Convex verifies Clerk JWTs (`convex/auth.config.ts`) with extra issuer/audience/authorised-party checks (`convex/authz.ts`) | |
| Convex Cloud | System of record, scheduled jobs (`convex/crons.ts`: 15-minute cycle, two weekday briefing crons), HTTP actions (`convex/http.ts`) | |
| TypeDB Cloud | Knowledge graph; reached from Convex actions and, optionally, from Next.js | `lib/graph/typedb-driver-adapter.ts` |
| Google Gemini | Evidence-locked chat answers | `lib/graph/gemini-provider-adapter.ts` |
| Python worker | Remote research staging agent; least-privilege environment assertion | `worker/remote_research.py` |
| Trading 212 | Read-only account sync (`lib/brokers/trading212.ts`) **and** an order-execution client (`lib/brokers/trading212-orders.ts`) | |
| GitHub Actions | One workflow: scheduled trigger of the Convex scheduler HTTP endpoint plus one Python test file | `.github/workflows/remote-research-operations.yml` |

## 3. Paths able to place Trading 212 orders (before the review)

`/api/trading` → `lib/trading/server.ts` `handleTrading` → `Trading212OrderClient.submit` / `.cancel`, gated only by `LIVE_TRADING_ENABLED` / `DEMO_TRADING_ENABLED` being the string `true`, plus Convex state (opt-in, reviewer grant, confirmation, kill switch). No research agent, worker or Convex function could reach the order client. See `04-research-only-execution-boundary.md`.

## 4. Baseline command results (commit `639a2ed`, Linux, Node 22.23.4, Python 3)

| Check | Result |
|---|---|
| `npm ci` | Succeeds, but Vitest **cannot start**: the lockfile carries only the Windows native binding for the bundler (`@rolldown/binding-win32-x64-msvc`). Worked around locally by unpacking the Linux binding; fixed permanently in WP5. |
| `tsc --noEmit` | Pass |
| Vitest (after the binding workaround) | **521 passed, 7 failed** of 528 |
| — 3 failures | Pinned evidence-package SHA-256 mismatch: the pins were registered from Windows (CRLF) checkouts; a Linux checkout is LF. |
| — 4 failures | Require a live TypeDB server (`HDR1 Cannot connect`). |
| Python `unittest` | 218 passed, **1 error** (live TypeDB driver not installed / server not reachable) |
| ESLint | **31 errors**, 21 warnings (25 `no-explicit-any`, 4 `react-hooks/purity`, 2 `no-unescaped-entities`) |
| `next build` | Pass |
| `npm audit` | 8 moderate, 0 high, 0 critical (all in the ESLint toolchain: `typescript-eslint`, `eslint-config-next`, `minimatch`) |
| actionlint 1.7.7 | No findings on the existing workflow |

The earlier claim of "528 tests passing" could not be reproduced on a clean Linux checkout without intervention, and 7 of those tests depend on line endings or a live server.

## 5. Classification of previously reported findings

| Reported finding | Classification | Notes |
|---|---|---|
| `operations:publicOperationsOverview` falls back to `RESEARCH_OWNER_ID` for anonymous callers | **CONFIRMED** | Returned that owner's chat telemetry, spend, run history, staged research, briefing and broker connection state. |
| `evidenceChat:getChatOperationsTelemetry` anonymous owner fallback | **CONFIRMED** | |
| Unscoped `brokerConnections ... order('desc').first()` | **CONFIRMED** | Reached when the configured owner had no broker row: returned another user's connection. |
| Unscoped `evidenceChatAudit ... order('desc').take(...)` | **CONFIRMED** | In both functions above. |
| Public `consumeAcceptanceNonceAndGetContext` / `recordAcceptanceChatTurn` | **CONFIRMED** | Plus: nonces from `Math.random`, stored in clear in the general audit table, no question binding, unvalidated audit fields. |
| Research-only product contains an order-execution path | **CONFIRMED** | Enabled by two environment strings. |
| Fail-open Clerk proxy | **PARTIALLY CONFIRMED** | `proxy.ts` passed every request through when Clerk was unconfigured or threw. Route handlers still call `auth()`, so this was not an authentication bypass, but it hid broken authentication. |
| Hard-coded Clerk user identifiers | **CONFIRMED** | Fallback owners in `convex/graph.ts`; identifiers also appear in several `docs/*.md` reports. |
| TypeDB `admin`/`password` defaults | **CONFIRMED** | Used whenever settings were missing, in any environment. |
| Misleading TLS badge | **CONFIRMED** | `/data-room` showed TLS when the database name was `aci_macro_intelligence_staging`; operations status hard-coded "TLS enabled" next to a `:80` host. |
| In-memory rate limits presented as protection | **CONFIRMED** | Two per-process `Map` limiters. |
| Hard-coded Gemini request IDs | **CONFIRMED** | `Tj3yaoqeGa6xuMYPoMuKoAk`, attached to two **different** token accountings. |
| `Date.now()` request IDs, default token counts, placeholder hashes, fallback = expected answer, citation checks that ignore the answer | **CONFIRMED** | `lib/portfolio/portfolio-live-eval-5.ts`, `-15.ts`. |
| CI runs no application tests | **CONFIRMED** | |
| Trading 212 fixture resembling a live connection | **CONFIRMED** | `evaluatePhaseG8MultiAssetPilot` labelled a hard-coded £250 balance `trading212_live_read_only`. |

## 6. Findings not in the earlier audits

| Finding | Severity |
|---|---|
| `graph:executeReadOnlyCloudTypeQl` was an **anonymous public Convex action** running caller-supplied TypeQL with the deployment's TypeDB credentials (full graph read, including `private_tenant` data). Sibling probe/verify actions were also anonymous; the Next.js bridge fell back to a hard-coded Convex URL. | High |
| `graph:executeAllowlistedCloudGraphQuery` accepted an arbitrary client-supplied `callerId`. | Medium |
| `graph:projectPendingOutboxNow` accepted any identity (including model actors, unverified issuers) although it writes to TypeDB. | Medium |
| `evidenceChat:checkGeminiProviderStatusAction` let anonymous callers make the deployment call the provider with its key. | Low |
| `/api/graph/chat` trusted an `x-aci-test-caller` header on any non-production build whose `Host` header said `localhost`. | Low (development builds only) |
| Status rows set `lastVerifiedAt: now` on every read, presenting declarations as fresh verification. | Medium (integrity) |

## 7. Changes after the Opus/Argon audit

The only post-audit commits before this review were `04f12a6` and `7970ac6` (workflow startup fix and trading-flag isolation for the research agent) and `639a2ed` (documentation). None addressed the findings above.
