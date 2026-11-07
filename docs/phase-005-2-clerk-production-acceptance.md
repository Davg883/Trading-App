# AI Capital Intelligence — Phase 005.2: Clerk Production Activation & Acceptance Report

- **Date:** 2026-11-07
- **Phase:** `005.2 — Clerk Production Activation`
- **Primary Custom Domain:** `https://capital.aiguides.co.uk`
- **Vercel Production Domain:** `https://trading-app-theta-two.vercel.app`
- **Active Vercel Production Deployment ID:** `dpl_mQ62eGFY5YJGAH45ZbWyuaXxJxNb` (`READY`, Git commit `a4d0114`)
- **Clerk Production Instance ID:** `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` (`instance_environment_type: "production"`)
- **Isolated Production Convex Deployment:** `https://benevolent-magpie-921.eu-west-1.convex.cloud`
- **Isolated Preview/Dev Convex Deployment:** `https://prestigious-dragon-8.eu-west-1.convex.cloud`

---

## 1. Domain & Authentication Mode Audit (`/__clerk` Proxy vs Standard DNS)

### 1.1 Why Clerk Currently Displays `https://trading-app-theta-two.vercel.app/__clerk`
Live inspection of the Clerk Frontend API proxy endpoints (`/__clerk/v1/environment` and `/__clerk/.well-known/openid-configuration`) confirmed the exact state of Clerk Production instance `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`:

- When the Clerk Production instance (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`) was created, its **primary domain in Clerk** was set to the `*.vercel.app` hostname **`trading-app-theta-two.vercel.app`**, while its redirect URLs (`home_url`, `after_sign_in_url`, `after_sign_up_url`) were set to **`https://capital.aiguides.co.uk`**.
- Because users cannot create DNS CNAME records under `vercel.app`, Clerk automatically configured instance `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` in **Frontend API Proxy mode** at **`https://trading-app-theta-two.vercel.app/__clerk`** (using `accounts.trading-app-theta-two.vercel.app` and Clerk's shared `accounts.dev` email infrastructure).
- Consequently, Clerk's upstream Frontend API (`https://frontend-api.clerk.dev`) currently attributes proxy requests to `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` **only** when the proxy host is `trading-app-theta-two.vercel.app`:

| Endpoint Tested on Deployment `dpl_mQ62eGFY5YJGAH45ZbWyuaXxJxNb` | HTTP Status | Observed Response |
| :--- | :--- | :--- |
| `GET https://capital.aiguides.co.uk/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` | `200 OK` | Next.js `proxy.ts` matcher (`/__clerk/(.*)`) successfully proxies the Clerk JS v6 bundle |
| `GET https://trading-app-theta-two.vercel.app/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` | `200 OK` | Next.js `proxy.ts` matcher (`/__clerk/(.*)`) successfully proxies the Clerk JS v6 bundle |
| `GET https://trading-app-theta-two.vercel.app/__clerk/v1/environment` | `200 OK` | Returns `instance_environment_type: "production"`, `home_url: "https://capital.aiguides.co.uk"`, `sign_in_url: "https://accounts.trading-app-theta-two.vercel.app/sign-in"` |
| `GET https://trading-app-theta-two.vercel.app/__clerk/.well-known/openid-configuration` | `200 OK` | Returns `"issuer": "https://trading-app-theta-two.vercel.app/__clerk"`, `"jwks_uri": "https://trading-app-theta-two.vercel.app/__clerk/.well-known/jwks.json"` |
| `GET https://capital.aiguides.co.uk/__clerk/v1/environment` | `400 Bad Request` | `{"code": "host_invalid", "long_message": "We were unable to attribute this request to an instance running on Clerk."}` (because Clerk Dashboard domain is still set to `trading-app-theta-two.vercel.app` instead of `capital.aiguides.co.uk`) |
| `GET https://trading-app-theta-two.vercel.app/__clerk/v1/environment` (with `Origin: https://capital.aiguides.co.uk`) | `400 Bad Request` | `{"code": "origin_invalid", "long_message": "The Request HTTP Origin header must be equal to or a subdomain of the requesting URL."}` |

---

## 2. Proxy Configuration (`proxy.ts`, `ClerkProvider`, & `NEXT_PUBLIC_CLERK_PROXY_URL`)

- **Installed Clerk SDK:** `@clerk/nextjs@7.9.22` (`@clerk/shared@4.43.0`, `@clerk/backend` with native `clerkFrontendApiProxy` support).
- **Middleware ([`proxy.ts`](../proxy.ts)):**
  - Configured with `clerkMiddleware({ frontendApiProxy: { enabled: true } })`.
  - Updated `config.matcher` in [`proxy.ts`](../proxy.ts#L6) to explicitly include `'/__clerk/(.*)'`:
    ```ts
    export const config = {
      matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        '/(api|trpc)(.*)',
        '/__clerk/(.*)',
      ],
    };
    ```
  - **Why `'/__clerk/(.*)'` Is Essential:** The default Next.js static-extension exclusion regex ignores `.js` paths (`js(?!on)`), which caused `/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` to return `404` before `'/__clerk/(.*)'` was added. With `'/__clerk/(.*)'` present in `config.matcher`, both `https://capital.aiguides.co.uk/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` and `https://trading-app-theta-two.vercel.app/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` return **`200 OK`**.
- **Environment Variable (`NEXT_PUBLIC_CLERK_PROXY_URL`):**
  - Configured in Vercel Production (`id: 0LiUmkCK2GGr9zXU`, target `["production"]`) as `https://capital.aiguides.co.uk/__clerk`.
  - Read automatically by `<ClerkProvider>` via `mergeNextClerkPropsWithEnv()` in `@clerk/nextjs@7.9.22`.

---

## 3. Verification of `pk_live_` and `sk_live_` Credentials (Key Prefixes Only)

> **Security Note:** Only key prefixes, environment variable IDs, and decoded public hostname suffixes are shown below. No secret values are logged or exposed.

| Environment Variable | Vercel Env ID | Storage Type | Target Scope | Key Prefix | Instance / Domain Binding |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `CLERK_SECRET_KEY` | `Efj6SJuGOywe3Orq` | `sensitive` (Secret) | `["production"]` | `sk_live_` | Verified active for Clerk Production instance `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` (authenticated `200 OK` against `frontend-api.clerk.dev`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `yOagQWGJkNyATzfV` | `plain` (Client) | `["production"]` | `pk_live_` | Encodes `clerk.capital.aiguides.co.uk$` (matches `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` once the Clerk Dashboard domain is changed from `trading-app-theta-two.vercel.app` to `capital.aiguides.co.uk`) |
| `NEXT_PUBLIC_CLERK_PROXY_URL` | `0LiUmkCK2GGr9zXU` | `plain` (Client) | `["production"]` | `https://...` | `https://capital.aiguides.co.uk/__clerk` |
| `CLERK_JWT_ISSUER_DOMAIN` | `zfDvAm6LJmQ4m6Ir` | `sensitive` (Secret) | `["production"]` | `https://...` | `https://capital.aiguides.co.uk/__clerk,https://clerk.capital.aiguides.co.uk,https://trading-app-theta-two.vercel.app/__clerk` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `OXgCrhiEMy5JfP5p` | `encrypted` | `["preview", "development"]` | `pk_test_` | Isolated to Preview & Development |
| `CLERK_SECRET_KEY` | `HcGDxbuUKdspHkzy` | `encrypted` | `["development"]` | `sk_test_` | Isolated to Development |

### Crucial Finding on `pk_live_` vs `sk_live_` Domain Alignment
- Your `CLERK_SECRET_KEY` (`id: Efj6SJuGOywe3Orq`) **is already a valid `sk_live_` key** belonging to Clerk Production instance `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`.
- Because Clerk encodes the instance's configured domain inside `pk_live_` (`"pk_live_" + base64("clerk.<domain>$")`):
  - While the Clerk Dashboard domain is set to `trading-app-theta-two.vercel.app`, the instance's publishable key in Clerk is `pk_live_Y2xlcmsudHJhZGluZy1hcHAtdGhldGEtdHdvLnZlcmNlbC5hcHAk` (`clerk.trading-app-theta-two.vercel.app$`).
  - As soon as you change the domain in **Clerk Dashboard (Production) → Configure → Domains** from `trading-app-theta-two.vercel.app` to **`capital.aiguides.co.uk`**, the instance's publishable key becomes `pk_live_Y2xlcmsuY2FwaXRhbC5haWd1aWRlcy5jby51ayQ` (`clerk.capital.aiguides.co.uk$`), which is already configured in Vercel Production (`id: yOagQWGJkNyATzfV`).

---

## 4. Convex Production Authentication Synchronisation

- **Production Convex Deployment:** `benevolent-magpie-921` (`https://benevolent-magpie-921.eu-west-1.convex.cloud`)
- **Configuration ([`convex/auth.config.ts`](../convex/auth.config.ts)):**
  - Updated `CLERK_JWT_ISSUER_DOMAIN` on `benevolent-magpie-921` and deployed via `npx convex deploy -y` to trust the Production issuers for `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`:
    - `https://capital.aiguides.co.uk/__clerk` (Custom domain with Frontend API Proxy)
    - `https://clerk.capital.aiguides.co.uk` (Custom domain with Standard DNS)
    - `https://trading-app-theta-two.vercel.app/__clerk` (`vercel.app` domain with Frontend API Proxy)
  - All Clerk Development JWTs (`*.clerk.accounts.dev`) are rejected by `benevolent-magpie-921`.
  - Role isolation (`tests/trading-execution.test.ts` — 12/12 passing) enforces strict `identity.subject` separation and reviewer expiration controls.

---

## 5. Live Acceptance & Security Verification (`https://capital.aiguides.co.uk`)

- **Clerk JS Proxy Bundle (`/npm/@clerk/clerk-js@6/dist/clerk.browser.js`):** Returns **`200 OK`** via `https://capital.aiguides.co.uk/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js`.
- **Direct Route & Page Checks (`/`, `/settings/brokers`, `/trading`, `/proof-scale`, `/workspace`, `/consensus`, `/defence`, `/infrastructure`, `/policy-risk`, `/recovery`):** All return HTTP `200 OK` with zero redirect loops, zero `500` errors, and zero leaked private records.
- **API Endpoint Security (`https://capital.aiguides.co.uk/api/*`):**
  - `POST /api/operations/settings` (unauthenticated same-origin) → `401 sign_in_required`
  - `POST /api/operations/settings` (cross-origin `https://malicious.example.com`) → `403 forbidden_origin`
  - `POST /api/brokers/sync` & `POST /api/brokers/auto-sync` (unauthenticated) → `401 sign_in_required`
  - `GET / POST /api/research/staging`, `POST /api/operations/scheduled`, `POST /api/brokers/scheduled` (missing/invalid bearer token) → `503 not_configured`
- **Mobile Acceptance (Android Chrome Emulation — Pixel 7 `412×915`):** `0px` horizontal overflow across `/` and `/settings/brokers`.
- **Brokerage & Execution Isolation:** Production broker vault remains unconfigured (`Secure broker storage is not configured`); both Live and Demo trading remain disabled (`Live submission is disabled on this server. Demo submission is disabled.`).

---

## 6. Do You Still Need GoDaddy DNS Records? (And How to Switch the Clerk Dashboard Domain to `capital.aiguides.co.uk`)

Because your primary domain is **`https://capital.aiguides.co.uk`**, Clerk's backend (`frontend-api.clerk.dev`) will reject requests from `https://capital.aiguides.co.uk/__clerk` with `400 host_invalid` until the domain in the **Clerk Production Dashboard** (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`) is changed from `trading-app-theta-two.vercel.app` to `capital.aiguides.co.uk`.

### Step 1 — Change the Production Domain in the Clerk Dashboard
1. Open **Clerk Dashboard (Production) → Configure → Domains**.
2. Change the instance domain from `trading-app-theta-two.vercel.app` to **`capital.aiguides.co.uk`**.
3. Under **Frontend API proxy**, set the proxy URL to:
   ```txt
   https://capital.aiguides.co.uk/__clerk
   ```

### Step 2 — GoDaddy DNS Records Required for `capital.aiguides.co.uk`
When you switch a Clerk Production instance from a `.vercel.app` domain (which uses Clerk's shared `accounts.dev` infrastructure) to a custom domain (`capital.aiguides.co.uk`), here is how DNS requirements apply:

- **If you use Frontend API Proxy mode (`https://capital.aiguides.co.uk/__clerk`) on `capital.aiguides.co.uk`:**
  - The Frontend API runs directly through Next.js at `https://capital.aiguides.co.uk/__clerk` (no `clerk.capital` DNS traffic is needed at runtime once proxy mode is active).
  - **However**, Clerk's custom-domain verification in **Configure → Domains** still requires the CNAME records shown in your Clerk Dashboard for the Account Portal (`accounts.capital`) and custom transactional email/DKIM (`clkmail.capital`, `clk._domainkey.capital`, `clk2._domainkey.capital`) before Clerk marks the custom domain `capital.aiguides.co.uk` as fully verified:

| Record Type | Host / Name (in GoDaddy for `aiguides.co.uk`) | Full Hostname | Target / Points To | Needed When Using `capital.aiguides.co.uk` Custom Domain? |
| :--- | :--- | :--- | :--- | :--- |
| `CNAME` | `clerk.capital` | `clerk.capital.aiguides.co.uk` | `frontend-api.clerk.services` | Required by Clerk's domain verification check (even when `/__clerk` proxy handles runtime FAPI traffic) |
| `CNAME` | `accounts.capital` | `accounts.capital.aiguides.co.uk` | `accounts.clerk.services` | **Yes** — Required for Clerk Account Portal |
| `CNAME` | `clkmail.capital` | `clkmail.capital.aiguides.co.uk` | *Exact `u<id>.wl.sendgrid.net` value in Clerk Dashboard* | **Yes** — Required for custom domain verification & email |
| `CNAME` | `clk._domainkey.capital` | `clk._domainkey.capital.aiguides.co.uk` | *Exact `dkim1.<id>.clerk.services` value in Clerk Dashboard* | **Yes** — Required for DKIM verification |
| `CNAME` | `clk2._domainkey.capital` | `clk2._domainkey.capital.aiguides.co.uk` | *Exact `dkim2.<id>.clerk.services` value in Clerk Dashboard* | **Yes** — Required for DKIM verification |
