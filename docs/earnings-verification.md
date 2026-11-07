# Earnings update verification — 29 October 2026

Implemented and cross-reviewed across the earnings engine, UI and Python bridge, with primary-source checking by the main agent.

- 39 TypeScript tests pass, including source metadata, quarterly KPI arithmetic, consensus accounting compatibility, immutable evidence versions, mixed session/delay rejection, Convex owner isolation and the actual Alphabet fixture.
- 36 Python tests pass, including the existing worker tests and the new complete synthetic earnings experiment, artifact binding, market-outcome exclusion, baseline registration and approved paper-scenario cost reconciliation.
- Production build, strict TypeScript and ESLint pass.
- Browser verification passes: actual KPI display, pre/post historical exclusions, current-review snapshot export, unverified article intake, report upload and mobile layout. Desktop and mobile screenshots are under test-results/.
- Network-free demonstration exercised two mocked providers and a registered no-trade baseline with supplied synthetic outcomes. No paid provider request was made.
- Both real Alphabet historical snapshots are blocked because source receipt occurred after their cutoffs. Generated request and exclusion records are in data/earnings/.

The SEC exhibit was read and manually reconciled; this is not a continuously running SEC ingestion service. No real price observations or actual model outcomes are bundled. Calendar windows are explicit caller-provided policies, not certified exchange-calendar calculations. The QQQ design proxy represents Nasdaq-100 ETF performance, not the Nasdaq Composite. Reports remain retrospective, and importing JSON does not authenticate its contents. The CLI and public case artifacts do not automatically synchronise with a deployed Convex project.

Repeat checks with `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `python -m unittest discover -s worker -p "test_*.py"`, and (with the local server running) `node scripts/earnings-browser-check.mjs`.
