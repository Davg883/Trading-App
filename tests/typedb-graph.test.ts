import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from '../convex/schema';
import { grantReviewers } from './helpers/roles';
import { GET as graphGatewayGet, POST as graphGatewayPost } from '../app/api/graph/query/route';
import {
  resolveCanonicalOrganisation,
  validateRelationshipGovernance,
  reconstructGraphRelationshipsAtDate,
} from '../lib/graph/identity-governance';
import {
  buildOutboxItemsFromDataset,
  computeDeterministicProjectionKey,
  processProjectionOutboxBatch,
  replayOutboxFromCheckpoint,
} from '../lib/graph/projection-engine';
import {
  assertNoBrokerOrPrivateAccountData,
  evaluateProjectionStaleness,
  executeAllowlistedGraphQuery,
  loadInitialAcceptanceDataset,
  resetGraphGatewayRateLimitsForTests,
} from '../lib/graph/query-gateway';
import {
  assertCanRecreateTypeDbDatabase,
  probeTypeDbServer,
  PRODUCTION_TYPEDB_DATABASE,
  projectDatasetIntoLiveTypeDb,
  executeReadOnlyTypeQlOnLiveServer,
  STAGING_TYPEDB_DATABASE,
} from '../lib/graph/typedb-driver-adapter';
import { runGraphVsConvexBenchmark } from '../lib/graph/benchmark-evaluator';
import {
  MACRO_CASE_001_CLAIMS,
  MACRO_CASE_001_SCENARIOS,
  computeNonDoubleCountedCommitments,
  reconstructMacroCase001AtCutoff,
  runMacroCase001GraphInvestigations,
} from '../lib/graph/macro-case-001';
import type { MacroGraphDataset } from '../lib/graph/contracts';

beforeEach(() => {
  resetGraphGatewayRateLimitsForTests();
});

/**
 * Live TypeDB integration tests are separated from the hermetic suite (MVP hardening WP5).
 * They require a reachable TypeDB 3.14.2 server and run only when ACI_LIVE_TYPEDB_TESTS=1
 * (`npm run test:integration:typedb`). In the default run they are reported as skipped, never as passed.
 */
const LIVE_TYPEDB = process.env.ACI_LIVE_TYPEDB_TESTS === '1';

describe('Phase G.1: TypeDB 3.14 Macro Intelligence Engine & Acceptance Suite', () => {
  it('1. Disambiguates canonical identities via SEC CIK/LEI and blocks fuzzy name merges', () => {
    const dataset = loadInitialAcceptanceDataset();

    // Resolves Nscale UK Ltd to org-nscale via authoritative SEC CIK 0002110365
    const resolvedByCik = resolveCanonicalOrganisation(
      { proposedName: 'Nscale UK Limited', secCik: '2110365' },
      dataset.organisations,
    );
    expect(resolvedByCik.status).toBe('resolved');
    if (resolvedByCik.status === 'resolved') {
      expect(resolvedByCik.matchedBy).toBe('sec_cik');
      expect(resolvedByCik.organisation.orgId).toBe('org-nscale');
    }

    // Resolves Microsoft via LEI
    const resolvedByLei = resolveCanonicalOrganisation(
      { proposedName: 'MSFT Subsidiary', leiCode: 'INR2EJN1ERAN0W5ZP974' },
      dataset.organisations,
    );
    expect(resolvedByLei.status).toBe('resolved');
    if (resolvedByLei.status === 'resolved') {
      expect(resolvedByLei.matchedBy).toBe('lei_code');
      expect(resolvedByLei.organisation.orgId).toBe('org-msft');
    }

    // Blocks fuzzy-name merge when a candidate shares a similar name ("CoreWeave Cloud Holdings") without CIK/LEI
    const blockedFuzzy = resolveCanonicalOrganisation(
      { proposedName: 'CoreWeave Cloud Holdings LLC', secCik: null, leiCode: null },
      dataset.organisations,
    );
    expect(blockedFuzzy.status).toBe('blocked_fuzzy_name_only');
  });

  it('2. Enforces multi-party (>2 participant) financing & guarantee hyperedges and blocks news speculation from confirmed contracts', () => {
    const dataset = loadInitialAcceptanceDataset();
    const sourcesById = new Map(dataset.sources.map((s) => [s.sourceDocId, s]));

    // 4-participant guarantee (NVIDIA guarantor, Nscale borrower, Ward County Lessor beneficiary, Ward County project)
    const wardGuarantee = dataset.relationships.find(
      (r) => r.relationshipId === 'rel-ward-county-guarantee-r1',
    )!;
    expect(wardGuarantee.participants.length).toBe(4);
    expect(
      validateRelationshipGovernance(wardGuarantee, dataset.relationships, sourcesById).valid,
    ).toBe(true);

    // 5-participant financing arrangement (NVIDIA financier, Nscale borrower, Nscale issuer, project, convertible note instrument)
    const convFinancing = dataset.relationships.find(
      (r) => r.relationshipId === 'rel-nscale-nvda-convertible-r1',
    )!;
    expect(convFinancing.participants.length).toBe(5);
    expect(
      validateRelationshipGovernance(convFinancing, dataset.relationships, sourcesById).valid,
    ).toBe(true);

    // Attempting to promote secondary news (`reuters-credit-oct30`) to `confirmed` / `signed` fails validation
    const invalidSpeculationPromotion = {
      ...dataset.relationships.find((r) => r.relationshipId === 'rel-monarch-credit-talks-r1')!,
      contractualStatus: 'signed' as const,
      epistemicStatus: 'confirmed' as const,
    };
    const govCheck = validateRelationshipGovernance(
      invalidSpeculationPromotion,
      dataset.relationships,
      sourcesById,
    );
    expect(govCheck.valid).toBe(false);
    expect(govCheck.reasons.join(' ')).toContain('primary source');
  });

  it('3. Reconstructs historical point-in-time graph state and preserves superseded revisions without destructive overwrite', async () => {
    const dataset = loadInitialAcceptanceDataset();

    // At 2026-09-25 (publication basis), Microsoft-Nscale Loughton is `announced` (v1)
    const sep2026 = await executeAllowlistedGraphQuery(
      {
        queryType: 'as_known_at_date_graph',
        organisationId: 'org-msft',
        asOfMs: 1790380800000, // 2026-09-25
        temporalBasis: 'publication',
        includeSuperseded: false,
      },
      { callerId: 'owner_1', datasets: [dataset] },
    );
    expect(sep2026.edges.map((e) => e.relationshipId)).toContain('rel-loughton-msft-r1');
    expect(sep2026.edges.map((e) => e.relationshipId)).not.toContain('rel-loughton-msft-r2');

    // At 2026-11-05 (receipt basis), v1 is superseded by v2 (`cancelled`), while includeSuperseded=true returns both
    const nov2026ActiveOnly = await executeAllowlistedGraphQuery(
      {
        queryType: 'as_known_at_date_graph',
        organisationId: 'org-msft',
        asOfMs: 1793900000000,
        temporalBasis: 'receipt',
        includeSuperseded: false,
      },
      { callerId: 'owner_1', datasets: [dataset] },
    );
    expect(nov2026ActiveOnly.edges.map((e) => e.relationshipId)).toContain(
      'rel-loughton-msft-r2',
    );
    expect(nov2026ActiveOnly.edges.map((e) => e.relationshipId)).not.toContain(
      'rel-loughton-msft-r1',
    );
    expect(nov2026ActiveOnly.supersededHiddenCount).toBeGreaterThanOrEqual(1);

    const nov2026WithHistory = await executeAllowlistedGraphQuery(
      {
        queryType: 'as_known_at_date_graph',
        organisationId: 'org-msft',
        asOfMs: 1793900000000,
        temporalBasis: 'receipt',
        includeSuperseded: true,
      },
      { callerId: 'owner_1', datasets: [dataset] },
    );
    expect(nov2026WithHistory.edges.map((e) => e.relationshipId)).toEqual(
      expect.arrayContaining(['rel-loughton-msft-r1', 'rel-loughton-msft-r2']),
    );
  });

  it('4. Traverses 2-hop dependencies, preserves missing principals as null, and surfaces conflicting disclosures', async () => {
    const dataset = loadInitialAcceptanceDataset();

    // 2-hop query from CoreWeave (`org-crwv`) reaches Applied Digital (`org-apld`), Polaris Forge 1, and Ellendale 400 MW Substation
    const crwvNetwork = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-crwv',
        asOfMs: 1793900000000,
        maxDepth: 2,
      },
      { callerId: 'owner_1', datasets: [dataset] },
    );
    const nodeIds = crwvNetwork.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(
      expect.arrayContaining([
        'org-crwv',
        'org-apld',
        'proj-polaris-forge-1-nd',
        'asset-ellendale-substation',
      ]),
    );

    // Conflicting disclosures on Polaris Forge 2 (`org-unnamed-ig-hyperscaler` in 8-K vs `org-orcl` in secondary press)
    const apldNetwork = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-apld',
        asOfMs: 1793900000000,
        maxDepth: 1,
      },
      { callerId: 'owner_1', datasets: [dataset] },
    );
    expect(apldNetwork.conflicts).toHaveLength(1);
    expect(apldNetwork.conflicts[0]!.conflictGroupId).toBe('conflict-polaris-forge-2-tenant');
    expect(apldNetwork.conflicts[0]!.assertions).toHaveLength(2);

    // Missing evidence (`rel-monarch-credit-talks-r1`) retains `principalAmount: null` and surfaces in TL;DR uncertainties
    const monarchNet = await executeAllowlistedGraphQuery(
      {
        queryType: 'project_dependency_network',
        projectId: 'proj-monarch-wv',
        asOfMs: 1793900000000,
        maxDepth: 2,
      },
      { callerId: 'owner_1', datasets: [dataset] },
    );
    const creditTalks = monarchNet.edges.find(
      (e) => e.relationshipId === 'rel-monarch-credit-talks-r1',
    )!;
    expect(creditTalks.principalAmount).toBeNull();
    expect(creditTalks.epistemicStatus).toBe('reported');
    expect(
      monarchNet.tldr.uncertainties.some((u) =>
        u.relationshipIds.includes('rel-monarch-credit-talks-r1'),
      ),
    ).toBe(true);
    expect(monarchNet.tldr.nonCausationNotice).toContain('never constitutes proof of market price causation');
  });

  it('5. Handles outbox deterministic keys, retry backoff, dead-letter transitions, and checkpoint replay', async () => {
    const dataset = loadInitialAcceptanceDataset();
    const { accepted } = buildOutboxItemsFromDataset(dataset, 1793900000000, 2);
    expect(accepted.length).toBe(dataset.relationships.length);

    // Deterministic projectionKey
    const k1 = computeDeterministicProjectionKey(
      dataset.owner,
      dataset.visibility,
      dataset.relationships[0]!,
    );
    const k2 = computeDeterministicProjectionKey(
      dataset.owner,
      dataset.visibility,
      dataset.relationships[0]!,
    );
    expect(k1).toBe(k2);

    // Simulate transient failure on item 0 followed by replay
    let failFirst = true;
    const pass1 = await processProjectionOutboxBatch(
      accepted,
      async (item) => {
        if (item.sequence === 1 && failFirst) {
          throw new Error('Simulated transient TypeDB timeout');
        }
      },
      1793900000000,
    );
    expect(pass1.updatedOutbox[0]!.status).toBe('retrying');
    expect(pass1.checkpoint.retryingCount).toBe(1);
    expect(pass1.checkpoint.projectedCount).toBe(accepted.length - 1);

    // Second failure transitions item 0 to dead_letter (maxAttempts = 2)
    const pass2 = await processProjectionOutboxBatch(
      pass1.updatedOutbox,
      async (item) => {
        if (item.sequence === 1 && failFirst) {
          throw new Error('Simulated persistent TypeDB error');
        }
      },
      1793900100000,
    );
    expect(pass2.updatedOutbox[0]!.status).toBe('dead_letter');
    expect(pass2.checkpoint.deadLetterCount).toBe(1);

    // Replay from checkpoint 0 recovers all items cleanly
    failFirst = false;
    const replayed = replayOutboxFromCheckpoint(pass2.updatedOutbox, 0, 1793900200000);
    const pass3 = await processProjectionOutboxBatch(
      replayed,
      async () => {},
      1793900200000,
    );
    expect(pass3.checkpoint.projectedCount).toBe(accepted.length);
    expect(pass3.checkpoint.deadLetterCount).toBe(0);
  });

  it('6. Enforces cross-user tenant isolation, query limits, rate limits, and blocks broker/account data', async () => {
    const publicDataset = loadInitialAcceptanceDataset();
    const privateOwnerADataset: MacroGraphDataset = {
      ...publicDataset,
      owner: 'user_owner_A',
      visibility: 'private_tenant',
      sectors: [],
      locations: [],
      energyAssets: [],
      instruments: [],
      observations: [],
      organisations: [
        {
          orgId: 'org-private-alpha',
          legalName: 'Private Alpha Counterparty Ltd',
          displayName: 'Private Alpha',
          subtype: 'private_company',
          secCik: null,
          leiCode: null,
          ticker: null,
          jurisdiction: 'GB-ENG',
          sectorIds: ['sec-specialist-neoclouds'],
          aliases: [],
        },
      ],
      projects: [
        {
          projectId: 'proj-private-alpha',
          projectName: 'Private Alpha Secret Campus',
          projectType: 'ai_data_center_campus',
          projectStage: 'planned',
          plannedCapacityMw: 100,
          energisedCapacityMw: 0,
          locationId: 'loc-loughton-uk',
        },
      ],
      sources: publicDataset.sources.slice(0, 1),
      relationships: [
        {
          ...publicDataset.relationships[0]!,
          relationshipId: 'rel-private-owner-a-only',
          participants: [
            { role: 'buyer', entityId: 'org-private-alpha', entityKind: 'organisation' },
            { role: 'vendor', entityId: 'org-nscale', entityKind: 'organisation' },
            {
              role: 'target_project',
              entityId: 'proj-private-alpha',
              entityKind: 'infrastructure_project',
            },
          ],
        },
      ],
    };

    // User B cannot see User A's private tenant relationship
    const userBResult = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-nscale',
        asOfMs: 1793900000000,
      },
      {
        callerId: 'user_owner_B',
        datasets: [publicDataset, privateOwnerADataset],
      },
    );
    expect(userBResult.edges.map((e) => e.relationshipId)).not.toContain(
      'rel-private-owner-a-only',
    );

    // User A can see their own private tenant relationship
    const userAResult = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-nscale',
        asOfMs: 1793900000000,
      },
      {
        callerId: 'user_owner_A',
        datasets: [publicDataset, privateOwnerADataset],
      },
    );
    expect(userAResult.edges.map((e) => e.relationshipId)).toContain(
      'rel-private-owner-a-only',
    );

    // Rejects raw TypeQL injection or maxDepth > 2
    await expect(
      executeAllowlistedGraphQuery(
        {
          queryType: 'organisation_relationship_summary',
          maxDepth: 5,
        },
        { callerId: 'user_owner_A' },
      ),
    ).rejects.toThrow();

    await expect(
      executeAllowlistedGraphQuery(
        {
          queryType: 'organisation_relationship_summary',
          rawTypeql: 'match $x isa entity; delete $x;',
        },
        { callerId: 'user_owner_A' },
      ),
    ).rejects.toThrow();

    // Blocks broker credentials or account records from entering the graph
    expect(() =>
      assertNoBrokerOrPrivateAccountData({ leak: 'brokerCredentials' }),
    ).toThrow('Security violation');
  });

  it.skipIf(!LIVE_TYPEDB)('7. Projects schema and dataset into live TypeDB CE 3.14.2 and executes end-to-end TypeQL 3 read transactions', async () => {
    const probe = await probeTypeDbServer();
    expect(probe.reachable).toBe(true);
    expect(probe.version).toBe('3.14.2');

    const dataset = loadInitialAcceptanceDataset();
    expect(() => assertCanRecreateTypeDbDatabase(PRODUCTION_TYPEDB_DATABASE)).toThrow(
      /Security violation: destructive recreateDatabase is forbidden on production TypeDB database/,
    );
    await expect(
      projectDatasetIntoLiveTypeDb(dataset, {
        config: {
          httpAddress: 'http://127.0.0.1:8000',
          username: 'admin',
          password: 'password',
          databaseName: PRODUCTION_TYPEDB_DATABASE,
        },
        recreateDatabase: true,
      }),
    ).rejects.toThrow(/Security violation: destructive recreateDatabase is forbidden/);

    const testConfig = {
      httpAddress: 'http://127.0.0.1:8000',
      username: 'admin',
      password: 'password',
      databaseName: STAGING_TYPEDB_DATABASE,
    };

    const { report } = await projectDatasetIntoLiveTypeDb(dataset, {
      config: testConfig,
      recreateDatabase: true,
    });

    expect(report.connected).toBe(true);
    expect(report.serverVersion).toBe('3.14.2');
    expect(report.schemaCommitted).toBe(true);
    expect(report.outboxDeadLetterCount).toBe(0);
    expect(report.outboxProjectedCount).toBe(dataset.relationships.length);

    // Execute live read-only TypeQL 3 queries against TypeDB CE 3.14.2
    const orgCountRes = await executeReadOnlyTypeQlOnLiveServer(
      'match $o isa organisation, has org_id $id, has display_name $name;',
      testConfig,
    );
    expect(orgCountRes.ok).toBe(true);
    expect(orgCountRes.answerCount).toBe(dataset.organisations.length);

    const gatewayLiveRes = await executeAllowlistedGraphQuery(
      {
        queryType: 'project_dependency_network',
        projectId: 'proj-monarch-wv',
        asOfMs: 1793900000000,
      },
      {
        callerId: 'live_typedb_verifier',
        datasets: [dataset],
        preferLiveTypeDb: true,
      },
    );
    expect(gatewayLiveRes.backendMode).toBe('typedb_live');
    expect(gatewayLiveRes.typedbServerVersion).toBe('3.14.2');
    expect(gatewayLiveRes.edges.length).toBeGreaterThanOrEqual(3);

    const benchmark = await runGraphVsConvexBenchmark(dataset);
    expect(benchmark.metrics.relationshipRetrievalAccuracy.typedbGraph).toBe(1.0);
    expect(benchmark.metrics.temporalCorrectness.typedbGraph).toBe(1.0);
  }, 30000);

  it('8. Enforces Convex graphProjectionOutbox reviewer authority, idempotent projection keys, checkpoint replay, and audit logging', async () => {
    const modules = {
      './_generated/server.ts': async () => ({}),
      './graph.ts': () => import('../convex/graph'),
      './roles.ts': () => import('../convex/roles'),
    };
    const graphM = (name: string) => makeFunctionReference<'mutation'>(`graph:${name}`);
    const graphQ = (name: string) => makeFunctionReference<'query'>(`graph:${name}`);

    const OWNER = 'https://clerk.capital.aiguides.co.uk|user_owner';
    const OTHER = 'https://clerk.capital.aiguides.co.uk|user_other';

    const t = convexTest(schema, modules);
    await grantReviewers(t, [OWNER]);

    const owner = t.withIdentity({ subject: 'user_owner', tokenIdentifier: OWNER });
    const other = t.withIdentity({ subject: 'user_other', tokenIdentifier: OTHER });

    const dataset = loadInitialAcceptanceDataset();
    const rel = dataset.relationships[0]!;

    // Non-reviewer is rejected from enqueueing into the TypeDB projection outbox
    await expect(
      other.mutation(graphM('enqueueApprovedRelationship'), {
        visibility: 'public_research',
        sourceTable: 'evidenceClaims',
        sourceRecordId: rel.relationshipId,
        relationshipJson: JSON.stringify(rel),
      }),
    ).rejects.toThrow();

    // Reviewer can enqueue approved relationship; duplicate enqueue is idempotent
    const firstEnqueue = (await owner.mutation(graphM('enqueueApprovedRelationship'), {
      visibility: 'public_research',
      sourceTable: 'evidenceClaims',
      sourceRecordId: rel.relationshipId,
      relationshipJson: JSON.stringify(rel),
      maxAttempts: 2,
    })) as { outboxId: string; deduplicated: boolean; projectionKey: string };
    expect(firstEnqueue.deduplicated).toBe(false);
    expect(firstEnqueue.outboxId).toBeTruthy();

    const duplicateEnqueue = (await owner.mutation(graphM('enqueueApprovedRelationship'), {
      visibility: 'public_research',
      sourceTable: 'evidenceClaims',
      sourceRecordId: rel.relationshipId,
      relationshipJson: JSON.stringify(rel),
    })) as { outboxId: string; deduplicated: boolean; projectionKey: string };
    expect(duplicateEnqueue.deduplicated).toBe(true);
    expect(duplicateEnqueue.projectionKey).toBe(firstEnqueue.projectionKey);

    // Simulate failure -> retrying -> dead_letter -> checkpoint replay -> projected
    const fail1 = (await owner.mutation(graphM('recordProjectionOutcome'), {
      outboxId: firstEnqueue.outboxId,
      succeeded: false,
      errorMessage: 'Transient TypeDB HTTP timeout',
    })) as { status: string };
    expect(fail1.status).toBe('retrying');

    const fail2 = (await owner.mutation(graphM('recordProjectionOutcome'), {
      outboxId: firstEnqueue.outboxId,
      succeeded: false,
      errorMessage: 'Second TypeDB failure -> dead letter',
    })) as { status: string };
    expect(fail2.status).toBe('dead_letter');

    const replayRes = (await owner.mutation(graphM('replayFromCheckpoint'), {
      fromSequence: 0,
    })) as { resetCount: number };
    expect(replayRes.resetCount).toBe(1);

    const okOutcome = (await owner.mutation(graphM('recordProjectionOutcome'), {
      outboxId: firstEnqueue.outboxId,
      succeeded: true,
    })) as { status: string };
    expect(okOutcome.status).toBe('projected');

    // Audit record and projection health are isolated per tenant
    await owner.mutation(graphM('recordGraphQueryAudit'), {
      queryType: 'project_dependency_network',
      parametersJson: JSON.stringify({ projectId: 'proj-monarch-wv' }),
      asOfMs: 1793900000000,
      nodeCount: 5,
      edgeCount: 3,
      latencyMs: 14,
      backendMode: 'typedb_live',
    });

    const ownerHealth = (await owner.query(graphQ('projectionHealth'), {})) as {
      checkpoint: { projectedCount: number; deadLetterCount: number } | null;
      outboxItems: unknown[];
    };
    expect(ownerHealth.checkpoint?.projectedCount).toBe(1);
    expect(ownerHealth.checkpoint?.deadLetterCount).toBe(0);
    expect(ownerHealth.outboxItems).toHaveLength(1);

    const otherHealth = (await other.query(graphQ('projectionHealth'), {})) as {
      checkpoint: unknown;
      outboxItems: unknown[];
    };
    expect(otherHealth.checkpoint).toBeNull();
    expect(otherHealth.outboxItems).toHaveLength(0);

    // Server API route rejects unauthenticated requests (401) and serves allowlisted queries when authenticated (200)
    const unauthReq = new NextRequest('https://capital.aiguides.co.uk/api/graph/query', {
      method: 'POST',
      body: JSON.stringify({ queryType: 'sector_connections' }),
    });
    const unauthRes = await graphGatewayPost(unauthReq);
    expect(unauthRes.status).toBe(401);

    const authMetaReq = new NextRequest(
      'https://capital.aiguides.co.uk/api/graph/query?action=metadata',
      {
        method: 'GET',
        headers: { 'x-aci-test-caller': OWNER },
      },
    );
    const authMetaRes = await graphGatewayGet(authMetaReq);
    expect(authMetaRes.status).toBe(200);
    const metaJson = (await authMetaRes.json()) as {
      executionAuthority: string;
      typedbServer: { reachable: boolean; version: string };
    };
    expect(metaJson.executionAuthority).toBe('none');
    // Hermetic part ends here; the live-server assertions run only in the TypeDB integration job.
    if (LIVE_TYPEDB) {
      expect(metaJson.typedbServer.reachable).toBe(true);
      expect(metaJson.typedbServer.version).toBe('3.14.2');
    } else {
      expect(typeof metaJson.typedbServer.reachable).toBe('boolean');
    }
  });

  it('9. Enforces Stage 4 reviewer promotion workflow, correction history, and Stage 5 projection lag / staleness detection', async () => {
    const modules = {
      './_generated/server.ts': async () => ({}),
      './graph.ts': () => import('../convex/graph'),
      './roles.ts': () => import('../convex/roles'),
    };
    const graphM = (name: string) => makeFunctionReference<'mutation'>(`graph:${name}`);
    const graphQ = (name: string) => makeFunctionReference<'query'>(`graph:${name}`);

    const OWNER = 'https://clerk.capital.aiguides.co.uk|user_owner';
    const t = convexTest(schema, modules);
    await grantReviewers(t, [OWNER]);
    const owner = t.withIdentity({ subject: 'user_owner', tokenIdentifier: OWNER });

    const dataset = loadInitialAcceptanceDataset();
    const monarchCreditRel = dataset.relationships.find(
      (r) => r.relationshipId === 'rel-monarch-credit-talks-r1',
    )!;

    // 1. An approved source document does NOT allow a secondary/reported relationship to be auto-confirmed
    await expect(
      owner.mutation(graphM('reviewAndPromoteRelationship'), {
        visibility: 'public_research',
        decision: 'approved',
        reviewNote: 'Attempt to mark secondary news as confirmed',
        sourceTable: 'researchStagingItems',
        sourceRecordId: monarchCreditRel.relationshipId,
        sourceDocumentApproved: true,
        promoteToOutbox: true,
        relationshipJson: JSON.stringify({
          ...monarchCreditRel,
          epistemicStatus: 'confirmed',
          contractualStatus: 'signed',
        }),
      }),
    ).rejects.toThrow();

    // 2. Reviewer can reject a candidate relationship without promoting it into the TypeDB outbox
    const rejectRes = (await owner.mutation(graphM('reviewAndPromoteRelationship'), {
      visibility: 'public_research',
      decision: 'rejected',
      reviewNote: 'Hold pending verification of credit facility terms',
      sourceTable: 'researchStagingItems',
      sourceRecordId: monarchCreditRel.relationshipId,
      sourceDocumentApproved: true,
      promoteToOutbox: false,
      relationshipJson: JSON.stringify(monarchCreditRel),
    })) as {
      decision: string;
      promotedOutboxId: string | null;
      correctionHistoryCount: number;
    };
    expect(rejectRes.decision).toBe('rejected');
    expect(rejectRes.promotedOutboxId).toBeNull();
    expect(rejectRes.correctionHistoryCount).toBe(1);

    // 3. Reviewer can subsequently approve the relationship with `reported` epistemic status and promote to outbox, preserving correction history
    const approveRes = (await owner.mutation(graphM('reviewAndPromoteRelationship'), {
      visibility: 'public_research',
      decision: 'approved',
      reviewNote: 'Approved as reported discussion with null principal preserved',
      correctionNote: 'Supersedes earlier hold after corroborating Reuters timestamp',
      sourceTable: 'researchStagingItems',
      sourceRecordId: monarchCreditRel.relationshipId,
      sourceDocumentApproved: true,
      promoteToOutbox: true,
      relationshipJson: JSON.stringify(monarchCreditRel),
    })) as {
      decision: string;
      promotedOutboxId: string | null;
      projectionKey: string | null;
      correctionHistoryCount: number;
    };
    expect(approveRes.decision).toBe('approved');
    expect(approveRes.promotedOutboxId).toBeTruthy();
    expect(approveRes.projectionKey).toMatch(/^proj:[a-f0-9]{64}$/);
    expect(approveRes.correctionHistoryCount).toBe(2);

    const health = (await owner.query(graphQ('projectionHealth'), {})) as {
      reviews: Array<{ decision: string; correctionHistoryJson: string }>;
      outboxItems: Array<{ relationshipId: string; status: string }>;
    };
    expect(health.reviews.length).toBe(2);
    expect(health.outboxItems.length).toBe(1);
    expect(health.outboxItems[0]!.relationshipId).toBe('rel-monarch-credit-talks-r1');

    // 4. Verify Stage 5 projection lag and dead-letter staleness evaluation
    const healthyStatus = evaluateProjectionStaleness({
      backendMode: 'typedb_live',
      maxProjectionLagMs: 0,
      projectedCount: 14,
      pendingCount: 0,
      retryingCount: 0,
      deadLetterCount: 0,
    });
    expect(healthyStatus.stale).toBe(false);

    const deadLetterStale = evaluateProjectionStaleness({
      backendMode: 'typedb_live',
      maxProjectionLagMs: 1200,
      projectedCount: 13,
      pendingCount: 0,
      retryingCount: 0,
      deadLetterCount: 1,
    });
    expect(deadLetterStale.stale).toBe(true);
    expect(deadLetterStale.staleReason).toContain('dead_letter');

    const lagStale = evaluateProjectionStaleness({
      backendMode: 'typedb_live',
      maxProjectionLagMs: 25 * 60 * 1000,
      projectedCount: 13,
      pendingCount: 1,
      retryingCount: 0,
      deadLetterCount: 0,
    });
    expect(lagStale.stale).toBe(true);
    expect(lagStale.staleReason).toContain('Projection lag');
  });

  it.skipIf(!LIVE_TYPEDB)('10. Verifies Macro Case 001 (US to Ireland AI Contagion): discovery guardrails, 6-class claims, non-double-counting ledger, historical cutoffs, and live TypeDB Cloud investigations', async () => {
    const dataset = loadInitialAcceptanceDataset();
    const sourcesById = new Map(dataset.sources.map((s) => [s.sourceDocId, s]));

    // 1. Verify all 6 required source groups are registered with exact publication and receipt timestamps
    const requiredSourceIds = [
      'irish-news-quinn-2026-11-08',
      'cbi-fsr-2026-i',
      'cbi-makhlouf-speech-2026-11-02',
      'ireland-dof-ai-correction-2026-07',
      'anthropic-s1-2026-10-26',
      'anthropic-s1a-2026-11-02',
      'cru-eirgrid-dc-policy-2026',
      'intc-10q-q3-2026',
      'nscale-s1-sep18',
    ];
    for (const srcId of requiredSourceIds) {
      const src = sourcesById.get(srcId);
      expect(src).toBeDefined();
      expect(src!.publishedAtMs).toBeGreaterThan(0);
      expect(src!.receivedAtMs).toBeGreaterThanOrEqual(src!.publishedAtMs);
    }

    // 2. Verify Eamon Quinn's 8 Nov 2026 Irish News article is secondary discovery (`reported`) and blocked from promotion to `confirmed`
    const quinnSrc = sourcesById.get('irish-news-quinn-2026-11-08')!;
    expect(quinnSrc.authority).toBe('secondary');
    expect(quinnSrc.kind).toBe('news');
    const quinnRel = dataset.relationships.find(
      (r) => r.relationshipId === 'rel-quinn-irish-news-discovery-contagion-r1',
    )!;
    expect(quinnRel.epistemicStatus).toBe('reported');
    expect(quinnRel.bindingObligation).toBe(false);

    const invalidPromotion = validateRelationshipGovernance(
      {
        ...quinnRel,
        epistemicStatus: 'confirmed',
        contractualStatus: 'signed',
      },
      dataset.relationships,
      sourcesById,
    );
    expect(invalidPromotion.valid).toBe(false);
    expect(invalidPromotion.reasons.join(' ')).toContain('primary source');

    // 3. Verify all 6 claim classifications and 5 financial commitment categories are represented with units, dates, and assumptions
    const classifications = new Set(MACRO_CASE_001_CLAIMS.map((c) => c.classification));
    expect(classifications.has('observed')).toBe(true);
    expect(classifications.has('reported')).toBe(true);
    expect(classifications.has('proposed')).toBe(true);
    expect(classifications.has('modelled_scenario')).toBe(true);
    expect(classifications.has('interpretation')).toBe(true);
    expect(classifications.has('unverified')).toBe(true);

    const commitmentCategories = new Set(
      MACRO_CASE_001_CLAIMS.map((c) => c.commitmentBucket).filter(Boolean),
    );
    expect(commitmentCategories.has('equity_ownership')).toBe(true);
    expect(commitmentCategories.has('debt')).toBe(true);
    expect(commitmentCategories.has('guarantees')).toBe(true);
    expect(commitmentCategories.has('compute_purchase_commitments')).toBe(true);
    expect(commitmentCategories.has('planned_investments')).toBe(true);

    for (const claim of MACRO_CASE_001_CLAIMS) {
      expect(claim.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(claim.assumptionsAndBasis.length).toBeGreaterThan(10);
    }

    // 4. Verify non-double-counting commitment ledger ($895.4B deduplicated vs $940.0B naive sum -> $44.6B overlap prevented)
    const ledger = computeNonDoubleCountedCommitments(dataset);
    expect(ledger.deduplicatedComputeCommitmentsUsd).toBe(895_400_000_000);
    expect(ledger.naiveComputeCommitmentsSumUsd).toBe(940_000_000_000);
    expect(ledger.doubleCountPreventedUsd).toBe(44_600_000_000);
    expect(ledger.signedDebtAndCoInvestmentUsd).toBe(12_000_000_000);
    expect(ledger.signedGuaranteesUsd).toBe(860_300_000);
    expect(ledger.signedEquityAndConvertibleBackingCapUsd).toBe(40_000_000_000);

    // 5. Verify scenario comparison keeps modelled COSMO shocks distinct from observed baseline
    expect(MACRO_CASE_001_SCENARIOS).toHaveLength(3);
    expect(MACRO_CASE_001_SCENARIOS[0]!.classification).toBe('observed');
    expect(MACRO_CASE_001_SCENARIOS[0]!.irishMddImpactPct).toBe(0);
    expect(MACRO_CASE_001_SCENARIOS[1]!.classification).toBe('modelled_scenario');
    expect(MACRO_CASE_001_SCENARIOS[1]!.irishMddImpactPct).toBe(-1.6);
    expect(MACRO_CASE_001_SCENARIOS[2]!.classification).toBe('modelled_scenario');
    expect(MACRO_CASE_001_SCENARIOS[2]!.irishMddImpactPct).toBe(-3.25);

    // 6. Verify historical cutoff reconstruction at 2026-07-31, 2026-10-27, 2026-11-03, and 2026-11-08
    const cutJul = reconstructMacroCase001AtCutoff(1785542399000, 'publication', dataset);
    expect(cutJul.anthropicS1Available).toBe(false);
    expect(cutJul.makhloufSpeechAvailable).toBe(false);
    expect(cutJul.discoveryArticleAvailable).toBe(false);

    const cutOct = reconstructMacroCase001AtCutoff(1793145599000, 'publication', dataset);
    expect(cutOct.anthropicS1Available).toBe(true);
    expect(cutOct.makhloufSpeechAvailable).toBe(false);
    expect(cutOct.discoveryArticleAvailable).toBe(false);

    const cutNov3 = reconstructMacroCase001AtCutoff(1793750399000, 'publication', dataset);
    expect(cutNov3.anthropicS1Available).toBe(true);
    expect(cutNov3.makhloufSpeechAvailable).toBe(true);
    expect(cutNov3.discoveryArticleAvailable).toBe(false);

    const cutNov8 = reconstructMacroCase001AtCutoff(1794146400000, 'publication', dataset);
    expect(cutNov8.anthropicS1Available).toBe(true);
    expect(cutNov8.makhloufSpeechAvailable).toBe(true);
    expect(cutNov8.discoveryArticleAvailable).toBe(true);
    expect(cutNov8.activeRelationships.length).toBe(22);

    // 7. Execute all 5 Macro Case 001 graph investigations live against hosted TypeDB Cloud (3.14.2)
    const dossier = await runMacroCase001GraphInvestigations({
      callerId: 'macro_case_001_acceptance_test',
      preferLiveTypeDb: true,
    });
    expect(dossier.executionAuthority).toBe('none');
    expect(dossier.investigations).toHaveLength(5);
    for (const inv of dossier.investigations) {
      expect(inv.backendMode).toBe('typedb_live');
      expect(inv.typedbServerVersion).toBe('3.14.2');
      expect(inv.evidencedRelationshipIds.length).toBeGreaterThan(0);
    }
    expect(dossier.evaluationMetrics.evidenceCoverageRatio).toBe(1.0);
    expect(dossier.evaluationMetrics.relationshipPrecisionRatio).toBe(1.0);
    expect(dossier.evaluationMetrics.doubleCountingErrorUsd).toBe(0);
  }, 45000);
});
