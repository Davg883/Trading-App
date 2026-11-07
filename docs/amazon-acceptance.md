# Amazon Q3 2026 cash conversion — implementation acceptance

Date: 31 October 2026. Version: `amazon-cash-2026-v1`.

## Delivered

The case is available at `/earnings/amazon`, linked from Economics Observatory and the existing earnings case navigation. It reuses the Earnings Intelligence page, event/source registry, evidence cutoffs, owner identity and immutable registration architecture. Alphabet and all six dashboard modules remain available.

The versioned source artifact contains **69 observations**, plus two separately defined Bedrock business-metric claims, from official Amazon financial disclosures. Six quarters of company/AWS sales, operating income, net income and TTM cash/revenue comparisons are retained. Reported observations, calculated quarterly cash values, management guidance and management expectations have distinct record kinds. The legacy earnings projection contains only **62 reported observations**, with units explicitly converted from USD millions to billions; derived values and management outlook are never relabelled as reported legacy results.

## Reconciled results

All amounts below are USD millions. Sources: [SEC Exhibit 99.1](https://www.sec.gov/Archives/edgar/data/1018724/000101872426000038/amzn-20260930xex991.htm) and the [official release](https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Third-Quarter-Results/default.aspx).

| Measurement | Reconciliation |
| --- | --- |
| Q3 consolidated sales / operating income / net income | 201,944 / 28,076 / 20,685. |
| Q3 AWS sales / operating income / derived margin | 45,984 / 17,773 / 38.6504%. |
| Q3 company operating margin | 28,076 / 201,944 = 13.9029%. |
| Q3 gross purchases less proceeds | 77,259 − 1,381 = 75,878 derived net cash capex. |
| Q3 operating cash less net capex | 42,422 − 75,878 = −33,456 derived quarterly FCF. |
| TTM operating cash less reported net capex | 168,300 − 210,657 = −42,357 reported TTM FCF; residual zero. |
| Compatible TTM revenue and FCF margin | Revenue 797,455; margin −42,357 / 797,455 = −5.3115%. |
| TTM capex coverage | 168,300 / 210,657 = 79.8929%. |
| Comparable prior-year TTM FCF deterioration | −42,357 − 14,788 = −57,145; −386.4282% relative to positive prior FCF. |
| TTM net capex growth | 210,657 / 115,903 − 1 = 81.7528%. |
| AWS margin change | −0.7060 percentage points sequentially; +4.0082 points year over year. |

The article discrepancy remains **user-described and unverified**, because the article and URL were not supplied. The official $77.259bn number is gross purchases; $75.878bn is the distinct net quarterly amount. The article annotation is always redacted from frozen model evidence.

Management's approximately $220bn 2026 cash-capex guidance retains its disclosed definition without assuming equivalence to gross or net reported purchases. AWS growth above 40% in each of 2027 and 2028 is recorded as two management expectations with open bounds, never as realised growth or forecast revenue amounts. Nearly 17× total Bedrock token volume and nearly 7× Fortune 500 customer spending retain unlike populations, approximation qualifiers and missing cohort details. AI-specific ROI remains null.

## Evidence and experiment controls

Source and observation receipt for the extraction/import is `2026-10-31T18:31:43Z`. Earlier comparative reporting windows do not receive earlier receipt timestamps. SEC acceptance `2026-10-29T20:05:27Z` is labelled a filing publication proxy, distinct from first public availability or exact IR release time. The date-only IR source retains a null exact time and a conservative eligibility bound. Selecting the release-plus-one-minute cutoff leaves the newly received financial data unavailable.

The retrospective interpretation draft contains one eligible frozen evidence set, a deterministic rules baseline and two pending independent model slots. Private authenticated registrations require distinct declared providers and exact model versions, and record actual workspace ingestion and registration times. A versioned qualitative rubric remains unscored until review. No model call, model output, latency, token count, inference cost, financial forecast, market forecast or model performance score is fabricated. The later forward experiment is explicitly **not registered** and requires a separate future-target protocol and registration.

## Validation

| Check | Result |
| --- | --- |
| Full TypeScript suite | **242 passing tests across 26 files**, including 16 new cash-engine tests, 12 interpretation tests, ten new persistence tests and five imported-source reconciliation tests. All prior suites remain passing. |
| Full Python discovery | **142 passing tests**, including 18 new independent cash tests and 14 interpretation-runner tests. A discovery import-path issue was corrected and the complete suite rerun. |
| Financial reproduction | Complete TypeScript/Python output parity against the actual official case; deterministic repeat output. |
| Browser export reproduction | The actual UI research download runs twice through Python with identical output and matching net capex, TTM FCF, null ROI and pending models. |
| Amazon browser workflow | Passed Observatory navigation, six-quarter history, gross/net reconciliation, guidance/cohort separation, receipt cutoff exclusion, model-draft export, invalid-cutoff blocking, mobile layout and no browser exceptions. |
| Existing browser regression | Dashboard/paper approval and persistence, Alphabet earnings, market stress and broker settings checks rerun. |
| TypeScript checking and production build | Passed; `/earnings/amazon` included in production routes. |
| Lint | Passed. |
| Visual inspection | Amazon desktop and mobile screenshots inspected; no horizontal page overflow in responsive browser checks. |

There are **384 passing TypeScript/Python tests** in total. Existing market-stress, earnings, model-runner, authorisation, risk, ledger, proof, infrastructure and defence tests remain included. New persistence tests check owner isolation, immutable imports and result attempts, registered-source linkage, real-ingestion cutoff protection, distinct model providers, exact evidence/version binding, safe failed submissions, rejection of model self-scores and no writes to forecasts, quotes, proposals, fills or broker tables. Cross-language tests validate mocked provider results against the actual non-ASCII source case. Corrected observations retain eligible audit history, while superseded IDs cannot be cited as active model evidence.

## Outstanding work and integrations

The local sourced case and independent evaluator work without external credentials. Clerk/Convex production configuration and trusted private ingestion remain unconfigured in the local preview, so no real deployed authenticated experiment was created. The additive source/experiment functions and schema are validated with authenticated Convex mocks. Follow the [experiment workflow](amazon-experiment.md) to import the case through trusted earnings ingestion after deployment configuration.

Two actual interpretation-model runs and their comparison have **not** been completed. The separate interpretation adapter, opt-in worker, validated internal result ingestion and private comparison display are implemented and tested with mocked provider responses. Configure the exact model identities and server-side worker credentials, export a registered manifest and explicitly authorise a paid run before expecting real results. Independent quality assessment remains pending. The existing market-forecast runner is preserved and is not presented as an interpretation-only runner.

No licensed market prices, verified share-price reaction, consensus snapshot or executable quote was imported. No forecast scoring is possible without separately registered targets and valid observations. Missing AI-specific return inputs remain unavailable. Source verification is an extraction audit, not an independently timestamped archive service or an audit of Amazon's financial statements.

No broker execution permission, leveraged trading, live order or paper allocation was introduced. Existing independent risk and authenticated human paper approval remain required.

See [source provenance](../data/earnings/AMAZON-SOURCES.md), [KPI dictionary](amazon-kpis.md) and [experiment workflow](amazon-experiment.md).
