# Recovery validation 006: observed-source audit

Review and actual package receipt: **3 November 2026, 22:54:55 UTC**. `sourced-observations.json` contains observed source values only. It is a retrospective reference package, not a licensed execution feed or an authentic forward prediction.

## Historical closes

Nasdaq's public historical API returned **23 dated Close/Last observations per instrument**, covering 1 October through **2 November 2026**, for COMP, NDX, SOX, QQQ, NVDA, MSFT, AAPL and VT. The request explicitly included 3 November, but that session was absent from every returned series at collection. Do not display the 2 November observations as current 3 November closes.

The working request format uses ISO dates. A request using `10/01/2026` was rejected as an invalid parameter; the successful format was `2026-10-01`. Index history was supplied through the **quote** endpoint with `assetclass=index`; `/api/index/.../historical` did not supply the requested observations.

| Instrument | Primary historical source | Latest returned close, 2 November | Observed field |
| --- | --- | ---: | --- |
| NASDAQ Composite, COMP | [Nasdaq COMP history](https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=2026-10-01&todate=2026-11-03&limit=100) | 25,164.36 index points | Dated Close/Last row |
| NASDAQ-100, NDX | [Nasdaq NDX history](https://api.nasdaq.com/api/quote/NDX/historical?assetclass=index&fromdate=2026-10-01&todate=2026-11-03&limit=100) | 27,989.82 index points | Dated Close/Last row |
| PHLX Semiconductor index, SOX | [Nasdaq SOX history](https://api.nasdaq.com/api/quote/SOX/historical?assetclass=index&fromdate=2026-10-01&todate=2026-11-03&limit=100) | 10,328.33 index points | Dated Close/Last row |
| QQQ ETF | [Nasdaq QQQ history](https://api.nasdaq.com/api/quote/QQQ/historical?assetclass=etf&fromdate=2026-10-01&todate=2026-11-03&limit=100) | USD 681.09 | Dated Close/Last row |
| NVIDIA, NVDA | [Nasdaq NVDA history](https://api.nasdaq.com/api/quote/NVDA/historical?assetclass=stocks&fromdate=2026-10-01&todate=2026-11-03&limit=100) | USD 202.06 | Dated Close/Last row |
| Microsoft, MSFT | [Nasdaq MSFT history](https://api.nasdaq.com/api/quote/MSFT/historical?assetclass=stocks&fromdate=2026-10-01&todate=2026-11-03&limit=100) | USD 507.12 | Dated Close/Last row |
| Apple, AAPL | [Nasdaq AAPL history](https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=2026-10-01&todate=2026-11-03&limit=100) | USD 338.32 | Dated Close/Last row |
| Vanguard Total World Stock ETF, VT | [Nasdaq VT history](https://api.nasdaq.com/api/quote/VT/historical?assetclass=etf&fromdate=2026-10-01&todate=2026-11-03&limit=100) | USD 155.11 | Dated Close/Last row |

COMP, NDX and SOX are indices, not investable ETF shares. QQQ is a separate ETF and is never substituted for the NASDAQ Composite. An index's numerical level is not a share price or investable principal.

The API response did not supply a per-row publication timestamp or an explicit split/dividend-adjustment convention. The raw package therefore preserves nullable publication times and marks stock/ETF observations `unadjusted_close`, with corporate-action treatment unverified. It does not silently claim total-return or split-adjusted prices. Actual receipt is used as a conservative knowledge bound. Licensed compatible histories, corporate-action review and GBP conversion are still required for paper portfolio accounting.

The observations are publicly accessible source references. A commercial market-data feed, redistribution rights and executable-use licence have **not** been configured or asserted. Local descriptive research and source inspection are distinct from operational brokerage quotes. Raw responses are retained as inspection artifacts under `tmp/recovery/nasdaq-*-iso.json`; that folder is not an independent immutable archive service.

## Independent corroboration and source conflicts

[FRED NASDAQCOM](https://fred.stlouisfed.org/series/NASDAQCOM) and [FRED NASDAQ100](https://fred.stlouisfed.org/series/NASDAQ100), sourced from Nasdaq, show the same latest 2 November levels of 25,164.36 and 27,989.82. They are a distribution channel for Nasdaq data, not independent market-price construction. Their notes identify daily market-close values and mark the series copyrighted with pre-approval required. The FRED CSV route was attempted but the remote connection closed; the dated Nasdaq JSON rows were used instead. No pre-market indicator or projected index-weighting basket was substituted.

The parent source review also identified two exact reported Composite levels in AP's end-of-session summaries:

- [2 November AP summary](https://apnews.com/article/475bb37b4d95dd99e26c94e708c99f8f): 25,164.32; publication 21:21:03 UTC.
- [3 November AP summary](https://apnews.com/article/95ac47c160dba546cbbdf72c10010e2c): 25,372.01; publication 21:14:37 UTC.

These are stored under the distinct `ap-COMP` series key. AP's 2 November value differs from Nasdaq/FRED by 0.04 points. **The two sources are not spliced** to manufacture a continuous technical history. AP supplies only two observations here, insufficient for five- or twenty-session returns or a twenty-session moving average. A reported rounded percentage is never used to reconstruct an index level.

The alternate AP market-wrap article had a displayed timestamp inconsistent with its completed-session content during initial retrieval. Its original publication timing was not used as a precise historical eligibility timestamp. News describing an uneven advance does not establish a licensed constituent breadth population.

## Macro measurements and lag

The following FRED latest observations all refer to **2 November**, despite their series-update timestamps occurring on 3 November. Update time and measurement time are separate fields. The explicit CST update labels were converted to UTC using UTC−6.

| Source | Latest measurement | Value and unit | Displayed update converted to UTC | Usage status |
| --- | --- | --- | --- | --- |
| [CBOE VIX via FRED, VIXCLS](https://fred.stlouisfed.org/series/VIXCLS) | 2 November | 21.15 index points | 3 November 14:37 UTC | Copyrighted; citation required; public reference only |
| [Federal Reserve Treasury yield, DGS10](https://fred.stlouisfed.org/series/DGS10) | 2 November | 4.91 percent | 3 November 21:16 UTC | Public domain; citation requested |
| [ICE BofA high-yield OAS, BAMLH0A0HYM2](https://fred.stlouisfed.org/series/BAMLH0A0HYM2) | 2 November | 3.43 percent, equivalent to 343 basis points | 3 November 16:01 UTC | ICE internal-use reference; redistribution requires permission; no application-feed licence asserted |

Five explicit observations for each series were captured: 27, 28, 29 and 30 October, and 2 November. The 26 October baseline was not captured. Consequently an exact five-session change cannot be derived from this package and must remain unavailable rather than substituting a four-return change. Yield percentages and credit-spread basis points must be converted explicitly when compared with thresholds.

## Missing evidence and election context

No complete licensed constituent breadth population, sector-participation population, compatible GBP FX history or 3 November Nasdaq historical close was imported. These are visible missing inputs, not zero values or estimates. Company statements, analyst commentary, an indicative basket and market-wrap headlines cannot fill those gaps.

The AP session summary is retained as election-day market context. It establishes no election result, winner, policy outcome or causal explanation for the price move. No future election outcome is entered into evidence available earlier in the day. The package contains no automatic recommendation and grants no order, broker or human-approval authority.

# Source version 2: 5 November 2026 re-capture

Actual receipt: **5 November 2026, 14:25–14:26 UTC** (per-file write times, rounded up to the second). Built by `scripts/prepare-recovery-case-v2.py` into `november-3-2026-v2.json`, `november-3-2026-v2-request.json` and `sourced-observations-v2.json`, with external source version `recovery-006-2026-11-03-source-v2`. **Version 1 is unchanged.** It still records the anchor close as missing, because that was true at its 3 November receipt time. Version 2 does not backdate anything. Every v2 row carries the 5 November receipt time.

## Anchor and follow-on closes (Nasdaq public historical API, 1 Sep – 4 Nov, 46 sessions each)

| Instrument | 2 Nov | **3 Nov (anchor)** | 4 Nov |
| --- | ---: | ---: | ---: |
| COMP index | 25,164.36 | **25,372.01** | 25,736.51 |
| NDX index | 27,989.82 | **28,180.26** | 28,437.17 |
| SOX index | 10,328.33 | **10,600.40** | 10,268.65 |
| QQQ ETF (USD) | 681.09 | **685.28** | 691.95 |
| NVDA (USD) | 202.06 | **206.69** | 200.13 |
| MSFT (USD) | 507.12 | **520.99** | 555.80 |
| AAPL (USD) | 338.32 | **331.90** | 349.51 |
| VT ETF (USD) | 155.11 | **155.16** | 157.81 |

The overlapping 1 Oct – 2 Nov closes match v1 exactly (`v1Revisions: []`). The 3 November COMP close now agrees with AP's separately reported 25,372.01. The two series are still not spliced. Stock and ETF closes remain unadjusted and unlicensed.

## Macro (FRED CSV) and FX (Bank of England)

VIXCLS, DGS10 and BAMLH0A0HYM2 were captured from 1 September through **3 November**. This fills the 26 and 27 October baselines that v1 lacked. No 4 November observation existed at capture. Exact five-session changes at the anchor (3 Nov vs 27 Oct): VIX **+3.31 pts** (17.52 → 20.83), 10-year **−0.04 pp** (4.99 → 4.95), HY OAS **+22 bp** (318 → 340). FRED's CSV gives no per-row publication time, so `publishedAt` is null and receipt is the eligibility bound.

Bank of England XUDLUSS (USD per GBP, about 16:00 London) was captured through 4 November and stored inverted as a USD→GBP rate (`boe-xudluss-inverted-v1`; 3 Nov 1.3415 USD/GBP). It is an **indicative rate, not a dealing rate**, and it is **not aligned to the 21:00 UTC US close**. It is therefore stored with `licensed: false` and its true fixing time, and it cannot price the paper experiments.

## Still missing in v2

Licensed Composite breadth population; licensed sector-participation population; any analyst target-revision or rating-label feed (the frozen analyst snapshot holds zero recommendations); a licensed close-aligned GBP FX rate; dealing, spread, slippage, FX-fee, platform-fee and cash-rate assumptions; corporate-action review; election-result sources. Election headlines are the v1 AP records with their original publication and receipt times. No new headline was imported.
