# Analyst consensus validation: source provenance

Review date: 3 November 2026. The associated `company-comparison.json` is a retrospective context package, separate from a licensed analyst-consensus feed and from executable price observations. Its receipt timestamp is the actual package registration time, **2026-11-03T22:25:07Z**. This does not establish possession at any earlier earnings date.

## Authoritative company sources

| Source | Publication precision | Financial scope |
| --- | --- | --- |
| [NVIDIA FY2027 Q2 results](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027) | Official release date: 26 August 2026. Intraday publication time was not independently established. | Quarter ended 26 July 2026; unaudited consolidated GAAP income, balance sheet and cash-flow statements; reconciled company free cash flow; separate forward outlook. |
| [Microsoft FY2027 Q1 results](https://www.microsoft.com/en-us/Investor/earnings/FY-2027-Q1/press-release-webcast) | Official release date: 28 October 2026. Intraday publication time was not independently established. | Three months ended 30 September 2026; GAAP income and cash-flow statements; recast segment and product revenue definitions. |
| [Apple FY2026 Q4 release](https://www.apple.com/newsroom/2026/11/apple-reports-fourth-quarter-results/) | Official release date: **2 November 2026**, not 29 October. Intraday publication time was not independently established. | Quarter ended 26 September 2026, including disclosed tariff-refund effects; annual results and dividend announcement. |
| [Apple FY2026 Q4 financial statements](https://www.apple.com/newsroom/pdfs/fy2026q4/FY26_Q4_Consolidated_Financial_Statements.pdf) | Dated with the 2 November company release. | Page 1 distinguishes quarterly and annual income; page 2 contains point-in-time equity; page 3 contains **annual**, not quarterly, cash flows. |

Each source retains `publishedAt: null`, a separate `publicationDate`, `pubBasis: official_date_only` and actual system receipt. A historical eligibility implementation may conservatively use the end of the stated publication day while retaining the date-only precision, but must still require receipt before cutoff. No SEC acceptance timestamp was substituted for an unverified original release time.

## Reconciliation and period controls

All statement amounts are USD millions except diluted EPS, which is USD per share. Quarterly company income values are:

| Company | Fiscal reporting period | Revenue | Operating income | Net income | GAAP diluted EPS |
| --- | --- | ---: | ---: | ---: | ---: |
| NVIDIA | FY2027 Q2, 27 April–26 July 2026 | 96,221 | 63,734 | 59,688 | 2.46 |
| Microsoft | FY2027 Q1, 1 July–30 September 2026 | 92,279 | 45,915 | 36,629 | 4.92 |
| Apple | FY2026 Q4, 28 June–26 September 2026 | 114,477 | 35,631 | 30,711 | 2.10 |

NVIDIA's quarterly operating cash flow is 24,077. Its reported free cash flow of 21,341 subtracts both 2,677 of PP&E/intangible purchases **and 59 of principal payments**. OCF minus purchases alone is therefore a different definition. The package records the reported definition rather than silently changing it.

Microsoft's quarterly operating cash flow is 58,000 and cash additions to PP&E are 39,367. The package's 18,633 free-cash-flow value is explicitly **derived** from those two compatible quarterly observations. Cash PP&E additions do not include finance-lease additions; a broader infrastructure-capex number cannot be substituted without a reconciliation.

Apple's statement provides annual operating cash flow of 145,097 and annual PP&E payments of 9,041. The package derives annual free cash flow of 136,056. All three cash measures cover **28 September 2025–26 September 2026** and are clearly distinct from quarterly revenue and profit. They must not be divided by quarterly sales or compared as same-window cash-flow margins against NVIDIA or Microsoft. Apple reports annual diluted EPS of 8.98 separately from quarterly EPS of 2.10.

Reported equity is point-in-time: NVIDIA 228,984 at 26 July; Microsoft 470,509 at 30 September; Apple 112,093 at 26 September. These are book-equity amounts, not market capitalisation. No share price, market capitalisation, P/E, enterprise value, forward EPS or forward multiple has been imported. All valuation outputs remain null until compatible licensed data is available. Quarterly EPS is never multiplied by four to manufacture TTM or forward EPS.

## Cloud and AI definitions

- NVIDIA's Data Center revenue is a product/end-market measure, not revenue from a comparable cloud-provider segment. Its rounded 89.0 billion narrative value does not establish a Data Center operating-income figure.
- Microsoft separately discloses Azure revenue of 33,165 and a rounded Microsoft Cloud revenue KPI of 63.9 billion. Azure-only and Microsoft-Cloud-only operating income are not supplied in this package. The broader **Agents and Infra** segment reports 76,795 revenue and 40,558 operating income; those amounts cannot be labelled Azure or AI profit. Prior periods were recast following September 2026 segment changes.
- Apple's Services revenue of 31,573 is not a cloud-infrastructure segment. Its product/category definition differs from both Azure and NVIDIA Data Center.
- Company guidance and announcements remain news with explicit kinds. NVIDIA's next-quarter revenue outlook and contingent third-party financing ambitions are not realised revenue or funded project cash. Apple's dividend declaration is not an earned investment return.

The display may present this context side by side with explicit periods; it must not rank these businesses as though reporting windows, business models and non-GAAP free-cash-flow definitions were identical. These company figures do not establish AI-specific investment ROI.

## Melius NVIDIA revision: corroborated media only

The [Benzinga article dated 2 November](https://www.benzinga.com/analyst-stock-ratings/price-target/26/11/62779418/nvidia-amd-marvell-ai-stocks-big-tech-raise-cash) reports that Melius Research retained **Buy** while lowering NVIDIA's target from USD 420 to USD 315. The [provider's public NVIDIA analyst table](https://www.benzinga.com/quote/NVDA) separately identifies **Ben Reitzes**, Melius Research, and the 2 November 420-to-315 target revision.

The original Melius research note was not retrieved. The article attributes the report to CNBC; the linked CNBC page could not be retrieved during this review. The public provider page is corroboration within the same publisher, not independent confirmation from Melius. Accordingly:

- Verification remains `corroborated_media`.
- The action is a **target cut with Buy maintained**, not a rating downgrade.
- Date precision remains 2 November; the article's displayed clock time is not converted into a precise timestamp without an explicit timezone.
- `licensedFeedImported`, `originalResearchNoteRetrieved` and `consensusEligible` remain false.
- This single descriptive flag does not enter consensus averages, medians, counts, revisions, rating distributions or broker/trade logic.

No complete analyst table was scraped or imported, and no redistribution licence or data subscription was represented as active. Incidental quote and consensus numbers on provider pages were deliberately omitted from application market records and consensus calculations. A licensed, scoped source import is required before those analytics can be populated.
