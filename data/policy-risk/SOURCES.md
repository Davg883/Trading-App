# Benchmark 001.2 · US Midterm Infrastructure Risk — source provenance

Capture: **5 November 2026**. Pages were read between 14:30 and 14:55 UTC. Market data was captured at 14:50 UTC. The package build time (14:57:37 UTC) is recorded as a conservative receipt bound for every curated record. Built by `scripts/prepare-policy-risk-case.py` into `midterm-2026-11-03.json` and `midterm-2026-11-03-request.json`. **Retrospective**: everything was received after the 3 November election, so a strict receipt-basis view at the anchor contains no evidence.

## Policy and project sources

| ID | Source | Authority | Publication | Use |
| --- | --- | --- | --- | --- |
| ny-eo62 | NY Governor, Executive Order 62 | primary | dated 14 Jul 2026 (no time) | ≥50 MW DEC permit abeyance; ends on DPS final GEIS, no fixed date |
| ny-s10642 | NY Senate bill page S10642 / A11560 | primary | retrieval bound | Passed 4 Jun 2026; no signature or chapter shown. **Not enacted.** |
| hselaw-eo62 | Harter Secrest & Emery analysis | secondary | 17 Jul 2026 | EO 62 scope and exemptions |
| okhouse-hb2992 | Oklahoma House release | primary (chamber) | 13 May 2026 | HB 2992 signed; effective 1 Jul 2026; ≥75 MW cost allocation. Enrolled text not retrieved |
| azcapitol-tpt-pause | Arizona Capitol Times | secondary | 9 Jul 2026 | TPT exemption application pause through 2029. **Bill number not identified** |
| wyso-wilmington-court | WYSO | secondary | 24 Jul 2026 20:14 UTC | S.D. Ohio order of 14 Jul: redo three ordinances before the Amazon site-plan decision |
| fox19-wilmington-emergency | FOX19 | secondary | 4 Sep 2026 11:25 UTC | Emergency rezoning of the 471-acre Cosler parcel; state-court challenge |
| gridsight-votes | The Grid Sight tracker | secondary | updated 4 Nov 2026 (unofficial returns, 4 p.m. CT) | Local measure results and vote shares |
| wyso-sw-ohio-results | WYSO | secondary | 5 Nov 2026 03:38 UTC | Piqua, Urbana and Wilmington results; Piqua city statement on Meta |
| time-midterms | TIME | secondary | 4 Nov 2026 13:15 UTC | Race results and NBC exit poll (partly preliminary) |
| spectrum-janesville | Spectrum News | secondary | 6 Oct 2026 16:13 UTC | Janesville referendum; Viridian proposal "did not move forward" |
| theblock-wulf-eo62 | The Block | secondary | 15 Jul 2026 05:10 UTC | TeraWulf statements on Lake Mariner and Lake Hawkeye |
| apld-8k-2026-07-27, apld-8k-2026-10-07 | Applied Digital 8-K earnings releases (SEC EDGAR) | primary | 27 Jul / 7 Oct 2026 | Campus MW, energised MW, financing, tenants, capex |

## Conflicts and limits recorded rather than resolved

- **Piqua**: WYSO describes a ban on data centres over 25 MW. The tracker describes a construction ban. Earlier coverage questioned whether the measure was on the November ballot. The record is marked `conflictingSources` with high uncertainty. The city says it is "unclear" whether the measure affects Meta's project.
- **Urbana**: WYSO gives a 7.5 MW threshold, while the tracker says "ban within city limits". Marked as conflicting.
- **NY S10642**: one secondary outlet reported a signature that the legislative record does not show. It is kept as `passed_legislature`.
- **Wilmington**: the four rejected rezonings (≈545 acres) are adjacent to the Amazon parcel, not the parcel itself. Whether the September re-enactment satisfied the federal order is not established.
- **Applied Digital Polaris Forge 2**: earlier press named Oracle as tenant. The October 8-K says "investment-grade hyperscaler" without a name, and only the filing is used. Polaris Forge 1's 400 MW is the sum of disclosed building sizes.
- **Meta Piqua MW**: a power-demand figure appears only in secondary search snippets and is **not used**.
- All ballot results are **unofficial**. No county certification was imported.

## Market data

Nasdaq public historical Close/Last tables, 1 Sep – 4 Nov 2026 (46 sessions each), cover APLD, WULF, CRWV, IREN, CIFR, AMZN, MSFT, GOOGL, META, ORCL, NVDA, AMD, AVGO, VT, SPY and QQQ. These are unadjusted public-reference closes with corporate actions unreviewed. No licence is asserted. Raw responses are in `tmp/policy-risk/nasdaq/`.

## Missing evidence

- Secured or requested grid MW for every project.
- Supplier and equipment commitments.
- Verified construction delays with revised dates.
- Compute or lease pricing.
- Hyperscaler capex, FCF and project-level MW for AWS Wilmington, Meta Piqua and TeraWulf.
- Certified election results.
- Primary texts for the Arizona measure, Oklahoma HB 2992 and the Wilmington court order.
- Ohio's reported pause on data-centre tax exemptions. It was seen only in a search summary and **not registered**.
