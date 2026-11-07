# Amazon Q3 2026 economic interpretation experiment

This case is retrospective research over Amazon's official financial disclosures. It is not an original forecast made before Amazon's earnings release. Actual source receipt times must be retained, including when older comparison periods are extracted from a newer release. Historical values do not inherit the publication or receipt date of an earlier report unless that original source was actually collected and recorded.

## Existing architecture and accounting boundary

The Amazon case extends the existing Earnings Intelligence source/event registry. The existing `MetricRecord` contract represents actual figures, consensus observations or outcomes; it does not contain a management-guidance role. Therefore guidance and management expectations remain in the typed cash-conversion case register and are never disguised as realised financial metrics or consensus estimates. Compatible reported observations may still populate existing earnings metrics through trusted internal ingestion. Quarterly, trailing-twelve-month and calendar-year periods remain distinct.

The market model runner keeps its established target/probability/return contract and abstention baseline. Economic interpretation uses a separate additive experiment registration linked to the earnings event; it does not fabricate a return target or change an earlier market-scoring formula.

## Retrospective registration

Trusted ingestion imports an existing AMZN `2026-Q3` earnings event and its authoritative source references, then calls internal `earnings:importInterpretationCase` with `owner`, `eventId`, `externalId` and the source-backed `caseJson`. The append-only case preserves source receipt times while separately recording actual workspace ingestion. A later revision requires a new external case ID; an exact retry is idempotent.

An authenticated owner can use `earnings:registerInterpretationExperiment` to register the case ID, experiment name, eligible cutoff and two exact model identities. The two participants must have different declared providers. Both receive one immutable eligible source snapshot and the same deterministic rules interpretation. The current registration is `retrospective_interpretation`; it does not create records in the existing `forecasts` table, approve a paper trade or create a broker order.

Use a cutoff no earlier than actual case ingestion and source receipt. A case received after the historical release cannot be backdated into a pre-release or post-release forward record. Late source revisions and unverified market-reaction commentary are excluded. Missing model submissions remain pending with null results and scores. No provider request, model response, token count, latency or billed inference cost is invented.

Compare economic interpretations against a frozen rubric covering period and definition reconciliation, AWS versus company scope, cash-flow change, distinction between guidance and reported outcomes, the gross/net capex discrepancy and the Bedrock cohort mismatch. Record human or independently adjudicated interpretation quality separately from any later market-forecast score. A model cannot grade itself into investment or trading approval.

Registration itself makes no provider calls. The interpretation-specific runner is `worker.amazon_interpretation_runner`; its independent adapters reuse the established HTTP security boundary while preserving the market-forecast runner's original contract. Both adapters receive the exact same canonical eligible evidence. A result must match the registered case, quarter, cutoff, submission slot, provider and exact requested/returned model version. Citations may reference only frozen eligible source, financial-observation or Bedrock IDs. Calls, token usage, latency and safe failure codes are retained; actual billed cost remains null until supported by billing records. No model can submit its own interpretation score, market score or execution authority.

## Run and retain the model comparison

Export the registered frozen manifest from the private experiment view. Validate it without requests or credentials:

```powershell
python -m worker.amazon_interpretation_runner amazon-interpretation-manifest.json --validate-only
```

To run the two providers, configure `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in the worker process environment. Exact model IDs must match the registered manifest; do not put credentials into the JSON, command-line arguments or browser storage. Python does not automatically load Next.js `.env.local`. Reuse the existing provider secret-management instructions in [model-runner setup](model-runner.md).

```powershell
python -m worker.amazon_interpretation_runner amazon-interpretation-manifest.json --output-dir runs/amazon-q3-interpretation-001 --allow-paid-requests
```

The explicit paid-request flag is required before network calls. Both providers' credentials, exact configured model versions and official inference destinations are checked before either request begins. Missing or incompatible configuration blocks the entire run before output creation or network calls; the registered model slots remain pending. This avoids silently paying for one participant when the second is unconfigured.

Actual requests may incur provider charges. Use a new output directory; an existing run is never overwritten. Once setup is valid, the runner writes the immutable manifest and `results.json`, containing the two independently validated result records. A mismatched returned model, invalid citation, HTTP failure or timeout produces a failed submitted-attempt record rather than an invented successful interpretation. A failure does not erase an earlier or later attempt. Real calls were not used in implementation or tests.

Trusted server ingestion can store each record through internal `earnings:appendInterpretationResult` using `owner`, `experimentId`, a unique `externalId` per attempt and `resultJson`. The public browser and ordinary model clients cannot call this function. The server independently validates exact canonical evidence and participant identity, rejects calls starting before registration or completing in the future, and adds actual workspace ingestion time. Identical retries return the existing record; a conflicting result cannot overwrite it. Reattempts use new IDs, preserving both failures and successful submissions. The immutable registration retains its original pending slots; separately stored results describe the actual run attempts.

`earnings:interpretationCaseDetail` returns owner-scoped result records alongside their experiment. At most 100 attempts and 800,000 aggregate result bytes are retained per experiment, with a 200,000-byte maximum input per attempt. A larger study requires a separately designed immutable artifact archive. No model result changes source records, grades itself, becomes a forward forecast or creates a paper/broker order. Interpretation quality remains null pending independent review under the frozen qualitative rubric; no arbitrary score is generated.

## A later forward experiment

Create a **new**, separately registered experiment before its forecast deadline and before its financial or market outcomes are known. Choose future outcome definitions, earnings/reporting periods, model versions, neutral band where applicable, benchmark, exchange calendar, exact target endpoints, price basis, risk protocol and submission deadline in advance. Freeze only evidence actually published and received at that new cutoff. Include the already received Amazon report as historical evidence, while later releases and revisions remain unavailable until their real receipt times.

For market forecasts use the established earnings/model-runner target contract and independently sourced aligned prices. A press article's stated share-price move is not an executable quote. For financial forecasts register explicit comparable future metrics and an independent scoring definition; do not treat management expectations as model forecasts or realised financial benefits. Outcomes remain pending until valid eligible observations exist.

The retrospective interpretation registration cannot be converted or relabelled into the later forward experiment. Preserve both immutable records and compare their purposes separately. Existing authenticated human approval and deterministic paper risk checks remain required; all broker connections stay read-only.

## API contract references

The interpretation adapter was checked against the [official OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [Anthropic Messages reference](https://platform.claude.com/docs/en/api/messages). OpenAI JSON output is locally validated and requests use `store: false`. The Anthropic adapter keeps the established `2023-06-01` version header; the [official version history](https://platform.claude.com/docs/en/api/versioning) documents versioned compatibility. No SDK or existing forecast-runner API version is silently migrated. Models must be exact available versions selected and authorised by the operator; none is invented by this case.
