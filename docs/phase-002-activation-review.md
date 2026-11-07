# Phase 002 — Unified Live Trading Workspace: activation review

Prepared 6 November 2026 for the owner's separate activation decision. **Live order submission is not enabled.** `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` are both unset, the Live emergency switch defaults to *engaged*, and no order of any kind was submitted during implementation or testing. Environment: Clerk development instance and Convex dev deployment `prestigious-dragon-8`. This is **not** production-ready.

## What was added (existing modules reused, nothing replaced)

| Area | Implementation |
| --- | --- |
| Order model | `lib/trading/order-model.ts` (`trading-002-v1`): state machine, draft validation, deterministic risk, confirmation payload, broker-status mapping, reconciliation matcher |
| Broker client | `lib/brokers/trading212-orders.ts`, separate from the read-only adapter. Covers instruments, pending orders, order by id, order history with fills, dividends, submit and cancel. Submit and cancel refuse unless the server enables execution |
| Records and audit | `convex/trading.ts` with tables `tradeOrders`, `tradeOrderEvents`, `tradingSettings` and `tradingCredentials`. Every transition writes an event |
| Server enforcement | `POST /api/trading` (`lib/trading/server.ts`): Clerk session, same origin and strict request schemas |
| UI | `/trading`, linked from Market Radar: environment selector, gate status, opt-in, trading key, ticket, risk result, approval, final confirmation, broker status, monitor, limits |
| Vault | Unchanged key and format. Trading keys use a separate authenticated-data purpose (`orders`), so read and trading ciphertexts cannot be swapped |
| Existing | Read-only connection, paper ledger, reviewer roles, research records and risk tests are unchanged |

**Authority:** Trading 212 is authoritative for executed orders, fills and holdings. Convex is authoritative for proposals, approvals, risk decisions, submission claims and the audit trail.

## Official API facts this design relies on (docs.trading212.com, read 6 Nov 2026)

- **Not idempotent:** order placement is documented as "not idempotent", with no client order id. A repeated request can create duplicate orders.
- **Order shape:** sells use a negative quantity. Orders are by quantity only, in the primary account currency. The API is for Invest and Stocks ISA accounts and is in **beta**.
- **Scopes:** `orders:execute` is required to place orders; reading uses separate scopes.
- **Rate limits** are per account: market 50/min; limit, stop and stop-limit 1 per 2 s; pending list 1 per 5 s; order by id 1 per s; history 20/min; instruments 1 per 50 s. There is a maximum of 50 pending orders per ticker.
- **No quote endpoint.** The only broker price is a held position's `currentPrice`, so the price reference is **indicative only**, and orders in instruments you don't hold are blocked until a licensed quote source is added.
- **Cancellation** "is not guaranteed if the order is already in the process of being filled."
- **Not read:** the Terms PDF and some sub-pages (cancel, instruments, exchanges) were read only from the spec bundle. Review the API Terms before activation.

## The eight execution controls (each enforced server-side, several twice)

1. **Signed-in owner:** Clerk session, then the Convex owner identity. Every record is owner-scoped.
2. **Active reviewer grant:** required to approve, and re-checked at the moment of submission.
3. **Approved order proposal:** submission is claimable only from `confirmed`, which can only follow `approved`.
4. **Deterministic risk check:**
   - It fails closed on any unknown input.
   - Approval cannot waive it, and re-evaluating after approval returns the order to `draft`.
   - Limits: per-order value, position exposure, daily realised loss, price age, FX fee and instrument types. They are owner-configurable, but only by a reviewer and not while an order is outstanding.
5. **Fresh price reference:** at most `maxPriceAgeSeconds` old (default 120 s), and the account sync must be at most 5 minutes old.
6. **One-time confirmation:**
   - A random token is returned once; Convex stores only its SHA-256 hash.
   - It expires after 60 s and is bound to a SHA-256 of the exact order details, price reference and risk evaluation time.
   - A confirmation that goes stale before submission returns the order to `approved`.
7. **Execution flag:**
   - Live requires `LIVE_TRADING_ENABLED=true` **and** the emergency switch released by a reviewer with a reason.
   - Demo requires `DEMO_TRADING_ENABLED=true`.
   - Engaging the emergency switch is always allowed.
8. **Separate trading key:**
   - It is saved only after the owner accepts an exact opt-in statement.
   - It is stored in `tradingCredentials`, never in the read-only connection.
   - Read-only credentials are never used for orders, and there is no fallback (tested).

Model and automation identities are refused everywhere. No background job submits.

## Duplicate prevention and state machine

`draft → reviewed → approved → confirmed → submitting → acknowledged → partially_filled / filled / cancelled / rejected / unknown`. Owner or reviewer exits are `withdrawn`, `declined` and `not_placed`.

- **Single submission path:** `submitting` is reachable only from `confirmed`, by an atomic Convex claim with a unique submission id. A second claim, a double click or a replayed request is refused.
- **One POST per attempt:** no automatic retry, and redirects are refused.
- **Ambiguous outcomes:** a timeout, transport error, 408 or 5xx response, an unreadable success body, or an interrupted claim (a server restart) records `unknown`. It is never retried.
- **Reconciliation** matches only a *single new* API-initiated order with identical ticker, signed quantity, type and prices, created within the submission window and absent from the pending orders captured before submission. Several matches stay `unknown` for manual review. `not_placed` requires at least two empty checks spanning at least 5 minutes.
- **Broker is authoritative:** statuses map onto the state machine, terminal states are never overwritten by late reports, and a mismatched broker id is refused.

## Test evidence (mocked broker; Phase 1 and the offline part of Phase 3)

| Suite | Result |
| --- | --- |
| `tests/trading-order-model.test.ts` | 14 pass: transitions, validation, risk limits, confirmation binding, status mapping, reconciliation, and the client's single POST and no-retry behaviour (timeouts, transport, 5xx and 408 are ambiguous; 4xx is rejected), plus vault purpose separation |
| `tests/trading-convex.test.ts` | 14 pass: model refusal; owner isolation; reviewer and risk gates; one-time and expired confirmations; changed details; server flag; opt-in; missing key; revoked grant; the Live emergency switch; duplicate claims; stale confirmations; acknowledged, partial and filled outcomes; rejected; unknown and reconciliation; interrupted submission; key separation; limits; ledger independence |
| `tests/trading-server-security.test.ts` | 6 pass: Live refused before decrypting keys or contacting the broker; emergency switch; sign-in, origin and strict schema; no read-key fallback; no credential echo |
| `npm run test:browser:trading` | Pass: the Live-disabled banner, fail-closed signed-out submission, cross-origin refusal, no browser storage, mobile layout |

**Whole project:** all TypeScript tests (387) and all Python tests pass, typecheck is clean, and the broker, recovery and policy browser checks pass. Lint has only the pre-existing `recovery-monitor.tsx` false positive.

## Rollout status

| Phase | Status |
| --- | --- |
| 1. Screens and state handling against mocks | **Done** |
| 2. Real Trading 212 **Demo** submission | **Not run.** Needs a demo-account trading key (scopes: orders execute and read, metadata, history), `DEMO_TRADING_ENABLED=true` in `.env.local`, a restart, then the owner proposing, approving, confirming and submitting a small demo order |
| 3. Duplicates, partial fills, rejection, cancellation, disconnects, timeouts, restarts | Mocked and Convex-level **done**. Against the real Demo API: pending Phase 2 |
| 4. Deployment, authentication, two-user isolation, secret rotation, monitoring | Not done. Dev only; two-user isolation tested in the emulator; no production deployment, alerting or key rotation runbook |
| 5. Owner activation review | **This document.** Live stays disabled until you decide separately |

## Known limitations before any Live activation

- **No price outside held positions:** there is no broker quote endpoint, so new-instrument orders are blocked until a licensed quote feed is added.
- **Daily-loss check depends on history:** it uses realised P/L from today's order-history fills. If Trading 212 omits the field, trading is blocked (fail closed).
- **Monitoring is on request:** polling is manual. There is no background scheduler, alerting or stale-order notification.
- **Rate spacing is per server process:** it is held in memory, so multiple instances would need a shared limiter.
- **Dividends and fills are displayed, not booked:** no double-counting is possible, but there is no reconciled performance ledger for actual holdings yet.
- **Beta API:** behaviour and scopes may change; re-verify before activation.
- **Production gaps:** a Clerk production instance, `npx convex deploy`, HTTPS origins and separate production keys.

## Activation checklist (owner decisions, in order)

1. Complete Phase 2 on **Demo** and review its audit trail.
2. Read the Trading 212 API Terms.
3. Set limits (reviewer) appropriate for real money.
4. Create a separate Live key with only the scopes needed. Record the opt-in and save it on `/trading`.
5. Only then: set `LIVE_TRADING_ENABLED=true` on the server **and** release the emergency switch with a reason. Both are reversible: engaging the switch stops Live submission immediately.
