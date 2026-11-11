# 03 — Data-source assessment

**No provider was contacted, and no price was obtained for this assessment.** The provider table in `lib/portfolio/multi-asset-risk-pilot.ts` (`MARKET_DATA_PROVIDER_COMPARISON`) is hand-entered and unverified, so its figures are not repeated here as prices. Every paid source below needs a written quote and a licence review before contracting (prerequisite P3).

## 1. Coverage today versus requirement

| Input | Required for | What the system has today | Gap |
|---|---|---|---|
| Intraday prices (1-min bars, quotes) | All entries and exits, intraday stops, slippage model | None. Only delayed public end-of-day closes, labelled "unlicensed, delayed" | **MISSING: licensed intraday feed** |
| Daily OHLCV, adjusted | S2, regime, outcomes | Public EOD closes for 8 symbols; no corporate-action adjustment (`corporateActionsReviewed: false`) | **MISSING: licensed adjusted EOD + corporate actions** |
| Volume (intraday, time-of-day profile) | Relative-volume filter | EOD volume only | **MISSING** (comes with the intraday feed) |
| Earnings calendar (scheduled date and time) | S3 and the blackouts | None systematic | **MISSING: licensed calendar**, or manual entry from company IR pages recorded with receipt time |
| Earnings results / surprise | S3 | SEC XBRL facts after filing; no consensus | **MISSING: licensed consensus estimates** (otherwise S3 can use only price reaction, not surprise) |
| SEC filings (8-K, 10-Q, 10-K) | S1, S3 evidence | **Available**: EDGAR collector exists | Real-time 8-K polling cadence to be measured; EDGAR fair-access limit (10 requests/second, declared User-Agent) applies |
| Licensed news | S1 | **None** | **MISSING: licensed news feed with redistribution and storage rights** |
| Company press releases (IR pages, wire services) | S1 supplement | Not collected | Collectable; check each site's terms; store links and excerpts, not full text, unless licensed |
| GBP/USD | GBP-adjusted returns | ECB / Bank of England daily reference rates | **MISSING for intraday precision.** Daily rates are acceptable for P&L marking with a stated convention, but not for intraday GBP benchmarks |
| Volatility regime | Regime label | None | Computed from QQQ realised volatility (no licence needed); VIX needs a CBOE data licence |
| Broker instrument list, demo fills | Execution feasibility, fill comparison | Trading 212 read-only adapter (live and demo) and order client (demo use only in the lab) | Demo instrument availability per symbol to be checked |

## 2. Provider categories to quote

| Need | Candidate types (examples, not endorsements) | Questions for the quote |
|---|---|---|
| Intraday US equities (SIP or exchange consolidated) | Market-data API vendors such as Polygon.io/Massive, Tiingo IEX, Alpaca data, Databento, Nasdaq Basic | Real-time or 15-minute delayed; non-display / internal-use licence; exchange fees for "professional" status; history depth; corporate actions included |
| Licensed news | Newswire vendors (e.g. Benzinga, Dow Jones Newswires, LSEG/Reuters, Polygon/Massive news aggregation) | Storage and redistribution rights; publication-time precision; latency SLA; archive for evaluation |
| Earnings calendar and consensus | Estimates vendors (e.g. FactSet, LSEG I/B/E/S, Zacks, Estimize, Finnhub, Benzinga) | Point-in-time consensus snapshots (critical to avoid look-ahead); revision history |
| FX intraday | FX data vendors, or the equity vendor's FX feed | Mid vs. bid/offer; timestamp source |

**Non-professional versus professional status.** Exchange data fees depend on how the subscriber is classified. A company research lab is likely to count as professional or non-display use, which can multiply costs. Get legal confirmation before contracting.

## 3. Latency and timestamps

| Measurement | How |
|---|---|
| Provider event time → provider publish time | From the provider fields; recorded per observation |
| Provider publish → our receipt | `receivedAt − publishedAt`, logged for every item; p50 / p95 / p99 reported per source per session |
| Receipt → decision | Server timestamps |
| Decision → demo order acknowledgement | Server timestamps; broker response time |

**Required before L2:** 10 sessions of measured latency.
- S1 (news momentum) is not viable if p95 news latency exceeds about 60 seconds. At that point the move has usually happened, and the strategy measures a delay rather than a signal.
- That viability decision is recorded before any S1 results are seen.

## 4. Free sources that remain usable

- **SEC EDGAR:** filings and XBRL, within fair-access limits.
- **Company IR pages:** earnings dates, recorded with receipt time; manual entry is acceptable if the entry is itself journaled.
- **ECB / Bank of England reference FX:** daily marking only.
- **Trading 212 demo account:** fills for comparison, not a market-data source.

## 5. What happens if licensed data is not obtained

| Missing | Consequence |
|---|---|
| Licensed news | S1 cannot run. Do not substitute scraped or unlicensed news. |
| Consensus | S3 runs as "post-earnings price-reaction continuation" only, with the limitation stated. |
| Intraday prices | No intraday holding period. Strategies restricted to next-open entries and daily exits, with materially worse cost and slippage assumptions. |
| Bid and ask quotes, or the licensing rights to use them | The affected strategy is marked **NOT READY** (`05` §9.4). No fills are simulated from volume, assumed spreads or fixed estimates. This also applies to the next-open fallback above. |
