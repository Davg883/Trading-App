# Build verification — 27 October 2026

Subsequent source-level review: see [acceptance-review.md](acceptance-review.md). That review corrected four backend/worker defects plus the partial-authentication setup gate, and increased regression coverage to 40 tests. The original build evidence below is retained as milestone history.

Implemented by three specialist agents and reviewed by the primary agent. Both supplied strategic-review attachments were byte-identical.

## Verified locally

- Next.js production build and strict TypeScript compilation.
- ESLint source checks.
- 16 TypeScript tests across research calculations and the Convex test runtime: owner isolation, authentication, temporal evidence, approval gates, deadlines, account separation and duplicate-safe fills.
- 17 Python tests: numerical evaluation, immutable CSV imports, provider response validation, identical evidence, deadlines and missing credentials. Provider calls are mocked; no paid requests were made.
- Headless Edge browser workflow: six modules, company filtering, replay, approval, persistence, mobile layout and missing-credentials page. No browser exceptions.
- Desktop and 390px mobile screenshots visually inspected.
- npm dependency audit reported zero known vulnerabilities at installation. Exact installed versions and lockfile are retained.

## Boundaries

The main dashboard is a synthetic demonstration, with browser-local state. The /workspace page is a separate authenticated Convex client. Live Clerk login and a hosted Convex deployment cannot be verified without account configuration. Convex behavior has been exercised using convex-test, not a provisioned production instance.

The Python model runner is functional but separate from the dashboard. It writes immutable run artifacts; it does not automatically submit those records to Convex. Actual model IDs, credentials, usage pricing and provider compatibility need validation with the selected accounts.

Source adapters fetch SEC/FRED data, but licensed price-feed ingestion, financial-fact normalization, automated exchange-calendar alignment, outcome collection and scheduled model orchestration remain integration work. Adding API keys alone does not complete those integrations. Paper execution is long-only and uses a fixed-capital position budget, not a comprehensive marked-to-market risk system. There is no live broker execution.

## Primary guidance cross-checked

- https://nextjs.org/docs/app/getting-started/server-and-client-components
- https://nextjs.org/docs/app/getting-started/installation
- Installed Next.js 16.4.3 proxy documentation (proxy replaces middleware file convention).
- https://docs.convex.dev/quickstart/nextjs
- https://docs.convex.dev/understanding/best-practices/
- https://docs.convex.dev/auth/functions-auth
- https://docs.convex.dev/testing/convex-test

## Repeat browser checks

Run `npm run dev` first, then `npm run test:browser`. The script currently targets Microsoft Edge on Windows. Screenshots are written to test-results/. Other operating systems can use Playwright Chromium by changing the browser channel in the script.
