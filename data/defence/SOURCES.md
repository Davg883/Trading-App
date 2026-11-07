# Portfolio defence reference provenance

Reviewed 31 October 2026. `candidate-reference.json` is an educational product-specification catalogue, separate from all portfolio price, fund holdings and scenario inputs. A listing is not evidence of availability to a particular investor or brokerage account. Recheck issuer documents, costs and restrictions before research approval. No complete licensed price series or ETF holdings file was ingested in this release.

| Source | Supported reference facts | Deliberately not inferred |
| --- | --- | --- |
| [SEC asset allocation guidance](https://www.investor.gov/introduction-investing/getting-started/asset-allocation) | Diversification requires inspecting fund holdings and overlap. | Any particular fund is independent of AI or appropriate for the user. |
| [iShares ERNS issuer page](https://www.ishares.com/uk/individual/en/products/258120/ishares-ultrashort-bond-ucits-etf?locale=en_GB) | IE00BCRY6441; GBP; physical sampled investment-grade ultrashort bond UCITS fund; annual TER 0.09%; London listing. | Guaranteed capital, cash equivalence, realised yield, complete future costs or broker permission. |
| [iShares SGLN issuer page](https://www.ishares.com/uk/individual/en/products/258441/ishares-physical-gold-etc-fund) | IE00B4ND3602; physical metal ETC; USD base currency; GBP SGLN London trading line; annual TER 0.12%; not a UCITS fund. | GBP currency hedging, a future gold return or a recommendation. |
| [OIC protective put](https://prd-web.optionseducation.org/strategies/all-strategies/protective-put-married-put) | Long stock plus long put; premium reduces return; finite protection period. | An actual contract, executable option price, exchange calendar or exercise mechanics. |
| [OIC protective collar](https://www.optionseducation.org/strategies/all-strategies/collar-protective-collar) | Covered stock plus long put and short call; matched-expiry research structure; upside is capped. | Naked short exposure, a free hedge or permission to trade options. |
| [SEC inverse ETF bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/sec) | Daily-reset objectives and compounding can diverge from multi-period inverse index returns. | An executable product or exact future tracking. |

The synthetic case generator `lib/defence-demo.ts` uses only invented `demo-*` instrument identifiers. Its `example.com` URLs identify demonstration declarations and user assumptions, not market-data providers. Its `verified` flags mean the synthetic declaration was accepted within that demonstration. They never establish real-world verification. All prices and returns are explicitly synthetic, including the weekday-only calendar (which does not represent a verified real exchange calendar).

Historical observed scenarios must instead import compatible actual licensed observations and an independently checked exchange calendar. Model forecasts and retrospective narrative articles cannot replace missing price or holdings records.
