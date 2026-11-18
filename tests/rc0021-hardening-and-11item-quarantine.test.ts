import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';

vi.mock('server-only', () => ({}));

import schema from '../convex/schema';
import { APP_SESSION } from './helpers/app-identity';
import {
  KNOWN_INVALID_SEC_XBRL_RULES,
  NVDA_HUGGINGFACE_8K_ACCESSION,
  NVDA_HUGGINGFACE_8K_SHA256,
  NVDA_LEADERSHIP_8K_ACCESSION,
  buildEffectiveContaminationReadGuard,
  discoverXbrlQuarantineImpact,
  evaluateSecClaimQuarantine,
  matchInvalidSecXbrlRule,
  type BriefingRowSnapshot,
  type EvidenceRowSnapshot,
  type ExistingQuarantineRowSnapshot,
  type ExperimentRowSnapshot,
  type ForecastRowSnapshot,
  type ForwardEventRowSnapshot,
  type PersistedQuarantineOverlayRow,
  type StagingRowSnapshot,
} from '../lib/remote-ops/xbrl-quarantine-remediation';
import { evaluateCollectionHealth } from '../lib/remote-ops/health-monitor';
import { runScheduledOperations, submitResearchStaging } from '../lib/remote-ops/server';
import { DEFAULT_RESEARCH_JOBS } from '../lib/remote-ops/contracts';

const ISS = 'https://issuer.test';
const CONVEX_OWNER = `${ISS}|user_prod_sim_owner`;
const OTHER_OWNER = `${ISS}|user_other_tenant`;

const convexModules = {
  './_generated/server.ts': async () => ({}),
  './http.ts': () => import('../convex/http'),
  './operations.ts': () => import('../convex/operations'),
  './research.ts': () => import('../convex/research'),
  './remoteOpsCloud.ts': () => import('../convex/remoteOpsCloud'),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const PROD_SNAPSHOT_ZIP = path.resolve(
  process.cwd(),
  'backups/convex-prod/pre-scheduler-pause-20261118T1542Z.zip',
);

function buildSynthetic13RowProdFixture() {
  const owner = 'clerk_prod_fixture_owner';
  const stagingItems: StagingRowSnapshot[] = [
    // 7 original invalid items
    {
      _id: 's173c8gd5pg1w5q2nkkw7axwws8hrvhd',
      owner,
      externalId: 'staged-dcf44b009199d49a',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000040/amzn-20260930.htm',
      title: 'Amazon.com, Inc. (AMZN) SEC Form 10-Q (0001018724-26-000040) — Q1 2017 XBRL disclosure',
      entities: ['AMZN'],
      claimsJson: '[{"entity":"AMZN","metric":"capital_expenditures","value":4.9}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms7587e36rs0wkc1karn2f3v7h8hrt69'],
    },
    {
      _id: 's175zhgm8wjczaas6xbykpj1m98hrb24',
      owner,
      externalId: 'staged-c135441d25ee1df9',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526448357/d177209d8k.htm',
      title: 'Microsoft Corporation (MSFT) SEC Form 8-K (0001193125-26-448357) — Q1 2027 XBRL disclosure',
      entities: ['MSFT'],
      claimsJson: '[{"entity":"MSFT","metric":"capital_expenditures","value":19.39}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms75gdzx8qcncqjw2yzc81n5518hs1rt'],
    },
    {
      _id: 's1796fa1rf2k0gqz0bbg0tj1w58hswnn',
      owner,
      externalId: 'staged-e2523ed83a7c0247',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm',
      title: 'NVIDIA Corporation (NVDA) SEC Form 8-K (0001045810-26-000078) — Q2 2020 XBRL disclosure',
      entities: ['NVDA'],
      claimsJson: '[{"entity":"NVDA","metric":"capital_expenditures","value":0.24}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms77z8w5h1hpqctg3bm9gb3h0h8hs75j'],
    },
    {
      _id: 's179fenve4szsfka2hwv8h1fs58hsn1s',
      owner,
      externalId: 'staged-98c25c92c7ca82e7',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1652044/000119312526449835/d174184d8k.htm',
      title: 'Alphabet Inc. (GOOGL) SEC Form 8-K (0001193125-26-449835) — Q3 2026 XBRL disclosure',
      entities: ['GOOGL'],
      claimsJson: '[{"entity":"GOOGL","metric":"capital_expenditures","value":63.6}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms74hc2tezjdtbrnj0ey1pyk098hrv25'],
    },
    {
      _id: 's17ajsnhfvaxqhx4zvk6xgj8rn8hszcg',
      owner,
      externalId: 'staged-e28936b38824c3e3',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2488/000000248826000191/amd-20260926.htm',
      title: 'Advanced Micro Devices, Inc. (AMD) SEC Form 10-Q (0000002488-26-000191) — Q3 2026 XBRL disclosure',
      entities: ['AMD'],
      claimsJson: '[{"entity":"AMD","metric":"capital_expenditures","value":0.75}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms784gdkrd7f20r9cswj30sw8h8hst1t'],
    },
    {
      _id: 's17bn273r4w0g9z2sx20cynm8n8hrfnm',
      owner,
      externalId: 'staged-84349400e88f3423',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/50863/000005086326000191/intc-20260926.htm',
      title: 'Intel Corporation (INTC) SEC Form 10-Q (0000050863-26-000191) — Q3 2026 XBRL disclosure',
      entities: ['INTC'],
      claimsJson: '[{"entity":"INTC","metric":"capital_expenditures","value":11.16}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms70f815ya0tczsc2q0px6ba018hre4g'],
    },
    {
      _id: 's17c2kv2tme611sdnv32mfnrfh8j444b',
      owner,
      externalId: 'staged-7f5da1f3fb6a672d',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda-20260726.htm',
      title: 'NVIDIA Corporation (NVDA) SEC Form 10-Q (0001045810-20-000147) — Q2 2020 (YTD) XBRL disclosure',
      entities: ['NVDA'],
      claimsJson: '[{"entity":"NVDA","metric":"capital_expenditures","value":0.37}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms759425bw6sdjemkr49qqd67d8j4bn7'],
    },
    // 4 Production-only legacy 639a2ed items
    {
      _id: 's17f7n82pvwt0g4zrsn8praz3d8hw4xg',
      owner,
      externalId: 'staged-fbc874a28bd84c09',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1769628/000176962826000432/crwv-20260917.htm',
      title: 'CoreWeave, Inc. (CRWV) SEC Form 8-K (0001769628-26-000432) — Q2 2026 XBRL disclosure',
      entities: ['CRWV'],
      claimsJson: '[{"entity":"CRWV","metric":"capital_expenditures","value":3.86}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms7anp0f0byv15ywm0k3j9sc2s8hwzqh'],
    },
    {
      _id: 's1754x91sazyj6ksnfz44dc8k18hzcrd',
      owner,
      externalId: 'staged-38ed0fa5858e4039',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1769628/000176962826000461/crwv-20261110.htm',
      title: 'CoreWeave, Inc. (CRWV) SEC Form 8-K (0001769628-26-000461) — Q2 2026 XBRL disclosure',
      entities: ['CRWV'],
      claimsJson: '[{"entity":"CRWV","metric":"capital_expenditures","value":3.86}]',
      validationStatus: 'pending_verification',
      promotedEvidenceIds: [],
    },
    {
      _id: 's17armxzx1zq0pa690rkqk86gd8j3hh7',
      owner,
      externalId: 'staged-69c775fb1a6caee5',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000082/nvda-20261111.htm',
      title: 'NVIDIA Corporation (NVDA) SEC Form 8-K (0001045810-26-000082) — Q2 2020 XBRL disclosure',
      entities: ['NVDA'],
      claimsJson: '[{"entity":"NVDA","metric":"capital_expenditures","value":0.24}]',
      validationStatus: 'pending_verification',
      promotedEvidenceIds: [],
    },
    {
      _id: 's170edv39v3jgew0adnqv4dydd8j25k5',
      owner,
      externalId: 'staged-8e7477f68ecd364f',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1769628/000176962826000465/crwv-20260930.htm',
      title: 'CoreWeave, Inc. (CRWV) SEC Form 10-Q (0001769628-26-000465) — Q3 2026 XBRL disclosure',
      entities: ['CRWV'],
      claimsJson: '[{"entity":"CRWV","metric":"capital_expenditures","value":6.25}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms73jep6wabexz31egjwkcpxas8j3add'],
    },
    // 2 unaffected verified 10-Q disclosures
    {
      _id: 's1753p2gf23nfd3445hakjgr1n8j52zm',
      owner,
      externalId: 'staged-cca5a888067bd7d3',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000084/goog-20260930.htm',
      title: 'Alphabet Inc. (GOOGL) SEC Form 10-Q (0001652044-26-000084) — Q3 2026 (YTD) XBRL disclosure',
      entities: ['GOOGL'],
      claimsJson: '[{"entity":"GOOGL","metric":"capital_expenditures","value":131.95,"excerpt":"Q3 2026 (YTD)"}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms70jmk6jaam8fqkzsptrsykkx8j5d7r'],
    },
    {
      _id: 's17b831w3y08ywwkwe0gfkx61s8j59sn',
      owner,
      externalId: 'staged-ad56640669b3eae7',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/msft-20260930.htm',
      title: 'Microsoft Corporation (MSFT) SEC Form 10-Q (0001193125-26-436133) — Q1 2027 XBRL disclosure',
      entities: ['MSFT'],
      claimsJson: '[{"entity":"MSFT","metric":"capital_expenditures","value":39.37}]',
      validationStatus: 'promoted',
      promotedEvidenceIds: ['ms71dz969mzm0crbe4j3ts5ktx8j4tgt'],
    },
  ];

  const evidenceRows: EvidenceRowSnapshot[] = [
    { _id: 'ms7587e36rs0wkc1karn2f3v7h8hrt69', owner, source: stagingItems[0]!.sourceUrl, symbol: 'AMZN', metric: 'capital_expenditures', value: 4.9, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms75gdzx8qcncqjw2yzc81n5518hs1rt', owner, source: stagingItems[1]!.sourceUrl, symbol: 'MSFT', metric: 'capital_expenditures', value: 19.39, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms77z8w5h1hpqctg3bm9gb3h0h8hs75j', owner, source: stagingItems[2]!.sourceUrl, symbol: 'NVDA', metric: 'capital_expenditures', value: 0.24, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms71z2vm0nhq2850kvr3pym65s8hr3wb', owner, source: stagingItems[2]!.sourceUrl, symbol: 'NVDA', metric: 'sec_xbrl_primary_disclosure', value: 1.07, unit: 'USD_billions', period: '2026', definition: 'Forward experiment (forward-004-nvda-qqq-5d-2026-11-05) frozen sec_xbrl_fact', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms74hc2tezjdtbrnj0ey1pyk098hrv25', owner, source: stagingItems[3]!.sourceUrl, symbol: 'GOOGL', metric: 'capital_expenditures', value: 63.6, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms784gdkrd7f20r9cswj30sw8h8hst1t', owner, source: stagingItems[4]!.sourceUrl, symbol: 'AMD', metric: 'capital_expenditures', value: 0.75, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms70f815ya0tczsc2q0px6ba018hre4g', owner, source: stagingItems[5]!.sourceUrl, symbol: 'INTC', metric: 'capital_expenditures', value: 11.16, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms759425bw6sdjemkr49qqd67d8j4bn7', owner, source: stagingItems[6]!.sourceUrl, symbol: 'NVDA', metric: 'capital_expenditures', value: 0.37, unit: 'billions_usd', period: 'Q22020', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms7anp0f0byv15ywm0k3j9sc2s8hwzqh', owner, source: stagingItems[7]!.sourceUrl, symbol: 'CRWV', metric: 'capital_expenditures', value: 3.86, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms73jep6wabexz31egjwkcpxas8j3add', owner, source: stagingItems[10]!.sourceUrl, symbol: 'CRWV', metric: 'capital_expenditures', value: 6.25, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    // 5 unaffected active evidence rows
    { _id: 'ms70jmk6jaam8fqkzsptrsykkx8j5d7r', owner, source: stagingItems[11]!.sourceUrl, symbol: 'GOOGL', metric: 'capital_expenditures', value: 131.95, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms71dz969mzm0crbe4j3ts5ktx8j4tgt', owner, source: stagingItems[12]!.sourceUrl, symbol: 'MSFT', metric: 'capital_expenditures', value: 39.37, unit: 'billions_usd', period: '2026', definition: 'capex', status: 'reported', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms715x9nma0b5s2dtttdj4qg9d8hrmh3', owner, source: 'https://api.nasdaq.com/nvda', symbol: 'NVDA', metric: 'regular_session_close_usd', value: 186.64, unit: 'USD', period: '2026-11-06', definition: 'market_close', status: 'measured', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms71c5e7ze98j5dsk1cf0b6cfh8hs2sa', owner, source: 'https://api.frankfurter.app/fx', symbol: 'NVDA', metric: 'regular_session_close_gbp', value: 139.4406, unit: 'GBP', period: '2026-11-06', definition: 'fx_close', status: 'measured', publishedAt: 1, receivedAt: 2 },
    { _id: 'ms7bzgzm97mxhqpv744bw3as1s8hr3er', owner, source: 'https://api.nasdaq.com/qqq', symbol: 'QQQ', metric: 'regular_session_close_usd', value: 656.1, unit: 'USD', period: '2026-11-06', definition: 'market_close', status: 'measured', publishedAt: 1, receivedAt: 2 },
  ];

  const briefingDates = [
    ['ns742vprv6yrzmjj2hvzyzmrnd8hs128', '2026-11-07', ['fact-fx-2026-11-06', 'fact-MSFT-0001193125-26-448357', 'fact-NVDA-0001045810-26-000078'], ['interp-staged-e2523ed83a7c0247']],
    ['ns7530wwm50e8p3g20grjddc758hwf69', '2026-11-09', ['fact-staged-e2523ed83a7c0247', 'fact-staged-dcf44b009199d49a'], ['interp-staged-84349400e88f3423']],
    ['ns74zs1pg3xh18vsndtqnrtnad8hz891', '2026-11-10', ['fact-staged-fbc874a28bd84c09', 'fact-staged-98c25c92c7ca82e7'], ['interp-staged-fbc874a28bd84c09']],
    ['ns76rwr1465vp21k32zqfcda7h8j1n50', '2026-11-11', ['fact-staged-38ed0fa5858e4039', 'fact-staged-fbc874a28bd84c09'], ['interp-staged-38ed0fa5858e4039']],
    ['ns7fcrs46425h2m6tssm31t8158j3tgt', '2026-11-12', ['fact-staged-38ed0fa5858e4039', 'fact-staged-e28936b38824c3e3'], ['interp-staged-e28936b38824c3e3']],
    ['ns77092as1akqh4htpv53xscnn8j59pp', '2026-11-13', ['fact-staged-69c775fb1a6caee5', 'fact-staged-8e7477f68ecd364f'], ['interp-staged-69c775fb1a6caee5']],
    ['ns752pv1r2zbr3kyyxez3dfqy18ja9nr', '2026-11-16', ['fact-staged-7f5da1f3fb6a672d', 'fact-staged-cca5a888067bd7d3', 'fact-staged-ad56640669b3eae7'], ['interp-staged-7f5da1f3fb6a672d', 'interp-staged-cca5a888067bd7d3']],
    ['ns72gfvn3hjwxaphck907z1ftx8jcn75', '2026-11-17', ['fact-staged-7f5da1f3fb6a672d', 'fact-staged-69c775fb1a6caee5', 'fact-staged-cca5a888067bd7d3'], ['interp-staged-7f5da1f3fb6a672d']],
    ['ns79zjmp4gasxp5wk6zvs06mhx8jfnds', '2026-11-18', ['fact-staged-7f5da1f3fb6a672d', 'fact-staged-69c775fb1a6caee5', 'fact-staged-8e7477f68ecd364f', 'fact-staged-38ed0fa5858e4039', 'fact-staged-cca5a888067bd7d3', 'fact-staged-ad56640669b3eae7'], ['interp-staged-7f5da1f3fb6a672d', 'interp-staged-cca5a888067bd7d3', 'interp-staged-ad56640669b3eae7']],
  ] as const;

  const morningBriefings: BriefingRowSnapshot[] = briefingDates.map(([id, date, facts, interps], idx) => ({
    _id: id,
    owner,
    briefingDate: date,
    generatedAt: 1794065382172 + idx * 86_400_000,
    confirmedFactsJson: JSON.stringify(facts.map((fId) => ({ id: fId }))),
    researchInterpretationJson: JSON.stringify(
      interps.map((iId) => ({ id: iId, citedEvidenceIds: [iId.replace(/^interp-/, '')] })),
    ),
    riskChangesJson: '[]',
    incompleteEvidenceJson: '[]',
  }));

  const forwardResearchEvents: ForwardEventRowSnapshot[] = [
    {
      _id: 'n973y4tgnsebakan9jf9v2wks98hsnzt',
      owner,
      eventKey: 'forward-004-nvda-qqq-5d-2026-11-05',
      name: 'Phase 004 Forward Event · NVDA vs QQQ 5-Session Excess Return',
      symbol: 'NVDA',
      experimentId: 'mx78nw669a4sezbqvsagb6eczd8hs639',
      evidenceJson: JSON.stringify([
        { id: 'staged-e2523ed83a7c0247', sourceUrl: stagingItems[2]!.sourceUrl },
      ]),
      evaluationJson: '{}',
    },
  ];

  const experiments: ExperimentRowSnapshot[] = [
    {
      _id: 'mx78nw669a4sezbqvsagb6eczd8hs639',
      owner,
      name: 'Phase 004 Forward Event · NVDA vs QQQ 5-Session Excess Return',
      cutoff: 1794065364212,
      evidenceIds: [
        'ms715x9nma0b5s2dtttdj4qg9d8hrmh3',
        'ms71c5e7ze98j5dsk1cf0b6cfh8hs2sa',
        'ms7bzgzm97mxhqpv744bw3as1s8hr3er',
        'ms71z2vm0nhq2850kvr3pym65s8hr3wb',
      ],
      protocol: 'forward-research-004-v1:NVDA_vs_QQQ:5d',
    },
  ];

  const forecasts: ForecastRowSnapshot[] = [
    {
      _id: 'n57d4mrm2tpxfmb0a7q6c4xpbd8hrcct',
      owner,
      experimentId: 'mx78nw669a4sezbqvsagb6eczd8hs639',
      participant: 'deterministic_baseline',
      modelVersion: 'deterministic-sec-momentum-v1',
      evidenceIds: experiments[0]!.evidenceIds,
      decision: 'no-trade',
      idempotencyKey: 'forward-004-nvda-qqq-5d-2026-11-05:deterministic_baseline',
    },
    {
      _id: 'n57ezctkx7ff324bsabw9jb6f98hswmc',
      owner,
      experimentId: 'mx78nw669a4sezbqvsagb6eczd8hs639',
      participant: 'neutral_baseline',
      modelVersion: 'neutral-abstention-v1',
      evidenceIds: experiments[0]!.evidenceIds,
      decision: 'no-trade',
      idempotencyKey: 'forward-004-nvda-qqq-5d-2026-11-05:neutral_baseline',
    },
  ];

  return {
    stagingItems,
    evidenceRows,
    morningBriefings,
    forwardResearchEvents,
    experiments,
    forecasts,
    existingQuarantines: [] as ExistingQuarantineRowSnapshot[],
  };
}

function loadProductionSnapshotOrFallback() {
  if (!fs.existsSync(PROD_SNAPSHOT_ZIP)) {
    return buildSynthetic13RowProdFixture();
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aci-rc0021-prod-test-'));
  try {
    execFileSync('tar', ['-xf', PROD_SNAPSHOT_ZIP, '-C', tmpDir]);
    const readJsonl = (table: string): Array<Record<string, unknown>> => {
      const p = path.join(tmpDir, table, 'documents.jsonl');
      if (!fs.existsSync(p)) return [];
      return fs
        .readFileSync(p, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    };
    return {
      stagingItems: readJsonl('researchStagingItems').map((s) => ({
        ...s,
        _id: String(s._id),
        promotedEvidenceIds: Array.isArray(s.promotedEvidenceIds)
          ? s.promotedEvidenceIds.map(String)
          : [],
      })) as unknown as StagingRowSnapshot[],
      evidenceRows: readJsonl('evidence').map((e) => ({
        ...e,
        _id: String(e._id),
      })) as unknown as EvidenceRowSnapshot[],
      morningBriefings: readJsonl('morningBriefings').map((b) => ({
        ...b,
        _id: String(b._id),
      })) as unknown as BriefingRowSnapshot[],
      forwardResearchEvents: readJsonl('forwardResearchEvents').map((f) => ({
        ...f,
        _id: String(f._id),
        experimentId: f.experimentId ? String(f.experimentId) : null,
      })) as unknown as ForwardEventRowSnapshot[],
      experiments: readJsonl('experiments').map((e) => ({
        ...e,
        _id: String(e._id),
        evidenceIds: Array.isArray(e.evidenceIds) ? e.evidenceIds.map(String) : [],
      })) as unknown as ExperimentRowSnapshot[],
      forecasts: readJsonl('forecasts').map((fc) => ({
        ...fc,
        _id: String(fc._id),
        experimentId: String(fc.experimentId),
        evidenceIds: Array.isArray(fc.evidenceIds) ? fc.evidenceIds.map(String) : [],
      })) as unknown as ForecastRowSnapshot[],
      existingQuarantines: readJsonl('evidenceQuarantines').map((q) => ({
        ...q,
        _id: String(q._id),
        stagingItemId: String(q.stagingItemId),
      })) as unknown as ExistingQuarantineRowSnapshot[],
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('RC002.1 Hardening & Full 11-Item Production Quarantine Suite', () => {
  it('matches all 11 Production staging rows, 10 evidence rows, 9 briefings, and 4 study records with 0 deletions', () => {
    expect(KNOWN_INVALID_SEC_XBRL_RULES).toHaveLength(11);
    const snapshot = loadProductionSnapshotOrFallback();
    const impact = discoverXbrlQuarantineImpact(snapshot);

    expect(impact.beforeCounts.totalStagingItems).toBe(13);
    expect(impact.beforeCounts.totalEvidenceRows).toBe(15);
    expect(impact.items).toHaveLength(11);
    expect(impact.afterCountsIfExecuted.quarantinedStagingItems).toBe(11);
    expect(impact.afterCountsIfExecuted.quarantinedEvidenceRows).toBe(10);
    expect(impact.afterCountsIfExecuted.totalQuarantineLedgerRows).toBe(11);
    expect(impact.afterCountsIfExecuted.invalidatedMorningBriefingsCount).toBe(9);
    expect(impact.afterCountsIfExecuted.invalidatedForwardResearchEventsCount).toBe(1);
    expect(impact.afterCountsIfExecuted.invalidatedExperimentsCount).toBe(1);
    expect(impact.afterCountsIfExecuted.invalidatedForecastsCount).toBe(2);
    expect(impact.afterCountsIfExecuted.rowsDeletedCount).toBe(0);

    // Unaffected verified observations remain active (GOOGL 10-Q + MSFT 10-Q + 3 Nasdaq/ECB close rows = 5)
    expect(impact.afterCountsIfExecuted.activeEvidenceRows).toBe(5);
    expect(impact.uniqueAffectedIds.orphanEvidenceIds).toEqual([
      'ms71z2vm0nhq2850kvr3pym65s8hr3wb',
    ]);
  });

  it('preserves claim-level precision without broad accession-wide blocking on CRWV 000465 or NVDA 000082/000078', () => {
    // Dev CRWV 10-Q 0001769628-26-000465 ($23.56B Q3 2026 YTD) must NOT be blocked
    const devCrwvValid = matchInvalidSecXbrlRule({
      externalId: 'staged-6afe1e4dac78ab77',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1769628/000176962826000465/crwv-20260930.htm',
      claimsJson:
        '[{"entity":"CRWV","metric":"capital_expenditures","value":23.56,"excerpt":"period ended 2026-09-30 Q3 2026 (YTD)"}]',
    });
    expect(devCrwvValid).toBeNull();

    // Prod CRWV 10-Q 0001769628-26-000465 ($6.25B prior-year 2025 comparative) MUST be matched
    const prodCrwvInvalid = matchInvalidSecXbrlRule({
      externalId: 'staged-8e7477f68ecd364f',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1769628/000176962826000465/crwv-20260930.htm',
      claimsJson: '[{"entity":"CRWV","metric":"capital_expenditures","value":6.25}]',
    });
    expect(prodCrwvInvalid?.ruleId).toBe('rc0021-invalid-crwv-000465-10q-comparative-2025-capex');

    // NVDA 0001045810-26-000082: Item 5.02 CEO transition allowed; XBRL Q2 2020 capex blocked
    const nvda000082Leadership = evaluateSecClaimQuarantine({
      accession: NVDA_LEADERSHIP_8K_ACCESSION,
      extractionMethod: 'primary_filing_item_text',
      metricOrClaimType: 'leadership_appointment',
      secItem: '5.02',
      contentSha256: '1543a0cc1775291131f5d22224435fff8a58de4e7d6804618ee82fbda1a1dd5c',
    });
    expect(nvda000082Leadership.allowed).toBe(true);

    const nvda000082XbrlCapex = evaluateSecClaimQuarantine({
      accession: NVDA_LEADERSHIP_8K_ACCESSION,
      extractionMethod: 'xbrl',
      metricOrClaimType: 'capital_expenditures',
    });
    expect(nvda000082XbrlCapex.allowed).toBe(false);

    // NVDA 0001045810-26-000078: Item 8.01 proposed M&A allowed; XBRL capex blocked
    const nvda000078Ma = evaluateSecClaimQuarantine({
      accession: NVDA_HUGGINGFACE_8K_ACCESSION,
      extractionMethod: 'primary_filing_item_text',
      metricOrClaimType: 'pending_m_and_a_agreement',
      secItem: '8.01',
      contentSha256: NVDA_HUGGINGFACE_8K_SHA256,
      epistemicStatus: 'proposed',
      contractualStatus: 'contingent_signed',
      bindingObligation: false,
    });
    expect(nvda000078Ma.allowed).toBe(true);
  });

  it('enforces SAFE_WITHHELD_PENDING_QUARANTINE on read (including direct old briefing & study access) and idempotent ledger replay', () => {
    const snapshot = loadProductionSnapshotOrFallback();

    // 1. Pre-quarantine state (`persistedQuarantines = []`): fails closed into SAFE_WITHHELD_PENDING_QUARANTINE
    const preGuard = buildEffectiveContaminationReadGuard({
      ...snapshot,
      persistedQuarantines: [],
    });
    expect(preGuard.remediationState).toBe('SAFE_WITHHELD_PENDING_QUARANTINE');
    expect(preGuard.pendingQuarantineCount).toBe(11);
    expect(preGuard.withheldStagingIds.size).toBe(11);
    expect(preGuard.withheldEvidenceIds.size).toBe(10);

    // Direct access to oldest historical briefing (2026-11-07) preserves FX fact and withholds all contaminated SEC facts
    const briefNov07 = snapshot.morningBriefings.find((b) => b.briefingDate === '2026-11-07')!;
    const sanitisedNov07 = preGuard.sanitiseBriefing({
      _id: briefNov07._id,
      briefingDate: briefNov07.briefingDate,
      generatedAt: briefNov07.generatedAt,
      confirmedFacts: JSON.parse(briefNov07.confirmedFactsJson) as Array<{ id: string }>,
      researchInterpretation: JSON.parse(briefNov07.researchInterpretationJson) as Array<{
        id: string;
        citedEvidenceIds?: string[];
      }>,
    });
    expect(sanitisedNov07.remediationState).toBe('SAFE_WITHHELD_PENDING_QUARANTINE');
    expect(sanitisedNov07.confirmedFacts.map((f) => f.id)).toEqual(['fact-fx-2026-11-06']);
    expect(sanitisedNov07.withheldFacts.length).toBeGreaterThanOrEqual(2);

    // Latest briefing (2026-11-18) withholds all 4 invalid facts (incl. NVDA 000082 Q2 2020 & CRWV 8-K/10-Q) and keeps ONLY GOOGL + MSFT 10-Q
    const briefNov18 = snapshot.morningBriefings.find((b) => b.briefingDate === '2026-11-18')!;
    const sanitisedNov18 = preGuard.sanitiseBriefing({
      _id: briefNov18._id,
      briefingDate: briefNov18.briefingDate,
      generatedAt: briefNov18.generatedAt,
      confirmedFacts: JSON.parse(briefNov18.confirmedFactsJson) as Array<{ id: string }>,
      researchInterpretation: JSON.parse(briefNov18.researchInterpretationJson) as Array<{
        id: string;
        citedEvidenceIds?: string[];
      }>,
    });
    expect(sanitisedNov18.remediationState).toBe('SAFE_WITHHELD_PENDING_QUARANTINE');
    expect(sanitisedNov18.confirmedFacts.map((f) => f.id).sort()).toEqual([
      'fact-staged-ad56640669b3eae7',
      'fact-staged-cca5a888067bd7d3',
    ]);
    expect(sanitisedNov18.withheldFacts).toHaveLength(4);

    // Downstream study records are flagged even before ledger mutation runs
    expect(preGuard.experimentWithholdMap.has('mx78nw669a4sezbqvsagb6eczd8hs639')).toBe(true);
    expect(preGuard.forecastWithholdMap.has('n57d4mrm2tpxfmb0a7q6c4xpbd8hrcct')).toBe(true);
    expect(preGuard.forecastWithholdMap.has('n57ezctkx7ff324bsabw9jb6f98hswmc')).toBe(true);

    // 2. Post-quarantine ledger state + idempotency check
    const simulatedLedger: PersistedQuarantineOverlayRow[] = preGuard.impact.items.map(
      (item, idx) => ({
        _id: `q-prod-${idx}`,
        owner: snapshot.stagingItems[0]!.owner,
        quarantineKey: item.quarantineKey,
        stagingItemId: item.stagingItemId,
        stagingExternalId: item.stagingExternalId,
        sourceUrl: item.sourceUrl,
        ticker: item.ticker,
        evidenceIds: item.allEvidenceIds,
        affectedBriefingIds: item.affectedBriefings.map((b) => b.id),
        affectedForwardEventIds: item.affectedForwardEvents.map((f) => f.id),
        affectedExperimentIds: item.affectedExperiments.map((e) => e.id),
        affectedForecastIds: item.affectedForecasts.map((fc) => fc.id),
        affectedBriefingFactIds: item.affectedBriefingFactIds,
        reasonCode: item.reasonCode,
        reason: item.reason,
      }),
    );

    const postGuard = buildEffectiveContaminationReadGuard({
      stagingItems: snapshot.stagingItems.map((s) =>
        preGuard.withheldStagingIds.has(s._id)
          ? { ...s, quarantinedAt: 1795023000000, quarantineId: 'q-prod' }
          : s,
      ),
      evidenceRows: snapshot.evidenceRows.map((e) =>
        preGuard.withheldEvidenceIds.has(e._id)
          ? { ...e, quarantinedAt: 1795023000000, quarantineId: 'q-prod' }
          : e,
      ),
      morningBriefings: snapshot.morningBriefings,
      forwardResearchEvents: snapshot.forwardResearchEvents,
      experiments: snapshot.experiments,
      forecasts: snapshot.forecasts,
      persistedQuarantines: simulatedLedger,
    });

    expect(postGuard.remediationState).toBe('QUARANTINED_LEDGER_COMPLETE');
    expect(postGuard.pendingQuarantineCount).toBe(0);
    expect(
      postGuard.impact.items.every((it) => it.status === 'already_quarantined'),
    ).toBe(true);
  });

  it('blocks HTTP forceOnDemand: true (409) and direct HTTP research staging (503) while RESEARCH_SCHEDULER_ENV=disabled', async () => {
    const prevSchedEnv = process.env.RESEARCH_SCHEDULER_ENV;
    const prevSecret = process.env.OPERATIONS_SCHEDULER_SECRET;
    const prevToken = process.env.RESEARCH_STAGING_TOKEN;
    const prevOwner = process.env.RESEARCH_OWNER_ID;

    try {
      process.env.RESEARCH_SCHEDULER_ENV = 'disabled';
      process.env.OPERATIONS_SCHEDULER_SECRET = 'test-operations-scheduler-secret-32chars!!';
      process.env.RESEARCH_STAGING_TOKEN = 'test-research-staging-token-32chars-min!!';
      process.env.RESEARCH_OWNER_ID = 'clerk_test_owner';

      const forceReq = new Request('https://capital.aiguides.co.uk/api/operations/scheduled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPERATIONS_SCHEDULER_SECRET}`,
        },
        body: JSON.stringify({ environment: 'remote', jobs: ['sec_filings_collect'], forceOnDemand: true }),
      });
      const forceResp = await runScheduledOperations(forceReq);
      expect(forceResp.status).toBe(409);
      const forceBody = await forceResp.json();
      expect(forceBody.error.code).toBe('scheduler_env_disabled');
      expect(forceBody.executionAuthority).toBe('none');

      const stagingReq = new Request('https://capital.aiguides.co.uk/api/research/staging', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RESEARCH_STAGING_TOKEN}`,
        },
        body: JSON.stringify({ runId: 'test-run', agentId: 'agent', environment: 'remote', items: [] }),
      });
      const stagingResp = await submitResearchStaging(stagingReq);
      expect(stagingResp.status).toBe(503);
      const stagingBody = await stagingResp.json();
      expect(stagingBody.error.code).toBe('scheduler_env_disabled');
      expect(stagingBody.executionAuthority).toBe('none');
    } finally {
      if (prevSchedEnv === undefined) delete process.env.RESEARCH_SCHEDULER_ENV;
      else process.env.RESEARCH_SCHEDULER_ENV = prevSchedEnv;
      if (prevSecret === undefined) delete process.env.OPERATIONS_SCHEDULER_SECRET;
      else process.env.OPERATIONS_SCHEDULER_SECRET = prevSecret;
      if (prevToken === undefined) delete process.env.RESEARCH_STAGING_TOKEN;
      else process.env.RESEARCH_STAGING_TOKEN = prevToken;
      if (prevOwner === undefined) delete process.env.RESEARCH_OWNER_ID;
      else process.env.RESEARCH_OWNER_ID = prevOwner;
    }
  });

  it('distinguishes configured, enabled, effectively running, paused, and last-successful states', () => {
    const now = Date.parse('2026-11-18T17:45:00.000Z');
    const health = evaluateCollectionHealth({
      now,
      systemEnabled: true,
      activeEnvironment: 'remote',
      schedulerEnv: 'disabled',
      pendingQuarantineCount: 11,
      dailyCostCeilingGbp: 5,
      monthlyCostCeilingGbp: 50,
      dailyEstimatedCostGbp: 0,
      dailyActualCostGbp: 0,
      monthlyEstimatedCostGbp: 0,
      monthlyActualCostGbp: 0,
      pendingVerificationCount: 0,
      jobs: DEFAULT_RESEARCH_JOBS.map((d) => ({
        jobKey: d.jobKey,
        intervalMinutes: d.intervalMinutes,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: now - 2 * 3600_000,
        lastRunAt: now - 2 * 3600_000,
        nextRunAt: now - 1800_000,
        sourcesAddedTotal: 7,
        evidenceAddedTotal: 7,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      })),
    });

    // Persisted toggle `enabled` stays true, while `scheduled` (effectively running) is false and scheduler layer is `paused`
    expect(health.systemEnabled).toBe(true);
    expect(health.operationalLayers.scheduler.status).toBe('paused');
    expect(health.operationalLayers.collector.status).toBe('idle');
    expect(health.jobs.every((j) => j.enabled === true && j.scheduled === false)).toBe(true);
    expect(health.jobs.every((j) => j.lastSuccessAt === now - 2 * 3600_000)).toBe(true);
    expect(
      health.alerts.some((a) => a.id === 'ops-safe-withheld-pending-quarantine'),
    ).toBe(true);
  });

  it('proves Convex transactional rollback atomicity, direct old-briefing/study read withholding, tenant isolation, HTTP 409/503 gates, and 11-item execution on convexTest', async () => {
    vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', ISS);
    vi.stubEnv('RESEARCH_SCHEDULER_ENV', 'disabled');
    vi.stubEnv('OPERATIONS_SCHEDULER_SECRET', 'convex-test-ops-scheduler-secret-32chars!!');
    vi.stubEnv('RESEARCH_STAGING_TOKEN', 'convex-test-research-staging-token-32ch!!');
    vi.stubEnv('RESEARCH_OWNER_ID', CONVEX_OWNER);

    const t = convexTest(schema, convexModules);
    const asOwner = t.withIdentity({
      ...APP_SESSION,
      subject: 'user_prod_sim_owner',
      tokenIdentifier: CONVEX_OWNER,
      issuer: ISS,
    });
    const asOther = t.withIdentity({
      ...APP_SESSION,
      subject: 'user_other_tenant',
      tokenIdentifier: OTHER_OWNER,
      issuer: ISS,
    });

    const fixture = loadProductionSnapshotOrFallback();

    // Seed all 13 staging rows, 15 evidence rows, 9 briefings, 1 forward event, 1 experiment, 2 forecasts + 1 other-tenant staging row
    const seeded = await t.run(async (ctx) => {
      type InsertedEvId = Awaited<ReturnType<typeof ctx.db.insert<'evidence'>>>;
      type InsertedStId = Awaited<ReturnType<typeof ctx.db.insert<'researchStagingItems'>>>;
      type InsertedBriefId = Awaited<ReturnType<typeof ctx.db.insert<'morningBriefings'>>>;

      const evIdMap = new Map<string, InsertedEvId>();
      for (const ev of fixture.evidenceRows) {
        const newId = await ctx.db.insert('evidence', {
          owner: CONVEX_OWNER,
          source: ev.source,
          symbol: ev.symbol,
          metric: ev.metric,
          value: ev.value,
          unit: ev.unit ?? 'USD_B',
          period: ev.period ?? '2026',
          definition: ev.definition ?? 'sec_xbrl',
          status: (ev.status as 'reported' | 'estimated' | 'measured') ?? 'reported',
          publishedAt: ev.publishedAt ?? 1_790_000_000_000,
          receivedAt: ev.receivedAt ?? 1_790_000_060_000,
        });
        evIdMap.set(ev._id, newId);
      }

      const stIdMap = new Map<string, InsertedStId>();
      for (const st of fixture.stagingItems) {
        const mappedPromoted = st.promotedEvidenceIds
          .map((oldId) => evIdMap.get(oldId))
          .filter((id): id is InsertedEvId => id !== undefined);
        const newStId = await ctx.db.insert('researchStagingItems', {
          owner: CONVEX_OWNER,
          externalId: st.externalId,
          runId: 'run-prod-sim',
          agentId: 'sec-collector',
          sourceUrl: st.sourceUrl,
          sourceDomain: 'sec.gov',
          title: st.title,
          contentSha256: 'b'.repeat(64),
          publishedAt: 1_790_000_000_000,
          receivedAt: 1_790_000_060_000,
          ingestedAt: 1_790_000_060_000,
          entities: st.entities,
          claimsJson: st.claimsJson,
          summary: st.title,
          isPrimarySource: true,
          primarySourceUrl: st.sourceUrl,
          validationStatus:
            (st.validationStatus as 'promoted' | 'pending_verification' | 'quarantined_injection') ??
            'promoted',
          validationReasons: [],
          researchEligible: true,
          marketOutcomeEligible: false,
          promotedEvidenceIds: mappedPromoted,
          executionAuthority: 'none',
          version: 'remote-ops-003-v1',
        });
        stIdMap.set(st._id, newStId);
      }

      const otherTenantStagingId = await ctx.db.insert('researchStagingItems', {
        owner: OTHER_OWNER,
        externalId: 'staged-other-tenant-001',
        runId: 'run-other',
        agentId: 'sec-collector',
        sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/other.htm',
        sourceDomain: 'sec.gov',
        title: 'Other Tenant Staging Item',
        contentSha256: 'c'.repeat(64),
        publishedAt: 1_790_000_000_000,
        receivedAt: 1_790_000_060_000,
        ingestedAt: 1_790_000_060_000,
        entities: ['MSFT'],
        claimsJson: '[]',
        summary: 'Other tenant',
        isPrimarySource: true,
        primarySourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/other.htm',
        validationStatus: 'pending_verification',
        validationReasons: [],
        researchEligible: false,
        marketOutcomeEligible: false,
        promotedEvidenceIds: [],
        executionAuthority: 'none',
        version: 'remote-ops-003-v1',
      });

      const briefIdMap = new Map<string, InsertedBriefId>();
      for (const b of fixture.morningBriefings) {
        const bId = await ctx.db.insert('morningBriefings', {
          owner: CONVEX_OWNER,
          briefingDate: b.briefingDate,
          generatedAt: b.generatedAt,
          timezone: 'Europe/London',
          confirmedFactsJson: b.confirmedFactsJson,
          researchInterpretationJson: b.researchInterpretationJson,
          riskChangesJson: b.riskChangesJson ?? '[]',
          incompleteEvidenceJson: b.incompleteEvidenceJson ?? '[]',
          modelVersion: 'deterministic-v1',
          executionAuthority: 'none',
          version: 'remote-ops-003-v1',
        });
        briefIdMap.set(b.briefingDate, bId);
      }

      const expFixture = fixture.experiments[0]!;
      const mappedExpEvIds = expFixture.evidenceIds
        .map((oldId) => evIdMap.get(oldId))
        .filter((id): id is InsertedEvId => id !== undefined);
      const expId = await ctx.db.insert('experiments', {
        owner: CONVEX_OWNER,
        name: expFixture.name,
        cutoff: expFixture.cutoff,
        evidenceIds: mappedExpEvIds,
        protocol: expFixture.protocol,
        protocolVersion: 'forward-research-004-v1',
        deadline: expFixture.cutoff + 432_000_000,
        createdAt: expFixture.cutoff,
      });

      const fwdFixture = fixture.forwardResearchEvents[0]!;
      await ctx.db.insert('forwardResearchEvents', {
        owner: CONVEX_OWNER,
        eventKey: fwdFixture.eventKey,
        name: fwdFixture.name,
        symbol: fwdFixture.symbol,
        benchmarkSymbol: 'QQQ',
        horizon: '5d',
        neutralBand: 0.005,
        registeredAt: expFixture.cutoff,
        cutoffAt: expFixture.cutoff,
        anchorSessionDate: '2026-11-06',
        anchorAt: expFixture.cutoff,
        targetEndSessionDate: '2026-11-13',
        targetEndAt: expFixture.cutoff + 432_000_000,
        evidenceSha256: 'd'.repeat(64),
        evidenceJson: fwdFixture.evidenceJson,
        participantsJson: '[]',
        evaluationJson: fwdFixture.evaluationJson ?? '{}',
        experimentId: expId,
        updatedAt: expFixture.cutoff,
        executionAuthority: 'none',
        version: 'forward-research-004-v1',
      });

      for (const fc of fixture.forecasts) {
        await ctx.db.insert('forecasts', {
          owner: CONVEX_OWNER,
          experimentId: expId,
          participant: fc.participant,
          modelVersion: fc.modelVersion,
          horizon: '5d',
          probabilities: [0.33, 0.34, 0.33],
          expectedReturn: 0,
          lower: -0.02,
          upper: 0.02,
          evidenceIds: mappedExpEvIds,
          explanation: 'Simulated baseline forecast',
          invalidation: 'None',
          decision: 'no-trade',
          submittedAt: expFixture.cutoff,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          costGbp: 0,
          latencyMs: 1,
          idempotencyKey: fc.idempotencyKey,
        });
      }

      const orphanEvId = evIdMap.get('ms71z2vm0nhq2850kvr3pym65s8hr3wb')!;
      return {
        otherTenantStagingId,
        briefIdsByDate: Object.fromEntries(briefIdMap),
        expId,
        orphanEvId,
      };
    });

    // 1. Convex HTTP bypass blockers while RESEARCH_SCHEDULER_ENV=disabled
    const convexHttpForce = await t.fetch('/api/operations/scheduled', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer convex-test-ops-scheduler-secret-32chars!!',
      },
      body: JSON.stringify({ environment: 'remote', forceOnDemand: true }),
    });
    expect(convexHttpForce.status).toBe(409);

    const convexHttpStaging = await t.fetch('/api/research/staging', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer convex-test-research-staging-token-32ch!!',
      },
      body: JSON.stringify({ runId: 'r1', agentId: 'a1', environment: 'remote', items: [] }),
    });
    expect(convexHttpStaging.status).toBe(503);

    // 2. Pre-quarantine SAFE_WITHHELD_PENDING_QUARANTINE on overview, direct access to oldest briefing & direct study + tenant isolation
    const opsOverviewPre = (await asOwner.query(
      makeFunctionReference<'query'>('operations:overview'),
      {},
    )) as { remediationState: string; pendingQuarantineCount: number };
    expect(opsOverviewPre.remediationState).toBe('SAFE_WITHHELD_PENDING_QUARANTINE');
    expect(opsOverviewPre.pendingQuarantineCount).toBe(11);

    const oldBriefNov07 = (await asOwner.query(
      makeFunctionReference<'query'>('operations:getMorningBriefing'),
      { briefingDate: '2026-11-07' },
    )) as {
      remediationState: string;
      withheldFacts: Array<{ id: string }>;
      executionAuthority: string;
    };
    expect(oldBriefNov07.remediationState).toBe('SAFE_WITHHELD_PENDING_QUARANTINE');
    expect(oldBriefNov07.withheldFacts.length).toBeGreaterThanOrEqual(2);
    expect(oldBriefNov07.executionAuthority).toBe('none');

    const otherTenantOldBrief = await asOther.query(
      makeFunctionReference<'query'>('operations:getMorningBriefing'),
      { briefingDate: '2026-11-07' },
    );
    expect(otherTenantOldBrief).toBeNull();

    interface StudyRecordResponse {
      remediationState: string;
      experiment: { invalidatedByQuarantine: boolean };
      withheldEvidence: Array<{ evidenceId: string }>;
      activeEvidence: Array<{ _id: string }>;
    }

    const directStudyPre = (await asOwner.query(
      makeFunctionReference<'query'>('research:getStudyRecord'),
      { experimentId: seeded.expId },
    )) as StudyRecordResponse;
    expect(directStudyPre.remediationState).toBe('SAFE_WITHHELD_PENDING_QUARANTINE');
    expect(directStudyPre.experiment.invalidatedByQuarantine).toBe(true);
    expect(directStudyPre.withheldEvidence).toHaveLength(1);
    expect(directStudyPre.activeEvidence).toHaveLength(3);

    await expect(
      asOther.query(makeFunctionReference<'query'>('research:getStudyRecord'), {
        experimentId: seeded.expId,
      }),
    ).rejects.toThrow(/Record unavailable/);

    await expect(
      asOwner.mutation(makeFunctionReference<'mutation'>('research:freezeExperiment'), {
        name: 'Try freezing unquarantined orphan',
        cutoff: Date.now() - 1000,
        evidenceIds: [seeded.orphanEvId],
        protocol: 'test',
        deadline: Date.now() + 600_000,
      }),
    ).rejects.toThrow(/Quarantined evidence cannot be frozen/);

    // 3. Dry-run planner discovers all 11 items
    const plan = (await t.query(
      makeFunctionReference<'query'>('operations:planKnownXbrlQuarantineInternal'),
      { owner: CONVEX_OWNER },
    )) as {
      items: Array<{
        stagingItemId: typeof seeded.otherTenantStagingId;
        reasonCode: string;
        reason: string;
        claimedJson: string;
        expectedJson: string;
      }>;
    };
    expect(plan.items).toHaveLength(11);

    const mutationItems = plan.items.map((it) => ({
      stagingItemId: it.stagingItemId,
      reasonCode: it.reasonCode,
      reason: it.reason,
      claimedJson: it.claimedJson,
      expectedJson: it.expectedJson,
    }));

    // 4. Transactional atomicity / rollback proof:
    // Pass 10 valid items followed by 1 wrong-owner item (#11). Items 1..10 write inside the loop before #11 throws;
    // verify Convex aborts the entire mutation with ZERO partial writes persisted!
    await expect(
      t.mutation(makeFunctionReference<'mutation'>('operations:quarantineStagedEvidenceInternal'), {
        owner: CONVEX_OWNER,
        quarantinedBy: 'rc0021-atomicity-test',
        dryRun: false,
        items: [
          ...mutationItems.slice(0, 10),
          {
            ...mutationItems[10]!,
            stagingItemId: seeded.otherTenantStagingId,
          },
        ],
      }),
    ).rejects.toThrow(/not found for this owner/);

    const postAbortCounts = await t.run(async (ctx) => {
      const qRows = await ctx.db
        .query('evidenceQuarantines')
        .withIndex('by_owner', (q) => q.eq('owner', CONVEX_OWNER))
        .collect();
      const stRows = await ctx.db
        .query('researchStagingItems')
        .withIndex('by_owner', (q) => q.eq('owner', CONVEX_OWNER))
        .collect();
      const evRows = await ctx.db
        .query('evidence')
        .withIndex('by_owner', (q) => q.eq('owner', CONVEX_OWNER))
        .collect();
      return {
        quarantineLedgerCount: qRows.length,
        patchedStagingCount: stRows.filter((s) => s.quarantinedAt !== undefined).length,
        patchedEvidenceCount: evRows.filter((e) => e.quarantinedAt !== undefined).length,
      };
    });
    expect(postAbortCounts).toEqual({
      quarantineLedgerCount: 0,
      patchedStagingCount: 0,
      patchedEvidenceCount: 0,
    });

    interface QuarantineMutationResponse {
      report: Array<{ status: string }>;
    }

    // 5. Execute clean 11-item quarantine (`dryRun: false`) and verify exact counts + idempotent replay
    const execRes = (await t.mutation(
      makeFunctionReference<'mutation'>('operations:quarantineStagedEvidenceInternal'),
      {
        owner: CONVEX_OWNER,
        quarantinedBy: 'rc0021-prod-sim',
        dryRun: false,
        items: mutationItems,
      },
    )) as QuarantineMutationResponse;
    expect(execRes.report).toHaveLength(11);
    expect(execRes.report.every((r) => r.status === 'quarantined')).toBe(true);

    const postExecCounts = await t.run(async (ctx) => {
      const qRows = await ctx.db
        .query('evidenceQuarantines')
        .withIndex('by_owner', (q) => q.eq('owner', CONVEX_OWNER))
        .collect();
      const stRows = await ctx.db
        .query('researchStagingItems')
        .withIndex('by_owner', (q) => q.eq('owner', CONVEX_OWNER))
        .collect();
      const evRows = await ctx.db
        .query('evidence')
        .withIndex('by_owner', (q) => q.eq('owner', CONVEX_OWNER))
        .collect();
      return {
        totalStaging: stRows.length,
        quarantinedStaging: stRows.filter((s) => s.quarantinedAt !== undefined).length,
        totalEvidence: evRows.length,
        quarantinedEvidence: evRows.filter((e) => e.quarantinedAt !== undefined).length,
        activeEvidence: evRows.filter((e) => e.quarantinedAt === undefined).length,
        quarantineLedger: qRows.length,
      };
    });
    expect(postExecCounts).toEqual({
      totalStaging: 13,
      quarantinedStaging: 11,
      totalEvidence: 15,
      quarantinedEvidence: 10,
      activeEvidence: 5,
      quarantineLedger: 11,
    });

    // 6. Idempotent replay: re-running returns `already_quarantined` for all 11 items with 0 extra rows
    const replayRes = (await t.mutation(
      makeFunctionReference<'mutation'>('operations:quarantineStagedEvidenceInternal'),
      {
        owner: CONVEX_OWNER,
        quarantinedBy: 'rc0021-prod-sim-replay',
        dryRun: false,
        items: mutationItems,
      },
    )) as QuarantineMutationResponse;
    expect(replayRes.report.every((r) => r.status === 'already_quarantined')).toBe(true);

    const directStudyPost = (await asOwner.query(
      makeFunctionReference<'query'>('research:getStudyRecord'),
      { experimentId: seeded.expId },
    )) as StudyRecordResponse;
    expect(directStudyPost.remediationState).toBe('QUARANTINED_LEDGER_COMPLETE');
    expect(directStudyPost.experiment.invalidatedByQuarantine).toBe(true);
  });
});
