'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  EpistemicStatus,
  GraphEdgeView,
  GraphNodeView,
  MacroGraphDataset,
  MacroRelationship,
} from '../lib/graph/contracts';
import { reconstructGraphRelationshipsAtDate } from '../lib/graph/identity-governance';
import { generateBoundedGraphTldr } from '../lib/graph/tldr-generator';
import type { BenchmarkComparisonReport } from '../lib/graph/benchmark-evaluator';

export type DataRoomViewKey =
  | 'executive_overview'
  | 'sector_intelligence'
  | 'relationship_explorer'
  | 'risk_pathways'
  | 'evidence_room';

export type TemporalBasis = 'receipt' | 'publication';

export interface MacroDataRoomProps {
  dataset: MacroGraphDataset;
  benchmark: BenchmarkComparisonReport;
  liveTypeDbStatus: {
    reachable: boolean;
    version: string | null;
  };
}

const AS_OF_PRESETS = [
  {
    label: '2026-11-05 — Full Receipt State (Active v2)',
    asOfMs: 1793900000000,
  },
  {
    label: '2026-09-25 — Pre-Cancellation State (Loughton v1 Announced)',
    asOfMs: 1790380800000,
  },
];

function formatUsdPrincipal(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) {
    return 'Undisclosed (Null Preserved)';
  }
  const ccy = currency ?? 'USD';
  if (amount >= 1_000_000_000) {
    return `${ccy} ${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `${ccy} ${(amount / 1_000_000).toFixed(0)}M`;
  }
  return `${ccy} ${amount.toLocaleString()}`;
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function MacroDataRoom({
  dataset,
  benchmark,
  liveTypeDbStatus,
}: MacroDataRoomProps) {
  const [activeView, setActiveView] = useState<DataRoomViewKey>('executive_overview');
  const [asOfMs, setAsOfMs] = useState<number>(1793900000000);
  const [temporalBasis, setTemporalBasis] = useState<TemporalBasis>('receipt');
  const [includeSuperseded, setIncludeSuperseded] = useState<boolean>(false);
  const [focalId, setFocalId] = useState<string>('org-nscale');
  const [maxDepth, setMaxDepth] = useState<1 | 2>(2);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string>(
    'rel-loughton-msft-r2',
  );
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  // Close mobile drawer on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const entityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of dataset.organisations) map.set(o.orgId, o.displayName);
    for (const s of dataset.sectors) map.set(s.sectorId, s.sectorName);
    for (const p of dataset.projects) map.set(p.projectId, p.projectName);
    for (const a of dataset.energyAssets) map.set(a.assetId, a.assetName);
    for (const i of dataset.instruments) map.set(i.instrumentId, i.instrumentType);
    for (const l of dataset.locations) map.set(l.locationId, l.locationName);
    return map;
  }, [dataset]);

  const sourcesById = useMemo(
    () => new Map(dataset.sources.map((s) => [s.sourceDocId, s])),
    [dataset.sources],
  );

  // Reconstruct point-in-time relationships
  const temporalSlice = useMemo(
    () =>
      reconstructGraphRelationshipsAtDate(dataset.relationships, asOfMs, {
        basis: temporalBasis,
        includeSuperseded,
        includeConflicting: true,
      }),
    [dataset.relationships, asOfMs, temporalBasis, includeSuperseded],
  );

  const conflictGroups = useMemo(() => {
    const groups = new Map<string, MacroRelationship[]>();
    for (const rel of temporalSlice.activeRelationships) {
      if (rel.conflictGroupId) {
        const list = groups.get(rel.conflictGroupId) ?? [];
        list.push(rel);
        groups.set(rel.conflictGroupId, list);
      }
    }
    return [...groups.entries()].map(([conflictGroupId, assertions]) => ({
      conflictGroupId,
      logicalEventId: assertions[0]?.logicalEventId ?? conflictGroupId,
      assertions,
    }));
  }, [temporalSlice.activeRelationships]);

  // Filtered relationships for Relationship Explorer progressive disclosure
  const explorerRelationships = useMemo(() => {
    const hop1 = temporalSlice.activeRelationships.filter((r) =>
      r.participants.some((p) => p.entityId === focalId),
    );
    if (maxDepth === 1) return hop1;

    const hop1Entities = new Set<string>([focalId]);
    for (const r of hop1) {
      for (const p of r.participants) hop1Entities.add(p.entityId);
    }
    return temporalSlice.activeRelationships.filter((r) =>
      r.participants.some((p) => hop1Entities.has(p.entityId)),
    );
  }, [temporalSlice.activeRelationships, focalId, maxDepth]);

  const toEdgeView = (rel: MacroRelationship): GraphEdgeView => ({
    relationshipId: rel.relationshipId,
    relationType: rel.relationType,
    logicalEventId: rel.logicalEventId,
    version: rel.version,
    supersedesRelationshipId: rel.supersedesRelationshipId,
    supersededByRelationshipId:
      temporalSlice.supersededMap.get(rel.relationshipId) ?? null,
    category: rel.category,
    contractualStatus: rel.contractualStatus,
    epistemicStatus: rel.epistemicStatus,
    reviewerStatus: rel.reviewerStatus,
    conflictGroupId: rel.conflictGroupId,
    principalAmount: rel.principalAmount,
    currencyCode: rel.currencyCode,
    capacityUnit: rel.capacityUnit,
    capacityQuantity: rel.capacityQuantity,
    conditionsSummary: rel.conditionsSummary,
    bindingObligation: rel.bindingObligation,
    effectiveFromMs: rel.effectiveFromMs,
    effectiveToMs: rel.effectiveToMs,
    publishedAtMs: rel.publishedAtMs,
    receivedAtMs: rel.receivedAtMs,
    participants: rel.participants.map((p) => ({
      role: p.role,
      entityId: p.entityId,
      entityKind: p.entityKind,
      label: entityNameById.get(p.entityId) ?? p.entityId,
    })),
    sources: rel.sourceDocIds
      .map((id) => sourcesById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s)),
  });

  const tldr = useMemo(() => {
    const nodes: GraphNodeView[] = [
      ...dataset.organisations.map((o) => ({
        id: o.orgId,
        kind: 'organisation' as const,
        label: o.displayName,
        subtype: o.subtype,
        ticker: o.ticker,
        secCik: o.secCik,
        leiCode: o.leiCode,
        sectorIds: o.sectorIds,
        metadata: { jurisdiction: o.jurisdiction },
      })),
      ...dataset.projects.map((p) => ({
        id: p.projectId,
        kind: 'infrastructure_project' as const,
        label: p.projectName,
        subtype: p.projectType,
        ticker: null,
        secCik: null,
        leiCode: null,
        sectorIds: [],
        metadata: {},
      })),
    ];
    const edgeViews = temporalSlice.activeRelationships.map(toEdgeView);
    return generateBoundedGraphTldr({
      nodes,
      edges: edgeViews,
      observations: dataset.observations,
      conflicts: conflictGroups.map((cg) => ({
        conflictGroupId: cg.conflictGroupId,
        logicalEventId: cg.logicalEventId,
        assertions: cg.assertions.map(toEdgeView),
        resolutionRule:
          'Conflicting claims are preserved side-by-side pending authoritative SEC filing disambiguation.',
      })),
      asOfMs,
      temporalBasis,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    asOfMs,
    temporalBasis,
    temporalSlice.activeRelationships,
    conflictGroups,
    dataset,
  ]);

  const selectedRelationship: MacroRelationship = useMemo(() => {
    const found =
      temporalSlice.activeRelationships.find(
        (r) => r.relationshipId === selectedRelationshipId,
      ) ??
      dataset.relationships.find((r) => r.relationshipId === selectedRelationshipId) ??
      temporalSlice.activeRelationships[0] ??
      dataset.relationships[0]!;
    return found;
  }, [selectedRelationshipId, temporalSlice.activeRelationships, dataset.relationships]);

  const selectRelationshipForDrawer = (relId: string) => {
    setSelectedRelationshipId(relId);
    setMobileDrawerOpen(true);
  };

  const renderEpistemicBadge = (status: EpistemicStatus) => (
    <span className={`dr-epistemic-badge ${status}`} data-testid={`badge-${status}`}>
      {status}
    </span>
  );

  const renderEvidenceDrawerContent = (rel: MacroRelationship) => {
    const linkedSources = rel.sourceDocIds
      .map((id) => sourcesById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const supersededTarget = rel.supersedesRelationshipId
      ? dataset.relationships.find((r) => r.relationshipId === rel.supersedesRelationshipId)
      : null;

    return (
      <div data-testid="evidence-drawer-content">
        <div className="dr-drawer-header">
          <div>
            <span className="eyebrow">IMMUTABLE EVIDENCE DRAWER</span>
            <h3 style={{ margin: '6px 0 4px', fontSize: '15px', color: '#192434' }}>
              {rel.relationshipId} (v{rel.version})
            </h3>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
              {renderEpistemicBadge(rel.epistemicStatus)}
              <span className="tag">{rel.relationType}</span>
              <span className="tag">{rel.contractualStatus}</span>
            </div>
          </div>
          {mobileDrawerOpen && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setMobileDrawerOpen(false)}
              aria-label="Close evidence drawer"
            >
              Close
            </button>
          )}
        </div>

        <p style={{ fontSize: '12px', color: '#2b394a', marginBottom: '12px' }}>
          {rel.conditionsSummary}
        </p>

        <dl className="dr-drawer-meta">
          <div>
            <dt>Principal / Capacity</dt>
            <dd>
              {rel.principalAmount !== null
                ? formatUsdPrincipal(rel.principalAmount, rel.currencyCode)
                : rel.capacityQuantity !== null && rel.capacityUnit !== null
                  ? `${rel.capacityQuantity} ${rel.capacityUnit}`
                  : 'Undisclosed (Null Preserved)'}
            </dd>
          </div>
          <div>
            <dt>Extraction & Review</dt>
            <dd>
              {rel.extractionStatus} · {rel.reviewerStatus}
            </dd>
          </div>
          <div>
            <dt>Published Timestamp</dt>
            <dd>{formatUtcDate(rel.publishedAtMs)}</dd>
          </div>
          <div>
            <dt>Received Timestamp</dt>
            <dd>{formatUtcDate(rel.receivedAtMs)}</dd>
          </div>
          <div>
            <dt>Effective Start → End</dt>
            <dd>
              {formatUtcDate(rel.effectiveFromMs)} →{' '}
              {rel.effectiveToMs ? formatUtcDate(rel.effectiveToMs) : 'Open'}
            </dd>
          </div>
          <div>
            <dt>Execution Authority</dt>
            <dd>none (Read-Only Graph)</dd>
          </div>
        </dl>

        {supersededTarget && (
          <div
            style={{
              background: '#fff8eb',
              border: '1px solid #efd5a2',
              borderRadius: '6px',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '11px',
            }}
          >
            <strong>Non-Destructive Supersession Lineage:</strong> Supersedes{' '}
            <code>{supersededTarget.relationshipId}</code> (v
            {supersededTarget.version}, {supersededTarget.contractualStatus}).{' '}
            <button
              type="button"
              className="text-link"
              onClick={() => setSelectedRelationshipId(supersededTarget.relationshipId)}
            >
              Inspect Superseded v1 Record →
            </button>
          </div>
        )}

        <div style={{ marginBottom: '12px' }}>
          <strong style={{ fontSize: '11px', color: '#516072', display: 'block' }}>
            TYPED ROLE PARTICIPANTS ({rel.participants.length})
          </strong>
          <div className="dr-participants-row">
            {rel.participants.map((p, idx) => (
              <span key={`${p.role}-${p.entityId}-${idx}`} className="dr-participant-chip">
                <b>{p.role}:</b> {entityNameById.get(p.entityId) ?? p.entityId}
              </span>
            ))}
          </div>
        </div>

        <div>
          <strong
            style={{
              fontSize: '11px',
              color: '#516072',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            SUPPORTING PRIMARY & CORROBORATED SOURCES ({linkedSources.length})
          </strong>
          {linkedSources.map((src) => (
            <div key={src.sourceDocId} className="dr-source-item">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                  fontSize: '10px',
                  color: '#6b7786',
                }}
              >
                <span>
                  <b>{src.authority}</b> · {src.kind}
                </span>
                <span>SHA-256: {src.contentSha256.slice(0, 12)}…</span>
              </div>
              <h4>{src.title}</h4>
              <div className="dr-source-snippet">
                Basis: {src.publicationBasis} · Verified immutable source record (
                <code>{src.sourceDocId}</code>)
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '10px',
                  color: '#657383',
                }}
              >
                <span>
                  Pub: {formatUtcDate(src.publishedAtMs)} · Rec:{' '}
                  {formatUtcDate(src.receivedAtMs)}
                </span>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#396b24', fontWeight: 600 }}
                >
                  Source Filing ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="data-room-shell" data-testid="macro-data-room">
      {/* Top Institutional Header */}
      <header className="data-room-topbar">
        <div className="data-room-brand">
          <div>
            <span>AI CAPITAL INTELLIGENCE · MACRO INTELLIGENCE DATA ROOM</span>
            <small>
              TYPEDB 3.14 PERA KNOWLEDGE GRAPH · CONVEX APPEND-ONLY OUTBOX · READ-ONLY
              GATEWAY
            </small>
          </div>
        </div>
        <div className="data-room-status-cluster">
          <span className="dr-pill live" data-testid="typedb-live-pill">
            TypeDB Server:{' '}
            {liveTypeDbStatus.reachable
              ? `LIVE (${liveTypeDbStatus.version})`
              : 'MIRROR FALLBACK'}
          </span>
          <span className="dr-pill">Schema: {dataset.schemaVersion}</span>
          <span className="dr-pill guardrail">
            Execution Authority: NONE (Live & Demo Disabled)
          </span>
          <Link href="/" className="button secondary" style={{ padding: '7px 12px' }}>
            ← Command Centre
          </Link>
        </div>
      </header>

      {/* Sub-navigation & Temporal Time Machine */}
      <nav className="data-room-subnav" aria-label="Macro Data Room Views">
        <div className="dr-view-tabs" role="tablist">
          {(
            [
              ['executive_overview', '1. Executive Overview'],
              ['sector_intelligence', '2. Sector Intelligence'],
              ['relationship_explorer', '3. Relationship Explorer'],
              ['risk_pathways', '4. Risk Pathways'],
              ['evidence_room', '5. Evidence Room'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeView === key}
              data-testid={`tab-${key}`}
              className={`dr-view-tab ${activeView === key ? 'active' : ''}`}
              onClick={() => setActiveView(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="dr-temporal-bar">
          <label htmlFor="as-of-select" style={{ fontWeight: 600 }}>
            Point-in-Time As-Of:
          </label>
          <select
            id="as-of-select"
            data-testid="as-of-select"
            value={asOfMs}
            onChange={(e) => {
              const nextAsOf = Number(e.target.value);
              setAsOfMs(nextAsOf);
              setTemporalBasis(nextAsOf <= 1790380800000 ? 'publication' : 'receipt');
            }}
          >
            {AS_OF_PRESETS.map((preset) => (
              <option key={preset.asOfMs} value={preset.asOfMs}>
                {preset.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            data-testid="toggle-temporal-basis"
            className={temporalBasis === 'receipt' ? 'active' : ''}
            onClick={() =>
              setTemporalBasis((prev) =>
                prev === 'receipt' ? 'publication' : 'receipt',
              )
            }
          >
            Basis: {temporalBasis === 'receipt' ? 'Receipt-Eligible' : 'Publication Date'}
          </button>

          <button
            type="button"
            data-testid="toggle-include-superseded"
            className={includeSuperseded ? 'active' : ''}
            onClick={() => setIncludeSuperseded((prev) => !prev)}
          >
            {includeSuperseded
              ? 'Showing Superseded History'
              : `Hide Superseded (${temporalSlice.supersededHiddenCount})`}
          </button>
        </div>
      </nav>

      {/* Main Two-Column Workspace */}
      <div className="data-room-body">
        <main>
          {/* KPI Strip */}
          <section className="dr-kpi-strip" aria-label="Knowledge Graph Telemetry">
            <div className="dr-kpi-card">
              <small>Canonical Entities</small>
              <strong>
                {dataset.organisations.length +
                  dataset.projects.length +
                  dataset.energyAssets.length +
                  dataset.instruments.length}
              </strong>
              <span>
                {dataset.organisations.length} orgs (CIK/LEI verified) ·{' '}
                {dataset.projects.length} campuses
              </span>
            </div>
            <div className="dr-kpi-card">
              <small>Active Typed Hyperedges</small>
              <strong data-testid="active-edge-count">
                {temporalSlice.activeRelationships.length}
              </strong>
              <span>
                As of {formatUtcDate(asOfMs)} ({temporalBasis} basis)
              </span>
            </div>
            <div className="dr-kpi-card">
              <small>Disclosed Conflicts & Gaps</small>
              <strong>
                {conflictGroups.length} conflict ·{' '}
                {
                  temporalSlice.activeRelationships.filter(
                    (r) => r.principalAmount === null && r.epistemicStatus === 'reported',
                  ).length
                }{' '}
                missing
              </strong>
              <span>Preserved without silent overwrite or invention</span>
            </div>
            <div className="dr-kpi-card">
              <small>Graph vs Document Benchmark</small>
              <strong>
                {(benchmark.metrics.relationshipRetrievalAccuracy.typedbGraph * 100).toFixed(
                  0,
                )}
                % vs{' '}
                {(
                  benchmark.metrics.relationshipRetrievalAccuracy.convexBaseline * 100
                ).toFixed(0)}
                %
              </strong>
              <span>
                {
                  benchmark.metrics.analystWorkflowSteps
                    .estimatedAnalystMinutesSavedPerQuestion
                }
                m saved per multi-hop review
              </span>
            </div>
          </section>

          {/* VIEW 1: EXECUTIVE OVERVIEW (BOUNDED TL;DR) */}
          {activeView === 'executive_overview' && (
            <section className="dr-card" data-testid="view-executive-overview">
              <div className="dr-card-header">
                <div>
                  <span className="eyebrow">BOUNDED GRAPH-BACKED TL;DR GENERATOR</span>
                  <h2>
                    AI Infrastructure, Financing & Counterparty Knowledge Graph Summary
                  </h2>
                  <p>
                    Every statement is strictly derived from verified graph nodes, typed
                    role-players, and immutable source documents as of{' '}
                    {formatUtcDate(asOfMs)}.
                  </p>
                </div>
                {renderEpistemicBadge('confirmed')}
              </div>

              <div className="dr-tldr-grid">
                <div className="dr-tldr-section">
                  <h3>1. What Changed ({tldr.whatChanged.length})</h3>
                  {tldr.whatChanged.map((b, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`dr-bullet-item ${
                        b.relationshipIds.includes(selectedRelationship.relationshipId)
                          ? 'selected'
                          : ''
                      }`}
                      onClick={() =>
                        b.relationshipIds[0] &&
                        selectRelationshipForDrawer(b.relationshipIds[0])
                      }
                    >
                      <div className="dr-bullet-top">
                        {renderEpistemicBadge(b.epistemicStatus)}
                        <span style={{ fontSize: '10px', color: '#6b7786' }}>
                          {b.relationshipIds.join(', ')}
                        </span>
                      </div>
                      <p>{b.text}</p>
                    </button>
                  ))}
                </div>

                <div className="dr-tldr-section">
                  <h3>2. Why It Matters ({tldr.whyItMatters.length})</h3>
                  {tldr.whyItMatters.map((b, i) => (
                    <button
                      key={i}
                      type="button"
                      className="dr-bullet-item"
                      onClick={() =>
                        b.relationshipIds[0] &&
                        selectRelationshipForDrawer(b.relationshipIds[0])
                      }
                    >
                      <div className="dr-bullet-top">
                        {renderEpistemicBadge(b.epistemicStatus)}
                        <span style={{ fontSize: '10px', color: '#6b7786' }}>
                          {b.relationshipIds.join(', ')}
                        </span>
                      </div>
                      <p>{b.text}</p>
                    </button>
                  ))}
                </div>

                <div className="dr-tldr-section">
                  <h3>3. Connected Entities & Sectors</h3>
                  {tldr.connectedEntitiesAndSectors.map((b, i) => (
                    <button
                      key={i}
                      type="button"
                      className="dr-bullet-item"
                      onClick={() =>
                        b.relationshipIds[0] &&
                        selectRelationshipForDrawer(b.relationshipIds[0])
                      }
                    >
                      <div className="dr-bullet-top">
                        {renderEpistemicBadge(b.epistemicStatus)}
                        <span style={{ fontSize: '10px', color: '#6b7786' }}>
                          {b.sourceDocIds.length} source(s)
                        </span>
                      </div>
                      <p>{b.text}</p>
                    </button>
                  ))}
                </div>

                <div className="dr-tldr-section">
                  <h3>4. Uncertainties & Next Information To Collect</h3>
                  {tldr.uncertainties.map((b, i) => (
                    <button
                      key={`u-${i}`}
                      type="button"
                      className="dr-bullet-item"
                      onClick={() =>
                        b.relationshipIds[0] &&
                        selectRelationshipForDrawer(b.relationshipIds[0])
                      }
                    >
                      <div className="dr-bullet-top">
                        {renderEpistemicBadge(b.epistemicStatus)}
                        <span style={{ fontSize: '10px', color: '#6b7786' }}>
                          Uncertainty / Conflict
                        </span>
                      </div>
                      <p>{b.text}</p>
                    </button>
                  ))}
                  {tldr.nextInformationToCollect.map((item, idx) => (
                    <div
                      key={`next-${idx}`}
                      style={{
                        fontSize: '11px',
                        padding: '8px 10px',
                        background: '#eef3f8',
                        borderRadius: '5px',
                        marginTop: '6px',
                        color: '#2d3d50',
                      }}
                    >
                      <b>Next Collection Target:</b> {item.text}
                    </div>
                  ))}
                </div>
              </div>

              <div className="dr-non-causation-banner" data-testid="non-causation-notice">
                <strong>Epistemic & Non-Causation Guardrail:</strong>{' '}
                {tldr.nonCausationNotice}
              </div>
            </section>
          )}

          {/* VIEW 2: SECTOR INTELLIGENCE */}
          {activeView === 'sector_intelligence' && (
            <section className="dr-card" data-testid="view-sector-intelligence">
              <div className="dr-card-header">
                <div>
                  <span className="eyebrow">SECTOR TAXONOMY & INTER-SECTOR EXPOSURE</span>
                  <h2>Sector Intelligence & Macro Transmission Matrix</h2>
                  <p>
                    Tracks how hyperscaler capex, GPU supply, neocloud project debt, and
                    grid interconnection regulations propagate across sectors.
                  </p>
                </div>
              </div>

              <div className="dr-sector-grid">
                {dataset.sectors.map((sec) => {
                  const memberOrgs = dataset.organisations.filter((o) =>
                    o.sectorIds.includes(sec.sectorId),
                  );
                  const memberIds = new Set(memberOrgs.map((o) => o.orgId));
                  const linkedRels = temporalSlice.activeRelationships.filter((r) =>
                    r.participants.some((p) => memberIds.has(p.entityId)),
                  );
                  return (
                    <div key={sec.sectorId} className="dr-tldr-section">
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '6px',
                        }}
                      >
                        <span className="tag">{sec.economicLayer}</span>
                        <span className="tag green">{linkedRels.length} Active Links</span>
                      </div>
                      <h3
                        style={{
                          fontSize: '14px',
                          textTransform: 'none',
                          color: '#192434',
                        }}
                      >
                        {sec.sectorName}
                      </h3>
                      <p
                        style={{
                          fontSize: '11px',
                          color: '#5c6979',
                          margin: '6px 0 10px',
                        }}
                      >
                        Industry Group: {sec.industryGroup}
                      </p>
                      <div className="dr-participants-row" style={{ marginBottom: '10px' }}>
                        {memberOrgs.map((o) => (
                          <span key={o.orgId} className="dr-participant-chip">
                            <b>{o.ticker ?? o.subtype}:</b> {o.displayName}
                          </span>
                        ))}
                      </div>
                      {linkedRels.slice(0, 2).map((rel) => (
                        <button
                          key={rel.relationshipId}
                          type="button"
                          className="dr-bullet-item"
                          onClick={() => selectRelationshipForDrawer(rel.relationshipId)}
                        >
                          <div className="dr-bullet-top">
                            {renderEpistemicBadge(rel.epistemicStatus)}
                            <span style={{ fontSize: '10px', color: '#6b7786' }}>
                              {rel.relationType}
                            </span>
                          </div>
                          <p>{rel.conditionsSummary}</p>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* VIEW 3: RELATIONSHIP EXPLORER (PROGRESSIVE DISCLOSURE) */}
          {activeView === 'relationship_explorer' && (
            <section className="dr-card" data-testid="view-relationship-explorer">
              <div className="dr-card-header">
                <div>
                  <span className="eyebrow">PROGRESSIVE DISCLOSURE GRAPH EXPLORER</span>
                  <h2>Multi-Participant Relationship Explorer</h2>
                  <p>
                    Replaces hairball graphs with bounded 1-hop / 2-hop focal traversal and
                    explicit N-ary role inspection. Click any edge to inspect its primary
                    sources in the Evidence Drawer.
                  </p>
                </div>
              </div>

              <div className="dr-explorer-controls">
                <label
                  htmlFor="focal-entity-select"
                  style={{ fontSize: '11px', fontWeight: 600 }}
                >
                  Focal Entity / Campus:
                </label>
                <select
                  id="focal-entity-select"
                  data-testid="focal-entity-select"
                  value={focalId}
                  onChange={(e) => setFocalId(e.target.value)}
                >
                  <optgroup label="SEC-Reporting & Ecosystem Organisations">
                    {dataset.organisations.map((o) => (
                      <option key={o.orgId} value={o.orgId}>
                        {o.displayName} ({o.ticker ?? o.subtype})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Infrastructure Projects">
                    {dataset.projects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>
                        {p.projectName} ({p.plannedCapacityMw ?? 0} MW)
                      </option>
                    ))}
                  </optgroup>
                </select>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Traversal Depth:</span>
                  <button
                    type="button"
                    data-testid="depth-1-btn"
                    className={`button ${maxDepth === 1 ? 'primary' : 'secondary'}`}
                    style={{ padding: '6px 10px' }}
                    onClick={() => setMaxDepth(1)}
                  >
                    1-Hop Direct
                  </button>
                  <button
                    type="button"
                    data-testid="depth-2-btn"
                    className={`button ${maxDepth === 2 ? 'primary' : 'secondary'}`}
                    style={{ padding: '6px 10px' }}
                    onClick={() => setMaxDepth(2)}
                  >
                    2-Hop Network
                  </button>
                </div>
              </div>

              <div className="dr-rel-list">
                {explorerRelationships.map((rel) => (
                  <button
                    key={rel.relationshipId}
                    type="button"
                    data-testid={`rel-card-${rel.relationshipId}`}
                    className={`dr-rel-card ${
                      selectedRelationship.relationshipId === rel.relationshipId
                        ? 'selected'
                        : ''
                    }`}
                    onClick={() => selectRelationshipForDrawer(rel.relationshipId)}
                  >
                    <div className="dr-rel-card-top">
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        {renderEpistemicBadge(rel.epistemicStatus)}
                        <strong style={{ fontSize: '13px', color: '#192434' }}>
                          {rel.relationshipId} (v{rel.version})
                        </strong>
                        <span className="tag">{rel.relationType}</span>
                        <span className="tag">{rel.contractualStatus}</span>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#2b4a2f' }}>
                        {formatUsdPrincipal(rel.principalAmount, rel.currencyCode)}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#2e3c4e', margin: '4px 0' }}>
                      {rel.conditionsSummary}
                    </p>
                    <div className="dr-participants-row">
                      {rel.participants.map((p, idx) => (
                        <span
                          key={`${p.role}-${p.entityId}-${idx}`}
                          className="dr-participant-chip"
                        >
                          <b>{p.role}:</b> {entityNameById.get(p.entityId) ?? p.entityId}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* VIEW 4: RISK PATHWAYS & HYPOTHETICAL SCENARIOS */}
          {activeView === 'risk_pathways' && (
            <section className="dr-card" data-testid="view-risk-pathways">
              <div className="dr-card-header">
                <div>
                  <span className="eyebrow">
                    COUNTERPARTY CONCENTRATION & STRESS PATHWAYS
                  </span>
                  <h2>2-Hop Dependency Chains & Hypothetical Risk Pathways</h2>
                  <p>
                    Separates confirmed/reported multi-hop dependencies from explicitly
                    tagged hypothetical stress scenarios.
                  </p>
                </div>
                {renderEpistemicBadge('hypothetical')}
              </div>

              <div className="dr-tldr-grid" style={{ marginBottom: '16px' }}>
                <div className="dr-tldr-section">
                  <div className="dr-bullet-top" style={{ marginBottom: '8px' }}>
                    {renderEpistemicBadge('hypothetical')}
                    <span className="tag amber">Stress Pathway A</span>
                  </div>
                  <h3 style={{ textTransform: 'none', fontSize: '13px', color: '#192434' }}>
                    Hypothetical Scenario: Monarch West Virginia Credit Facility Unresolved
                  </h3>
                  <p style={{ fontSize: '12px', color: '#344356' }}>
                    If Nscale’s reported private-credit discussions (
                    <code>rel-monarch-credit-talks-r1</code>, principal undisclosed) do not
                    reach binding financial close, Nscale’s 600 MW Monarch campus buildout
                    schedule faces liquidity compression alongside its{' '}
                    <b>USD 1.4B Delayed-Draw Term Loan</b> (<code>inst-nscale-ddtl-1400m</code>
                    ) and <b>USD 865M NVIDIA Convertible Note</b>.
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ marginTop: '8px' }}
                    onClick={() =>
                      selectRelationshipForDrawer('rel-monarch-credit-talks-r1')
                    }
                  >
                    Inspect Reported Monarch Credit Evidence →
                  </button>
                </div>

                <div className="dr-tldr-section">
                  <div className="dr-bullet-top" style={{ marginBottom: '8px' }}>
                    {renderEpistemicBadge('hypothetical')}
                    <span className="tag amber">Stress Pathway B</span>
                  </div>
                  <h3 style={{ textTransform: 'none', fontSize: '13px', color: '#192434' }}>
                    Hypothetical Scenario: Grid Energisation & NY EO 62 Moratorium Spillover
                  </h3>
                  <p style={{ fontSize: '12px', color: '#344356' }}>
                    2-hop physical infrastructure path: CoreWeave (<code>org-crwv</code>) →
                    Applied Digital Polaris Forge 1 (<code>proj-polaris-forge-1-nd</code>) →
                    Ellendale 400 MW Substation (<code>asset-ellendale-substation</code>),
                    while TeraWulf’s Cayuga campus (<code>proj-cayuga-ny</code>) faces New
                    York Executive Order 62’s 120-day grid cost-allocation review (≥20 MW).
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ marginTop: '8px' }}
                    onClick={() => selectRelationshipForDrawer('rel-cayuga-ny-eo62-r1')}
                  >
                    Inspect NY EO 62 Regulatory Dependency →
                  </button>
                </div>
              </div>

              <div className="dr-tldr-section">
                <h3>Shared Counterparty Exposure (NVIDIA & Nscale Multi-Role Hub)</h3>
                <p style={{ fontSize: '12px', color: '#3c4b5e', marginBottom: '10px' }}>
                  NVIDIA (<code>org-nvda</code>) simultaneously acts as <b>GPU Supplier</b>,{' '}
                  <b>Convertible Note Financier (USD 865M)</b>, and{' '}
                  <b>Lease Backstop Guarantor (USD 410M)</b> across Nscale’s campuses — a
                  circular vendor-financing topology captured natively via TypeDB N-ary
                  relations.
                </p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      selectRelationshipForDrawer('rel-nscale-nvda-convertible-r1')
                    }
                  >
                    Inspect 5-Party Convertible Note
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      selectRelationshipForDrawer('rel-ward-county-guarantee-r1')
                    }
                  >
                    Inspect 4-Party Ward County Guarantee
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => selectRelationshipForDrawer('rel-monarch-gpu-supply-r1')}
                  >
                    Inspect Monarch GPU Supply
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* VIEW 5: EVIDENCE ROOM & BENCHMARK SCORECARD */}
          {activeView === 'evidence_room' && (
            <section className="dr-card" data-testid="view-evidence-room">
              <div className="dr-card-header">
                <div>
                  <span className="eyebrow">
                    PRIMARY FILINGS · CONFLICT REGISTER · GRAPH BENCHMARK
                  </span>
                  <h2>Immutable Evidence Room & Quantitative Graph Evaluation</h2>
                  <p>
                    Displays side-by-side conflicting disclosures, primary SEC filings, and
                    the quantitative TypeDB 3.14 vs Convex-only benchmark.
                  </p>
                </div>
              </div>

              {/* Conflict Register */}
              <div className="dr-tldr-section" style={{ marginBottom: '16px' }}>
                <h3>
                  Disclosed Conflict Register ({conflictGroups.length} Active Conflict
                  Group)
                </h3>
                {conflictGroups.map((conflict) => (
                  <div
                    key={conflict.conflictGroupId}
                    data-testid={`conflict-${conflict.conflictGroupId}`}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e5c79b',
                      borderRadius: '6px',
                      padding: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}
                    >
                      <strong>Conflict Group: {conflict.conflictGroupId}</strong>
                      <span className="tag amber">Conflicting Claims Preserved</span>
                    </div>
                    <div className="dr-tldr-grid">
                      {conflict.assertions.map((assertion) => (
                        <button
                          key={assertion.relationshipId}
                          type="button"
                          className="dr-bullet-item"
                          onClick={() =>
                            selectRelationshipForDrawer(assertion.relationshipId)
                          }
                        >
                          <div className="dr-bullet-top">
                            {renderEpistemicBadge(assertion.epistemicStatus)}
                            <span className="tag">{assertion.reviewerStatus}</span>
                          </div>
                          <p>
                            <b>{assertion.relationshipId}:</b> {assertion.conditionsSummary}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quantitative Benchmark Table */}
              <div className="dr-tldr-section">
                <h3>TypeDB 3.14 Knowledge Graph vs Convex-Only Document Benchmark</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>EVALUATION DIMENSION</th>
                        <th>CONVEX-ONLY BASELINE</th>
                        <th>TYPEDB 3.14 GRAPH</th>
                        <th>ENGINEERING FINDING</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Relationship Retrieval Accuracy</td>
                        <td>
                          {(
                            benchmark.metrics.relationshipRetrievalAccuracy.convexBaseline *
                            100
                          ).toFixed(0)}
                          %
                        </td>
                        <td>
                          <b>
                            {(
                              benchmark.metrics.relationshipRetrievalAccuracy.typedbGraph *
                              100
                            ).toFixed(0)}
                            %
                          </b>
                        </td>
                        <td>Resolves N-ary (&gt;2 party) hyperedges &amp; 2-hop paths</td>
                      </tr>
                      <tr>
                        <td>Evidence & Provenance Completeness</td>
                        <td>
                          {(benchmark.metrics.evidenceCompleteness.convexBaseline * 100).toFixed(
                            0,
                          )}
                          %
                        </td>
                        <td>
                          <b>
                            {(
                              benchmark.metrics.evidenceCompleteness.typedbGraph * 100
                            ).toFixed(0)}
                            %
                          </b>
                        </td>
                        <td>Every hyperedge bound to SHA-256 source documents</td>
                      </tr>
                      <tr>
                        <td>Temporal Point-in-Time Correctness</td>
                        <td>
                          {(benchmark.metrics.temporalCorrectness.convexBaseline * 100).toFixed(
                            0,
                          )}
                          %
                        </td>
                        <td>
                          <b>
                            {(
                              benchmark.metrics.temporalCorrectness.typedbGraph * 100
                            ).toFixed(0)}
                            %
                          </b>
                        </td>
                        <td>Non-destructive supersession + dual-clock eligibility</td>
                      </tr>
                      <tr>
                        <td>Query Latency (p50)</td>
                        <td>
                          {benchmark.metrics.queryLatencyMs.convexBaselineManualJoinMs}ms
                        </td>
                        <td>
                          <b>{benchmark.metrics.queryLatencyMs.typedbGraphP50Ms}ms</b>
                        </td>
                        <td>Single bounded traversal vs multi-table client joins</td>
                      </tr>
                      <tr>
                        <td>Analyst Workflow Efficiency</td>
                        <td>
                          {benchmark.metrics.analystWorkflowSteps.convexBaselineTableReads}{' '}
                          table reads
                        </td>
                        <td>
                          <b>
                            {benchmark.metrics.analystWorkflowSteps.typedbGraphQueries} query
                          </b>
                        </td>
                        <td>
                          {
                            benchmark.metrics.analystWorkflowSteps
                              .estimatedAnalystMinutesSavedPerQuestion
                          }{' '}
                          mins saved per review
                        </td>
                      </tr>
                      <tr>
                        <td>False-Positive Relationship Rate</td>
                        <td>
                          {(
                            benchmark.metrics.falsePositiveRelationshipRate
                              .untypedKeywordJoinBaseline * 100
                          ).toFixed(0)}
                          %
                        </td>
                        <td>
                          <b>
                            {(
                              benchmark.metrics.falsePositiveRelationshipRate.typedbGraph *
                              100
                            ).toFixed(0)}
                            %
                          </b>
                        </td>
                        <td>CIK/LEI & primary source gate</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </main>

        {/* Persistent Right-Hand Evidence Drawer on Desktop */}
        <aside
          className="dr-evidence-drawer desktop-only"
          aria-label="Relationship Evidence Drawer"
          data-testid="desktop-evidence-drawer"
        >
          {renderEvidenceDrawerContent(selectedRelationship)}
        </aside>
      </div>

      {/* Accessible Full-Screen Drawer on Mobile */}
      {mobileDrawerOpen && (
        <div
          className="dr-mobile-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Relationship Evidence Drawer"
          data-testid="mobile-evidence-drawer"
        >
          <div className="dr-mobile-drawer-sheet">
            {renderEvidenceDrawerContent(selectedRelationship)}
          </div>
        </div>
      )}
    </div>
  );
}
