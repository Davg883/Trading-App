import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from '../convex/schema';
import { APP_SESSION } from './helpers/app-identity';
import {
  KNOWN_INVALID_SEC_XBRL_RULES,
  NVDA_HUGGINGFACE_8K_ACCESSION,
  NVDA_HUGGINGFACE_8K_SHA256,
  evaluateSecClaimQuarantine,
  type QuarantineDryRunImpactReport,
} from '../lib/remote-ops/xbrl-quarantine-remediation';
import {
  assertNoDisputedG9SecRecordsPostEarnings,
  runCase007PostEarningsPipeline,
} from '../lib/remote-ops/case-007-nvidia-ingestor';

const ISS = 'https://issuer.test';
const OWNER = `${ISS}|user_researcher`;

const modules = {
  './_generated/server.ts': async () => ({}),
  './operations.ts': () => import('../convex/operations'),
  './research.ts': () => import('../convex/research'),
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('RC002 Workstream B — SEC/XBRL Quarantine, Orphan Evidence & Study Invalidation (B-003)', () => {
  it('discovers all 7 invalid SEC/XBRL staging items, 8 evidence rows (including forward-frozen orphan), briefings, forward events, experiments, and forecasts without deleting historical records', async () => {
    vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', ISS);
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity({
      ...APP_SESSION,
      subject: 'user_researcher',
      tokenIdentifier: OWNER,
      issuer: ISS,
    });

    const seeded = await t.run(async (ctx) => {
      const now = Date.parse('2026-11-18T12:00:00Z');
      const stagingIds: string[] = [];
      const promotedEvIds: string[] = [];

      // Insert all 7 canonical invalid SEC/XBRL disclosures + 7 promoted `evidence` rows
      const fixtureSpecs = [
        {
          externalId: 'staged-7f5da1f3fb6a672d',
          ticker: 'NVDA',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000084/xslForm13F_X02/primary_doc.xml',
          title: 'NVDA SEC Form 13F-HR (0001045810-26-000084)',
          value: 0.37,
          period: 'Q22020',
        },
        {
          externalId: 'staged-e2523ed83a7c0247',
          ticker: 'NVDA',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm',
          title: 'NVDA SEC Form 8-K (0001045810-26-000078)',
          value: 0.24,
          period: 'Q2 2020',
        },
        {
          externalId: 'staged-dcf44b009199d49a',
          ticker: 'AMZN',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000046/amzn-20260930.htm',
          title: 'AMZN SEC Form 10-Q (0001018724-26-000046)',
          value: 4.9,
          period: 'Q1 2017',
        },
        {
          externalId: 'staged-98c25c92c7ca82e7',
          ticker: 'GOOGL',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000083/goog-20261103.htm',
          title: 'GOOGL SEC Form 8-K (0001652044-26-000083)',
          value: 63.6,
          period: 'FY2025',
        },
        {
          externalId: 'staged-c135441d25ee1df9',
          ticker: 'MSFT',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/789019/000119312526094552/d94552d8k.htm',
          title: 'MSFT SEC Form 8-K (0001193125-26-094552)',
          value: 19.39,
          period: 'FY2025',
        },
        {
          externalId: 'staged-84349400e88f3423', // Production cloud-agent variant (verifying cross-env rule matching!)
          ticker: 'INTC',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/50863/000005086326000191/intc-20260926.htm',
          title: 'INTC SEC Form 10-Q (0000050863-26-000191)',
          value: 11.16,
          period: 'Q3 2026',
        },
        {
          externalId: 'staged-39bf33eb27445eee', // Development py-remote-sec variant
          ticker: 'AMD',
          sourceUrl:
            'https://www.sec.gov/Archives/edgar/data/2488/000000248826000191/amd-20260926.htm',
          title: 'AMD SEC Form 10-Q (0000002488-26-000191)',
          value: 0.75,
          period: 'Q3 2026',
        },
      ] as const;

      for (const spec of fixtureSpecs) {
        const evId = await ctx.db.insert('evidence', {
          owner: OWNER,
          source: spec.sourceUrl,
          symbol: spec.ticker,
          metric: 'capital_expenditures',
          value: spec.value,
          unit: 'USD_B',
          period: spec.period,
          definition: `Promoted SEC XBRL fact (${spec.externalId})`,
          status: 'reported',
          publishedAt: now - 86_400_000,
          receivedAt: now - 80_000_000,
        });
        promotedEvIds.push(evId);

        const stId = await ctx.db.insert('researchStagingItems', {
          owner: OWNER,
          externalId: spec.externalId,
          runId: 'run-g9-invalid',
          agentId: 'sec-collector',
          sourceUrl: spec.sourceUrl,
          sourceDomain: 'sec.gov',
          title: spec.title,
          contentSha256: 'a'.repeat(64),
          publishedAt: now - 86_400_000,
          receivedAt: now - 80_000_000,
          ingestedAt: now - 80_000_000,
          entities: [spec.ticker],
          claimsJson: JSON.stringify([
            {
              entity: spec.ticker,
              metric: 'capital_expenditures',
              value: spec.value,
              period: spec.period,
            },
          ]),
          summary: `${spec.ticker} comparative XBRL capex`,
          isPrimarySource: true,
          primarySourceUrl: spec.sourceUrl,
          validationStatus: 'promoted',
          validationReasons: [],
          researchEligible: true,
          marketOutcomeEligible: false,
          promotedEvidenceIds: [evId],
          executionAuthority: 'none',
          version: 'remote-ops-003-v1',
        });
        stagingIds.push(stId);
      }

      // Insert 8th ORPHAN forward-frozen `evidence` row on `0001045810-26-000078` (matching `md7ah8t1nmryeqt0c06wjq9c6x8hpgsb` in Dev / `ms71z2vm0nhq2850kvr3pym65s8hr3wb` in Prod)
      const orphanEvId = await ctx.db.insert('evidence', {
        owner: OWNER,
        source:
          'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm',
        symbol: 'NVDA',
        metric: 'capital_expenditures',
        value: 1.07,
        unit: 'USD_B',
        period: 'Q2 2020',
        definition: 'Forward experiment (forward-004-nvda-qqq-5d-2026-11-05) frozen sec_xbrl_fact',
        status: 'reported',
        publishedAt: now - 90_000_000,
        receivedAt: now - 85_000_000,
      });

      // Insert 1 clean unaffected `evidence` row to ensure surgical isolation
      const cleanEvId = await ctx.db.insert('evidence', {
        owner: OWNER,
        source:
          'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/q3fy27pr.htm',
        symbol: 'NVDA',
        metric: 'revenue',
        value: 115.844,
        unit: 'USD_B',
        period: 'Q3 FY2027',
        definition: 'Verified Q3 FY27 GAAP revenue',
        status: 'reported',
        publishedAt: now - 3600_000,
        receivedAt: now - 3500_000,
      });

      // Insert dependent `experiments`, `forecasts`, `forwardResearchEvents`, and `morningBriefings`
      const expId = await ctx.db.insert('experiments', {
        owner: OWNER,
        name: 'NVDA 5d Forward Excess Return vs QQQ',
        cutoff: now - 80_000_000,
        evidenceIds: [orphanEvId],
        protocol: 'forward-research-004-v1:NVDA_vs_QQQ:5d',
        protocolVersion: 'forward-research-004-v1',
        deadline: now + 86_400_000,
        createdAt: now - 79_000_000,
      });

      const fc1 = await ctx.db.insert('forecasts', {
        owner: OWNER,
        experimentId: expId,
        participant: 'deterministic_baseline',
        modelVersion: 'deterministic-sec-momentum-v1',
        horizon: '5d',
        probabilities: [0.4, 0.3, 0.3],
        expectedReturn: 0.012,
        lower: -0.04,
        upper: 0.06,
        evidenceIds: [orphanEvId],
        explanation: 'Frozen SEC XBRL baseline',
        invalidation: 'Quarantined SEC fact',
        decision: 'no-trade',
        submittedAt: now - 79_000_000,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costGbp: 0,
        latencyMs: 1,
        idempotencyKey: 'forward-004-nvda-qqq-5d-2026-11-05:deterministic_baseline',
      });

      const fc2 = await ctx.db.insert('forecasts', {
        owner: OWNER,
        experimentId: expId,
        participant: 'neutral_baseline',
        modelVersion: 'neutral-abstention-v1',
        horizon: '5d',
        probabilities: [0.33, 0.33, 0.34],
        expectedReturn: 0,
        lower: -0.05,
        upper: 0.05,
        evidenceIds: [orphanEvId],
        explanation: 'Neutral baseline',
        invalidation: 'Quarantined SEC fact',
        decision: 'no-trade',
        submittedAt: now - 79_000_000,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costGbp: 0,
        latencyMs: 1,
        idempotencyKey: 'forward-004-nvda-qqq-5d-2026-11-05:neutral_baseline',
      });

      const fwdId = await ctx.db.insert('forwardResearchEvents', {
        owner: OWNER,
        eventKey: 'forward-004-nvda-qqq-5d-2026-11-05',
        name: 'NVDA 5d Forward Excess Return vs QQQ',
        symbol: 'NVDA',
        benchmarkSymbol: 'QQQ',
        horizon: '5d',
        neutralBand: 0.01,
        registeredAt: now - 79_000_000,
        cutoffAt: now - 80_000_000,
        anchorSessionDate: '2026-11-05',
        anchorAt: now - 80_000_000,
        targetEndSessionDate: '2026-11-12',
        targetEndAt: now - 20_000_000,
        evidenceSha256: 'b'.repeat(64),
        evidenceJson: JSON.stringify([
          {
            id: 'staged-e2523ed83a7c0247',
            symbol: 'NVDA',
            kind: 'sec_xbrl_fact',
            metric: 'capital_expenditures',
            value: 1.07,
            unit: 'USD_B',
            period: 'Q2 2020',
            sourceUrl:
              'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm',
            publishedAt: now - 90_000_000,
            serverReceivedAt: now - 85_000_000,
          },
        ]),
        participantsJson: JSON.stringify([]),
        evaluationJson: JSON.stringify({
          evaluationStatus: 'awaiting_post_horizon_observations',
          evaluatedAt: now - 79_000_000,
          blockingReason: null,
          anchorObservationId: null,
          targetObservationId: null,
          benchmarkAnchorObservationId: null,
          benchmarkTargetObservationId: null,
          realizedReturnUsd: null,
          realizedReturnGbp: null,
          benchmarkReturnUsd: null,
          benchmarkReturnGbp: null,
          excessReturnUsd: null,
          excessReturnGbp: null,
          realizedClass: null,
          participantScores: [],
        }),
        experimentId: expId,
        updatedAt: now - 79_000_000,
        executionAuthority: 'none',
        version: 'forward-research-004-v1',
      });

      const briefId = await ctx.db.insert('morningBriefings', {
        owner: OWNER,
        briefingDate: '2026-11-18',
        generatedAt: now - 1000,
        timezone: 'Europe/London',
        confirmedFactsJson: JSON.stringify([
          {
            id: 'fact-NVDA-0001045810-26-000084',
            entity: 'NVDA',
            metric: 'capital_expenditures',
            period: 'Q22020',
            valueDisplay: '$0.37B',
            classification: 'confirmed_fact',
            sourceKind: 'sec_filing',
            sourceUrl:
              'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000084/xslForm13F_X02/primary_doc.xml',
            publishedAt: now - 86_400_000,
            receivedAt: now - 80_000_000,
          },
          {
            id: 'fact-NVDA-0001045810-26-000088',
            entity: 'NVDA',
            metric: 'revenue',
            period: 'Q3 FY2027',
            valueDisplay: '$115.844B',
            classification: 'confirmed_fact',
            sourceKind: 'sec_filing',
            sourceUrl:
              'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/q3fy27pr.htm',
            publishedAt: now - 3600_000,
            receivedAt: now - 3500_000,
          },
        ]),
        researchInterpretationJson: JSON.stringify([
          {
            id: 'interp-contaminated-1',
            title: 'Invalid NVDA capex extrapolation',
            entities: ['NVDA'],
            summary: 'Uses obsolete Q2 2020 capex.',
            citedEvidenceIds: ['staged-7f5da1f3fb6a672d'],
            modelVersion: 'deterministic-v1',
            executionAuthority: 'none',
          },
          {
            id: 'interp-clean-1',
            title: 'Verified Q3 revenue beat',
            entities: ['NVDA'],
            summary: 'Cites verified Q3 FY27 Form 8-K.',
            citedEvidenceIds: ['doc-nvda-q3fy27-ex991-20261117'],
            modelVersion: 'deterministic-v1',
            executionAuthority: 'none',
          },
        ]),
        riskChangesJson: JSON.stringify([]),
        incompleteEvidenceJson: JSON.stringify([]),
        modelVersion: 'deterministic-v1',
        executionAuthority: 'none',
        version: 'remote-ops-003-v1',
      });

      return { stagingIds, promotedEvIds, orphanEvId, cleanEvId, expId, fc1, fc2, fwdId, briefId };
    });

    // 1. Run strictly read-only `planKnownXbrlQuarantineInternal`
    const planRef = makeFunctionReference<
      'query',
      Record<string, unknown>,
      QuarantineDryRunImpactReport
    >('operations:planKnownXbrlQuarantineInternal');
    const plan = await t.query(planRef, { owner: OWNER });
    expect(plan.dryRun).toBe(true);
    expect(plan.uniqueAffectedIds.stagingItemIds).toHaveLength(7);
    expect(plan.uniqueAffectedIds.promotedEvidenceIds).toHaveLength(7);
    expect(plan.uniqueAffectedIds.orphanEvidenceIds).toEqual([String(seeded.orphanEvId)]);
    expect(plan.uniqueAffectedIds.allEvidenceIds).toHaveLength(8);
    expect(plan.uniqueAffectedIds.morningBriefingIds).toEqual([String(seeded.briefId)]);
    expect(plan.uniqueAffectedIds.forwardResearchEventIds).toEqual([String(seeded.fwdId)]);
    expect(plan.uniqueAffectedIds.experimentIds).toEqual([String(seeded.expId)]);
    expect(plan.uniqueAffectedIds.forecastIds).toHaveLength(2);
    expect(plan.afterCountsIfExecuted.rowsDeletedCount).toBe(0);

    // 2. Run `quarantineStagedEvidenceInternal` with `dryRun: true` and verify ZERO mutations occurred
    const quarantineMutRef = makeFunctionReference<
      'mutation',
      Record<string, unknown>,
      { dryRun: boolean; report: Array<{ status: string }> }
    >('operations:quarantineStagedEvidenceInternal');
    const mutationItems = plan.items.map((it) => ({
      stagingItemId: it.stagingItemId,
      reasonCode: it.reasonCode,
      reason: it.reason,
      claimedJson: it.claimedJson,
      expectedJson: it.expectedJson,
    }));

    const dryRes = await t.mutation(quarantineMutRef, {
      owner: OWNER,
      quarantinedBy: 'rc002-dry-run-test',
      dryRun: true,
      items: mutationItems,
    });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.report).toHaveLength(7);
    const qTableAfterDry = await t.run((ctx) => ctx.db.query('evidenceQuarantines').collect());
    expect(qTableAfterDry).toHaveLength(0);

    // 3. Execute in isolated in-memory test DB ONLY (`dryRun: false`) to prove complete remediation & UI/study invalidation
    const liveTestRes = await t.mutation(quarantineMutRef, {
      owner: OWNER,
      quarantinedBy: 'rc002-isolated-unit-test',
      dryRun: false,
      items: mutationItems,
    });
    expect(liveTestRes.dryRun).toBe(false);
    expect(liveTestRes.report.every((r) => r.status === 'quarantined')).toBe(true);

    // Verify all 8 evidence rows (including orphanEvId!) are quarantined while cleanEvId remains unquarantined, and 0 rows deleted
    const postDbCheck = await t.run(async (ctx) => {
      const allEv = await ctx.db.query('evidence').collect();
      const orphan = await ctx.db.get(seeded.orphanEvId);
      const clean = await ctx.db.get(seeded.cleanEvId);
      const allBriefings = await ctx.db.query('morningBriefings').collect();
      const allForward = await ctx.db.query('forwardResearchEvents').collect();
      const allExp = await ctx.db.query('experiments').collect();
      const allFc = await ctx.db.query('forecasts').collect();
      return { allEv, orphan, clean, allBriefings, allForward, allExp, allFc };
    });
    expect(postDbCheck.allEv).toHaveLength(9);
    expect(typeof postDbCheck.orphan?.quarantinedAt).toBe('number');
    expect(postDbCheck.clean?.quarantinedAt).toBeUndefined();
    expect(postDbCheck.allBriefings).toHaveLength(1);
    expect(postDbCheck.allForward).toHaveLength(1);
    expect(postDbCheck.allExp).toHaveLength(1);
    expect(postDbCheck.allFc).toHaveLength(2);

    // Verify `operations:overview` visibly withholds quarantined briefing facts + interpretations AND invalidates forward study
    type TestOverview = {
      latestBriefing: {
        confirmedFacts: Array<{ id: string }>;
        withheldFacts: Array<{ id: string }>;
        researchInterpretation: Array<{ id: string }>;
        withheldInterpretations: Array<{ id: string }>;
      };
      forwardResearchEvents: Array<{ invalidatedByQuarantine?: boolean }>;
      missingEvidenceResolution: { windows: Array<{ windowId: string }> };
    };
    const overview = (await asOwner.query(
      makeFunctionReference<'query'>('operations:overview'),
      {},
    )) as TestOverview;
    expect(overview.latestBriefing.confirmedFacts.map((f) => f.id)).toEqual([
      'fact-NVDA-0001045810-26-000088',
    ]);
    expect(overview.latestBriefing.withheldFacts.map((w) => w.id)).toEqual([
      'fact-NVDA-0001045810-26-000084',
    ]);
    expect(overview.latestBriefing.researchInterpretation.map((i) => i.id)).toEqual([
      'interp-clean-1',
    ]);
    expect(overview.latestBriefing.withheldInterpretations.map((w) => w.id)).toEqual([
      'interp-contaminated-1',
    ]);
    expect(overview.forwardResearchEvents[0]!.invalidatedByQuarantine).toBe(true);
    expect(
      overview.missingEvidenceResolution.windows.some((w) =>
        w.windowId.includes('forward-004-nvda-qqq-5d-2026-11-05'),
      ),
    ).toBe(false);

    // Verify `research:dashboard` flags affected `experiments` & `forecasts` as `invalidatedByQuarantine: true`
    // and `research:freezeExperiment` blocks quarantined evidence
    type TestResearchDash = {
      experiments: Array<{ invalidatedByQuarantine: boolean }>;
      forecasts: Array<{ invalidatedByQuarantine: boolean }>;
    };
    const researchDash = (await asOwner.query(
      makeFunctionReference<'query'>('research:dashboard'),
      {},
    )) as TestResearchDash;
    expect(researchDash.experiments[0]!.invalidatedByQuarantine).toBe(true);
    expect(researchDash.forecasts.every((fc) => fc.invalidatedByQuarantine === true)).toBe(true);

    await expect(
      asOwner.mutation(makeFunctionReference<'mutation'>('research:freezeExperiment'), {
        name: 'Attempt to freeze quarantined orphan evidence',
        cutoff: Date.parse('2026-11-18T12:00:00Z'),
        evidenceIds: [seeded.orphanEvId],
        protocol: 'test-protocol',
        deadline: Date.now() + 600_000,
      }),
    ).rejects.toThrow(/Quarantined evidence cannot be frozen/);
  });

  it('enforces claim-level quarantine on Form 8-K 0001045810-26-000078: blocks XBRL capex and completed-ownership claims while allowing verified Item 8.01 pending M&A', () => {
    expect(KNOWN_INVALID_SEC_XBRL_RULES).toHaveLength(7);

    // 1. Disputed XBRL capex extraction on 0001045810-26-000078 remains permanently blocked
    const xbrlVerdict = evaluateSecClaimQuarantine({
      accession: NVDA_HUGGINGFACE_8K_ACCESSION,
      extractionMethod: 'xbrl',
      metricOrClaimType: 'capital_expenditures',
      contentSha256: NVDA_HUGGINGFACE_8K_SHA256,
    });
    expect(xbrlVerdict.allowed).toBe(false);

    // 2. Misrepresenting pending Hugging Face Item 8.01 M&A as `confirmed` / `funded` ownership is blocked
    const badCompletedVerdict = evaluateSecClaimQuarantine({
      accession: NVDA_HUGGINGFACE_8K_ACCESSION,
      extractionMethod: 'primary_filing_item_text',
      metricOrClaimType: 'merger_agreement',
      secItem: '8.01',
      contentSha256: NVDA_HUGGINGFACE_8K_SHA256,
      epistemicStatus: 'confirmed',
      contractualStatus: 'funded',
      bindingObligation: true,
    });
    expect(badCompletedVerdict.allowed).toBe(false);

    // 3. Verified Item 8.01 pending M&A (`proposed` + `contingent_signed`, `bindingObligation: false`) is allowed under `claim_level` policy
    const validPendingVerdict = evaluateSecClaimQuarantine({
      accession: NVDA_HUGGINGFACE_8K_ACCESSION,
      extractionMethod: 'primary_filing_item_text',
      metricOrClaimType: 'ownership_stake',
      secItem: '8.01',
      contentSha256: NVDA_HUGGINGFACE_8K_SHA256,
      epistemicStatus: 'proposed',
      contractualStatus: 'contingent_signed',
      bindingObligation: false,
    });
    expect(validPendingVerdict.allowed).toBe(true);
    if (validPendingVerdict.allowed) {
      expect(validPendingVerdict.policyApplied).toBe('claim_level_verified_item_801_allowed');
    }

    // 4. Verify `assertNoDisputedG9SecRecordsPostEarnings` enforces `accession_wide` by default and `claim_level` when opted in
    const base = runCase007PostEarningsPipeline({ owner: 'public_research' }).dataset;
    const hfVerifiedDoc = {
      sourceDocId: 'doc-nvda-8k-hf-item801-20260902',
      title: 'NVIDIA Form 8-K Item 8.01 Pending Hugging Face Acquisition (0001045810-26-000078)',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm',
      kind: 'filing' as const,
      authority: 'primary' as const,
      contentSha256: NVDA_HUGGINGFACE_8K_SHA256,
      publicationBasis: 'sec_edgar_acceptance' as const,
      publishedAtMs: Date.parse('2026-09-02T20:30:00Z'),
      receivedAtMs: Date.parse('2026-09-02T20:35:00Z'),
      ingestedAtMs: Date.parse('2026-11-18T01:35:00Z'),
    };
    const datasetWithVerifiedItem801 = {
      ...base,
      sources: [...base.sources, hfVerifiedDoc],
      relationships: base.relationships.map((r) =>
        r.relationshipId === 'rel-case007b-nvda-huggingface-pending-acq-r1'
          ? { ...r, sourceDocIds: [...r.sourceDocIds, hfVerifiedDoc.sourceDocId] }
          : r,
      ),
    };

    expect(() =>
      assertNoDisputedG9SecRecordsPostEarnings(datasetWithVerifiedItem801, {
        quarantinePolicy: 'accession_wide',
      }),
    ).toThrow(/0001045810-26-000078|000104581026000078/);

    expect(() =>
      assertNoDisputedG9SecRecordsPostEarnings(datasetWithVerifiedItem801, {
        quarantinePolicy: 'claim_level',
      }),
    ).not.toThrow();
  });
});
