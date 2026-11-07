# Case 006 v2 — acceptance and forward-activation status

Assessed **5 November 2026**. Version 1 (`recovery-006-2026-11-03-source-v1`, `data/recovery/november-3-2026.json`) and every historical evidence contract are unchanged. Its file hash is pinned and tested.

## Nature of v2

**v2 is a retrospective reconstruction, not an authentic 3 November forecast.** Every v2 observation, including the 3 November anchor closes, carries its actual receipt time on **5 November 2026 (14:25–14:26 UTC)**. Nothing is backdated. Version 1 was captured on 3 November before the anchor close was published, and it still records that close as missing. A strict view at the anchor shows no v2 evidence. The `recovery-006-v1` protocol and the `recovery-confirmation-v1` criteria are unchanged.

## Phase A — v2 acceptance

| Step | Status | Evidence |
| --- | --- | --- |
| A1 Anchor-date correction in both engines | **Done** | `recoveryMomentum` / `recovery_momentum` take an end bound, and the classifier ends at the registered anchor. Tests: `tests/recovery-case-v2.test.ts`, `worker/test_market_recovery.py` (anchor fix; no earlier-close substitution) |
| A2 Identical values and classifications | **Done** | `tests/recovery-v2-acceptance.test.ts` runs `python -m worker.market_recovery` on the v2 request. Classification, missing evidence, anchor dates, 1/5/20-session returns and drawdowns (to 1e-12), positive-session counts, macro values and all 12 outcome statuses match TypeScript |
| A3 Below the Convex import limit | **Done** | Compact v2 payload is 334,469 bytes against an 800,000-byte limit (tested) |
| A4 Authenticated import under a new source ID | **Done 6 Nov 2026** | Imported by the signed-in owner through `POST /api/research/import` (the "Import source package" button on `/recovery`) into Convex dev deployment `prestigious-dragon-8` (eu-west-1). Convex record `q9787byqmmnfb2gypy9n0v7dwh8hqg4x`, actual `ingestedAt` 2026-11-06T12:42:30Z, audit row `recovery.case.imported`. v1 was not touched. Earlier implementation note: | `POST /api/research/import` with `{"packageId":"recovery-006-2026-11-03-source-v2"}`. It checks the same origin, resolves the owner from the Clerk→Convex identity through `recovery:viewer`, verifies the pinned hash and calls internal `recovery:importCase` with the server admin key. Emulator test: v1 and v2 coexist as separate records, v1 is unchanged, and v2 content under the v1 ID is rejected. **Blocked:** no Convex deployment or Clerk keys are configured (`.env.local` is absent) |
| A5 Later receipt times preserved | **Done (emulator)** | Stored v2 prices keep their 5 November `receivedAt`. Convex adds its own `ingestedAt`. Import rejects any receipt later than actual ingestion |
| A6 Retrospective documentation | **Done** | This file; `data/recovery/SOURCES.md` (source version 2); `docs/recovery-experiment.md` (source v2 result) |

## Reproducible dataset hashes

| Source ID | File SHA-256 | Canonical-record SHA-256 (as stored in Convex) | Import bytes |
| --- | --- | --- | ---: |
| recovery-006-2026-11-03-source-v1 | `1dee78dd69b1e4da500d93d09bc090d49d0c807cdb3bdc48eae4def07a76bd87` | `92a6fcec23aac123ca3e3bc10ab79d24c49af6dfe85445d7b62fc6b8f32e22f4` | 163,548 |
| **recovery-006-2026-11-03-source-v2** | `a9c720d139341e253ad39d1557ec9ce4fa625d129e1f0df976163333c93b7440` | `78007c644d5df994c074a8afe9ac8acaae1b2a7bf44e0727c8bebeca7d7a09d1` | 334,469 |
| policy-risk-001.2-midterm-2026-11-03-source-v1 | `77c1edceafc55a1a8aad701222b2b52af0e9f7bc943672d24bf23a45a3eb689f` | `7543d10d7a4760be6b1bbd4333cc52abcb418c93ce0713c1c292cef54b72de92` | 252,369 |

Pins live in `lib/research-packages.ts`. Changing a single byte makes import fail, so a correction needs a new file, a new ID and a new pin.

## Phase B — £500 experiment preparation

| Step | Status |
| --- | --- |
| B1 Licensed historical and forward price provider | **Blocked.** No provider key or licence is configured. Current closes are Nasdaq public-reference, unadjusted and unlicensed |
| B2 Exchange calendar and corporate actions | Calendar: done (NYSE sessions, holidays and early closes in the package). Corporate-action adjustment: **blocked** on a licensed adjusted feed |
| B3 Versioned broker dealing, FX and spread assumptions | **Awaiting your decision.** Plan schemas require every cost field, and unknown is never zero. The values must come from your broker's account terms, which I have not assumed |
| B4 Actual or labelled estimated execution prices | Engine supports it; blocked on B1 and B3 |
| B5 Three independent portfolios | Engine and Convex `registerCase006` create exactly three £500 records and 12 windows. Registered locally only |
| B6 Forward evidence with trusted server timestamps | Convex sets `ingestedAt`, `registeredAt` and `evaluatedAt` server-side. **Blocked** on deployment |
| B7 Score only completed compatible windows | Enforced and tested. All 12 windows are pending: no licensed prices, FX or costs |

## Phase C — analyst signal validation

**Blocked.** No licensed recommendation or target-revision feed is configured (`BENZINGA_API_KEY` or an equivalent). The existing engine (`lib/analyst-consensus.ts`) already separates headline ratings from target revisions and has an incremental-information comparison against the rules baseline. With zero licensed rows it reports nothing rather than estimating.

## Completion evidence

| Item | Value |
| --- | --- |
| Imported Convex source ID | `recovery-006-2026-11-03-source-v2` → Convex record `q9787byqmmnfb2gypy9n0v7dwh8hqg4x` (deployment `prestigious-dragon-8`, **development**) |
| Reproducible dataset hash | v2 file `a9c720d139341e253ad39d1557ec9ce4fa625d129e1f0df976163333c93b7440`. Stored record re-hashed from Convex: `78007c644d5df994c074a8afe9ac8acaae1b2a7bf44e0727c8bebeca7d7a09d1`, which matches the pin |
| Authentication and ownership checks | **Live on the dev deployment.** Record owner is the verified Clerk identity `https://harmless-akita-9211.clerk.accounts.dev\|user_3LjSsuJX398YIJRdss5Q7PqsSH9`. Unauthenticated `recovery:list` and `recovery:detail` return "Sign in required". Public calls to `recovery:importCase` fail (internal only). The import route refused unauthenticated requests (`sign_in_required`). Cross-owner refusal is verified in the emulator only, since a second user has not been created. **Not yet run on a production Clerk/Convex instance** |
| Price and FX provider coverage | Licensed: **none**. Public reference: Nasdaq closes for 8 recovery instruments (1 Sep – 4 Nov 2026) and 16 policy-risk tickers; BoE XUDLUSS GBP/USD to 4 Nov (indicative, not close-aligned) |
| Genuinely forward-registered observations | **0** |
| Outcome windows | Case 006: 0 complete / 12 pending. Benchmark 001.2: 6 complete (1-session) / 18 pending |
| Real provider charges | **£0 / $0**. No paid provider was called |
| Live order placement / risk approvals | Unchanged. No order path was added, and broker connections stay read-only |

## Remaining blockers

1. **Production instances.** Development Clerk (Trading App, `harmless-akita-9211`) and the Convex dev deployment `prestigious-dragon-8` are connected and in use. Production still needs Clerk production keys on an owned domain and `npx convex deploy`.
1a. **Receipt check:** all 8 anchor closes in the stored v2 record keep `receivedAt` 2026-11-05T14:25:01–14:25:29Z, and no stored price has a receipt earlier than that.
2. **A licensed price, adjustment and FX provider**, with a licence covering this use.
3. **Your broker cost schedule** (dealing fee, FX fee, spread or slippage convention, platform fee, cash rate), versioned and with a source.
4. **A licensed analyst ratings and target feed.**
