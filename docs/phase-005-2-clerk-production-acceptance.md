# AI Capital Intelligence — Phase 005.2: Clerk Production Custom-Domain Cutover & Runtime Acceptance Report

- **Date:** 2026-11-07
- **Phase:** `005.2 — Clerk Production Activation, Custom-Domain Cutover & Browser Runtime Hardening`
- **Primary Application Domain:** `https://capital.aiguides.co.uk`
- **Active Vercel Production Commit:** `085f7a6` (`READY`, deployed on `https://capital.aiguides.co.uk`)
- **Clerk Production Instance ID:** `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` (`instance_environment_type: "production"`, `show_devmode_warning: false`)
- **Clerk Production Frontend API & Issuer:** `https://clerk.capital.aiguides.co.uk`
- **Isolated Production Convex Deployment:** `https://benevolent-magpie-921.eu-west-1.convex.cloud`
- **Isolated Preview/Dev Convex Deployment:** `https://prestigious-dragon-8.eu-west-1.convex.cloud`

---

## 1. Root-Cause Diagnosis: Why "Development mode" & Stuck Loading Spinner Appeared

Deep browser-runtime inspection of `@clerk/clerk-js@6.41.0`, `@clerk/ui@1.42.0`, `@clerk/nextjs@7.9.22`, and `convex/react-clerk` on `https://capital.aiguides.co.uk` identified four concrete root causes:

### 1.1 Root Cause 1 — `localStorage['__clerk_environment']` 24-Hour Cache Fallback (`show_devmode_warning: true`)
- In `@clerk/ui@1.42.0` (`ui-common_ui_8f3fa6_1.42.0.js`), the orange **"Development mode"** badge (`[data-clerk-dev-mode-notice]`) renders if and only if `displayConfig.showDevModeWarning === true`.
- In `@clerk/clerk-js@6.41.0` (`clerk.browser.js`), every successful environment load writes a snapshot to `localStorage['__clerk_environment']` with a **24-hour TTL (`86,400,000` ms)**:
  ```js
  t3.setItem("__clerk_environment", this.environment?.__internal_toSnapshot(), 864e5);
  ```
- When `capital.aiguides.co.uk` previously served the `pk_test_` Development key, the user's browser cached `{ instance_environment_type: "development", show_devmode_warning: true }` inside `localStorage['__clerk_environment']`.
- During the cutover window when `/__clerk/v1/environment` returned `400 host_invalid` (or in an already-open tab still requesting `/__clerk/v1/environment`), `clerk.browser.js`'s `.catch()` handler fell back to `localStorage.getItem('__clerk_environment')`, hydrating `window.Clerk.environment` from the cached `pk_test_` snapshot and displaying the orange **"Development mode"** label.

### 1.2 Root Cause 2 — Host-Only Cookie Shadowing (`capital.aiguides.co.uk` vs `.aiguides.co.uk`) & Unhandled `invalidateCacheAction()` Promise Hang
- Clerk Development (`pk_test_`) sets host-only cookies (`__client_uat`, `__session`, `__clerk_db_jwt`) on `capital.aiguides.co.uk`, whereas Clerk Production (`pk_live_` on `clerk.capital.aiguides.co.uk`) sets cookies on `Domain=.aiguides.co.uk`.
- Per RFC 6265 §5.3, setting a cookie on `Domain=.aiguides.co.uk` never overwrites a host-only cookie on `capital.aiguides.co.uk`; the stale host-only cookie continues to be sent first in HTTP `Cookie` headers.
- Furthermore, in `@clerk/nextjs@7.9.22` (`ClerkProvider.js`), `window.__internal_onBeforeSetActive` wraps Next.js Server Action `invalidateCacheAction()` without a `.catch()` handler:
  ```js
  window.__internal_onBeforeSetActive = (intent) => new Promise((resolve) => {
    void invalidateCacheAction().then(() => resolve()); // No .catch()!
  });
  ```
  When `window.Clerk.setActive()` ran during sign-in while stale cookies or an older deployment build ID caused the `Next-Action` `POST` to redirect (`307` to `clerk.capital.aiguides.co.uk/v1/client/handshake`) or reject, the Promise in `window.__internal_onBeforeSetActive` never settled—leaving the Clerk Sign-In modal stuck on the loading spinner indefinitely.

### 1.3 Root Cause 3 — Missing `"convex"` JWT Template Fallback in Clerk Production (`getToken({ template: "convex" })` → `404`)
- Clerk does not copy custom JWT templates (`"convex"`) when creating a Production instance (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`).
- When `ConvexProviderWithClerk` and server API routes called `getToken({ template: 'convex' })` against the Production instance without a `"convex"` template, Clerk returned `404 Not Found`, causing `ConvexProviderWithClerk` to treat a signed-in Clerk user as unauthenticated (`isConvexAuthenticated = false`).

### 1.4 Root Cause 4 — Google OAuth Unconfigured & Account Portal TLS
- In the Clerk Production Dashboard (`ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`), Google OAuth is enabled without custom Production OAuth client credentials (`accounts.google.com/o/oauth2/auth?client_id=&...`), and `accounts.capital.aiguides.co.uk` TLS is still provisioning at Clerk, so all sign-in flows must execute via the first-party custom Frontend API `https://clerk.capital.aiguides.co.uk` inside the in-app modal on `https://capital.aiguides.co.uk`.

---

## 2. Deployed Architectural & Runtime Fixes (Commit `085f7a6`)

1. **Pre-Interactive Self-Healing Browser Sanitizer & Spinner Guard ([`app/layout.tsx`](../app/layout.tsx))**:
   - When `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` starts with `pk_live_`, a synchronous `<head>` script runs before `@clerk/clerk-js` initializes:
     - Inspects `localStorage.getItem('__clerk_environment')` and deletes it (plus `localStorage['clerk-db-jwt']`) if it contains `"development"` or `"show_devmode_warning":true`.
     - Expires stale host-only Clerk cookies (`__clerk_db_jwt`, `__clerk_redirect_count`, `__client_uat`, `__session`) on `capital.aiguides.co.uk` (without a `Domain` attribute, which per RFC 6265 §5.3 removes only host-only cookies while preserving `.aiguides.co.uk` Production cookies).
     - Wraps `window.__internal_onBeforeSetActive` via `Object.defineProperty` with `Promise.race([Promise.resolve(next(intent)).catch(() => {}), new Promise((r) => setTimeout(r, 2500))])` so a failed or slow `invalidateCacheAction()` Server Action can never hang `window.Clerk.setActive()` or the Sign-In loading spinner.
   - Zero cosmetic suppression (`unsafe_disableDevelopmentModeWarnings` is **not** used).

2. **Legacy `/__clerk/*` Redirect & `Next-Action` Handshake Guard ([`proxy.ts`](../proxy.ts))**:
   - Redirects any legacy `/__clerk/:path*` request (`307`) to `https://clerk.capital.aiguides.co.uk/:path*` when `NEXT_PUBLIC_CLERK_PROXY_URL` is unset, ensuring even pre-cutover open tabs receive `200 OK` from `clerk.capital.aiguides.co.uk` instead of `400 host_invalid`.
   - Prevents cross-origin `307` `/v1/client/handshake` redirects on `Next-Action` Server Action `POST` requests.

3. **Dual OIDC + Custom RS256 JWT Acceptance in Convex Production ([`convex/auth.config.ts`](../convex/auth.config.ts) & [`lib/clerk-convex-auth.ts`](../lib/clerk-convex-auth.ts))**:
   - Updated [`convex/auth.config.ts`](../convex/auth.config.ts) and deployed to `https://benevolent-magpie-921.eu-west-1.convex.cloud` so each issuer in `CLERK_JWT_ISSUER_DOMAIN` (`https://clerk.capital.aiguides.co.uk`) registers both:
     - `{ domain, applicationID: 'convex' }` (for `"convex"` template JWTs), and
     - `{ type: 'customJwt', issuer: domain, jwks: '${domain}/.well-known/jwks.json', algorithm: 'RS256' }` (for default Clerk Production RS256 session tokens).
   - Created [`lib/clerk-convex-auth.ts`](../lib/clerk-convex-auth.ts) (`useConvexClerkAuth`) and wired all 10 `integrations/*.tsx` providers plus all 4 server modules ([`lib/brokers/server.ts`](../lib/brokers/server.ts), [`lib/remote-ops/server.ts`](../lib/remote-ops/server.ts), [`lib/research-import-server.ts`](../lib/research-import-server.ts), [`lib/trading/server.ts`](../lib/trading/server.ts)) to try `getToken({ template: 'convex' })` first and fall back to the default Clerk RS256 session token if the `"convex"` template is absent (`404`).
   - Added `<UserButton />` to [`integrations/connected-command-centre.tsx`](../integrations/connected-command-centre.tsx) so authenticated users on `/` can inspect their session and sign out directly from the Command Centre.

---

## 3. Environment Variable & DNS/TLS Verification (No Secret Values Exposed)

### 3.1 Authoritative GoDaddy DNS (`ns69.domaincontrol.com` / `ns70.domaincontrol.com`) & Endpoint Status

| Endpoint / Record | Target / Response | Status |
| :--- | :--- | :--- |
| `CNAME capital.aiguides.co.uk` | `142550a5694d4daa.vercel-dns-017.com` | ✅ `200 OK` (Vercel Production commit `085f7a6`) |
| `CNAME clerk.capital.aiguides.co.uk` | `frontend-api.clerk.services` | ✅ `200 OK` (`x-clerk-instance-id: ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`) |
| `GET https://clerk.capital.aiguides.co.uk/v1/environment` | `instance_environment_type: "production"`, `show_devmode_warning: false` | ✅ `200 OK` |
| `GET https://clerk.capital.aiguides.co.uk/.well-known/openid-configuration` | `issuer: "https://clerk.capital.aiguides.co.uk"` | ✅ `200 OK` |
| `GET https://capital.aiguides.co.uk/__clerk/v1/environment` | `307 Temporary Redirect` → `https://clerk.capital.aiguides.co.uk/v1/environment` | ✅ `307` → `200 OK` |

### 3.2 Vercel Production & Preview Environment Matrix (`prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF`)

| Environment Variable | Vercel Env ID | Storage Type | Target Scope | Key Prefix / Value | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `yOagQWGJkNyATzfV` | `plain` (Client) | `["production"]` | `pk_live_` (`clerk.capital.aiguides.co.uk$`) | ✅ Matches `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` |
| `CLERK_SECRET_KEY` | `Efj6SJuGOywe3Orq` | `sensitive` (Secret) | `["production"]` | `sk_live_` | ✅ Matches `ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt` |
| `CLERK_JWT_ISSUER_DOMAIN` | `zfDvAm6LJmQ4m6Ir` | `sensitive` (Secret) | `["production"]` | `https://clerk.capital.aiguides.co.uk` | ✅ Locked to single custom-domain issuer |
| `NEXT_PUBLIC_CLERK_PROXY_URL` | `0LiUmkCK2GGr9zXU` | `plain` (Client) | `["development"]` | `""` (empty; removed from Production) | ✅ Cleared from Production |
| `NEXT_PUBLIC_CONVEX_URL` | `UX70BvcZTHokAQ4x` | `plain` (Client) | `["production"]` | `https://benevolent-magpie-921.eu-west-1.convex.cloud` | ✅ Isolated Production Convex backend |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `OXgCrhiEMy5JfP5p` | `encrypted` | `["preview", "development"]` | `pk_test_` | ✅ Isolated to Preview & Development |
| `NEXT_PUBLIC_CONVEX_URL` | `p0W5RcGjqa7dYuos` | `plain` (Client) | `["preview", "development"]` | `https://prestigious-dragon-8.eu-west-1.convex.cloud` | ✅ Isolated Preview/Dev Convex backend |

---

## 4. Live Browser Runtime Verification (`https://capital.aiguides.co.uk`)

Executed via automated Playwright Chromium (Edge channel) against live `https://capital.aiguides.co.uk` (commit `085f7a6`, `2026-11-07T20:59:15Z`):

### 4.1 Self-Healing Poisoned Browser State Test (Simulating Stale `pk_test_` `localStorage` & Host-Only Cookies)
A browser context was pre-seeded with:
- `localStorage['__clerk_environment'] = '{"auth_config":{"single_session_mode":true},"display_config":{"instance_environment_type":"development","show_devmode_warning":true}}'`
- `localStorage['clerk-db-jwt'] = 'stale-dev-jwt'`
- Host-only cookies `__clerk_db_jwt=stale_dev_db_jwt`, `__client_uat=1794000000`, and `__session=stale_dev_session` on `capital.aiguides.co.uk`

Upon navigating to `https://capital.aiguides.co.uk/` and opening the Sign-In modal:
- **`window.Clerk.publishableKey.slice(0, 8)`:** `"pk_live_"`
- **`window.Clerk.frontendApi`:** `"clerk.capital.aiguides.co.uk"`
- **`window.Clerk.environment.displayConfig.instanceEnvironmentType`:** `"production"`
- **`window.Clerk.environment.displayConfig.showDevModeWarning`:** `false`
- **`localStorage['__clerk_environment']` after load:** Replaced with `"production"` (`localStorageContainsDevWarning: false`)
- **`localStorage['clerk-db-jwt']`:** `null` (`staleDbJwtCleared: true`)
- **`document.cookie` after load:** `"__client_uat=0; __client_uat_n3_M02zk=0"` (all stale host-only cookies purged)
- **`[data-clerk-dev-mode-notice]` DOM element count:** `0` (`modalHasDevModeText: false`)
- **`window.__internal_onBeforeSetActive('sign-in')` resolution:** `284 ms` normal (`0 ms` fallback resolution on simulated Server Action rejection)

### 4.2 Fresh InPrivate Desktop (`1440×900`) & Android Mobile (`412×915`) Verification
- **Desktop (`1440×900`):**
  - `pkPrefix`: `"pk_live_"`, `fapi`: `"clerk.capital.aiguides.co.uk"`, `instanceType`: `"production"`, `showDevWarning`: `false`, `devBadgeCount`: `0`.
  - All Clerk JS & UI bundles loaded with `200 OK` from `https://clerk.capital.aiguides.co.uk/npm/@clerk/...` (`x-clerk-instance-id: ins_3LmpoQvdoIwHQTiSi7QsZu1cKRt`).
  - Submitting an email in the Sign-In modal (`POST https://clerk.capital.aiguides.co.uk/v1/client/sign_ins`) and switching to the Sign-Up view transitioned immediately without hanging on the loading spinner.
- **Android Chrome Mobile (Pixel 7 `412×915`):**
  - `pkPrefix`: `"pk_live_"`, `fapi`: `"clerk.capital.aiguides.co.uk"`, `instanceType`: `"production"`, `showDevWarning`: `false`, `devBadgeCount`: `0`, `modalVisible`: `true`, `overflowPx`: `0`.

### 4.3 Brokerage & Trading Safety Controls
- **Production Broker Vault:** Remains unconfigured and isolated (`Secure broker storage is not configured`).
- **Live & Demo Execution:** Both `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` remain `false`, and the emergency Live kill switch remains engaged by default.
- **Unit & Security Regression Suite:** `47 passed (47)` test files, `442 passed (442)` tests (`npm test`).
