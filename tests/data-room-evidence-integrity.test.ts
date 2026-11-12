import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import MacroDataRoom from '../components/macro-data-room';
import { runGraphVsConvexBenchmark, type BenchmarkComparisonReport } from '../lib/graph/benchmark-evaluator';
import type { MacroGraphDataset } from '../lib/graph/contracts';
import { loadInitialAcceptanceDataset } from '../lib/graph/query-gateway';

describe('Data Room Evidence Integrity & Provenance Corrections (1–5)', () => {
  let dataset: MacroGraphDataset;
  let benchmark: BenchmarkComparisonReport;

  beforeAll(async () => {
    dataset = loadInitialAcceptanceDataset();
    benchmark = await runGraphVsConvexBenchmark(dataset);
  });

  it('Correction 1: Evidence drawer never substitutes another relationship’s evidence when selection is unmatched or excluded by historical cutoff', () => {
    // 1A. Unmatched relationship ID renders explicit no-relationship alert and zero substituted sources
    const unmatchedHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'executive_overview',
        initialSelectedRelationshipId: 'rel-nonexistent-id-999',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );

    expect(unmatchedHtml).toContain('data-testid="drawer-no-relationship-notice"');
    expect(unmatchedHtml).toContain('rel-nonexistent-id-999');
    expect(unmatchedHtml).toContain('never substituted');
    expect(unmatchedHtml).not.toContain('data-testid="drawer-source-');

    // 1B. Relationship excluded by historical cutoff (e.g., Anthropic S-1/A published 2026-11-02 viewed at 2026-07-31 cutoff)
    // renders explicit temporal exclusion notice, withholds post-cutoff sources, and never substitutes another relationship
    const excludedAtCutoffHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'executive_overview',
        initialAsOfMs: 1785542399000, // 2026-07-31
        initialTemporalBasis: 'publication',
        initialSelectedRelationshipId: 'rel-anthropic-s1a-amzn-compute-r1',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );

    expect(excludedAtCutoffHtml).toContain('data-testid="drawer-temporal-exclusion-notice"');
    expect(excludedAtCutoffHtml).toContain('Excluded by Active Historical Cutoff');
    expect(excludedAtCutoffHtml).toContain('rel-anthropic-s1a-amzn-compute-r1 (v1)');
    expect(excludedAtCutoffHtml).toContain('data-testid="drawer-sources-withheld-by-cutoff"');
    expect(excludedAtCutoffHtml).toContain('another relationship&#x27;s evidence is never substituted');
    // Post-cutoff source card is not rendered as active evidence
    expect(excludedAtCutoffHtml).not.toContain('data-testid="drawer-source-anthropic-s1a-2026-11-02"');
    // Pre-cutoff sources from other relationships are never substituted
    expect(excludedAtCutoffHtml).not.toContain('data-testid="drawer-source-ny-eo62"');

    // 1C. Active relationship in slice renders only its own linked source document
    const activeRelHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'executive_overview',
        initialAsOfMs: 1794146400000, // 2026-11-08
        initialTemporalBasis: 'receipt',
        initialSelectedRelationshipId: 'rel-ward-county-guarantee-r1',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );

    expect(activeRelHtml).not.toContain('data-testid="drawer-temporal-exclusion-notice"');
    expect(activeRelHtml).toContain('rel-ward-county-guarantee-r1 (v1)');
    expect(activeRelHtml).toContain('data-testid="drawer-source-nscale-s1-sep18"');
    expect(activeRelHtml).not.toContain('data-testid="drawer-source-anthropic-s1a-2026-11-02"');
  });

  it('Correction 2: Removes unsupported financial claims, non-existent relationship IDs, and broken external links', () => {
    const riskPathwaysHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'risk_pathways',
        initialSelectedRelationshipId: 'rel-nscale-nvda-convertible-r1',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );

    // Fabricated / mismatched claims and non-existent IDs must be absent
    expect(riskPathwaysHtml).not.toContain('inst-nscale-ddtl-1400m');
    expect(riskPathwaysHtml).not.toContain('Delayed-Draw Term Loan');
    expect(riskPathwaysHtml).not.toContain('USD 865M');
    expect(riskPathwaysHtml).not.toContain('USD 410M');
    expect(riskPathwaysHtml).not.toContain('proj-cayuga-ny');
    expect(riskPathwaysHtml).not.toContain('rel-cayuga-ny-eo62-r1');
    expect(riskPathwaysHtml).not.toContain('rel-monarch-gpu-supply-r1');

    // Dataset-backed figures and relationship IDs are present
    expect(riskPathwaysHtml).toContain('USD 44.60B Monarch compute service cap');
    expect(riskPathwaysHtml).toContain('USD 1.00B NVIDIA Convertible Note');
    expect(riskPathwaysHtml).toContain('Convertible Note Financier (USD 1.00B)');
    expect(riskPathwaysHtml).toContain('Lease Backstop Guarantor (USD 860M / $860.3M)');
    expect(riskPathwaysHtml).toContain('proj-lake-mariner-ny');
    expect(riskPathwaysHtml).toContain('rel-wulf-ny-eo62-dep');
    expect(riskPathwaysHtml).toContain('rel-nvda-nscale-gpu-arch');

    // Static demonstration banner & honest source fixture references (no broken external anchor links in drawer)
    expect(riskPathwaysHtml).toContain('data-testid="static-demo-dataset-banner"');
    expect(riskPathwaysHtml).toContain('Static Demonstration &amp; Synthetic Stress-Test Dataset Notice');
    expect(riskPathwaysHtml).toContain('Static demonstration source fixture');
    expect(riskPathwaysHtml).toContain('data-testid="drawer-source-reference-nscale-s1-sep18"');
    expect(riskPathwaysHtml).not.toContain('Verified immutable source record');
    expect(riskPathwaysHtml).not.toContain('Source Filing ↗');
  });

  it('Correction 3: Separates TypeDB connectivity, static dataset, live retrieval, validation, and audit status across all views', () => {
    const execHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'executive_overview',
        liveTypeDbStatus: {
          reachable: true,
          version: '3.14.2',
          databaseName: 'aci_macro_intelligence_staging',
          tlsEnabled: true,
        },
      }),
    );

    // 5-pill provenance status cluster
    expect(execHtml).toContain('data-testid="data-room-provenance-bar"');
    expect(execHtml).toContain('1. TypeDB server probe: REACHABLE (3.14.2)');
    expect(execHtml).toContain(
      '2. Displayed dataset: static repository demonstration fixture (not a live TypeDB read)',
    );
    expect(execHtml).toContain(
      '3. Live TypeDB retrieval: inactive on Data Room views (rendered from static mirror)',
    );
    expect(execHtml).toContain(
      '4. Validation: deterministic local schema &amp; non-double-counting checks',
    );
    expect(execHtml).toContain(
      `5. Audit &amp; outbox status: ${dataset.relationships.length} bundled static relationships (browser-local demo state; not persisted to Convex)`,
    );

    // Misleading lower-page headings are replaced in Executive Overview, Evidence Room, and Evidence Chat
    expect(execHtml).toContain('STATIC DEMONSTRATION CASE DOSSIER (BUNDLED FIXTURE)');
    expect(execHtml).toContain('5 Pre-Computed Graph Investigation Summaries (Static Demonstration Dataset)');
    expect(execHtml).not.toContain('HOSTED TYPEDB CLOUD DOSSIER');
    expect(execHtml).not.toContain('5 Approved TypeDB Cloud Graph Investigations (Live');

    const evidenceRoomHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'evidence_room',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );
    expect(evidenceRoomHtml).toContain(
      'Stage 4 &amp; 5 Outbox &amp; Projection Simulator (Browser-Local Demonstration on Static Dataset)',
    );
    expect(evidenceRoomHtml).not.toContain(
      'Convex Append-Only Graph Outbox &amp; Hosted TypeDB Cloud Sync',
    );

    const chatHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'evidence_chat',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );
    expect(chatHtml).toContain(
      'bundled static repository mirror by default; live TypeDB',
    );
    expect(chatHtml).not.toContain(
      'retrieved from TypeDB Cloud (<code>aci_macro_intelligence_prod</code>) and Convex',
    );
  });

  it('Correction 4: Identifies all browser-only approval and replay controls as demonstrations and removes fake Clerk reviewer identity', () => {
    const evidenceRoomHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'evidence_room',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );

    expect(evidenceRoomHtml).toContain('data-testid="demo-review-controls-notice"');
    expect(evidenceRoomHtml).toContain('Browser-Only Demo Control — Local State Only');
    expect(evidenceRoomHtml).toContain('demo:browser_local_reviewer');
    expect(evidenceRoomHtml).toContain('Demo: Approve in Browser State');
    expect(evidenceRoomHtml).toContain('Demo: Reject in Browser State');
    expect(evidenceRoomHtml).toContain('Demo: Simulate Outbox Dead-Letter (Local State)');
    expect(evidenceRoomHtml).toContain('Demo: Replay Outbox in Browser State');

    const sourceCode = fs.readFileSync(
      path.join(process.cwd(), 'components', 'macro-data-room.tsx'),
      'utf8',
    );
    expect(sourceCode).not.toContain('https://clerk.capital.aiguides.co.uk|reviewer_human');
  });

  it('Correction 5: Identifies all synthetic Human Review allocations and outbox entries as synthetic fixture examples', () => {
    const evidenceRoomHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset,
        benchmark,
        initialView: 'evidence_room',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );

    expect(evidenceRoomHtml).toContain('data-testid="drawer-synthetic-review-status"');
    expect(evidenceRoomHtml).toContain('(Synthetic Fixture Example)');
    expect(evidenceRoomHtml).toContain('data-testid="synthetic-human-review-notice"');
    expect(evidenceRoomHtml).toContain('Synthetic Example — Static Dataset Fixture');
    expect(evidenceRoomHtml).toContain('approved (Synthetic Fixture)');
    expect(evidenceRoomHtml).toContain('projected (demo)');
  });
});
