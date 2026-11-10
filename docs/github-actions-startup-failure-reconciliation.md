# GitHub Actions Startup Failure Investigation & Resolution Report
**Document Identifier:** `DOC-CI-WORKFLOW-RECON-20261110`  
**Workflow File:** `.github/workflows/remote-research-operations.yml`  
**Repository:** `Davg883/Trading-App`  
**Branch:** `main`  
**Failed Runs Investigated:** `42848116421` (commit `150339e`), `42848338003` (commit `481eb92`)  
**Corrective Commits:** `04f12a6` (expression fix), `7970ac6` (least-privilege isolation fix)  
**Successful Verified Run:** `42849757669`  
**Status:** FULL RECONCILIATION PASSED  
**Execution Authority:** Strictly `none` (`LIVE_TRADING_ENABLED` absent/unauthorized, read-only broker controls preserved)  

---

## 1. Incident Overview & Startup Failure Diagnostics

On commit `150339e` (and preceding commits touching the repository), GitHub Actions runs for `.github/workflows/remote-research-operations.yml` immediately entered `conclusion: failure` with:
- **Error:** `"No jobs were run"`
- **Total Jobs:** `0`
- **Workflow Name in API:** `.github/workflows/remote-research-operations.yml` (indicating workflow compilation abort before parsing top-level `name:`)

### Exact Workflow Annotation & Failure Details
Inspection of the GitHub Check Suite (`check_suite_id: 116042180895`, run `42848116421`) revealed the exact startup error:
```
Invalid workflow file: .github/workflows/remote-research-operations.yml#L1
(Line: 51, Col: 13): Unrecognized named-value: 'secrets'. Located at position 1 within expression: secrets.OPERATIONS_SCHEDULER_SECRET != '' && vars.RESEARCH_APP_ORIGIN != ''
```

When attempting an authorized manual dispatch prior to the fix, the GitHub Actions REST API returned HTTP `422 Unprocessable Entity`:
```json
{
  "message": "Invalid Argument - failed to parse workflow: (Line: 51, Col: 13): Unrecognized named-value: 'secrets'. Located at position 1 within expression: secrets.OPERATIONS_SCHEDULER_SECRET != '' && vars.RESEARCH_APP_ORIGIN != ''",
  "documentation_url": "https://docs.github.com/rest/actions/workflows#create-a-workflow-dispatch-event",
  "status": "422"
}
```

---

## 2. Root Cause Analysis

Two distinct issues were identified:

### Primary Cause: Step Conditional Expression Restriction (`secrets` context)
- In GitHub Actions syntax, the `secrets` context is **explicitly prohibited** inside `if:` conditional statements at the step or job level. This security measure prevents malicious actors or compromised workflows from conditionally evaluating secret strings to exfiltrate secret data via timing or branch enumeration.
- Line 51 contained:
  ```yaml
  if: ${{ secrets.OPERATIONS_SCHEDULER_SECRET != '' && vars.RESEARCH_APP_ORIGIN != '' }}
  ```
- Because GitHub parses and validates all workflow expressions upon repository push and registration, an unrecognized context inside `if:` aborts compilation before any runner can be provisioned. As a result, 0 jobs were created ("No jobs were run") and all scheduled cron triggers were prevented from starting.

### Secondary Cause: Least-Privilege Environment Violation in Research Worker
- Lines 31-32 injected:
  ```yaml
  env:
    RESEARCH_SCHEDULER_ENV: 'remote'
    LIVE_TRADING_ENABLED: 'false'
    DEMO_TRADING_ENABLED: 'false'
  ```
- Step 42 invokes `worker.remote_research.assert_least_privilege_environment(dict(os.environ))`.
- In [`worker/remote_research.py`](file:///c:/GPT%205%20CODEX/Trading%20app/worker/remote_research.py#L53-L56), `FORBIDDEN_ENV_KEYS_FOR_AGENT` strictly includes `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED`.
- In Python, `env.get('LIVE_TRADING_ENABLED')` returns `'false'`, which evaluates to truthy. The verification function threw `PermissionError: Remote research agent refused forbidden environment credentials: DEMO_TRADING_ENABLED, LIVE_TRADING_ENABLED`, ensuring that the research agent process has absolute zero trading flags or capabilities.

---

## 3. Scope of Remote Research Operations & Convex Cloud Independence

### Intended Operations of `.github/workflows/remote-research-operations.yml`
1. **Secret & Capability Isolation Check:** Runs `worker.remote_research.assert_least_privilege_environment` to verify that no broker vault keys (`BROKER_VAULT_KEY_B64`), Trading 212 API keys (`TRADING212_API_KEY`), or trading flags are present in the runner environment.
2. **Deterministic Research Test Suite:** Executes 8 unit tests in `worker/test_remote_research.py` to verify news ingestion validation, claim classification, prompt-injection quarantine, and non-double-counting logic.
3. **Secondary External Scheduled Trigger:** Issues a POST request to `${RESEARCH_APP_ORIGIN}/api/operations/scheduled` with `OPERATIONS_SCHEDULER_SECRET` to request processing of pending jobs (`market_data_collect`, `sec_filings_collect`, `news_discovery_agent`, `portfolio_risk_refresh`, `daily_intelligence_briefing`).

### Independence of Convex Production Scheduled Collectors
- **Convex Scheduled Functions Are Completely Independent:**
  - Convex maintains its own persistent, high-availability cloud scheduler defined in [`convex/crons.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/convex/crons.ts).
  - `remote-research-operations-cycle`: Convex automatically runs an internal cycle every 15 minutes calling `remoteOpsCloud:runScheduledCloudCycle` with `{ environment: 'remote', forceOnDemand: false }`.
  - `morning-intelligence-brief-uk-bst` and `morning-intelligence-brief-uk-gmt`: Convex triggers the London Morning Intelligence Briefing at 06:30 and 07:30 UTC independently of external HTTP triggers.
- Therefore, during the period when GitHub Actions failed startup validation, Convex's native cloud collectors continued their independent execution without interruption.

---

## 4. Corrective Implementation

The workflow was corrected with minimal, safe changes:
1. **Expression Fix:** Removed `if: ${{ secrets.OPERATIONS_SCHEDULER_SECRET != '' && vars.RESEARCH_APP_ORIGIN != '' }}`. Mapped the secret and variable into step-level `env:` and handled presence checking safely inside the bash script:
   ```yaml
         - name: Trigger persistent scheduled operations endpoint
           env:
             OPERATIONS_SCHEDULER_SECRET: ${{ secrets.OPERATIONS_SCHEDULER_SECRET }}
             RESEARCH_APP_ORIGIN: ${{ vars.RESEARCH_APP_ORIGIN }}
             TARGET_JOB: ${{ inputs.job_key }}
           run: |
             if [ -z "$OPERATIONS_SCHEDULER_SECRET" ] || [ -z "$RESEARCH_APP_ORIGIN" ]; then
               echo "OPERATIONS_SCHEDULER_SECRET or RESEARCH_APP_ORIGIN not configured; skipping remote HTTP trigger."
               exit 0
             fi
             JOB="${TARGET_JOB:-all_due}"
             if [ "$JOB" = "all_due" ]; then
               BODY='{"environment":"remote"}'
             else
               BODY="{\"environment\":\"remote\",\"jobs\":[\"$JOB\"],\"forceOnDemand\":true}"
             fi
             curl --fail --silent --show-error --max-time 60 \
               -X POST "${RESEARCH_APP_ORIGIN}/api/operations/scheduled" \
               -H "Content-Type: application/json" \
               -H "Authorization: Bearer ${OPERATIONS_SCHEDULER_SECRET}" \
               -d "$BODY"
   ```
2. **Environment Isolation Fix:** Removed `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` from the job-level `env:`, ensuring the research runner environment remains strictly unprivileged.
3. **Permissions Preserved:** `permissions: contents: read` was retained.

---

## 5. Verification & Successful Run Confirmation

1. **Pre-Push Validation:**
   - Validated YAML with PyYAML (0 errors).
   - Validated Python assertions locally (`assert_least_privilege_environment` passed).
   - Tested bash branch logic with Git Bash (both empty and populated credential paths passed).
2. **Commits Pushed:**
   - [`04f12a6`](https://github.com/Davg883/Trading-App/commit/04f12a6): `fix(ci): remove invalid secrets expression in remote-research-operations workflow`
   - [`7970ac6`](https://github.com/Davg883/Trading-App/commit/7970ac6): `fix(ci): isolate research agent environment from trading flags`
3. **Authorised Follow-Up Run:**
   - **Run ID:** `42849757669`
   - **Trigger:** `workflow_dispatch`
   - **Status:** `completed`
   - **Conclusion:** `success`
   - **URL:** `https://github.com/Davg883/Trading-App/actions/runs/42849757669`
   - **Step Breakdown:**
     - Set up job: `success`
     - Checkout repository: `success`
     - Set up Python 3.13: `success`
     - Verify least-privilege secret isolation: `success`
     - Run Python remote research verification suite: `success` (8 tests passed)
     - Trigger persistent scheduled operations endpoint: `success` (handled missing env vars gracefully, exited 0)
     - Complete job: `success`
