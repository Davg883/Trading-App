import { describe, expect, it, vi } from 'vitest';
import {
  classifyResearchQuestionIntent,
  retrieveClosedEvidenceBundle,
} from '../lib/graph/evidence-retrieval-gateway';
import { generateAndValidateEvidenceLockedAnswer } from '../lib/graph/gemini-provider-adapter';
import { validateEvidenceLockedAnswer } from '../lib/graph/evidence-answer-validator';
import { runCase007PostEarningsPipeline } from '../lib/remote-ops/case-007-nvidia-ingestor';

const CASE007B_DATASET = runCase007PostEarningsPipeline({ owner: 'public_research' }).dataset;
const POST_EARNINGS_CUTOFF_MS = 1794965700000; // 2026-11-18T01:35:00.000Z
const PRE_EARNINGS_CUTOFF_MS = 1794949170000; // 2026-11-17T20:59:30.000Z

describe('RC002 Workstream A — Evidence Chat Integrity (B-001 & B-002)', () => {
  it('B-001: bounds oversized validation failure details without throwing ZodError while preserving full server-side diagnostic logs', async () => {
    const bundle = await retrieveClosedEvidenceBundle({
      question: 'How did NVIDIA Q3 FY2027 reported revenue compare against its forecast?',
      requesterId: 'test-b001-stress',
      historicalCutoffMs: PRE_EARNINGS_CUTOFF_MS,
      temporalBasis: 'publication',
      dataset: CASE007B_DATASET,
      graphDatabaseName: 'aci_case007b_verified_dev',
      preferLiveTypeDb: false,
      nowMs: POST_EARNINGS_CUTOFF_MS,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const oversizedCandidate = {
        version: 'evidence-locked-answer-g4-v1',
        bundleId: bundle.bundleId,
        bundleSha256: bundle.bundleSha256,
        shortAnswer:
          'Synthetic oversized unverified output citing $999.9B, $888.8B, and bearer secret_token_1234567890abcdef.',
        executiveTldr: ['Unverified bullet ($777.7B)'],
        supportingClaims: Array.from({ length: 12 }, (_, idx) => ({
          claimId: `oversized-bad-claim-identifier-sequence-${idx}-exceeding-legacy-detail-limit`,
          statement: `Bad claim ${idx} asserting $999.9B`,
          distinction: 'source_fact',
          evidenceIds: [`missing-evidence-doc-identifier-long-${idx}`],
          relationshipIds: [`rel-nonexistent-long-identifier-stress-${idx}`],
          quantitativeValue: 999_900_000_000 + idx,
          unit: 'USD',
          currency: 'USD',
          periodOrAsOf: '2029-12-31',
        })),
        relevantRelationshipIds: Array.from({ length: 15 }, (_, idx) => `rel-bad-relevant-id-${idx}`),
        contradictoryEvidence: [],
        missingInformation: ['None'],
        historicalCutoffUsed: {
          asOfMs: bundle.historicalCutoffMs,
          asOfIso: bundle.historicalCutoffIso,
          temporalBasis: bundle.temporalBasis,
        },
        supportStatus: 'fully_supported',
        abstentionReason: null,
        suggestedFollowUpQuestions: ['Follow up?'],
        executionAuthority: 'none',
      };

      const outcome = validateEvidenceLockedAnswer(oversizedCandidate, bundle, POST_EARNINGS_CUTOFF_MS);
      expect(outcome.report.valid).toBe(false);
      expect(outcome.report.actionTaken).toBe('downgraded_to_abstention');
      expect(outcome.validatedAnswer.supportStatus).toBe('unsupported');
      expect(outcome.validatedAnswer.executionAuthority).toBe('none');

      for (const check of outcome.report.checks) {
        expect(check.detail.length).toBeLessThanOrEqual(500);
      }

      // Server-side structured log preserves complete failure counts while redacting bearer tokens
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logLine = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(logLine).toContain('[evidence-validator]');
      expect(logLine).toContain('"invalidEvidenceIdsCount":12');
      expect(logLine).toContain('"invalidRelationshipIdsCount":27');
      expect(logLine).not.toContain('secret_token_1234567890abcdef');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('B-002: routes financial-performance phrases, earliest-mentioned focal entity, and ISO-8601 sub-day cutoffs accurately', async () => {
    for (const phrase of [
      'What was NVIDIA Q3 FY2027 reported revenue and gross margin?',
      'Compare NVIDIA forecast versus actual revenue and free cash flow in Q3 FY2027.',
    ]) {
      const route = classifyResearchQuestionIntent(phrase, CASE007B_DATASET);
      expect(route.intentCategory).toBe('entity_relationships');
      expect(route.focalEntityId).toBe('org-nvda');
    }

    const sharedRoute = classifyResearchQuestionIntent(
      'Which AI infrastructure investments share documented financial counterparties with NVIDIA, Anthropic, CoreWeave, and Microsoft?',
      CASE007B_DATASET,
    );
    expect(sharedRoute.intentCategory).toBe('shared_counterparties');
    expect(sharedRoute.focalEntityId).toBe('org-nvda');

    const temporalQuestion =
      'As of 2026-11-17T20:59:30Z before Q3 FY2027 results were released, what were NVIDIA latest reported revenue and Q3 FY2027 revenue forecast?';
    const temporalRoute = classifyResearchQuestionIntent(temporalQuestion, CASE007B_DATASET);
    expect(temporalRoute.intentCategory).toBe('historical_cutoff_knowledge');

    const temporalBundle = await retrieveClosedEvidenceBundle({
      question: temporalQuestion,
      requesterId: 'test-iso-cutoff',
      historicalCutoffMs: POST_EARNINGS_CUTOFF_MS,
      temporalBasis: 'publication',
      dataset: CASE007B_DATASET,
      graphDatabaseName: 'aci_case007b_verified_dev',
      preferLiveTypeDb: false,
      nowMs: POST_EARNINGS_CUTOFF_MS,
    });
    expect(temporalBundle.historicalCutoffMs).toBe(PRE_EARNINGS_CUTOFF_MS);
    expect(temporalBundle.excludedByHistoricalCutoffCount).toBeGreaterThanOrEqual(10);
  });

  it('B-002: synthesizes validated, source-grounded NVIDIA answers across Q1–Q6 and temporal control Q1b with zero Case 001 leakage', async () => {
    const answerableProbes = [
      {
        id: 'Q1',
        question:
          'How did NVIDIA Q3 FY2027 reported revenue, gross margin, Data Center revenue, and free cash flow compare against its pre-results Q3 FY2027 forecast, and what is management Q4 FY2027 guidance?',
        cutoffMs: POST_EARNINGS_CUTOFF_MS,
        expectedSupport: 'fully_supported',
        mustInclude: ['$115.844B', '$108.0B', '+7.26%', '$107.61B', '74.8%', '$43.777B', '$130.0B'],
      },
      {
        id: 'Q1b',
        question:
          'As of 2026-11-17T20:59:30Z before Q3 FY2027 results were released, what were NVIDIA latest reported revenue and Q3 FY2027 revenue forecast?',
        cutoffMs: PRE_EARNINGS_CUTOFF_MS,
        expectedSupport: 'fully_supported',
        mustInclude: ['$96.221B', '$108.0B'],
        mustExclude: ['$115.844B', '$130.0B'],
      },
      {
        id: 'Q2',
        question:
          'What does NVIDIA disclose regarding infrastructure spending, capital expenditures, supply purchase obligations, and top customer revenue concentration in Q3 FY2027?',
        cutoffMs: POST_EARNINGS_CUTOFF_MS,
        expectedSupport: 'fully_supported',
        mustInclude: ['$4.422B', '$518.0B', '$390.0B', '36%', '35%', '$81.033B'],
      },
      {
        id: 'Q3',
        question:
          'Distinguish NVIDIA direct supply and lease commitments from its contingent neocloud commitments, SB Energy Ports lease guarantee, and maximum gross credit guarantee cap.',
        cutoffMs: POST_EARNINGS_CUTOFF_MS,
        expectedSupport: 'fully_supported',
        mustInclude: ['$518.0B', '$32.0B', '$105.0B', '$118.0B', '$0 Paid'],
      },
      {
        id: 'Q4',
        question:
          'What leadership changes and governance risks are documented for NVIDIA following Jensen Huang resignation, Colette Kress dual role, and Harvey Jones appointment?',
        cutoffMs: POST_EARNINGS_CUTOFF_MS,
        expectedSupport: 'partially_supported',
        mustInclude: ['Jensen Huang', 'Colette Kress', 'Harvey C. Jones', 'independent committee'],
      },
      {
        id: 'Q5',
        question:
          'What are NVIDIA documented equity, hardware, cloud, and guarantee relationships with Anthropic, CoreWeave, Microsoft, Alphabet, Oracle, Nebius, Intel, and SpaceX?',
        cutoffMs: POST_EARNINGS_CUTOFF_MS,
        expectedSupport: 'fully_supported',
        mustInclude: ['Anthropic', 'CoreWeave', 'Nebius', 'SpaceX', 'Intel', '$48.33B', '$105.0B'],
      },
      {
        id: 'Q6',
        question:
          'Based strictly on verified NVIDIA Q3 FY2027 filings and graph relationships, what are the primary bullish and bearish investment interpretations?',
        cutoffMs: POST_EARNINGS_CUTOFF_MS,
        expectedSupport: 'fully_supported',
        mustInclude: ['Bullish Case', 'Bearish Case', '$115.844B', '71.0%-72.0%', '$118B'],
      },
    ] as const;

    for (const probe of answerableProbes) {
      const bundle = await retrieveClosedEvidenceBundle({
        question: probe.question,
        requesterId: `test-${probe.id}`,
        historicalCutoffMs: probe.cutoffMs,
        temporalBasis: 'publication',
        dataset: CASE007B_DATASET,
        graphDatabaseName: 'aci_case007b_verified_dev',
        preferLiveTypeDb: false,
        nowMs: POST_EARNINGS_CUTOFF_MS,
      });

      const turn = await generateAndValidateEvidenceLockedAnswer({
        bundle,
        callerId: `test-${probe.id}`,
        mode: 'auto',
        env: {},
        nowMs: POST_EARNINGS_CUTOFF_MS,
      });

      expect(turn.validation.valid, `${probe.id} validator failed: ${JSON.stringify(turn.validation.checks.filter((c) => !c.passed))}`).toBe(true);
      expect(turn.validation.actionTaken).toBe('accepted');
      expect(turn.answer.supportStatus).toBe(probe.expectedSupport);
      expect(turn.executionAuthority).toBe('none');

      const combinedText = `${turn.answer.shortAnswer} ${turn.answer.supportingClaims.map((c) => c.statement).join(' ')}`;
      for (const token of probe.mustInclude) {
        expect(combinedText).toContain(token);
      }
      if ('mustExclude' in probe && probe.mustExclude) {
        for (const forbidden of probe.mustExclude) {
          expect(combinedText).not.toContain(forbidden);
        }
      }
      // Never leak static Macro Case 001 entities into NVIDIA graph answers
      expect(combinedText).not.toContain('Nscale');
      expect(combinedText).not.toContain('Loughton');
      expect(combinedText).not.toContain('EirGrid');
      expect(combinedText).not.toContain('$895.4B');
    }
  });

  it('B-002: abstains cleanly (unsupported, zero claims) when requested facts are absent or gated (Q7 & Q7b)', async () => {
    for (const gapQuestion of [
      'What is NVIDIA projected FY2028 net income, 2028 share price target, and the exact names of Customer A and Customer B in its Q3 FY2027 concentration disclosure?',
      'Which specific companies are Customer A (22% of revenue) and Customer B (15% of revenue) in NVIDIA Q3 FY2027 filing, and what is the confirmed purchase price of the pending Hugging Face acquisition?',
    ]) {
      const bundle = await retrieveClosedEvidenceBundle({
        question: gapQuestion,
        requesterId: 'test-gap',
        historicalCutoffMs: POST_EARNINGS_CUTOFF_MS,
        temporalBasis: 'publication',
        dataset: CASE007B_DATASET,
        graphDatabaseName: 'aci_case007b_verified_dev',
        preferLiveTypeDb: false,
        nowMs: POST_EARNINGS_CUTOFF_MS,
      });

      const turn = await generateAndValidateEvidenceLockedAnswer({
        bundle,
        callerId: 'test-gap',
        mode: 'auto',
        env: {},
        nowMs: POST_EARNINGS_CUTOFF_MS,
      });

      expect(turn.validation.valid).toBe(true);
      expect(turn.answer.supportStatus).toBe('unsupported');
      expect(turn.answer.supportingClaims).toHaveLength(0);
      expect(turn.answer.abstentionReason).toBeTruthy();
      expect(turn.answer.abstentionReason).not.toContain('Macro Case 001');
      expect(turn.executionAuthority).toBe('none');
    }
  });
});
