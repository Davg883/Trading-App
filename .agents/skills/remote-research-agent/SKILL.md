---
name: remote-research-agent
description: Execute the 10-step AI Capital Intelligence Remote Research Agent workflow for news discovery, SEC disclosure interpretation, claim classification, and restricted staging submission.
---

# Remote Research Agent Workflow Skill

Use this skill when running scheduled or on-demand AI-sector news and financial disclosure research.

## 10-Step Execution Procedure

1. **Read Universe & Cursor**:
   - Query `GET /api/research/staging` with `Authorization: Bearer $RESEARCH_STAGING_TOKEN` (or inspect the local staging state) to read the 11 covered symbols (`MSFT`, `GOOGL`, `AMZN`, `NVDA`, `CRWV`, `INTC`, `AMD`, `AVGO`, `META`, `ORCL`, `QQQ`), the latest processed `cursor`, and remaining daily/monthly model cost budget.
2. **Discover Candidate Sources**:
   - Gather new candidate disclosures and articles published or received after the cursor.
3. **De-duplicate**:
   - Canonicalize HTTPS URLs and compute SHA-256 content hashes via `worker.remote_research.canonicalize_source_url` and `content_sha256`. Skip any previously processed URL or hash.
4. **Extract Entities, Dates, Claims & Amounts**:
   - Run `python -m worker.remote_research --candidates <file> --output <out>` to extract covered tickers, `publishedAt`, genuine `receivedAt`, and numerical claims.
5. **Classify Claims**:
   - Classify every extracted claim as `observed`, `reported`, `estimated`, `proposed`, or `unverified`. Never submit market price claims from an AI agent.
6. **Identify Primary Sources**:
   - Verify whether each claim is backed by an authoritative primary domain (`sec.gov`, `fred.stlouisfed.org`, `bankofengland.co.uk`, `ferc.gov`, or official company IR).
7. **Submit to Restricted Staging**:
   - Send the structured payload to `POST /api/research/staging`.
8. **Independent Validation**:
   - Allow the staging validator to quarantine prompt-injection payloads, reject AI price claims, and hold unverified/secondary claims in `pending_verification` while promoting only verified primary-source facts to `evidence`.
9. **Record Run Metrics**:
   - Record `runId`, `modelVersion`, `inputTokens`, `outputTokens`, `estimatedCostGbp`, and any provider errors.
10. **Publish Concise Summary**:
    - Output a concise run summary for the Agent Operations and Morning Intelligence panels.
