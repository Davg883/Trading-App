# UI acceptance — Portfolio Command Centre (`portfolio-ui-001-v1`), 6 November 2026

The Market Radar home view is now an investment-first command centre. All six research modules, the Trading 212 read-only integration, authentication, research evidence controls and every trading safeguard are unchanged. The redesign enables no trading permission: the homepage only reads the server flags and calls no mutation (tested).

## What changed

| Deliverable | Location |
| --- | --- |
| Homepage composition | `app/page.tsx` (server: flags and research feed) → `components/dashboard.tsx` (Market Radar renders the command centre) |
| Command centre | `components/command-centre/command-centre.tsx` |
| Reusable KPI card | `components/command-centre/kpi-card.tsx` |
| Performance chart | `components/command-centre/performance-chart.tsx` |
| Holdings and watchlist panels | `components/command-centre/holdings-panel.tsx` |
| Risk and decisions widgets | `components/command-centre/risk-panel.tsx` |
| Compact alerts centre (replaces 7 stacked banners) | `components/command-centre/alerts-centre.tsx` |
| Research intelligence | `components/command-centre/research-intel.tsx` |
| Calculations | `lib/portfolio/performance.ts` (pure) and `lib/portfolio/research-feed.ts` (registered packages only) |
| Signed-in data | `integrations/connected-command-centre.tsx`, plus the owner-scoped query `convex/portfolio.ts:overview` |
| Styles | `app/command-centre.css`: fluid `min(1840px,100%)`, breakpoints at 1280, 1100 and 640 px, focus states, reduced motion, forced colours |
| Layout preview | `/dev/command-centre?fixture=sample\|empty\|stale` (development only; returns 404 in production; every screen carries a **SYNTHETIC LAYOUT FIXTURE** banner) |

**Visual hierarchy:**
1. Status bar.
2. Account and capital KPIs.
3. Full-width performance chart.
4. Holdings and watchlist beside the risk and approval queue.
5. Data-boundary legend.
6. Research intelligence.

The previous synthetic research terminal is retained below, collapsed and badged **Synthetic demonstration**. The top-bar pill now reads "Synthetic research modules" rather than "Demo environment", to avoid confusion with Trading 212 Demo.

## Backend addition (additive only)

The broker module stored only the latest snapshot, which made any honest history chart impossible. `brokers:recordSyncInternal` now also appends:
- one `accountValuations` row per successful sync or test (total value, cash, cost, value, realised and unrealised P/L, source URL);
- `accountCashFlows` for DEPOSIT, WITHDRAW and TRANSFER transactions, de-duplicated by broker reference.

Nothing else in the broker flow changed. Permissions, vault and snapshot replacement are as before. History starts accumulating from your next synchronisation; **there are currently 0 or 1 stored valuations, so your real chart correctly shows the empty state.**

## Calculation rules

- **Total value, cash, amount invested and P/L** come straight from the Trading 212 account summary, each with its source and timestamp.
- **Cumulative P/L** is realised plus unrealised P/L from the broker. **Return** is P/L ÷ amount invested; with nothing invested it is *unavailable*, not 0%.
- **Today's P/L** is the change between today's latest stored valuation and the last one before 00:00 UTC, **minus deposits and withdrawals in between**. It is unavailable without a pre-today valuation.
- **Time-weighted return** chains sub-periods with external flows removed. **Money-weighted return** (modified Dietz) is shown separately.
- **Chart points** are stored valuations only, plus the last stored valuation before the window start as its baseline. There is no interpolation and no drawing from the latest balance; fewer than two points shows the empty state.
- **Benchmark (QQQ):**
  - Calculated as the Nasdaq public close × the Bank of England USD/GBP fixing on the same date, as a price return.
  - Shown only when both exist within 36 hours of the portfolio's first and last valuations; otherwise unavailable with a reason.
  - Coverage currently ends on 4 November.
- **Other currencies:** cash flows or valuations in another currency are refused, not converted at an unknown rate.
- **Freshness:** account data older than 15 minutes is marked stale. Watchlist closes are labelled *Delayed* or *Stale* (over 36 hours) or *Unavailable*, with source "Nasdaq public historical close (unlicensed, delayed)".
- **Daily move per holding:** *unavailable*, because Trading 212 positions carry no prior close. Position prices are labelled as not a complete market-data feed.
- **Watchlist rows** never show quantity, value or return, and each row says "research only" or "also owned".

## Acceptance results

| Requirement | Evidence | Result |
| --- | --- | --- |
| Deposits do not appear as profits | Unit tests: a deposit-only change gives 0% TWR and MWR; today's P/L nets out deposits and withdrawals; cumulative P/L uses broker P/L fields | Pass |
| Empty portfolios show no historical returns | Unit test with a single £250 cash valuation; browser `empty` fixture shows the chart empty state, "No open positions", and return "Nothing invested yet" | Pass |
| Stale account data identified | Unit test for the 15-minute threshold; browser `stale` fixture shows the "Stale" badge and alert | Pass |
| GBP conversion uses known compatible rates | Benchmark refuses a missing FX rate or missing sessions; other-currency flows refused | Pass |
| Charts do not invent observations | Unit test: every plotted point equals a stored valuation in every window | Pass |
| Watchlist can't be mistaken for holdings | Separate panel and badge, no quantity, value or return columns; per-row "research only" or "also owned" (browser-checked) | Pass |
| No trading permissions enabled | Source test: no mutation, no flag assignment, no `/api/trading` call on the homepage; execution widget shows Live and Demo disabled | Pass |
| Valuation history append-only and owner-scoped | Convex test: two syncs give two valuations; the deposit is stored once as a flow; no credential fields; another owner sees nothing; signed out is refused | Pass |
| TypeScript and Python regressions | `npm test` **399 passed** (387 before + 12 new); Python all OK; typecheck clean | Pass |
| Browser checks | command-centre (390/768/1440/1920), trading, brokers, recovery and policy-risk all pass | Pass |
| Accessibility | Keyboard: status bar opens with Enter; the chart is focusable and readable with the arrow keys, with a live caption. Window selector uses `role=radiogroup`; scrollable tables are focusable regions with captions. Run under `reducedMotion: 'reduce'`; contrast fix applied to the dark KPI card | Pass (automated plus visual) |

The trading, recovery and policy browser scripts were updated **only** in how they reach their module from the homepage: they now open the status bar first, because the banner links moved there. All their assertions are unchanged.

## Screenshots (visually inspected)

`test-results/command-centre/`:
- `home-390.png`, `home-768.png`, `home-1440.png`, `home-1920.png`: the real homepage, signed out;
- `sample-390.png`, `sample-768.png`, `sample-1440.png`, `sample-1920.png`: the synthetic fixture;
- `empty-1440.png` and `stale-1440.png`.

Inspected at 390, 768, 1440 and 1920 px. Fixes made after inspection:
- table row-header font;
- the account badge appearing before any data existed;
- the "Demo environment" pill wording;
- "critical" wording for policy evidence gaps;
- chart letterboxing at wide widths;
- KPI label contrast.

## Remaining limitations

- **Your signed-in view was not screenshot-tested.** The test browser has no session, so the populated layouts use the labelled synthetic fixture. Open `http://localhost:3000` while signed in to see your real £250 cash account; until two syncs exist, its chart will say there is no history yet.
- **Gaps:** daily movement per holding and live watchlist quotes need a licensed market-data feed. The AI-sector tag list comes from the registered research universe, not an industry classification feed.
- **Chart baseline:** when a window has no stored valuation near its start, the chart starts at the last earlier valuation and says so in the return label.

## Final refinements (6 November 2026)

| # | Refinement | Implementation |
| --- | --- | --- |
| 1 | Primary KPI row | Total account value, today's investment P/L, cumulative investment P/L and portfolio return (`kpi-strip`, four cards) |
| 2 | Compact secondary strip | Available cash, amount invested, open positions and last full sync in one row (`KpiStrip`). Sources and timestamps sit under a "Sources and timestamps" disclosure |
| 3 | Two chart modes | **Return (TWR):** deposits and withdrawals removed. **Value (GBP):** stored balances, labelled "includes deposits and withdrawals; it is not a return". Benchmark comparison is disabled in value mode |
| 4 | Benchmark and cash-flow markers | `benchmarkSeries` draws a dashed QQQ GBP line only from observations with a close and a known GBP rate, based on the session nearest the first valuation; otherwise it shows a reason and no line. `flowEvents` puts deposit and withdrawal markers on the chart, with a text list of the events below it labelled "not performance" |
| 5 | Routes to resolution | Every unavailable KPI, the empty chart, unsynchronised holdings and every stale, missing or warning notice links to the fix: `/settings/brokers` (connect or synchronise), `/policy-risk#sources` (price and benchmark evidence), `/recovery#participation` and `/policy-risk#missing` (evidence gaps), and `/trading#orders` or `#controls` (approvals, unknown orders, execution states) |
| 6 | Mobile density | Below 768 px the watchlist, data boundaries and research intelligence collapse behind summaries. **Risk warnings never collapse:** warn and alert notices render outside the status bar on every width, and the risk panel stays fully expanded. KPIs keep their source line (smaller). The chart uses a taller 420×300 canvas rather than a stretched one |
| 7 | Fixture separation | With `fixtureLabel` set, the root carries `data-source="synthetic-fixture"`. Every card and panel gets a hatched background and a **FIXTURE** tag, every badge reads **Synthetic demonstration**, and every source reads "Synthetic fixture…", never "Trading 212" (browser-asserted). The real homepage carries `data-source="broker"` and shows none of these styles |

**Verification:**
- `npm test`: **401 passed** (2 new tests for flow events and the benchmark series).
- Python: all OK. Typecheck: clean. Lint: only the pre-existing `recovery-monitor.tsx` false positive.
- **Browser checks:** command-centre at 390, 768, 1440 and 1920 px, plus trading, brokers, recovery and policy-risk, all pass.
- **Fixed after inspection:**
  - an overflow at 768 px (a collapsible wrapper sized to its table);
  - fixture sources that read "Trading 212";
  - an unreadable mobile chart;
  - a clipped withdrawal label.
- **Execution:** no Live or Demo execution was enabled. The homepage still reads the flags only, and that is source-tested.

**Signed-in inspection: performed with a dedicated test user (owner-authorised).**

- **Test user:** `user_3LjpVqVwcwziWWGKnQSiIQRyRtG` (`aci-ui-test+clerk_test@example.com`, external ID `aci-ui-layout-test`) on the Clerk **development** instance.
  - It has no password; the account was created with `skip_password_requirement`.
  - It has no broker connection, no reviewer role and no data of its own. Its ID is recorded in the gitignored `.env.test.local`.
- **Sign-in method:** a server-created, single-use sign-in ticket (5-minute expiry), consumed through Clerk's `ticket` strategy in a headless browser. No credential was typed into any page, and the ticket file was deleted after use.
- **Script:** `npm run test:browser:command-centre:signed-in`, which requires `CLERK_UI_TICKET`.
- **Result:** passed at 390, 768, 1440 and 1920 px, and signed out at the end. Confirmed:
  - signed-in empty-account states;
  - the always-visible "No broker connection" warning, linking to `/settings/brokers`;
  - Connect and Synchronise routes on every unavailable figure and panel;
  - approvals 0, reviewer grant none, Live and Demo disabled, emergency switch engaged;
  - `data-source="broker"` with no fixture styling;
  - no horizontal overflow.
- **Screenshots:** `test-results/command-centre/signed-in-{390,768,1440,1920}.png`, visually inspected at 390 and 1440 px. One wording fix followed: "1 item needs attention".
- **Not covered:** a populated signed-in view with real holdings. The test user has no broker data, and none was fabricated. Your own account (£250 cash) can be checked in your signed-in browser.
- **Removing the test user:** it can be deleted at any time with `npx -y clerk@latest api users/user_3LjpVqVwcwziWWGKnQSiIQRyRtG -X DELETE --yes`.
