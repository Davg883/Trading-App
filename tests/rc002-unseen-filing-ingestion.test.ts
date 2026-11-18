import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { TypeDBHttpDriver, isApiErrorResponse } from '@typedb/driver-http';
import schema from '../convex/schema';
import { APP_SESSION } from './helpers/app-identity';
import {
  discoverSecFilingWindow,
  extractForm13fXmlGraphCandidates,
  extractPeriodicXbrlGraphCandidates,
  registerForm8kReviewCandidate,
  type EdgarSubmissionsPayload,
} from '../lib/remote-ops/sec-filing-graph-extractor';
import {
  assertExplicitTypeDbWriteTarget,
  ensureTypeDbDatabaseAndSchemaOnLiveServer,
  executeWriteStatementsOnLiveServer,
  hydrateMacroDatasetFromLiveTypeDb,
  inspectLiveTypeDbGraphCounts,
  type TypeDbConnectionConfig,
} from '../lib/graph/typedb-driver-adapter';
import { executeAllowlistedGraphQuery } from '../lib/graph/query-gateway';
import { retrieveClosedEvidenceBundle } from '../lib/graph/evidence-retrieval-gateway';
import { generateAndValidateEvidenceLockedAnswer } from '../lib/graph/gemini-provider-adapter';
import { sha256Hex } from '../lib/remote-ops/staging-validator';
import type { GraphOrganisation, GraphSector } from '../lib/graph/contracts';

const ISS = 'https://issuer.test';
const REVIEWER_ID = `${ISS}|user_reviewer`;
const NON_REVIEWER_ID = `${ISS}|user_reader`;

const DEFAULT_LOCAL_TYPEDB_BIN =
  process.env.TYPEDB_LOCAL_SERVER_BIN ??
  'C:/Users/david/.gemini/antigravity/brain/43d1d2a3-9e08-44b0-be6e-8f36e7c9ab90/scratch/typedb-3.14.2/typedb-all-windows-x86_64-3.14.2/server/typedb_server_bin.exe';

const HAS_LOCAL_TYPEDB_BIN = fs.existsSync(DEFAULT_LOCAL_TYPEDB_BIN);
const DISPOSABLE_HTTP_PORT = 18824;
const DISPOSABLE_GRPC_PORT = 18729;
const DISPOSABLE_DB_NAME = 'aci_rc002_unseen_disposable_test';

const convexModules = {
  './_generated/server.ts': async () => ({}),
  './graph.ts': () => import('../convex/graph'),
  './roles.ts': () => import('../convex/roles'),
  './operations.ts': () => import('../convex/operations'),
};

let serverProc: ChildProcess | null = null;
let tempDataDir: string | null = null;

async function waitForLocalTypeDb(httpAddress: string, timeoutMs = 25_000): Promise<string> {
  const driver = new TypeDBHttpDriver({
    username: 'admin',
    password: 'password',
    addresses: [httpAddress],
  });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ver = await driver.version();
      if (!isApiErrorResponse(ver)) {
        return ver.ok.version;
      }
    } catch {
      // retry while booting
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Disposable local TypeDB 3.14.2 failed to boot at ${httpAddress}`);
}

beforeAll(async () => {
  if (!HAS_LOCAL_TYPEDB_BIN) return;
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aci-rc002-typedb-'));
  serverProc = spawn(
    DEFAULT_LOCAL_TYPEDB_BIN,
    [
      '--server.listen-address',
      `127.0.0.1:${DISPOSABLE_GRPC_PORT}`,
      '--server.http.enabled',
      'true',
      '--server.http.listen-address',
      `127.0.0.1:${DISPOSABLE_HTTP_PORT}`,
      '--server.admin.enabled',
      'false',
      '--diagnostics.reporting.metrics',
      'false',
      '--diagnostics.reporting.errors',
      'false',
      '--diagnostics.monitoring.enabled',
      'false',
      '--storage.data-directory',
      tempDataDir,
    ],
    { stdio: 'ignore' },
  );
  await waitForLocalTypeDb(`http://127.0.0.1:${DISPOSABLE_HTTP_PORT}`);
}, 35_000);

afterAll(async () => {
  if (serverProc) {
    serverProc.kill();
    await new Promise((r) => setTimeout(r, 400));
    serverProc = null;
  }
  if (tempDataDir) {
    try {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    } catch {
      // Windows file handle release race
    }
    tempDataDir = null;
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('RC002 Workstream C — General-Purpose Unseen SEC Filing Ingestion & Target-Safe TypeDB Projection (B-004)', () => {
  it('discovers multi-filing windows beyond recent[0] with pagination & deduplication, extracts XBRL/13F/8-K candidates without hallucination, enforces reviewer & target safeguards, and projects an unseen filing into disposable local TypeDB 3.14.2', async () => {
    expect(HAS_LOCAL_TYPEDB_BIN).toBe(true);
    vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', ISS);

    // Genuinely unseen issuer absent from Macro Case 001 and NVIDIA Case 007: Arista Networks, Inc. (ANET, CIK 0001596532)
    const unseenSector: GraphSector = {
      sectorId: 'sec-cloud-networking-silicon',
      sectorName: 'AI Ethernet & Cloud Networking Infrastructure',
      industryGroup: 'Communications & Cloud Switching Equipment',
      economicLayer: 'network_fabric',
    };
    const unseenOrg: GraphOrganisation = {
      orgId: 'org-anet',
      legalName: 'Arista Networks, Inc.',
      displayName: 'Arista Networks',
      subtype: 'public_company',
      secCik: '0001596532',
      leiCode: null,
      ticker: 'ANET',
      jurisdiction: 'US-DE',
      sectorIds: [unseenSector.sectorId],
      aliases: ['Arista', 'ANET', 'Arista Networks'],
    };

    // 1. Multi-filing EDGAR submission payload where `recent[0]` is a Form 4 (which previously masked deeper filings!),
    //    `recent[1]` is an 8-K, `recent[2]` is a 10-Q, and `files[0]` overflow holds a 13F-HR.
    const submissionsPayload: EdgarSubmissionsPayload = {
      cik: '0001596532',
      name: 'Arista Networks, Inc.',
      tickers: ['ANET'],
      filings: {
        recent: {
          accessionNumber: [
            '0001596532-26-000051',
            '0001596532-26-000049',
            '0001596532-26-000044',
          ],
          form: ['4', '8-K', '10-Q'],
          filingDate: ['2026-11-10', '2026-11-06', '2026-11-04'],
          reportDate: ['2026-11-09', '2026-11-05', '2026-09-30'],
          acceptanceDateTime: [
            '2026-11-10T21:15:00.000Z',
            '2026-11-06T21:05:00.000Z',
            '2026-11-04T21:10:00.000Z',
          ],
          primaryDocument: ['form4.xml', 'anet-20261105-8k.htm', 'anet-20260930-10q.htm'],
          items: ['', '1.01,2.02,9.01', ''],
        },
        files: [{ name: 'CIK0001596532-submissions-001.json', filingCount: 1 }],
      },
    };

    const firstDiscovery = await discoverSecFilingWindow({
      ticker: 'ANET',
      cik: '0001596532',
      entityName: 'Arista Networks, Inc.',
      submissions: submissionsPayload,
      maxFilingsPerCik: 10,
      maxOverflowPages: 1,
      fetchOverflowPage: async (fileName) => {
        expect(fileName).toBe('CIK0001596532-submissions-001.json');
        return {
          accessionNumber: ['0001596532-26-000038'],
          form: ['13F-HR'],
          filingDate: ['2026-11-02'],
          reportDate: ['2026-09-30'],
          acceptanceDateTime: ['2026-11-02T20:00:00.000Z'],
          primaryDocument: ['primary_doc.xml'],
        };
      },
    });

    expect(firstDiscovery.skippedFormCount).toBe(1); // Form 4 skipped without blocking 8-K, 10-Q, or overflow 13F-HR!
    expect(firstDiscovery.overflowPagesFetched).toBe(1);
    expect(firstDiscovery.discovered.map((d) => d.form)).toEqual(['8-K', '10-Q', '13F-HR']);

    // Persistent deduplication check
    const secondDiscovery = await discoverSecFilingWindow({
      ticker: 'ANET',
      cik: '0001596532',
      entityName: 'Arista Networks, Inc.',
      submissions: submissionsPayload,
      seenAccessions: new Set(firstDiscovery.discovered.map((d) => d.accession)),
    });
    expect(secondDiscovery.discovered).toHaveLength(0);
    expect(secondDiscovery.skippedDuplicateCount).toBe(2);

    // 2. Deterministic 8-K registration WITHOUT inferring amounts or counterparties
    const header8k = firstDiscovery.discovered.find((d) => d.form === '8-K')!;
    const reg8k = registerForm8kReviewCandidate({
      header: header8k,
      subjectOrg: unseenOrg,
      rawFilingText:
        'Item 1.01 Entry into a Material Definitive Agreement. Item 2.02 Results of Operations.',
      receivedAtMs: Date.parse('2026-11-06T21:15:00.000Z'),
    });
    expect(reg8k.reviewStatus).toBe('pending_human_review');
    expect(reg8k.secItems).toEqual(['1.01', '2.02', '9.01']);
    expect(reg8k.inferredPrincipalAmount).toBeNull();
    expect(reg8k.inferredCounterpartyOrgId).toBeNull();

    // 3. Deterministic periodic 10-Q XBRL extraction (rejecting obsolete 2019 comparative tag!)
    const header10q = firstDiscovery.discovered.find((d) => d.form === '10-Q')!;
    const unseen10qFacts = {
      cik: 1596532,
      entityName: 'Arista Networks, Inc.',
      facts: {
        'us-gaap': {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                {
                  val: 2_312_000_000,
                  fy: 2026,
                  fp: 'Q3',
                  form: '10-Q',
                  filed: '2026-11-04',
                  accn: '0001596532-26-000044',
                  frame: 'CY2026Q3',
                  start: '2026-07-01',
                  end: '2026-09-30',
                },
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                {
                  val: 812_000_000,
                  fy: 2026,
                  fp: 'Q3',
                  form: '10-Q',
                  filed: '2026-11-04',
                  accn: '0001596532-26-000044',
                  frame: 'CY2026Q3',
                  start: '2026-07-01',
                  end: '2026-09-30',
                },
              ],
            },
          },
          PaymentsToAcquirePropertyPlantAndEquipment: {
            units: {
              USD: [
                // Deliberate obsolete 2019 comparative trap — must be REJECTED!
                {
                  val: 18_000_000,
                  fy: 2019,
                  fp: 'Q3',
                  form: '10-Q',
                  filed: '2026-11-04',
                  accn: '0001596532-26-000044',
                  frame: 'CY2019Q3',
                  start: '2019-07-01',
                  end: '2019-09-30',
                },
              ],
            },
          },
        },
      },
    };

    const xbrlExtracted = extractPeriodicXbrlGraphCandidates({
      header: header10q,
      factsPayload: unseen10qFacts,
      subjectOrg: unseenOrg,
      receivedAtMs: Date.parse('2026-11-04T21:20:00.000Z'),
    });
    expect(xbrlExtracted.observations).toHaveLength(2);
    expect(xbrlExtracted.observations.map((o) => o.metricValue)).toEqual([
      2_312_000_000,
      812_000_000,
    ]);
    expect(
      xbrlExtracted.rejectedConcepts.some(
        (r) =>
          r.concept === 'PaymentsToAcquirePropertyPlantAndEquipment' &&
          (r.reason.includes('period_end_mismatch_with_report_date') ||
            r.reason.includes('historical_comparative_period_rejected')),
      ),
    ).toBe(true);

    // 4. Deterministic 13F-HR XML extraction emitting `pending_review` ownership candidates
    const header13f = firstDiscovery.discovered.find((d) => d.form === '13F-HR')!;
    const unseen13fXml = `<?xml version="1.0" encoding="UTF-8"?>
      <informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
        <infoTable>
          <nameOfIssuer>ASTERA LABS INC</nameOfIssuer>
          <titleOfClass>COM</titleOfClass>
          <cusip>04626A103</cusip>
          <value>145000000</value>
          <shrsOrPrnAmt><sshPrnamt>1850000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
          <investmentDiscretion>SOLE</investmentDiscretion>
        </infoTable>
      </informationTable>`;

    const f13Extracted = extractForm13fXmlGraphCandidates({
      header: header13f,
      infoTableXml: unseen13fXml,
      filerOrg: unseenOrg,
      defaultSectorId: 'sec-13f-public-issuers',
      valueScaleMultiplier: 1,
      receivedAtMs: Date.parse('2026-11-02T20:10:00.000Z'),
    });
    expect(f13Extracted.totalPortfolioValueUsd).toBe(145_000_000);
    expect(f13Extracted.candidateRelationships).toHaveLength(1);
    expect(f13Extracted.candidateRelationships[0]!.reviewerStatus).toBe('pending_review');

    // 5. Stage dynamic source in Convex & verify human review + dynamic source resolution + role checks
    const t = convexTest(schema, convexModules);
    const asNonReviewer = t.withIdentity({
      ...APP_SESSION,
      subject: 'user_reader',
      tokenIdentifier: NON_REVIEWER_ID,
      issuer: ISS,
    });
    const asReviewer = t.withIdentity({
      ...APP_SESSION,
      subject: 'user_reviewer',
      tokenIdentifier: REVIEWER_ID,
      issuer: ISS,
    });
    const dynamicStagedExternalId = 'staged-unseen-anet-13f-20261102';
    await t.run(async (ctx) => {
      await ctx.db.insert('roleGrants', {
        subject: REVIEWER_ID,
        role: 'reviewer',
        grantedBy: 'deployment_admin',
        grantedVia: 'deployment_admin',
        reason: 'RC002 unseen filing test reviewer grant',
        grantedAt: Date.parse('2026-11-01T00:00:00.000Z'),
      });
      await ctx.db.insert('researchStagingItems', {
        owner: REVIEWER_ID,
        externalId: dynamicStagedExternalId,
        runId: 'run-unseen-anet',
        agentId: 'sec-collector-v2',
        sourceUrl: header13f.docUrl,
        sourceDomain: 'sec.gov',
        title: f13Extracted.sourceDocument.title,
        contentSha256: sha256Hex(unseen13fXml),
        publishedAt: header13f.publishedMs,
        receivedAt: Date.parse('2026-11-02T20:10:00.000Z'),
        ingestedAt: Date.parse('2026-11-02T20:10:00.000Z'),
        entities: ['ANET'],
        claimsJson: '[]',
        summary: 'Unseen Arista Form 13F-HR primary XML filing',
        isPrimarySource: true,
        primarySourceUrl: header13f.docUrl,
        validationStatus: 'promoted',
        validationReasons: [],
        researchEligible: true,
        marketOutcomeEligible: false,
        promotedEvidenceIds: [],
        executionAuthority: 'none',
        version: 'remote-ops-003-v1',
      });
    });

    const candidateRelWithDynamicStagedSource = {
      ...f13Extracted.candidateRelationships[0]!,
      sourceDocIds: [dynamicStagedExternalId],
    };

    const reviewMutRef = makeFunctionReference<
      'mutation',
      Record<string, unknown>,
      { decision: string; promotedOutboxId: string | null; deduplicated: boolean }
    >('graph:reviewAndPromoteRelationship');

    // Non-reviewer MUST be rejected
    await expect(
      asNonReviewer.mutation(reviewMutRef, {
        visibility: 'public_research',
        decision: 'approved',
        reviewNote: 'Attempt without reviewer role',
        sourceTable: 'researchStagingItems',
        sourceRecordId: dynamicStagedExternalId,
        relationshipJson: JSON.stringify(candidateRelWithDynamicStagedSource),
      }),
    ).rejects.toThrow(/Reviewer role required/);

    // Governance check: trying to mark a `reported_discussion` relationship as `confirmed` MUST be rejected
    await expect(
      asReviewer.mutation(reviewMutRef, {
        visibility: 'public_research',
        decision: 'approved',
        reviewNote: 'Attempt invalid auto-confirm',
        sourceTable: 'researchStagingItems',
        sourceRecordId: dynamicStagedExternalId,
        relationshipJson: JSON.stringify({
          ...candidateRelWithDynamicStagedSource,
          contractualStatus: 'reported_discussion',
          epistemicStatus: 'confirmed',
        }),
      }),
    ).rejects.toThrow(/Relationship governance check failed/);

    // Valid reviewer approval referencing dynamically staged unseen source + prerequisite entities & 10-Q observations
    const prerequisiteBundle = {
      sectors: [unseenSector, ...f13Extracted.prerequisiteSectors.filter((s) => s.sectorId !== unseenSector.sectorId)],
      locations: [],
      energyAssets: [],
      organisations: f13Extracted.prerequisiteOrganisations,
      executives: [],
      projects: [],
      instruments: f13Extracted.prerequisiteInstruments,
      sources: [xbrlExtracted.sourceDocument],
      observations: [...xbrlExtracted.observations, f13Extracted.portfolioObservation],
    };

    const promoted = await asReviewer.mutation(reviewMutRef, {
      visibility: 'public_research',
      decision: 'approved',
      reviewNote: 'Verified unseen ANET 13F-HR XML & Q3 2026 10-Q XBRL observations',
      sourceTable: 'researchStagingItems',
      sourceRecordId: dynamicStagedExternalId,
      relationshipJson: JSON.stringify(candidateRelWithDynamicStagedSource),
      prerequisiteBundleJson: JSON.stringify(prerequisiteBundle),
    });
    expect(promoted.decision).toBe('approved');
    expect(promoted.promotedOutboxId).toBeTruthy();

    // Idempotent replay produces `deduplicated: true`
    const replay = await asReviewer.mutation(reviewMutRef, {
      visibility: 'public_research',
      decision: 'approved',
      reviewNote: 'Idempotent re-promotion check',
      sourceTable: 'researchStagingItems',
      sourceRecordId: dynamicStagedExternalId,
      relationshipJson: JSON.stringify(candidateRelWithDynamicStagedSource),
      prerequisiteBundleJson: JSON.stringify(prerequisiteBundle),
    });
    expect(replay.deduplicated).toBe(true);

    // 6. Verify explicit TypeDB target safeguards BEFORE touching local disposable TypeDB 3.14.2
    const disposableConfig: TypeDbConnectionConfig = {
      httpAddress: `http://127.0.0.1:${DISPOSABLE_HTTP_PORT}`,
      username: 'admin',
      password: 'password',
      databaseName: DISPOSABLE_DB_NAME,
    };

    expect(() => assertExplicitTypeDbWriteTarget(disposableConfig, '')).toThrow(
      /explicit configured target database/,
    );
    expect(() =>
      assertExplicitTypeDbWriteTarget(disposableConfig, 'aci_case007b_verified_dev'),
    ).toThrow(/target mismatch/);
    expect(() =>
      assertExplicitTypeDbWriteTarget(
        { ...disposableConfig, databaseName: 'aci_macro_intelligence_prod' },
        'aci_macro_intelligence_prod',
      ),
    ).toThrow(/production TypeDB database/);

    // 7. Project ONLY the unseen filing outbox item into disposable local TypeDB 3.14.2 (ZERO Case 001 bootstrap!)
    const schemaEnsure = await ensureTypeDbDatabaseAndSchemaOnLiveServer(disposableConfig, {
      expectedTargetDatabase: DISPOSABLE_DB_NAME,
      recreateDatabase: true,
    });
    expect(schemaEnsure.createdDatabase).toBe(true);

    const outboxRow = await t.run((ctx) => ctx.db.query('graphProjectionOutbox').first());
    expect(outboxRow).toBeTruthy();
    const compiledTypeQl = JSON.parse(outboxRow!.typeqlJson) as string[];

    const writeRes = await executeWriteStatementsOnLiveServer(compiledTypeQl, disposableConfig, {
      expectedTargetDatabase: DISPOSABLE_DB_NAME,
    });
    expect(writeRes.ok, `TypeDB write failed: ${writeRes.error}`).toBe(true);

    const counts = await inspectLiveTypeDbGraphCounts(disposableConfig);
    expect(counts.ok).toBe(true);
    expect(counts.counts?.organisations).toBe(2); // ONLY Arista + Astera Labs — ZERO synthetic Case 001 orgs!
    expect(counts.counts?.macroRelationships).toBe(1);
    expect(counts.counts?.observations).toBe(3); // Q3 rev ($2.312B), Q3 net income ($812M), 13F portfolio ($145M)

    // 8. Hydrate back from live disposable TypeDB 3.14.2 and run allowlisted graph query + Evidence Chat!
    const hydrated = await hydrateMacroDatasetFromLiveTypeDb(disposableConfig, {
      callerOwner: 'public_research',
    });
    expect(hydrated.ok).toBe(true);
    expect(hydrated.serverVersion).toBe('3.14.2');
    expect(hydrated.dataset!.organisations.map((o) => o.orgId).sort()).toEqual([
      'org-13f-04626a103',
      'org-anet',
    ]);

    vi.stubEnv('TYPEDB_HTTP_ADDRESS', disposableConfig.httpAddress);
    vi.stubEnv('TYPEDB_USERNAME', disposableConfig.username);
    vi.stubEnv('TYPEDB_PASSWORD', disposableConfig.password);
    vi.stubEnv('TYPEDB_DATABASE', DISPOSABLE_DB_NAME);

    const liveGraphQuery = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-anet',
        asOfMs: Date.parse('2026-11-18T12:00:00Z'),
        temporalBasis: 'publication',
        maxDepth: 2,
      },
      {
        callerId: REVIEWER_ID,
        datasets: [hydrated.dataset!],
        preferLiveTypeDb: true,
      },
    );
    expect(liveGraphQuery.backendMode).toBe('typedb_live');
    expect(liveGraphQuery.edges).toHaveLength(1);

    const chatBundle = await retrieveClosedEvidenceBundle({
      question:
        'What revenue, net income, and Form 13F equity holdings are documented for Arista Networks (ANET)?',
      requesterId: REVIEWER_ID,
      historicalCutoffMs: Date.parse('2026-11-18T12:00:00Z'),
      temporalBasis: 'publication',
      dataset: hydrated.dataset!,
      graphDatabaseName: DISPOSABLE_DB_NAME,
      preferLiveTypeDb: false,
      nowMs: Date.parse('2026-11-18T12:00:00Z'),
    });
    expect(chatBundle.selectedQuery.focalEntityId).toBe('org-anet');

    const chatTurn = await generateAndValidateEvidenceLockedAnswer({
      bundle: chatBundle,
      callerId: REVIEWER_ID,
      mode: 'auto',
      env: {},
      nowMs: Date.parse('2026-11-18T12:00:00Z'),
    });
    expect(chatTurn.validation.valid).toBe(true);
    expect(chatTurn.answer.supportStatus).toBe('fully_supported');
    const answerText = `${chatTurn.answer.shortAnswer} ${chatTurn.answer.supportingClaims.map((c) => c.statement).join(' ')}`;
    expect(answerText).toContain('$2.312B');
    expect(answerText).toContain('ASTERA LABS');
    expect(answerText).not.toContain('Nscale');
    expect(answerText).not.toContain('Anthropic');

    // Persist acceptance evidence snapshot to scratch if present
    const scratchDir =
      'C:/Users/david/.gemini/antigravity/brain/43d1d2a3-9e08-44b0-be6e-8f36e7c9ab90/scratch';
    if (fs.existsSync(scratchDir)) {
      fs.writeFileSync(
        path.join(scratchDir, 'rc002_unseen_filing_ingestion_evidence.json'),
        JSON.stringify(
          {
            verifiedAtIso: new Date().toISOString(),
            disposableDatabase: DISPOSABLE_DB_NAME,
            typedbServerVersion: hydrated.serverVersion,
            touchedTypeDbCloud: false,
            unseenIssuer: { ticker: 'ANET', cik: '0001596532', name: 'Arista Networks, Inc.' },
            discoveredForms: firstDiscovery.discovered.map((d) => ({
              form: d.form,
              accession: d.accession,
              sourcePage: d.sourcePage,
            })),
            comparativeTrapRejected: xbrlExtracted.rejectedConcepts,
            liveTypeDbCounts: counts.counts,
            liveQueryBackendMode: liveGraphQuery.backendMode,
            evidenceChatAnswer: {
              supportStatus: chatTurn.answer.supportStatus,
              validatorValid: chatTurn.validation.valid,
              shortAnswer: chatTurn.answer.shortAnswer,
            },
          },
          null,
          2,
        ),
      );
    }
  }, 45_000);
});
