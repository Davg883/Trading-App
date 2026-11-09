import { describe, expect, it } from 'vitest';
import {
  ARK_CAPEX_THESIS_ID,
  ARK_THESIS_PROVENANCE_RECORDS,
  MACRO_CLAIM_VERIFICATION_AUDITS,
  THESIS_MONITOR_VERSION,
  VERIFIED_LIVE_GEMINI_THESIS_INFERENCE,
  auditMarketCloseIngestionV3,
  evaluateAiCapexModerationThesis,
  runValidatedThesisChatExplanationTest,
} from '../lib/research-ratings/thesis-monitor';

describe('AI Capital Intelligence — Cathie Wood Thesis Monitor: Live Integration Acceptance (v2.0.0)', () => {
  it('1. preserves separate provenance categories for the registered thesis, original ARK commentary, secondary article, and verified primary evidence', () => {
    const assessment = evaluateAiCapexModerationThesis();

    expect(assessment.thesisId).toBe(ARK_CAPEX_THESIS_ID);
    expect(assessment.version).toBe(THESIS_MONITOR_VERSION);
    expect(assessment.executionAuthority).toBe('none');
    expect(assessment.schemaExpansionRecommendation.expandTypeDbSchemaNow).toBe(false);
    expect(assessment.schemaExpansionRecommendation.promoteUnverifiedCommentaryToProdGraph).toBe(false);

    const thesisReg = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'registered_thesis_statement',
    );
    const commentaryRecords = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'commentary_origin',
    );
    const secondaryRecords = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'secondary_reporting',
    );
    const primaryRecords = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'verified_primary_evidence',
    );

    expect(thesisReg).toHaveLength(1);
    expect(commentaryRecords).toHaveLength(1);
    expect(secondaryRecords).toHaveLength(1);
    expect(primaryRecords.length).toBeGreaterThanOrEqual(7);

    // Non-primary layers must NEVER be eligible for graph confirmation as facts
    for (const record of [...thesisReg, ...commentaryRecords, ...secondaryRecords]) {
      expect(record.eligibleForGraphConfirmation).toBe(false);
      expect(record.claimClassification).not.toBe('observed_fact');
      expect(record.receivedAtMs).toBeGreaterThan(0);
    }

    // Verified primary SEC/BEA/Nasdaq records must preserve publication and receipt timestamps
    for (const record of primaryRecords) {
      expect(record.eligibleForGraphConfirmation).toBe(true);
      expect(record.claimClassification).toBe('observed_fact');
      expect(record.publicationDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.receivedAtMs).toBeGreaterThan(0);
    }
  });

  it('2. ingests and validates the 5–6 November 2026 US market closes with zero v2 revisions and zero live-quote substitution', () => {
    const mktAudit = auditMarketCloseIngestionV3();

    expect(mktAudit.licensedForRedistribution).toBe(false);
    expect(mktAudit.substitutedLiveQuotesForHistoricalCloses).toBe(false);
    expect(mktAudit.v2OverlapSessionsChecked).toBeGreaterThanOrEqual(7);
    expect(mktAudit.v2RevisionsDetectedCount).toBe(0);

    // Verify 5 Nov sell-off and 6 Nov rebound across COMP, SOX, SPY, QQQ, and NVDA
    expect(mktAudit.instruments.COMP!.nov4Close).toBe(25736.51);
    expect(mktAudit.instruments.COMP!.nov5Close).toBe(24315.0);
    expect(mktAudit.instruments.COMP!.nov6Close).toBe(24579.42);
    expect(mktAudit.instruments.COMP!.nov5ChangePct).toBeCloseTo(-5.5233, 3);
    expect(mktAudit.instruments.COMP!.nov6ChangePct).toBeCloseTo(1.0875, 3);

    expect(mktAudit.instruments.SOX!.nov5ChangePct).toBeCloseTo(-12.2461, 3);
    expect(mktAudit.instruments.SOX!.nov6ChangePct).toBeCloseTo(4.2071, 3);

    expect(mktAudit.instruments.SPY!.nov4Close).toBe(766.81);
    expect(mktAudit.instruments.SPY!.nov5Close).toBe(733.0);
    expect(mktAudit.instruments.SPY!.nov6Close).toBe(735.29);

    expect(mktAudit.instruments.NVDA!.nov4Close).toBe(200.13);
    expect(mktAudit.instruments.NVDA!.nov5Close).toBe(181.6);
    expect(mktAudit.instruments.NVDA!.nov6Close).toBe(186.64);
  });

  it('3. verifies the original BEA Q3 2026 GDP release (BEA 26-45) and separates enacted state policy from unofficial 3 Nov 2026 election returns', () => {
    const byKey = new Map(MACRO_CLAIM_VERIFICATION_AUDITS.map((c) => [c.claimKey, c]));

    const nov5 = byKey.get('nov_5_sp500_nasdaq_selloff')!;
    expect(nov5.verificationStatus).toBe('verified_in_primary_store');
    expect(nov5.whatIsVerifiedInStore).toContain('24,315.00');

    const nov6 = byKey.get('nov_6_market_rebound')!;
    expect(nov6.verificationStatus).toBe('verified_in_primary_store');
    expect(nov6.whatIsVerifiedInStore).toContain('24,579.42');

    const gdp = byKey.get('us_q3_2026_gdp_growth')!;
    expect(gdp.verificationStatus).toBe('verified_in_primary_store');
    expect(gdp.publishedAtMs).toBe(Date.parse('2026-10-29T12:30:00Z'));
    expect(gdp.receivedAtMs).toBeGreaterThan(Date.parse('2026-11-09T18:00:00Z'));
    expect(gdp.whatIsVerifiedInStore).toContain('BEA 26-45');
    expect(gdp.whatIsVerifiedInStore).toContain('+3.4% SAAR');

    const elections = byKey.get('us_2026_midterm_election_results')!;
    expect(elections.verificationStatus).toBe(
      'verified_enacted_policy_separated_from_unofficial_election_returns',
    );
    expect(elections.electionPolicySeparationNote).toContain('ny-eo62');
    expect(elections.electionPolicySeparationNote).toContain('okhouse-hb2992');
    expect(elections.electionPolicySeparationNote).toContain('unofficial_pending_statutory_canvass');
  });

  it('4. connects all 8 leading indicators to stored observations and separates observedFinancialFact, hypothesisBeingTested, relevanceOfObservation, evidenceDirection, sourceConfidence, freshnessAndHistoricalEligibility, and Part D observation fields', () => {
    const assessment = evaluateAiCapexModerationThesis();

    expect(assessment.leadingIndicators).toHaveLength(8);
    const seenIds = new Set<string>();
    for (const ind of assessment.leadingIndicators) {
      expect(seenIds.has(ind.indicatorId)).toBe(false);
      seenIds.add(ind.indicatorId);

      expect(ind.value.length).toBeGreaterThan(5);
      expect(ind.reportingPeriod.length).toBeGreaterThan(4);
      expect(ind.evidenceId.length).toBeGreaterThan(3);
      expect(ind.primaryEvidenceIds.length).toBeGreaterThan(0);
      expect(ind.historicalComparison.length).toBeGreaterThan(15);

      // Part A.4 explicit separation
      expect(ind.observedFinancialFact.length).toBeGreaterThan(10);
      expect(ind.hypothesisBeingTested.length).toBeGreaterThan(10);
      expect(ind.relevanceOfObservation.length).toBeGreaterThan(10);
      expect(ind.evidenceDirection).toBe(ind.evidenceClassification);
      expect(ind.sourceConfidence.rationale.length).toBeGreaterThan(10);
      expect(ind.freshnessAndHistoricalEligibility.rationale.length).toBeGreaterThan(10);

      // Part D.2 fresh observation comparison fields
      expect(ind.latestEligibleObservation.length).toBeGreaterThan(10);
      expect(ind.previousComparableObservation.length).toBeGreaterThan(10);
      expect(ind.evidenceSourceAndTimestamp.sourceId.length).toBeGreaterThan(3);
      expect(ind.materialChange.summary.length).toBeGreaterThan(10);
      expect(['supports', 'contradicts', 'does_not_resolve']).toContain(
        ind.hypothesisResolution,
      );

      // Neutral and insufficient_evidence must never resolve as 'supports'
      if (
        ind.evidenceDirection === 'neutral' ||
        ind.evidenceDirection === 'insufficient_evidence'
      ) {
        expect(ind.hypothesisResolution).toBe('does_not_resolve');
      }

      expect([
        'fresh_verified',
        'lagged_verified',
        'unofficial_pending_certification',
      ]).toContain(ind.freshnessStatus);
      expect([
        'supports',
        'contradicts',
        'neutral',
        'insufficient_evidence',
      ]).toContain(ind.evidenceClassification);
    }
  });

  it('5. derives category totals strictly from the 8 unique indicator records (1 supports + 4 contradicts + 2 neutral + 1 insufficient_evidence = 8) and audits Part A reclassifications', () => {
    const assessment = evaluateAiCapexModerationThesis();
    const changeSummary = assessment.evidenceChangeAssessment;

    expect(changeSummary.classificationPolicyNote).toContain('never statistical probabilities');
    expect(changeSummary.overallConclusionClassification).toBe('mixed_supports_and_contradicts');
    expect(changeSummary.totalDeclaredIndicatorsCount).toBe(8);
    expect(changeSummary.sumOfMutuallyExclusiveCountsEqualsTotal).toBe(true);
    expect(changeSummary.zeroDuplicateIndicatorIds).toBe(true);
    expect(changeSummary.items).toHaveLength(8);

    // Exact corrected v2.1.0 breakdown: 1 supports, 4 contradicts, 2 neutral, 1 insufficient_evidence = 8
    expect(changeSummary.counts.supports).toBe(1);
    expect(changeSummary.counts.contradicts).toBe(4);
    expect(changeSummary.counts.neutral).toBe(2);
    expect(changeSummary.counts.insufficient_evidence).toBe(1);
    expect(
      changeSummary.counts.supports +
        changeSummary.counts.contradicts +
        changeSummary.counts.neutral +
        changeSummary.counts.insufficient_evidence,
    ).toBe(assessment.leadingIndicators.length);

    // Verify specific Part A.5 indicator directions
    const byId = new Map(assessment.leadingIndicators.map((i) => [i.indicatorId, i]));
    expect(byId.get('ind-cloud-revenue-growth')!.evidenceDirection).toBe('supports');
    expect(byId.get('ind-capex-to-ocf')!.evidenceDirection).toBe('contradicts');
    expect(byId.get('ind-free-cash-flow')!.evidenceDirection).toBe('contradicts');
    expect(byId.get('ind-semiconductor-demand')!.evidenceDirection).toBe('contradicts');
    expect(byId.get('ind-credit-spreads-and-financing')!.evidenceDirection).toBe('contradicts');
    expect(byId.get('ind-project-deployment-delays')!.evidenceDirection).toBe('neutral');
    expect(byId.get('ind-power-availability')!.evidenceDirection).toBe('neutral');
    expect(byId.get('ind-regulatory-developments')!.evidenceDirection).toBe(
      'insufficient_evidence',
    );

    // Verify Part A quality gate audit record
    expect(assessment.partAQualityGateAudit.priorVersionReportedCounts.sum).toBe(9);
    expect(
      assessment.partAQualityGateAudit.correctedCountsDerivedFromUniqueIndicators.sum,
    ).toBe(8);
    expect(
      assessment.partAQualityGateAudit.correctedCountsDerivedFromUniqueIndicators
        .sumEqualsDeclaredCount,
    ).toBe(true);
    expect(assessment.partAQualityGateAudit.reclassifiedIndicatorsAudit).toHaveLength(4);

    for (const scenario of assessment.scenarios) {
      expect(scenario.probabilityAssignment).toBeNull();
    }
  });

  it('6. records and validates the authenticated Gemini live inference telemetry and 9-check closed-evidence validator', async () => {
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.generationMode).toBe('gemini_live');
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.providerStatus).toBe('succeeded');
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.requestId).toBe('Tj3yaoqeGa6xuMYPoMuKoAk');
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.inputTokens).toBe(6983);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.outputTokens).toBe(772);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.totalTokens).toBe(7755);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.latencyMs).toBe(37393);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.estimatedCostGbp).toBe(0.001178);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.validationValid).toBe(true);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.checksPassed).toBe(9);
    expect(VERIFIED_LIVE_GEMINI_THESIS_INFERENCE.shortAnswer).toContain(
      '1 supports, 4 contradict, 2 are neutral, and 1 has insufficient evidence',
    );

    const { bundle, validatedAnswer, validationReport } =
      await runValidatedThesisChatExplanationTest();

    expect(bundle.sources.some((s) => s.docId === 'bea-26-45-gdp-q3-2026-adv')).toBe(true);
    expect(bundle.sources.some((s) => s.docId === 'nasdaq-comp-history-v3')).toBe(true);
    expect(validationReport.valid).toBe(true);
    expect(validationReport.actionTaken).toBe('accepted');
    expect(validationReport.checks).toHaveLength(9);
    for (const check of validationReport.checks) {
      expect(check.passed).toBe(true);
    }
    expect(validatedAnswer.executionAuthority).toBe('none');
  });

  it('8. handles missing, stale, contradictory, superseded, and post-cutoff evidence deterministically', async () => {
    // (a) Missing evidence: excluding `amazon-sec-ex991` downgrades capex/OCF and FCF items to `insufficient_evidence`
    const withMissing = evaluateAiCapexModerationThesis({
      excludeEvidenceIds: ['amazon-sec-ex991'],
    });
    const capexInd = withMissing.leadingIndicators.find(
      (i) => i.indicatorId === 'ind-capex-to-ocf',
    )!;
    expect(capexInd.freshnessStatus).toBe('missing_evidence');
    expect(capexInd.evidenceClassification).toBe('insufficient_evidence');
    expect(withMissing.evidenceChangeAssessment.counts.insufficient_evidence).toBeGreaterThan(1);

    // (b) Stale evidence: setting tight maxFreshnessDays (10 days) marks July/August sources (`nvda-fy27-q2`, `cru-eirgrid-dc-policy-2026`) as `stale_beyond_threshold`
    const withStale = evaluateAiCapexModerationThesis({
      maxFreshnessDays: 10,
    });
    expect(withStale.evidenceChangeAssessment.staleIndicatorIds).toContain(
      'ind-semiconductor-demand',
    );
    expect(withStale.evidenceChangeAssessment.staleIndicatorIds).toContain(
      'ind-power-availability',
    );

    // (c) Superseded evidence: `rel-loughton-dc-cancelled-v1-r1` is excluded from active relationships while `rel-loughton-dc-active-v2-r1` is included
    const standard = evaluateAiCapexModerationThesis();
    expect(
      standard.evidenceChangeAssessment.activeSupersededRelationshipIdsExcluded,
    ).toContain('rel-loughton-dc-cancelled-v1-r1');
    expect(
      standard.evidenceChangeAssessment.activeReplacementRelationshipIdsIncluded,
    ).toContain('rel-loughton-dc-active-v2-r1');

    // (d) Historical cutoff (`publication` clock at 2026-10-30): excludes 2 Nov Anthropic S-1/A and 5–6 Nov market closes
    const oct30Cutoff = evaluateAiCapexModerationThesis({
      historicalCutoffMs: Date.parse('2026-10-30T23:59:59Z'),
      temporalBasis: 'publication',
    });
    expect(oct30Cutoff.evidenceChangeAssessment.excludedByHistoricalCutoffIds).toContain(
      'anthropic-s1a-2026-11-02',
    );
    expect(oct30Cutoff.evidenceChangeAssessment.excludedByHistoricalCutoffIds).toContain(
      'nasdaq-comp-history-v3',
    );

    // Also verify chat bundle at 30 Oct 2026 cutoff excludes `anthropic-s1a-2026-11-02` and still passes 9/9 validation checks
    const oct30Chat = await runValidatedThesisChatExplanationTest({
      historicalCutoffMs: Date.parse('2026-10-30T23:59:59Z'),
      temporalBasis: 'publication',
    });
    expect(
      oct30Chat.bundle.sources.some((s) => s.docId === 'anthropic-s1a-2026-11-02'),
    ).toBe(false);
    expect(oct30Chat.validationReport.valid).toBe(true);
  });

  it('9. preserves INSUFFICIENT DATA across all 7 stocks and executionAuthority=none', () => {
    const assessment = evaluateAiCapexModerationThesis();
    expect(assessment.executionAuthority).toBe('none');
    expect(assessment.companyLinkages).toHaveLength(7);
    for (const company of assessment.companyLinkages) {
      expect(company.currentRatingLabel).toBe('INSUFFICIENT DATA');
      expect(company.nov5CloseUsd).toBeGreaterThan(0);
      expect(company.nov6CloseUsd).toBeGreaterThan(0);
    }
  });
});
