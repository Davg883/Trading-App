# AI Capital Intelligence — Phase 005.2: Clerk Production Custom-Domain Cutover & Acceptance Report

- **Date:** 2026-11-07
- **Phase:** `005.2 — Clerk Production Activation & Custom-Domain Cutover`
- **Primary Application Domain:** `https://capital.aiguides.co.uk`
- **Active Vercel Production Deployment ID:** `dpl_8Ufoo9iKpTVCSRPqxig8epx8Y9en` (`READY`, Git commit `a4d0114`)
- **Clerk Production Instance ID:** `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` (`instance_environment_type: "production"`, preserved across cutover)
- **Clerk Production Frontend API & Issuer:** `https://clerk.capital.aiguides.co.uk`
- **Clerk Production Account Portal:** `https://accounts.capital.aiguides.co.uk`
- **Isolated Production Convex Deployment:** `https://benevolent-magpie-921.eu-west-1.convex.cloud`
- **Isolated Preview/Dev Convex Deployment:** `https://prestigious-dragon-8.eu-west-1.convex.cloud`

---

## 1. Custom-Domain Cutover & DNS/TLS Verification (`capital.aiguides.co.uk`)

The existing Clerk Production instance (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`, initially created against `trading-app-theta-two.vercel.app`) was preserved and cut over to the primary custom domain **`capital.aiguides.co.uk`**.

### 1.1 Authoritative GoDaddy DNS (`ns69.domaincontrol.com` / `ns70.domaincontrol.com`) & TLS Status

All 6 CNAME records (1 Vercel application record + 5 Clerk Production records) were verified directly against `ns69.domaincontrol.com` and over HTTPS:

| Purpose | Record Type | Hostname | Resolved CNAME Target | DNS & TLS Status |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Web Application** | `CNAME` | `capital.aiguides.co.uk` | `142550a5694d4daa.vercel-dns-017.com` | ✅ Verified (`200 OK`, TLS active) |
| **Clerk Frontend API (FAPI)** | `CNAME` | `clerk.capital.aiguides.co.uk` | `frontend-api.clerk.services` | ✅ Verified (`200 OK`, TLS active) |
| **Clerk Account Portal** | `CNAME` | `accounts.capital.aiguides.co.uk` | `accounts.clerk.services` | ✅ Verified (TLS active) |
| **Clerk Transactional Email** | `CNAME` | `clkmail.capital.aiguides.co.uk` | `mail.vpbkg0cy8u82.clerk.services` | ✅ Verified |
| **Clerk Email DKIM 1** | `CNAME` | `clk._domainkey.capital.aiguides.co.uk` | `dkim1.vpbkg0cy8u82.clerk.services` | ✅ Verified |
| **Clerk Email DKIM 2** | `CNAME` | `clk2._domainkey.capital.aiguides.co.uk` | `dkim2.vpbkg0cy8u82.clerk.services` | ✅ Verified |

### 1.2 Live Clerk Production Endpoint Verification (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`)

| Endpoint | HTTP Status | Observed Production Response |
| :--- | :--- | :--- |
| `GET https://clerk.capital.aiguides.co.uk/v1/environment` | `200 OK` | `instance_environment_type: "production"`, `home_url: "https://capital.aiguides.co.uk"`, `sign_in_url: "https://accounts.capital.aiguides.co.uk/sign-in"`, `Access-Control-Allow-Origin: https://capital.aiguides.co.uk` |
| `GET https://clerk.capital.aiguides.co.uk/v1/client` | `200 OK` | `Access-Control-Allow-Origin: https://capital.aiguides.co.uk` |
| `GET https://clerk.capital.aiguides.co.uk/.well-known/openid-configuration` | `200 OK` | `"issuer": "https://clerk.capital.aiguides.co.uk"`, `"jwks_uri": "https://clerk.capital.aiguides.co.uk/.well-known/jwks.json"` |
| `GET https://clerk.capital.aiguides.co.uk/.well-known/jwks.json` | `200 OK` | RSA signing key `kid: "ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt"` |
| `GET https://capital.aiguides.co.uk/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` | `200 OK` | Next.js [`proxy.ts`](../proxy.ts) `/__clerk/(.*)` matcher operational |

> **Note on Standard Custom-Domain DNS vs `/__clerk` Proxy Mode:** Because all 5 GoDaddy DNS CNAME records (`clerk.capital`, `accounts.capital`, `clkmail.capital`, `clk._domainkey.capital`, `clk2._domainkey.capital`) are active and verified in Clerk, `capital.aiguides.co.uk` uses **first-party custom-domain DNS (`https://clerk.capital.aiguides.co.uk`)** rather than `.vercel.app` proxy mode. Clearing `NEXT_PUBLIC_CLERK_PROXY_URL` from the Production target in `dpl_8Ufoo9iKpTVCSRPqxig8epx8Y9en` resolved the `400 host_invalid` error and enabled `<ClerkProvider>` on `https://capital.aiguides.co.uk` to load directly from `https://clerk.capital.aiguides.co.uk` (`window.Clerk.loaded === true`, zero console errors).

---

## 2. Environment Variable & Key Prefix Verification (No Secret Values Exposed)

| Environment Variable | Vercel Env ID | Storage Type | Target Scope | Key Prefix / Value | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `yOagQWGJkNyATzfV` | `plain` (Client) | `["production"]` | `pk_live_` (`clerk.capital.aiguides.co.uk$`) | ✅ Matches `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` |
| `CLERK_SECRET_KEY` | `Efj6SJuGOywe3Orq` | `sensitive` (Secret) | `["production"]` | `sk_live_` | ✅ Matches `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` |
| `CLERK_JWT_ISSUER_DOMAIN` | `zfDvAm6LJmQ4m6Ir` | `sensitive` (Secret) | `["production"]` | `https://clerk.capital.aiguides.co.uk` | ✅ Locked to single custom-domain issuer |
| `NEXT_PUBLIC_CONVEX_URL` | `UX70BvcZTHokAQ4x` | `plain` (Client) | `["production"]` | `https://benevolent-magpie-921.eu-west-1.convex.cloud` | ✅ Isolated Production Convex backend |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `OXgCrhiEMy5JfP5p` | `encrypted` | `["preview", "development"]` | `pk_test_` | ✅ Isolated to Preview & Development |
| `CLERK_SECRET_KEY` | `HcGDxbuUKdspHkzy` | `encrypted` | `["development"]` | `sk_test_` | ✅ Isolated to Development |
| `CLERK_JWT_ISSUER_DOMAIN` | `RTlFl2dhRpzdjHhj` | `sensitive` (Secret) | `["preview", "development"]` | `https://*.clerk.accounts.dev` | ✅ Isolated to Preview & Development |
| `NEXT_PUBLIC_CONVEX_URL` | `p0W5RcGjqa7dYuos` | `plain` (Client) | `["preview", "development"]` | `https://prestigious-dragon-8.eu-west-1.convex.cloud` | ✅ Isolated Preview/Dev Convex backend |

---

## 3. Convex Production Issuer Hardening (`benevolent-magpie-921`)

- **Configuration File:** [`convex/auth.config.ts`](../convex/auth.config.ts)
- **Production Issuer (`CLERK_JWT_ISSUER_DOMAIN` on `benevolent-magpie-921`):**
  - Removed obsolete/temporary proxy issuers (`https://trading-app-theta-two.vercel.app/__clerk` and `https://capital.aiguides.co.uk/__clerk`).
  - Locked `CLERK_JWT_ISSUER_DOMAIN` on `benevolent-magpie-921` strictly to:
    ```txt
    https://clerk.capital.aiguides.co.uk
    ```
  - Deployed via `npx convex deploy -y` to `https://benevolent-magpie-921.eu-west-1.convex.cloud`.
- **User Isolation & Reviewer Expiry Verification:**
  - Verified in [`convex/roles.ts`](../convex/roles.ts), [`convex/brokers.ts`](../convex/brokers.ts), and [`convex/trading.ts`](../convex/trading.ts) (plus automated Vitest suites `tests/trading-execution.test.ts` and `tests/broker-ui-security.test.ts`) that:
    - Unauthenticated requests are rejected.
    - Authenticated second users (`user_other`) cannot read or mutate `user_owner`'s portfolio snapshots, broker connections, or trading orders.
    - Reviewer role grants require explicit `expiresAt` timestamps and are rejected once expired.

---

## 4. Live Browser, Mobile, & API Acceptance Results (`https://capital.aiguides.co.uk`)

Executed via automated Playwright Chromium (Edge channel) against `https://capital.aiguides.co.uk` on deployment `dpl_8Ufoo9iKpTVCSRPqxig8epx8Y9en` (`2026-11-07T19:53:31Z`):

### 4.1 Desktop Browser Verification (`1440×900`)
- **`window.Clerk.loaded`:** `true` (Clerk JS `v6.41.0` loaded from `https://clerk.capital.aiguides.co.uk`)
- **`keyPrefix` / `instanceType`:** `pk_live_` / `Production`
- **`frontendApiDomain`:** `clerk.capital.aiguides.co.uk`
- **Signed-Out Visitor Guard (`/`):**
  - `signInPromptVisible`: `true` (`"Sign in to load your account"`)
  - `clerkModalOpenedOnClick`: `true` (Clicking the sign-in button opens the Clerk Production `<SignIn>` modal with zero errors)
  - `emptyAccountStateRendered`: `true` (`[data-testid="kpi-empty"]`)
  - `privateBrokerDataExposed`: `false`
  - `pageErrors`: `[]` (`0` console/page errors)
- **Protected & Research Route Navigation:**
  - `/settings/brokers` → `200 OK`, `signInGatePresent: true`, `"Secure broker storage is not configured"`
  - `/trading` → `200 OK`, `"Live submission is disabled on this server. Demo submission is disabled."` & `"Trading storage is not configured."`
  - `/proof-scale` → `200 OK`, `signInGatePresent: true`, `"Sign in to review your private evidence and pilots."`
  - `/workspace`, `/consensus`, `/defence`, `/infrastructure`, `/policy-risk`, `/recovery` → All `200 OK`, zero redirect loops or `500` errors.

### 4.2 Mobile Acceptance (Android Chrome Emulation — Pixel 7 `412×915`)
- **Viewport & Horizontal Overflow:** `viewportWidth: 412`, `scrollWidth: 412`, **`overflowPx: 0`** on `/` and `/settings/brokers`.
- **Responsive Mobile Collapsible Sections:** All 5 mobile `<details class="cc-collapsible">` sections rendered (`Research watchlist (delayed public reference prices)`, `Data boundaries`, `Morning intelligence brief`, `Agent operations & collection health`, `Research intelligence`).
- **Mobile Clerk Sign-In Modal (`clerkModalOpenedOnTap`):** `true` (Tapping `"Sign in to load your account"` opens the Clerk Production modal cleanly on mobile).
- **Mobile Page Errors:** `[]` (`0` errors).

### 4.3 Live API Endpoint Security Checks (`https://capital.aiguides.co.uk/api/*`)

| Endpoint & Test Scenario | HTTP Status | Error Code | Result |
| :--- | :--- | :--- | :--- |
| `GET /api/research/staging` (missing token) | `503` | `not_configured` | ✅ PASS |
| `GET /api/research/staging` (invalid bearer token) | `503` | `not_configured` | ✅ PASS |
| `POST /api/research/staging` (invalid bearer token) | `503` | `not_configured` | ✅ PASS |
| `POST /api/operations/scheduled` (missing / invalid bearer token) | `503` | `not_configured` | ✅ PASS |
| `POST /api/operations/settings` (unauthenticated same-origin) | `401` | `sign_in_required` | ✅ PASS |
| `POST /api/operations/settings` (cross-origin CSRF `https://malicious.example.com`) | `403` | `forbidden_origin` | ✅ PASS |
| `POST /api/research/import` (unauthenticated) | `503` | `null` | ✅ PASS |
| `POST /api/brokers/sync` (unauthenticated) | `401` | `sign_in_required` | ✅ PASS |
| `POST /api/brokers/auto-sync` (unauthenticated) | `401` | `sign_in_required` | ✅ PASS |
| `POST /api/brokers/scheduled` (invalid scheduler secret) | `503` | `not_configured` | ✅ PASS |

### 4.4 Brokerage & Trading Protection Status
- **Production Broker Vault:** Unconfigured and isolated (`Secure broker storage is not configured`; preview deployments hard-blocked in [`lib/brokers/vault.ts`](../lib/brokers/vault.ts)).
- **Live & Demo Execution:** Both `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` remain `false`, and the emergency Live kill switch remains engaged by default.

---

## 5. Interactive Owner Sign-In & Clerk Dashboard Confirmation

- The Clerk Production `<SignIn>` modal and `https://accounts.capital.aiguides.co.uk/sign-in` are live and operational on `https://capital.aiguides.co.uk`.
- Because interactive owner credentials/MFA belong strictly to the account owner, sign in once at **`https://capital.aiguides.co.uk`** using your owner account (and test sign-out via the `<UserButton>` control) to record your first authenticated Production session in the Clerk Dashboard (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`) and Convex Production (`benevolent-magpie-921`).
