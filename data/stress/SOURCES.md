# Market stress source provenance

The local observed workspace does not bundle market prices, historical analyst consensus or a verified six-company sell-off dataset. No October price decline, magnitude or causal explanation is asserted from an unsourced value.

`october-2026-case.json` records the retrospective research premise and missing inputs. Its only linked financial case is the existing Alphabet Q3 2026 SEC artifact in `data/earnings/alphabet-q3-2026.json`. See `data/earnings/SOURCES.md` for the original verification and timestamp provenance. This source does not supply market quotes or authoritative consensus. It must not be presented as an authentic pre-event forecast: the system receipt followed the release.

The `/stress` demonstration generates invented prices for the six watchlist symbols and QQQ. Every observation carries `synthetic: true`, an authored-fixture provider and example.com source, and a synthetic weekday calendar. These are format examples, not provider observations. The Python demonstration also uses an explicitly synthetic calendar and mocked model responses.

Observed imports must retain provider, source URL, event/publication time, receipt time, currency, session, feed delay, adjustment basis/version and a licensed-use declaration. Browser imports preserve the caller's claims; they do not independently authenticate a provider or verify a license. Trusted Convex ingestion is internal-only, append-only by external ID and optionally links the existing earnings source registry. Corrections require a new version rather than overwriting evidence.

Calendar and corporate-action review flags are explicit assertions by the supplying workflow. Production ingestion must substantiate them using the selected licensed provider. Mixed currencies and adjustment bases fail closed; no unrecorded conversion is applied.
