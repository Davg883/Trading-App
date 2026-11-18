# Follow-Up Task — Claim/Record-Level Quarantine Replacing Accession-Wide Blocking (`0001045810-26-000078`)

- **Recorded During:** Case 007-B Controlled Post-Earnings Promotion (`case-007-nvda-post-q3fy27-v2`, `2026-11-18`)
- **Current Policy Retained in Case 007-B:** SEC accession `0001045810-26-000078` (`000104581026000078`) and all seven disputed G9.2/G9.4 SEC XBRL staging records (`staged-7f5da1f3fb6a672d`, `staged-e2523ed83a7c0247`, `staged-dcf44b009199d49a`, `staged-adfd0a710e5538b2`, `staged-39bf33eb27445eee`, `staged-98c25c92c7ca82e7`, `staged-c135441d25ee1df9`) remain strictly retained on `DISPUTED_G9_SEC_XBRL_BLOCKLIST` in `lib/remote-ops/case-007-nvidia-ingestor.ts`.
- **Current Case 007-B Representation:** NVIDIA's pending agreement to acquire Hugging Face, Inc. (`rel-case007b-nvda-huggingface-pending-acq-r1`) is represented with `epistemicStatus: "proposed"`, `contractualStatus: "contingent_signed"`, `bindingObligation: false`, and `principalAmount: null`, citing only the approved Q3 FY27 Form 8-K (`0001045810-26-000088`, Exhibits `99.1` and `99.2`).

## Scope of Future Work Package (Not Implemented in Case 007-B)

1. Replace accession-wide substring blocking on multi-purpose Form 8-K filings (specifically `0001045810-26-000078`) with **claim- and record-level quarantine** keyed to `(secAccession, extractionMethod, xbrlContextPeriodOrTag, stagedRecordId)`.
2. Keep `staged-e2523ed83a7c0247` (automated inline-XBRL extraction that misattributed a comparative Q2 2020 cover/context tag on `0001045810-26-000078`) permanently quarantined and excluded from promotion.
3. Permit deterministic, human-reviewed Item `8.01` narrative disclosures from `0001045810-26-000078` (`nvda-20260902.htm`, accepted `2026-09-03T12:03:56.000Z`: approximately `$11.9 billion` purchase price payable to Hugging Face stockholders plus up to `$1.0 billion` equity retention program, expected closing `1H 2027` subject to regulatory approvals) to be evaluated as `proposed` / `contingent_signed` `v2` updates once claim-level quarantine tests pass owner review.
