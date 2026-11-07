# Independent model tournament CLI

The Python runner sends one immutable, validated evidence bundle concurrently to an OpenAI-compatible Chat Completions endpoint and the Anthropic Messages endpoint. It is optional and independent of the browser demo. No real requests were made during development: HTTP is mocked in tests.

The earnings extension also accepts a ready snapshot envelope from `python -m worker.earnings snapshot`. See [Earnings Intelligence benchmark](earnings-benchmark.md) for pre/post cutoff controls, explicit absolute/excess targets, the registered abstention baseline and evaluation of provider artifacts against supplied aligned prices. Earnings requests allow only long/no-trade actions; legacy generic bundles retain their earlier contract. Each provider artifact now includes the frozen evidence hash.

## Setup and invocation

Set `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in the process environment, using exact supported model IDs. Python does **not** automatically load Next.js `.env.local`. Use your environment/secret manager to expose these variables to Python; do not put secrets into the bundle or command-line arguments.

```powershell
python -m worker.model_runner worker/example-bundle.json --output-dir runs/benchmark-001 --deadline-seconds 60 --max-output-tokens 2000
python -m unittest discover -s worker -p "test_*.py" -v
```

Running with valid keys sends evidence to both providers and may incur API charges. The example is explicitly synthetic. For research runs replace it with an approved source-backed bundle; this runner validates timestamps and references, not the truth of source claims. Output directories must be new: prior runs are never overwritten. The limits are 100 evidence items, 250 KB bundle size, 16,000 maximum output tokens per participant and a maximum 300-second deadline. These bound individual requests, not monthly spending: configure provider account spend limits separately.

Optional `OPENAI_ENDPOINT` and `ANTHROPIC_ENDPOINT` specify complete HTTPS endpoints, without query strings or embedded credentials. Only send credentials to a provider you trust. OpenAI defaults to `https://api.openai.com/v1/chat/completions`. Anthropic defaults to `https://api.anthropic.com/v1/messages`, with the stable `2023-06-01` API version; `ANTHROPIC_VERSION` can override it for your provider configuration. Parameter support is model-specific; unsupported parameters produce a recorded failed run, not silent fallback to a different model.

All HTTP redirects are rejected, including same-host redirects, so credentials cannot be forwarded to another destination or a downgraded HTTP connection. Configure the final HTTPS endpoint directly. A redirect is recorded as a failed provider response.

## Frozen outcome definitions

Every input bundle must include a finite, nonnegative `neutralBand` in decimal return units; the bundled example uses `0.002` (0.2%). Protocol version `benchmark-001-v2` incorporates that exact value into the shared system prompt and saved manifest. Up means return strictly above the band, down strictly below its negative, and neutral includes both boundaries. Older bundles without this field are rejected before requests start.

When preparing an evaluation request, copy `manifest.bundle.neutralBand` to the evaluator's `neutralBand` field. Do not rely on the evaluator's legacy default for a recorded experiment. The output files are not automatically transformed into evaluator input: the caller still supplies aligned observed returns and converts forecast `lower`/`upper` into the evaluator's `interval` array.

The caller must also register an exact forecast anchor, exchange calendar and session policy before a real experiment. This runner only validates the horizon label (`1h`, `1d`, `5d`); it does not calculate future market timestamps or select prices. Those alignment and outcome-ingestion integrations remain unimplemented.

## Records and outcomes

`manifest.json` is written before requests begin and contains the exact evidence, SHA-256, shared system prompt, participants, token cap and deadline. `openai.json` and `anthropic.json` contain requested/returned model identifiers, raw response, raw usage fields, latency, validated forecast or failure state. Files are immutable by normal run behaviour, not tamper-proof storage; retain them in access-controlled archival storage for stronger provenance.

The global deadline stops accepting forecasts. Slow HTTP threads are daemonised and do not delay process exit; a timed-out provider request can still incur charges. Requests are not retried automatically, preventing hidden extra runs. Missing credentials, provider errors, malformed output, invalid citations and deadline failures are recorded explicitly. The CLI exits 0 only if both participants succeeded, 1 for participant failures, and 2 for invalid setup/input.

Output requires up/down/neutral probabilities summing to one, decimal expected return, 80% interval, nonempty citations into the frozen bundle, explanation, invalidation and long/short/no-trade decision. A citation check does not prove factual correctness: human or independent adjudication is still needed.

Actual billed cost is deliberately `null`, pending provider billing reconciliation. Raw token usage is preserved without inventing prices or assuming equal provider accounting. Anthropic's total input combines uncached, cache-write and cache-read tokens; OpenAI cached input is included within prompt usage. Use verified rates and billing records when preparing cost reports. The CLI outputs files; it does not automatically insert them into Convex or authorise paper orders.

The generic OpenAI-compatible adapter uses Chat Completions JSON mode and strict local validation for portability. OpenAI recommends Responses for new OpenAI-only applications and JSON Schema for models supporting it; a future native adapter can adopt those without changing the frozen experiment contract.

Primary documentation checked 27 October 2026:

- [OpenAI Chat Completions request and usage fields](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Anthropic Messages request and usage fields](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic prompt-cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
