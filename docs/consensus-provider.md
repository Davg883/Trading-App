# Licensed analyst-data ingestion

The observed case has no connected ratings or market-data feed. The application does not copy public website consensus totals into licensed records. Plugin discovery found no relevant available connection, and the workspace has no configured provider credentials. No subscription, provider request or brokerage action was made during implementation.

The provider-independent case contract is `analyst-consensus-001-v1`. The supplied worker adapter supports Benzinga ratings exports and the official read-only [Ratings API](https://docs.benzinga.com/api-reference/calendar-api/get-ratings). The [provider product description](https://www.benzinga.com/apis/cloud-product/analyst-ratings-api/) distinguishes raw firm rating language from normalised categories. Raw ratings are preserved; a separately declared mapping supplies positive/neutral/negative classification. An unmapped rating is not silently converted to Buy.

## Permission and timestamps

Obtain appropriate rights for retrieval, storage, display, research, derived metrics and any model processing before enabling an import. Copy `data/consensus/licence-template.json` into a private configuration file and replace its placeholders with the actual permitted-use scope, analyst population and reviewed rating mapping. Set `licenseConfirmed` true only after verification. This operator declaration is not independent legal verification of the provider agreement. A key alone does not establish a licence or redistribution permission.

Publication timezone must be explicit. The provider product page describes EST; the template uses UTC−05:00. Verify that this is correct for the actual export and all included dates. The adapter does not infer daylight-saving rules from an ambiguous timestamp. Prefer a provider-normalised export with a verified UTC offset when dealing with historical summer observations. Missing analyst/institution identities, original publication time, target currency or contradictory UTC update times are quarantined rather than invented. Original publication, provider update and actual import receipt are distinct.

Offline conversion does not require a key or network call:

```powershell
python -m worker.consensus_provider --case data/consensus/november-3-2026.json --licence path/to/private-licence.json --input path/to/licensed-ratings.json --from-date 2025-11-03 --to-date 2026-11-03 --output path/to/new-import.json
```

The raw input is the provider's JSON `{ "ratings": [...] }` response. A permitted API request requires `BENZINGA_API_KEY` in the worker process environment and an explicit flag:

```powershell
python -m worker.consensus_provider --case data/consensus/november-3-2026.json --licence path/to/private-licence.json --from-date 2025-11-03 --to-date 2026-11-03 --output path/to/new-import.json --allow-provider-request
```

Python does not automatically load Next.js `.env.local`. Keep keys in server/worker secret configuration, outside source files, browser storage, command-line arguments, source URLs and model evidence. No new frontend environment variable is introduced. The provider's token query parameter is used only for the fixed server-side HTTP request; source references and error messages never retain it.

Only GET requests to `https://api.benzinga.com/api/v2.1/calendar/ratings` are allowed. Redirects are rejected; timeouts, response size, date range and pagination are bounded. Incomplete or duplicate pagination is rejected. There is no generic URL proxy, order endpoint or automatic retry. The CLI logs safe counts and fixed errors rather than provider bodies, credential-bearing URLs or HTTP exception text. Output creation refuses to overwrite an existing artifact.

The import wrapper contains `case`, inserted count, quarantine references and the declared permission status. Load it with the monitor's **Import licensed case JSON** control for local inspection, or use trusted internal `consensus:importCase` after independent licence and source review. Exact vendor-version retries preserve the earlier receipt time. Corrected vendor versions append a new record and reference the preceding version; conflicting same-version changes are quarantined.

## Coverage and historical revisions

Completing pagination does not prove complete industry coverage. `coverageComplete` is false in the template. Any affirmative population claim must be separately justified. Statistics over an incomplete licensed sample are labelled partial, including the declared lookback and analyst universe.

A first import today can report provider-disclosed target/rating changes within the last 7/30/90 days. It cannot reconstruct what this workspace knew at those earlier cutoffs. Matched-cohort historical aggregate comparisons require receipt-time archives; otherwise they remain unavailable. Provider-reported previous targets are event comparisons, not a substitute for an earlier consensus snapshot. Provider headline labels require separately timestamped licensed `headlines` records; the adapter does not invent them by averaging a raw rating scale.

The current adapter uses raw `pt_current` / `pt_prior` values with the disclosed currency. Confirm comparable corporate-action and target-horizon conventions before treating them as a common economic target population. Price targets remain opinions and never become executable price observations.

## Prices, FX and outcome updates

Licensed market observations use the same case's `prices` and `fx` arrays. Preserve instrument ID, actual provider, source URL, licence/permitted-use declaration, event/publication/receipt time, currency, adjustment basis/version, regular session and corporate-action review. FX rates are GBP per unit of the foreign currency at the same registered session. No implicit currency conversion or missing-session fill is allowed.

After a local draft is frozen, **Append licensed outcome observations JSON** accepts only `{ "prices": [...], "fx": [...] }`. It appends observations or explicit revisions while leaving the analyst evidence, costs, weights and calendar frozen. The Python export reconstructs the original registered case plus later outcome observations, rather than silently replacing the original portfolio costs with edits. Private outcome computation uses the trusted internal evaluator described in the [experiment workflow](consensus-experiment.md).

Calendar and global ETF sources are separately cited in the case and [source register](../data/consensus/SOURCES.md). VT is an unleveraged US-listed research reference; availability to a UK retail account and any broker restrictions remain unverified. The research portfolios confer no purchase permission.
