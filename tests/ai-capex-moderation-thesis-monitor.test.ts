import { describe, expect, it } from 'vitest';
import {
  ARK_CAPEX_THESIS_ID,
  ARK_THESIS_PROVENANCE_RECORDS,
  MACRO_CLAIM_VERIFICATION_AUDITS,
  THESIS_MONITOR_VERSION,
  evaluateAiCapexModerationThesis,
  runValidatedThesisChatExplanationTest,
} from '../lib/research-ratings/thesis-monitor';

describe('AI Capital Intelligence — Research Thesis Monitor: Cathie Wood AI Capex Moderation', () => {
  it('1 & 2. registers the dated 7 November 2026 thesis and separates provenance across commentary_origin, secondary_reporting, and verified_primary_evidence', () => {
    const assessment = evaluateAiCapexModerationThesis();

    expect(assessment.thesisId).toBe(ARK_CAPEX_THESIS_ID);
    expect(assessment.version).toBe(THESIS_MONITOR_VERSION);
    expect(assessment.datedThesisStatement).toContain('7 November 2026');
    expect(assessment.executionAuthority).toBe('none');
    expect(assessment.schemaExpansionRecommendation.expandTypeDbSchemaNow).toBe(false);
    expect(assessment.schemaExpansionRecommendation.promoteUnverifiedCommentaryToProdGraph).toBe(false);

    const commentaryRecords = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'commentary_origin',
    );
    const secondaryRecords = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'secondary_reporting',
    );
    const primaryRecords = ARK_THESIS_PROVENANCE_RECORDS.filter(
      (r) => r.epistemicLayer === 'verified_primary_evidence',
    );

    expect(commentaryRecords.length).toBeGreaterThanOrEqual(1);
    expect(secondaryRecords.length).toBeGreaterThanOrEqual(1);
    expect(primaryRecords.length).toBeGreaterThanOrEqual(5);

    // Commentary and secondary reporting must NEVER be eligible for graph confirmation as facts
    for (const record of [...commentaryRecords, ...secondaryRecords]) {
      expect(record.eligibleForGraphConfirmation).toBe(false);
      expect(record.claimClassification).not.toBe('observed_fact');
      expect(record.receivedAtMs).toBeGreaterThan(0);
    }

    // Verified primary SEC records must preserve publication and receipt timestamps
    for (const record of primaryRecords) {
      expect(record.eligibleForGraphConfirmation).toBe(true);
      expect(record.claimClassification).toBe('observed_fact');
      expect(record.publicationDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.receivedAtMs).toBeGreaterThan(0);
    }
  });

  it('3. audits the 5 Nov sell-off, 6 Nov rebound, 2026 US election results, and Q3 GDP against authoritative stored sources without fabricating verification', () => {
    expect(MACRO_CLAIM_VERIFICATION_AUDITS).toHaveLength(4);

    const byKey = new Map(MACRO_CLAIM_VERIFICATION_AUDITS.map((c) => [c.claimKey, c]));

    const nov5 = byKey.get('nov_5_sp500_nasdaq_selloff')!;
    expect(nov5.verificationStatus).toBe('missing_primary_source_in_store');
    expect(nov5.whatIsVerifiedInStore).toContain('4 November 2026');

    const nov6 = byKey.get('nov_6_market_rebound')!;
    expect(nov6.verificationStatus).toBe('missing_primary_source_in_store');
    expect(nov6.whatIsVerifiedInStore).toContain('4 November 2026');

    const elections = byKey.get('us_2026_midterm_election_results')!;
    expect(elections.verificationStatus).toBe('partially_corroborated_unofficial_or_lagged');
    expect(elections.whatIsMissingOrUnverified).toContain('authority: secondary');

    const gdp = byKey.get('us_q3_2026_gdp_growth')!;
    expect(gdp.verificationStatus).toBe('missing_primary_source_in_store');
    expect(gdp.authoritativeSourceRequiredToResolve).toContain('A191RL1Q225SBEA');
  });

  it('4 & 10. links the thesis to all 7 universe stocks (NVDA, MSFT, AMZN, GOOGL, AMD, CRWV, INTC) while keeping all directional ratings gated at INSUFFICIENT DATA', () => {
    const assessment = evaluateAiCapexModerationThesis();
    const tickers = assessment.companyLinkages.map((c) => c.ticker);

    expect(tickers).toEqual(['AMZN', 'GOOGL', 'MSFT', 'NVDA', 'AMD', 'CRWV', 'INTC']);

    for (const linkage of assessment.companyLinkages) {
      expect(linkage.currentRatingLabel).toBe('INSUFFICIENT DATA');
      expect(linkage.verifiedSupportingMetrics.length).toBeGreaterThan(0);
      expect(linkage.verifiedContradictoryOrRiskMetrics.length).toBeGreaterThan(0);
      expect(linkage.missingCompanyEvidence.length).toBeGreaterThan(0);
      expect(linkage.citedEvidenceIds.length).toBeGreaterThan(0);
    }
  });

  it('5. constructs 3 testable scenarios with strictly null numerical probabilities', () => {
    const assessment = evaluateAiCapexModerationThesis();

    expect(assessment.scenarios).toHaveLength(3);
    expect(assessment.scenarios.map((s) => s.scenarioId)).toEqual([
      'scenario-efficient-capex-moderation',
      'scenario-persistent-infrastructure-bottlenecks',
      'scenario-hard-capex-retrenchment',
    ]);

    for (const scenario of assessment.scenarios) {
      expect(scenario.probabilityAssignment).toBeNull();
      expect(scenario.probabilityPolicyNote).toContain('No numerical probability assigned');
      expect(scenario.confirmingIndicatorThresholds.length).toBeGreaterThanOrEqual(2);
      expect(scenario.invalidatingIndicatorThresholds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('6 & 7. defines all 8 measurable leading indicators and separates supporting, contradictory, missing evidence, and uncertainties', () => {
    const assessment = evaluateAiCapexModerationThesis();

    expect(assessment.leadingIndicators).toHaveLength(8);
    const categories = assessment.leadingIndicators.map((i) => i.category);
    expect(categories).toEqual([
      'capex_efficiency',
      'cash_conversion',
      'cloud_monetisation',
      'silicon_demand',
      'project_execution',
      'credit_and_financing',
      'power_and_grid',
      'regulatory_and_policy',
    ]);

    expect(assessment.evidenceSynthesis.supportingEvidence.length).toBeGreaterThanOrEqual(4);
    expect(assessment.evidenceSynthesis.contradictoryEvidence.length).toBeGreaterThanOrEqual(3);
    expect(assessment.evidenceSynthesis.missingEvidence.length).toBeGreaterThanOrEqual(5);
    expect(assessment.evidenceSynthesis.keyUncertainties.length).toBeGreaterThanOrEqual(3);
  });

  it('8 & 9. validates the Evidence-Locked Research Chat explanation against the 9-check deterministic validator with explicit abstention on missing claims', async () => {
    const { bundle, validatedAnswer, validationReport } = await runValidatedThesisChatExplanationTest();

    expect(bundle.sources.length).toBeGreaterThan(0);
    expect(validationReport.valid).toBe(true);
    expect(validationReport.actionTaken).toBe('accepted');
    expect(validationReport.checks).toHaveLength(9);
    for (const check of validationReport.checks) {
      expect(check.passed).toBe(true);
    }

    expect(validatedAnswer.executionAuthority).toBe('none');
    expect(validatedAnswer.supportStatus).toBe('partially_supported');
    expect(validatedAnswer.shortAnswer).toContain('$895.4B');
    expect(validatedAnswer.missingInformation.join(' ')).toContain('5 November 2026');
    expect(validatedAnswer.missingInformation.join(' ')).toContain('Q3 2026 Advance GDP');
  });
});
