# Convex backend

`research.ts` implements owner-scoped reads and paper research mutations. Public functions always resolve the authenticated token identifier; ownership is never accepted from browser arguments. Ingestion and forecast writes are internal functions callable only by trusted backend orchestration. There is no broker or live execution function.

Set `CLERK_JWT_ISSUER_DOMAIN` in the Convex environment and configure Clerk's `convex` JWT template. Without it, the provider list is empty and authenticated access remains unavailable. Deploy with `npx convex dev` after selecting your own Convex project. No deployment credentials are checked in.

Evidence records are append-only; frozen experiments retain record IDs and a protocol version. A forecast may only cite its frozen bundle, must arrive before the experiment deadline and has a unique submission key. The three probabilities are ordered **up, down, neutral**. Returns use decimal fractions, not percentages.

Portfolio creation defaults to synthetic mode. A real-observation paper portfolio must explicitly set `synthetic: false`; it cannot consume synthetic prices. Reviews require a human identity and note. A subsequent quote must be at or after approval. Execution recomputes risk and atomically inserts a fill, reduces cash and records the audit event. Replays return the existing fill ID. Approvals expire after five minutes; quotes expire after one minute.

Benchmark 001 currently supports long-only accumulation. The position budget is 25% of the lower of initial capital and cash plus holdings at book value. It is a fixed-capital experiment constraint, **not a live mark-to-market margin system**. No sell/close mutation or broker borrowing is exposed. A production trading expansion must supply complete marked holdings, closing trades and exchange-calendar scheduling.

Dashboard queries return at most 500 records per collection. This is a pilot ceiling; pagination must be added before scaling. The app's browser-local synthetic demonstration is intentionally separate from this authenticated database.

## Tests

`npm test` covers authorization, owner isolation, late evidence, approval checks, ledger idempotency, cash reconciliation, score calculations, execution costs, and independent risk rules. `convex-test` runs the actual backend functions in a local emulator; it does not prove a hosted deployment is configured.

## Provider adapters

`lib/providers.ts` contains server-only, timeout-bounded SEC company-facts and FRED adapters and a strict model-response contract. SEC requires `SEC_USER_AGENT`; FRED requires `FRED_API_KEY`. FRED's ordinary series response is explicitly labelled `pointInTime: false`; do not use it as historical vintage evidence. Ingestion scheduling, licensed price-feed adapters and external model orchestration require configuration and remain separate from these raw fetch adapters.

## Benchmark 001.2 policy risk

`policyRisk.ts` persists the US Midterm Infrastructure Risk study. Case import, later observation sets and outcome evaluation are internal. Authenticated owners can list, inspect and register frozen retrospective studies. Outcomes are always recomputed server-side from the frozen registration. See [docs/policy-risk.md](../docs/policy-risk.md#convex-persistence-convexpolicyriskts).
