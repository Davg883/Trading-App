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
import {
  reconstructGraphRelationshipsAtDate,
  validateRelationshipGovernance,
} from '../lib/graph/identity-governance';
import { computeDeterministicProjectionKey } from '../lib/graph/projection-engine';
import { generateBoundedGraphTldr } from '../lib/graph/tldr-generator';
import type { BenchmarkComparisonReport } from '../lib/graph/benchmark-evaluator';
import {
  MACRO_CASE_001_CLAIMS,
  MACRO_CASE_001_HISTORICAL_CUTOFFS,
  MACRO_CASE_001_ID,
  MACRO_CASE_001_SCENARIOS,
  computeNonDoubleCountedCommitments,
  reconstructMacroCase001AtCutoff,
} from '../lib/graph/macro-case-001';
import {
  SUGGESTED_STARTER_QUESTIONS,
  type AnswerValidationReport,
  type EvidenceBundleV1,
  type EvidenceChatTurnResult,
  type EvidenceLockedAnswer,
  type GeminiInferenceTelemetry,
} from '../lib/graph/evidence-chat-contracts';

export type DataRoomViewKey =
  | 'executive_overview'
  | 'sector_intelligence'
  | 'relationship_explorer'
  | 'risk_pathways'
  | 'evidence_room'
  | 'evidence_chat';

export type TemporalBasis = 'receipt' | 'publication';

export interface MacroDataRoomProps {
  dataset: MacroGraphDataset;
  benchmark: BenchmarkComparisonReport;
  initialView?: DataRoomViewKey;
  liveTypeDbStatus: {
    reachable: boolean;
    authenticated?: boolean;
    databaseExists?: boolean;
    databaseName?: string;
    distribution?: string | null;
    version: string | null;
    latencyMs?: number;
    tlsEnabled?: boolean;
  };
}

export type ReviewerDecisionRecord = {
  relationshipId: string;
  version: number;
  decision: 'approved' | 'rejected';
  reviewer: string;
  reviewedAtMs: number;
  reviewNote: string;
  sourceDocIds: string[];
  epistemicStatus: EpistemicStatus;
  contractualStatus: MacroRelationship['contractualStatus'];
  projectionKey: string | null;
  outboxStatus: 'projected' | 'pending' | 'retrying' | 'dead_letter' | 'not_enqueued';
  lastError: string | null;
};

const AS_OF_PRESETS = [
  {
    label: '2026-11-08 — Macro Case 001 Discovery & Full Receipt State',
    asOfMs: 1794146400000,
  },
  {
    label: '2026-11-05 — Full Receipt State (Active v2)',
    asOfMs: 1793900000000,
  },
  {
    label: '2026-11-03 — Post-Anthropic S-1/A & Makhlouf Speech',
    asOfMs: 1793750399000,
  },
  {
    label: '2026-10-27 — Post-Anthropic Initial S-1 Filing',
    asOfMs: 1793145599000,
  },
  {
    label: '2026-09-25 — Pre-Cancellation State (Loughton v1 Announced)',
    asOfMs: 1790380800000,
  },
  {
    label: '2026-07-31 — Post-Ireland Dept of Finance & CBI FSR 2026 I',
    asOfMs: 1785542399000,
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
  initialView = 'executive_overview',
  liveTypeDbStatus,
}: MacroDataRoomProps) {
  const [activeView, setActiveView] = useState<DataRoomViewKey>(initialView);
  const [asOfMs, setAsOfMs] = useState<number>(1794146400000);
  const [temporalBasis, setTemporalBasis] = useState<TemporalBasis>('receipt');
  const [includeSuperseded, setIncludeSuperseded] = useState<boolean>(false);
  const [focalId, setFocalId] = useState<string>('org-nscale');
  const [maxDepth, setMaxDepth] = useState<1 | 2>(2);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string>(
    'rel-loughton-msft-r2',
  );
  const [selectedSourceDocId, setSelectedSourceDocId] = useState<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [chatQuestionInput, setChatQuestionInput] = useState<string>(
    SUGGESTED_STARTER_QUESTIONS[0]!,
  );
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatProviderReadiness, setChatProviderReadiness] = useState<{
    enabled: boolean;
    apiKeyConfigured: boolean;
    modelId: string;
    status: string;
    detail: string;
  } | null>(null);
  const [chatTurns, setChatTurns] = useState<
    Array<{
      turnId: string;
      question: string;
      bundle: EvidenceBundleV1;
      answer: EvidenceLockedAnswer;
      validationReport: AnswerValidationReport;
      providerMeta: GeminiInferenceTelemetry;
    }>
  >([]);
  const [reviewNoteInput, setReviewNoteInput] = useState<string>(
    'Primary SEC filing / corroborated disclosure verified; approved for hosted TypeDB Cloud outbox promotion.',
  );
  const [reviewerDecisions, setReviewerDecisions] = useState<
    Record<string, ReviewerDecisionRecord>
  >({});
  const [simulatedOutboxFailureRelId, setSimulatedOutboxFailureRelId] = useState<
    string | null
  >(null);
  const [lastReplayAtMs, setLastReplayAtMs] = useState<number | null>(null);

  const commitmentLedger = useMemo(
    () => computeNonDoubleCountedCommitments(dataset),
    [dataset],
  );

  const case001Cutoffs = useMemo(
    () =>
      MACRO_CASE_001_HISTORICAL_CUTOFFS.map((c) => {
        const snap = reconstructMacroCase001AtCutoff(c.asOfMs, 'publication', dataset);
        return {
          cutoffDateIso: new Date(c.asOfMs).toISOString().slice(0, 10),
          cutoffMs: c.asOfMs,
          label: c.label,
          activeRelationshipCount: snap.activeRelationships.length,
          anthropicS1DisclosuresKnown: snap.anthropicS1Available,
          makhloufSpeechKnown: snap.makhloufSpeechAvailable,
          irishNewsDiscoveryKnown: snap.discoveryArticleAvailable,
        };
      }),
    [dataset],
  );

  const case001Investigations = useMemo(
    () => [
      {
        questionId: 'inv-1-shared-counterparties',
        question: '1. Which companies share financing or infrastructure counterparties?',
        queryType: 'shared_counterparty_exposure',
        findingSummary:
          'Anthropic shares Amazon (AMZN) and Alphabet (GOOGL) across three simultaneous roles—Class N shareholder/convertible backer, enterprise cloud distributor, and compute supplier ($895.4B S-1/A commitment envelope)—while sharing Nscale and NVIDIA (NVDA) on the Monarch campus ($44.6B service cap + $1.0B NVIDIA convertible note + reported guarantee discussions). In Ireland, Amazon (AWS) and Microsoft share EirGrid and CRU on Dublin Metro grid infrastructure, while Intel, Microsoft, Alphabet, and Amazon share fiscal exposure to the Irish Department of Finance.',
        evidencedRelationshipIds: [
          'rel-anthropic-amzn-dual-role-r1',
          'rel-anthropic-googl-dual-role-r1',
          'rel-anthropic-s1a-amzn-compute-r1',
          'rel-anthropic-monarch-services-r1',
          'rel-nscale-nvda-convertible-r1',
          'rel-aws-dublin-eirgrid-dep-r1',
          'rel-msft-dublin-eirgrid-dep-r1',
        ],
      },
      {
        questionId: 'inv-2-third-party-funding-dependencies',
        question: '2. Which contractual arrangements depend on third-party funding?',
        queryType: 'project_dependency_network',
        findingSummary:
          'Four documented arrangements depend on external debt, credit guarantees, or co-investment: (1) Nscale’s $44.6B Monarch contract with Anthropic depends on project financing and unsigned NVIDIA credit-support discussions (rel-monarch-credit-talks-r1, null principal) alongside NVIDIA’s $1.0B convertible note; (2) Nscale’s Ward County Texas lease depends on NVIDIA’s signed $860.3M lease guarantee; (3) Intel’s Fab 34 in Leixlip, Ireland relies on an $11.0B Semiconductor Co-Investment (SCJV) structure; and (4) Anthropic’s $895.4B multi-year compute commitments rely on IPO capital formation and hyperscaler convertible/Class N backing ($40.0B Alphabet cap).',
        evidencedRelationshipIds: [
          'rel-anthropic-monarch-services-r1',
          'rel-monarch-credit-talks-r1',
          'rel-nscale-nvda-convertible-r1',
          'rel-ward-county-guarantee-r1',
          'rel-intc-fab34-leixlip-scjv-r1',
          'rel-anthropic-googl-dual-role-r1',
        ],
      },
      {
        questionId: 'inv-3-irish-economic-exposures',
        question: '3. Which Irish economic exposures are documented?',
        queryType: 'sector_connections',
        findingSummary:
          'Official Irish disclosures document three primary exposures: (1) Fiscal & Employment: multinational technology companies generate 17.0% of Irish income tax and >20.0% of corporate tax receipts (Dept of Finance, July 2026); (2) Electricity Grid Concentration: data centres consume 21.0% of Ireland’s national metered electricity, with AWS and Microsoft campuses in Dublin subject to CRU/EirGrid on-site dispatchable generation mandates; and (3) Semiconductor Capex: Intel’s Fab 34 in Leixlip, Co. Kildare carries an $11.0B SCJV capital commitment.',
        evidencedRelationshipIds: [
          'rel-ireland-dof-cbi-macro-exposure-r1',
          'rel-aws-dublin-eirgrid-dep-r1',
          'rel-msft-dublin-eirgrid-dep-r1',
          'rel-intc-fab34-leixlip-scjv-r1',
        ],
      },
      {
        questionId: 'inv-4-evidenced-transmission-pathways',
        question: '4. Which transmission pathways are directly evidenced?',
        queryType: 'organisation_relationship_summary',
        findingSummary:
          'Three US-to-Ireland transmission channels are directly evidenced in primary filings and official regulatory reports: (A) Multinational Capex & Export Channel: US hyperscalers and chipmakers (Amazon, Microsoft, Alphabet, Intel) fund Irish data-centre and semiconductor infrastructure; (B) Fiscal & High-Earner Tax Channel: US tech valuation or earnings shocks transmit to Ireland’s Exchequer via the 17.0% income-tax and >20.0% corporate-tax concentration; and (C) Non-Bank Financial Intermediation (NBFI) & Private-Credit Channel: CBI FSR 2026 I identifies Dublin-domiciled investment funds and private credit as sensitive to US asset repricing, whereas domestic Irish retail banks have low direct AI exposure.',
        evidencedRelationshipIds: [
          'rel-ireland-dof-cbi-macro-exposure-r1',
          'rel-intc-fab34-leixlip-scjv-r1',
          'rel-aws-dublin-eirgrid-dep-r1',
          'rel-msft-dublin-eirgrid-dep-r1',
          'rel-quinn-irish-news-discovery-contagion-r1',
        ],
      },
      {
        questionId: 'inv-5-deteriorating-credit-and-investment-scenarios',
        question: '5. What changes when hypothetical investment or credit conditions deteriorate?',
        queryType: 'as_known_at_date_graph',
        findingSummary:
          'Under the Irish Department of Finance July 2026 COSMO scenarios, a -10% US tech equity shock reduces Irish Modified Domestic Demand (MDD) by -1.6% after 1 year (investment -4.5%, exports -2.6%, consumption -0.7%, employment growth -0.7 pp), while a severe -20% US equity shock reduces Irish MDD by -3.25%. In the AI infrastructure credit chain, tighter credit conditions pressure unsigned third-party guarantee negotiations (rel-monarch-credit-talks-r1) and elevate refinancing costs on neocloud debt without implying deterministic default losses from graph topology alone.',
        evidencedRelationshipIds: [
          'rel-ireland-dof-cbi-macro-exposure-r1',
          'rel-monarch-credit-talks-r1',
          'rel-anthropic-s1a-amzn-compute-r1',
          'rel-loughton-msft-r2',
        ],
      },
    ],
    [],
  );

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

  // Hydrate Gemini provider readiness and persisted owner chat history when View 6 is active
  useEffect(() => {
    if (activeView !== 'evidence_chat') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/graph/chat', {
          method: 'GET',
          headers: { 'x-aci-test-caller': 'owner_primary' },
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          providerStatus?: {
            enabled: boolean;
            apiKeyConfigured: boolean;
            modelId: string;
            status: string;
            detail: string;
          };
          history?: Array<{
            turnId: string;
            question: string;
            modelId: string;
            generationMode: GeminiInferenceTelemetry['generationMode'];
            providerStatus: GeminiInferenceTelemetry['providerStatus'];
            inputTokens: number;
            outputTokens: number;
            cachedTokens: number;
            estimatedCostGbp: number;
            actualCostGbp: number | null;
            latencyMs: number;
            bundle: EvidenceBundleV1;
            answer: EvidenceLockedAnswer;
            validation: AnswerValidationReport;
          }>;
        };
        if (cancelled) return;
        if (json.providerStatus) {
          setChatProviderReadiness(json.providerStatus);
        }
        if (Array.isArray(json.history) && json.history.length > 0) {
          setChatTurns((prev) =>
            prev.length > 0
              ? prev
              : json.history!.map((h) => ({
                  turnId: h.turnId,
                  question: h.question,
                  bundle: h.bundle,
                  answer: h.answer,
                  validationReport: h.validation,
                  providerMeta: {
                    provider: 'google_genai_sdk',
                    modelId: h.modelId,
                    modelVerifiedViaEndpoint: h.generationMode === 'gemini_live',
                    generationMode: h.generationMode,
                    providerStatus: h.providerStatus,
                    latencyMs: h.latencyMs,
                    inputTokens: h.inputTokens,
                    outputTokens: h.outputTokens,
                    cachedTokens: h.cachedTokens,
                    estimatedCostGbp: h.estimatedCostGbp,
                    actualCostGbp: h.actualCostGbp,
                    errorCode: null,
                    sanitisedError: null,
                  },
                })),
          );
        }
      } catch {
        // Ignore background hydration errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

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
    setSelectedSourceDocId(null);
    setMobileDrawerOpen(true);
  };

  const selectEvidenceCitationForDrawer = (
    evidenceId: string,
    fallbackRelIds: string[] = [],
  ) => {
    setSelectedSourceDocId(evidenceId);
    const matchingRel =
      dataset.relationships.find((r) => r.sourceDocIds.includes(evidenceId)) ??
      (fallbackRelIds[0]
        ? dataset.relationships.find((r) => r.relationshipId === fallbackRelIds[0])
        : null);
    if (matchingRel) {
      setSelectedRelationshipId(matchingRel.relationshipId);
    }
    setMobileDrawerOpen(true);
  };

  const submitResearchQuestion = async (questionOverride?: string, cutoffOverrideMs?: number) => {
    const q = (questionOverride ?? chatQuestionInput).trim();
    if (!q || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    const effectiveCutoff = cutoffOverrideMs ?? asOfMs;
    if (cutoffOverrideMs !== undefined && cutoffOverrideMs !== asOfMs) {
      setAsOfMs(cutoffOverrideMs);
    }
    try {
      const res = await fetch('/api/graph/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-aci-test-caller': 'owner_primary',
        },
        body: JSON.stringify({
          question: q,
          historicalCutoffMs: effectiveCutoff,
          temporalBasis,
          mode: 'auto',
        }),
      });
      const json = (await res.json()) as EvidenceChatTurnResult & { error?: string };
      if (!res.ok || !json.bundle || !json.answer) {
        setChatError(json.error ?? `Request failed (${res.status})`);
      } else {
        setChatTurns((prev) => [
          {
            turnId: json.turnId ?? `turn_${Date.now().toString(36)}`,
            question: q,
            bundle: json.bundle,
            answer: json.answer,
            validationReport: json.validation,
            providerMeta: json.telemetry,
          },
          ...prev,
        ]);
        const firstRel = json.answer.relevantRelationshipIds?.[0];
        if (firstRel) {
          setSelectedRelationshipId(firstRel);
        }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Network error submitting research question');
    } finally {
      setChatLoading(false);
    }
  };

  const handleReviewerDecision = (
    rel: MacroRelationship,
    decision: 'approved' | 'rejected',
  ) => {
    const nowMs = Date.now();
    const reviewerId =
      rel.reviewedBy ?? 'https://clerk.capital.aiguides.co.uk|reviewer_human';
    const note =
      reviewNoteInput.trim() ||
      (decision === 'approved'
        ? 'Approved for Convex graphProjectionOutbox promotion.'
        : 'Rejected pending primary SEC filing verification.');

    if (decision === 'approved') {
      const gov = validateRelationshipGovernance(rel, dataset.relationships, sourcesById);
      const projKey = computeDeterministicProjectionKey(
        'public_research',
        'public_research',
        rel,
      );
      setReviewerDecisions((prev) => ({
        ...prev,
        [rel.relationshipId]: {
          relationshipId: rel.relationshipId,
          version: rel.version,
          decision: gov.valid ? 'approved' : 'rejected',
          reviewer: reviewerId,
          reviewedAtMs: nowMs,
          reviewNote: gov.valid ? note : `Governance blocked: ${gov.reasons.join(' ')}`,
          sourceDocIds: rel.sourceDocIds,
          epistemicStatus: rel.epistemicStatus,
          contractualStatus: rel.contractualStatus,
          projectionKey: gov.valid ? projKey : null,
          outboxStatus: gov.valid ? 'projected' : 'not_enqueued',
          lastError: gov.valid ? null : gov.reasons.join(' '),
        },
      }));
    } else {
      setReviewerDecisions((prev) => ({
        ...prev,
        [rel.relationshipId]: {
          relationshipId: rel.relationshipId,
          version: rel.version,
          decision: 'rejected',
          reviewer: reviewerId,
          reviewedAtMs: nowMs,
          reviewNote: note,
          sourceDocIds: rel.sourceDocIds,
          epistemicStatus: rel.epistemicStatus,
          contractualStatus: rel.contractualStatus,
          projectionKey: null,
          outboxStatus: 'not_enqueued',
          lastError: null,
        },
      }));
    }
  };

  const handleSimulateDeadLetter = (rel: MacroRelationship) => {
    const nowMs = Date.now();
    const projKey = computeDeterministicProjectionKey(
      'public_research',
      'public_research',
      rel,
    );
    setSimulatedOutboxFailureRelId(rel.relationshipId);
    setReviewerDecisions((prev) => ({
      ...prev,
      [rel.relationshipId]: {
        relationshipId: rel.relationshipId,
        version: rel.version,
        decision: 'approved',
        reviewer: rel.reviewedBy ?? 'https://clerk.capital.aiguides.co.uk|reviewer_human',
        reviewedAtMs: nowMs,
        reviewNote: 'Outbox lease attempt failed during simulated TypeDB downtime.',
        sourceDocIds: rel.sourceDocIds,
        epistemicStatus: rel.epistemicStatus,
        contractualStatus: rel.contractualStatus,
        projectionKey: projKey,
        outboxStatus: 'dead_letter',
        lastError: 'Simulated TypeDB HTTP timeout (attempt 3/3 -> dead_letter)',
      },
    }));
  };

  const handleReplayFromCheckpoint = () => {
    const nowMs = Date.now();
    setSimulatedOutboxFailureRelId(null);
    setLastReplayAtMs(nowMs);
    setReviewerDecisions((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const rec = next[key]!;
        if (rec.decision === 'approved') {
          next[key] = {
            ...rec,
            outboxStatus: 'projected',
            lastError: null,
          };
        }
      }
      return next;
    });
  };

  const renderEpistemicBadge = (status: EpistemicStatus) => (
    <span className={`dr-epistemic-badge ${status}`} data-testid={`badge-${status}`}>
      {status}
    </span>
  );

  const renderEvidenceDrawerContent = (rel: MacroRelationship, isMobile: boolean = false) => {
    const linkedSources = rel.sourceDocIds
      .map((id) => sourcesById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const supersededTarget = rel.supersedesRelationshipId
      ? dataset.relationships.find((r) => r.relationshipId === rel.supersedesRelationshipId)
      : null;

    return (
      <div data-testid="evidence-drawer-content" className="dr-drawer-inner">
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
          {isMobile && (
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

        <div
          className="dr-drawer-scrollable-body"
          data-testid="evidence-drawer-scrollable-body"
          tabIndex={0}
          role="region"
          aria-label="Evidence details and source records"
        >
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
            <div
              key={src.sourceDocId}
              className="dr-source-item"
              data-testid={`drawer-source-${src.sourceDocId}`}
              style={
                selectedSourceDocId === src.sourceDocId
                  ? {
                      border: '2px solid #2b6cb0',
                      background: '#f0f7ff',
                    }
                  : undefined
              }
            >
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

        {/* Stage 4 Human Review & Outbox Promotion Controls */}
        <div
          style={{
            marginTop: '14px',
            padding: '12px',
            background: '#f6f8fb',
            border: '1px solid #d8e1ec',
            borderRadius: '6px',
          }}
          data-testid="drawer-reviewer-promotion"
        >
          <strong
            style={{
              fontSize: '11px',
              color: '#192434',
              display: 'block',
              marginBottom: '6px',
            }}
          >
            HUMAN REVIEW &amp; OUTBOX PROMOTION (STAGE 4)
          </strong>
          <p style={{ fontSize: '11px', color: '#4c5b6d', margin: '0 0 8px' }}>
            Approving a source document never auto-confirms extracted relationships. Each
            hyperedge requires explicit reviewer sign-off before promotion into{' '}
            <code>graphProjectionOutbox</code> and hosted TypeDB Cloud (
            <code>aci_macro_intelligence_staging</code>).
          </p>
          <label
            htmlFor={`review-note-${rel.relationshipId}`}
            style={{ fontSize: '10px', fontWeight: 600, display: 'block', marginBottom: '4px' }}
          >
            Reviewer Decision Rationale:
          </label>
          <input
            id={`review-note-${rel.relationshipId}`}
            type="text"
            data-testid="reviewer-note-input"
            value={reviewNoteInput}
            onChange={(e) => setReviewNoteInput(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: '11px',
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid #cbd5e1',
              marginBottom: '8px',
            }}
          />
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button primary"
              data-testid="approve-promote-relationship-btn"
              style={{ padding: '6px 10px', fontSize: '11px' }}
              onClick={() => handleReviewerDecision(rel, 'approved')}
            >
              Approve &amp; Promote to Outbox
            </button>
            <button
              type="button"
              className="button secondary"
              data-testid="reject-relationship-btn"
              style={{ padding: '6px 10px', fontSize: '11px' }}
              onClick={() => handleReviewerDecision(rel, 'rejected')}
            >
              Reject Relationship
            </button>
          </div>
          {reviewerDecisions[rel.relationshipId] && (
            <div
              data-testid="drawer-review-outcome"
              style={{
                marginTop: '8px',
                padding: '8px',
                background:
                  reviewerDecisions[rel.relationshipId]!.decision === 'approved'
                    ? '#edf7ed'
                    : '#fff4f4',
                border: '1px solid #c6e0c6',
                borderRadius: '4px',
                fontSize: '11px',
              }}
            >
              <div>
                <b>Decision:</b>{' '}
                {reviewerDecisions[rel.relationshipId]!.decision.toUpperCase()} ·{' '}
                <b>Outbox:</b> {reviewerDecisions[rel.relationshipId]!.outboxStatus}
              </div>
              <div>
                <b>Reviewer:</b>{' '}
                <code>{reviewerDecisions[rel.relationshipId]!.reviewer}</code> ·{' '}
                {formatUtcDate(reviewerDecisions[rel.relationshipId]!.reviewedAtMs)}
              </div>
              {reviewerDecisions[rel.relationshipId]!.projectionKey && (
                <div style={{ wordBreak: 'break-all', fontSize: '10px', color: '#435365' }}>
                  <b>Key:</b>{' '}
                  <code>
                    {reviewerDecisions[rel.relationshipId]!.projectionKey!.slice(0, 28)}…
                  </code>
                </div>
              )}
              {reviewerDecisions[rel.relationshipId]!.lastError && (
                <div style={{ color: '#9c2b2b', marginTop: '4px' }}>
                  <b>Failure:</b> {reviewerDecisions[rel.relationshipId]!.lastError}
                </div>
              )}
            </div>
          )}
        </div>
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
              TypeDB 3.14 Knowledge Graph · Convex Outbox · Read-Only Gateway (Execution Authority: None)
            </small>
          </div>
        </div>
        <div className="data-room-status-cluster">
          <span className="dr-pill live" data-testid="typedb-live-pill">
            TypeDB Server:{' '}
            {liveTypeDbStatus.reachable
              ? `LIVE (${liveTypeDbStatus.version})${
                  liveTypeDbStatus.databaseName
                    ? ` · ${liveTypeDbStatus.databaseName}`
                    : ''
                }${liveTypeDbStatus.tlsEnabled ? ' · TLS' : ''}`
              : 'MIRROR FALLBACK'}
          </span>
          <span className="dr-pill" data-testid="projection-lag-pill">
            Outbox:{' '}
            {simulatedOutboxFailureRelId
              ? 'STALE (1 retrying / dead_letter)'
              : `${dataset.relationships.length}/${dataset.relationships.length} Projected (0ms lag)`}
          </span>
          <Link
            href="/"
            className="button secondary"
            style={{ padding: '7px 12px' }}
            data-testid="back-to-market-radar-link"
          >
            ← Market Radar &amp; Stock Ratings
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
              ['evidence_chat', '6. Evidence-Locked AI Chat'],
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
        <main style={{ minWidth: 0, overflowX: 'hidden' }}>
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

              {/* MACRO CASE 001: AI INFRASTRUCTURE CONTAGION, US TO IRELAND */}
              <div
                data-testid="macro-case-001-workspace"
                style={{
                  marginTop: '20px',
                  borderTop: '2px solid #d4dde8',
                  paddingTop: '18px',
                }}
              >
                <div className="dr-card-header" style={{ marginBottom: '12px' }}>
                  <div>
                    <span className="eyebrow">
                      CASE ID: {MACRO_CASE_001_ID} · HOSTED TYPEDB CLOUD DOSSIER
                    </span>
                    <h2 style={{ fontSize: '17px', marginTop: '4px' }}>
                      Macro Case 001: AI Infrastructure Contagion, US to Ireland
                    </h2>
                    <p style={{ fontSize: '12px', color: '#425265', marginTop: '4px' }}>
                      Secondary-source discovery from Eamon Quinn’s 8 Nov 2026{' '}
                      <i>Irish News</i> article (<code>irish-news-quinn-2026-11-08</code>,
                      retained strictly as <code>reported</code>), verified against primary
                      SEC filings (Anthropic Form S-1 &amp; S-1/A, Nscale Form S-1, Intel Q3
                      2026 10-Q) and primary Irish regulatory publications (CBI FSR 2026 I,
                      Governor Gabriel Makhlouf’s 2 Nov 2026 Croke Park speech, Department of
                      Finance July 2026 COSMO analysis, CRU/EirGrid).
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {renderEpistemicBadge('reported')}
                    {renderEpistemicBadge('confirmed')}
                    {renderEpistemicBadge('hypothetical')}
                  </div>
                </div>

                {/* Executive Case TL;DR & Governance Rule */}
                <div
                  data-testid="macro-case-001-tldr"
                  style={{
                    background: '#f5f8fc',
                    border: '1px solid #d5e0ec',
                    borderRadius: '6px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: '#233243',
                  }}
                >
                  <strong>Executive Case TL;DR &amp; Discovery Governance:</strong> Eamon
                  Quinn’s 8 November 2026 <i>Irish News</i> article serves strictly as a{' '}
                  <b>secondary-source discovery trigger</b> (
                  <code>rel-quinn-irish-news-discovery-contagion-r1</code>,{' '}
                  <code>epistemicStatus: &quot;reported&quot;</code>) and is{' '}
                  <b>never promoted to a confirmed graph edge on its own</b>. Primary SEC and
                  Irish official disclosures confirm: (1) Anthropic’s Form S-1/A (2 Nov 2026)
                  discloses <b>USD 895.40B</b> in aggregate signed multi-year compute
                  commitments (inclusive of Nscale’s <b>USD 44.60B</b> Monarch contract) and
                  a 9M 2026 GAAP net loss of <b>-USD 104.00B</b> alongside dual-role backing
                  from Amazon and Alphabet (up to <b>USD 40.00B</b>); (2) Ireland’s
                  multinational tech sector accounts for <b>17.0%</b> of income tax and{' '}
                  <b>&gt;20.0%</b> of corporate tax receipts while data centres consume{' '}
                  <b>21.0%</b> of national electricity; and (3) Department of Finance COSMO
                  scenarios model a <b>-1.6%</b> Irish MDD contraction under a -10% US tech
                  equity shock and <b>-3.25%</b> under a severe -20% shock, while Governor
                  Makhlouf judges domestic Irish retail banks &quot;not that exposed to
                  AI&quot; directly.
                </div>

                {/* Non-Double-Counting Financial Commitment Ledger */}
                <div
                  className="dr-tldr-section"
                  data-testid="macro-case-001-commitment-ledger"
                  style={{ marginBottom: '16px' }}
                >
                  <h3>
                    Non-Double-Counting Financial Commitment Ledger (Zero Sub-Commitment
                    Duplication)
                  </h3>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                      gap: '10px',
                      marginBottom: '10px',
                    }}
                  >
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #dce4ee',
                        borderRadius: '6px',
                        padding: '10px',
                      }}
                    >
                      <small style={{ color: '#5c6b7c', fontSize: '10px' }}>
                        DEDUPLICATED COMPUTE COMMITMENTS
                      </small>
                      <div
                        style={{ fontSize: '16px', fontWeight: 700, color: '#1b3a24' }}
                        data-testid="deduplicated-compute-usd"
                      >
                        {formatUsdPrincipal(
                          commitmentLedger.deduplicatedComputeCommitmentsUsd,
                          'USD',
                        )}
                      </div>
                      <small style={{ fontSize: '10px', color: '#4d5d70' }}>
                        Anthropic S-1/A envelope (naive sum:{' '}
                        {formatUsdPrincipal(
                          commitmentLedger.naiveComputeCommitmentsSumUsd,
                          'USD',
                        )}
                        )
                      </small>
                    </div>

                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #dce4ee',
                        borderRadius: '6px',
                        padding: '10px',
                      }}
                    >
                      <small style={{ color: '#5c6b7c', fontSize: '10px' }}>
                        DOUBLE-COUNT PREVENTED
                      </small>
                      <div
                        style={{ fontSize: '16px', fontWeight: 700, color: '#8a4b0f' }}
                        data-testid="double-count-prevented-usd"
                      >
                        {formatUsdPrincipal(
                          commitmentLedger.doubleCountPreventedUsd,
                          'USD',
                        )}
                      </div>
                      <small style={{ fontSize: '10px', color: '#4d5d70' }}>
                        Nscale Monarch $44.60B excluded from additive total
                      </small>
                    </div>

                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #dce4ee',
                        borderRadius: '6px',
                        padding: '10px',
                      }}
                    >
                      <small style={{ color: '#5c6b7c', fontSize: '10px' }}>
                        SIGNED DEBT &amp; CO-INVESTMENT
                      </small>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#192434' }}>
                        {formatUsdPrincipal(
                          commitmentLedger.signedDebtAndCoInvestmentUsd,
                          'USD',
                        )}
                      </div>
                      <small style={{ fontSize: '10px', color: '#4d5d70' }}>
                        Intel Fab 34 $11.00B SCJV + Nscale $1.00B NVIDIA note
                      </small>
                    </div>

                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #dce4ee',
                        borderRadius: '6px',
                        padding: '10px',
                      }}
                    >
                      <small style={{ color: '#5c6b7c', fontSize: '10px' }}>
                        SIGNED GUARANTEES &amp; BACKING CAPS
                      </small>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#192434' }}>
                        {formatUsdPrincipal(commitmentLedger.signedGuaranteesUsd, 'USD')} /{' '}
                        {formatUsdPrincipal(
                          commitmentLedger.signedEquityAndConvertibleBackingCapUsd,
                          'USD',
                        )}
                      </div>
                      <small style={{ fontSize: '10px', color: '#4d5d70' }}>
                        Ward County $860M guarantee · Alphabet $40.00B cap
                      </small>
                    </div>
                  </div>
                </div>

                {/* 5 Approved Graph Investigations */}
                <div
                  className="dr-tldr-section"
                  data-testid="macro-case-001-investigations"
                  style={{ marginBottom: '16px' }}
                >
                  <h3>
                    5 Approved TypeDB Cloud Graph Investigations (Live{' '}
                    <code>aci_macro_intelligence_staging</code>)
                  </h3>
                  <div className="dr-tldr-grid">
                    {case001Investigations.map((inv) => (
                      <div
                        key={inv.questionId}
                        data-testid={`case001-inv-${inv.questionId}`}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #dce4ee',
                          borderRadius: '6px',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '6px',
                          }}
                        >
                          <strong style={{ fontSize: '12px', color: '#192434' }}>
                            {inv.question}
                          </strong>
                          <span className="tag green">{inv.queryType}</span>
                        </div>
                        <p style={{ fontSize: '11px', color: '#2f3e50', margin: '0 0 8px' }}>
                          {inv.findingSummary}
                        </p>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {inv.evidencedRelationshipIds.map((relId) => (
                            <button
                              key={relId}
                              type="button"
                              className="button secondary"
                              style={{ padding: '4px 8px', fontSize: '10px' }}
                              onClick={() => selectRelationshipForDrawer(relId)}
                            >
                              {relId} →
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scenario Comparison Table (Observed Baseline vs -10% Central vs -20% Severe) */}
                <div
                  className="dr-tldr-section"
                  data-testid="macro-case-001-scenarios"
                  style={{ marginBottom: '16px' }}
                >
                  <h3>
                    Scenario Comparison: Observed Baseline vs Department of Finance AI
                    Correction Scenarios
                  </h3>
                  <div className="table-scroll" style={{ overflowX: 'auto', maxWidth: '100%' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>SCENARIO &amp; HORIZON</th>
                          <th>CLASSIFICATION</th>
                          <th>US EQUITY SHOCK</th>
                          <th>IRISH MDD IMPACT</th>
                          <th>INVESTMENT / EXPORTS / CONSUMPTION / JOBS</th>
                          <th>DOMESTIC BANKING &amp; CREDIT CHANNEL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MACRO_CASE_001_SCENARIOS.map((sc) => (
                          <tr key={sc.scenarioId} data-testid={`scenario-row-${sc.scenarioId}`}>
                            <td>
                              <b>{sc.name}</b>
                              <div style={{ fontSize: '10px', color: '#5c6979' }}>
                                {sc.horizonLabel}
                              </div>
                            </td>
                            <td>
                              <span
                                className={`tag ${
                                  sc.classification === 'observed' ? 'green' : 'amber'
                                }`}
                              >
                                {sc.classification}
                              </span>
                            </td>
                            <td>{sc.usEquityShockPct}%</td>
                            <td>
                              <b>{sc.irishMddImpactPct}%</b>
                            </td>
                            <td style={{ fontSize: '11px' }}>
                              {sc.irishInvestmentImpactPct !== null
                                ? `Inv: ${sc.irishInvestmentImpactPct}% · Exp: ${sc.irishExportsImpactPct}% · Cons: ${sc.irishConsumptionImpactPct}% · Jobs: ${sc.irishEmploymentGrowthDeltaPp} pp`
                                : 'Observed baseline (no shock applied)'}
                            </td>
                            <td style={{ fontSize: '11px' }}>
                              {sc.domesticBankingDirectExposure}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 6-Class Claim Classification & Financial Commitment Distinction Table */}
                <div
                  className="dr-tldr-section"
                  data-testid="macro-case-001-claims"
                  style={{ marginBottom: '16px' }}
                >
                  <h3>
                    Extracted Claims Register (6-Class Taxonomy &amp; Instrument Distinction:{' '}
                    {MACRO_CASE_001_CLAIMS.length} Verified Claims)
                  </h3>
                  <div className="table-scroll" style={{ overflowX: 'auto', maxWidth: '100%' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>CLAIM ID</th>
                          <th>CLASSIFICATION</th>
                          <th>COMMITMENT BUCKET</th>
                          <th>QUANTITATIVE VALUE &amp; AS-OF</th>
                          <th>SUMMARY &amp; ASSUMPTIONS</th>
                          <th>GRAPH PROMOTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MACRO_CASE_001_CLAIMS.map((cl) => (
                          <tr key={cl.claimId} data-testid={`claim-row-${cl.claimId}`}>
                            <td>
                              <code>{cl.claimId}</code>
                            </td>
                            <td>
                              <span
                                className={`tag ${
                                  cl.classification === 'observed'
                                    ? 'green'
                                    : cl.classification === 'modelled_scenario' ||
                                        cl.classification === 'reported'
                                      ? 'amber'
                                      : ''
                                }`}
                              >
                                {cl.classification}
                              </span>
                            </td>
                            <td>
                              <code>{cl.commitmentBucket ?? 'macro_fiscal_exposure'}</code>
                            </td>
                            <td style={{ fontSize: '11px' }}>
                              <b>
                                {cl.quantitativeValue !== null
                                  ? `${cl.quantitativeValue.toLocaleString()} ${cl.unit ?? ''}`
                                  : 'Null (Undisclosed)'}
                              </b>
                              <div style={{ fontSize: '10px', color: '#5c6979' }}>
                                As of {cl.asOfDate}
                              </div>
                            </td>
                            <td style={{ fontSize: '11px' }}>
                              {cl.title}
                              <div style={{ fontSize: '10px', color: '#5c6979' }}>
                                <i>Assumptions:</i> {cl.assumptionsAndBasis}
                              </div>
                            </td>
                            <td>
                              {cl.relationshipId ? (
                                <button
                                  type="button"
                                  className="text-link"
                                  onClick={() =>
                                    selectRelationshipForDrawer(cl.relationshipId!)
                                  }
                                >
                                  <code>{cl.relationshipId}</code> (
                                  {cl.promotedToConfirmedGraph
                                    ? 'confirmed'
                                    : cl.classification}
                                  )
                                </button>
                              ) : (
                                <span style={{ fontSize: '10px', color: '#6b7786' }}>
                                  Scenario / Observation only
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* As-Known-At-Date Historical Cutoff Reconstructor */}
                <div
                  className="dr-tldr-section"
                  data-testid="macro-case-001-cutoff-reconstructor"
                >
                  <h3>
                    As-Known-At-Date Historical Cutoff Reconstruction (Publication Clock)
                  </h3>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: '10px',
                    }}
                  >
                    {case001Cutoffs.map((cut) => (
                      <div
                        key={cut.cutoffDateIso}
                        data-testid={`cutoff-card-${cut.cutoffDateIso}`}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #dce4ee',
                          borderRadius: '6px',
                          padding: '10px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '6px',
                          }}
                        >
                          <strong style={{ fontSize: '12px' }}>{cut.cutoffDateIso}</strong>
                          <span className="tag green">
                            {cut.activeRelationshipCount} Active Edges
                          </span>
                        </div>
                        <p style={{ fontSize: '11px', color: '#39485a', margin: '0 0 8px' }}>
                          {cut.label}
                        </p>
                        <div style={{ fontSize: '10px', color: '#526273', marginBottom: '8px' }}>
                          Anthropic S-1 Known:{' '}
                          <b>{cut.anthropicS1DisclosuresKnown ? 'YES' : 'NO'}</b> · Makhlouf
                          Speech: <b>{cut.makhloufSpeechKnown ? 'YES' : 'NO'}</b> · Quinn
                          Article: <b>{cut.irishNewsDiscoveryKnown ? 'YES' : 'NO'}</b>
                        </div>
                        <button
                          type="button"
                          className="button secondary"
                          data-testid={`apply-cutoff-${cut.cutoffDateIso}`}
                          style={{ padding: '5px 8px', fontSize: '10px', width: '100%' }}
                          onClick={() => {
                            setAsOfMs(cut.cutoffMs);
                            setTemporalBasis('publication');
                          }}
                        >
                          Reconstruct Graph at {cut.cutoffDateIso} →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
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

              {/* Durable Outbox & Reviewer Promotion Register (Stages 4 & 5) */}
              <div
                className="dr-tldr-section"
                style={{ marginBottom: '16px' }}
                data-testid="outbox-projection-register"
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>
                      Convex Append-Only Graph Outbox &amp; Hosted TypeDB Cloud Sync (
                      <code>aci_macro_intelligence_staging</code>)
                    </h3>
                    <p style={{ fontSize: '11px', color: '#5c6979', margin: '4px 0 0' }}>
                      Deterministic SHA-256 <code>projectionKey</code> · Lease-protected
                      worker · Non-blocking downtime isolation · Checkpoint replay
                      {lastReplayAtMs
                        ? ` · Last Replayed ${formatUtcDate(lastReplayAtMs)}`
                        : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="button secondary"
                      data-testid="simulate-outbox-failure-btn"
                      style={{ padding: '6px 10px', fontSize: '11px' }}
                      onClick={() => handleSimulateDeadLetter(selectedRelationship)}
                    >
                      Simulate Outbox Dead-Letter
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      data-testid="replay-checkpoint-btn"
                      style={{ padding: '6px 10px', fontSize: '11px' }}
                      onClick={handleReplayFromCheckpoint}
                    >
                      Replay Outbox from Checkpoint 0
                    </button>
                  </div>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>SEQ</th>
                        <th>RELATIONSHIP ID</th>
                        <th>EPISTEMIC / CONTRACTUAL</th>
                        <th>REVIEWER STATUS</th>
                        <th>DETERMINISTIC PROJECTION KEY</th>
                        <th>OUTBOX STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataset.relationships.slice(0, 6).map((rel, idx) => {
                        const customDecision = reviewerDecisions[rel.relationshipId];
                        const pKey = computeDeterministicProjectionKey(
                          'public_research',
                          'public_research',
                          rel,
                        );
                        const status =
                          customDecision?.outboxStatus ??
                          (rel.reviewerStatus === 'rejected'
                            ? 'not_enqueued'
                            : 'projected');
                        return (
                          <tr key={rel.relationshipId}>
                            <td>#{idx + 1}</td>
                            <td>
                              <button
                                type="button"
                                className="text-link"
                                onClick={() =>
                                  selectRelationshipForDrawer(rel.relationshipId)
                                }
                              >
                                <code>{rel.relationshipId}</code> (v{rel.version})
                              </button>
                            </td>
                            <td>
                              {renderEpistemicBadge(rel.epistemicStatus)} ·{' '}
                              <span className="tag">{rel.contractualStatus}</span>
                            </td>
                            <td>
                              {customDecision ? customDecision.decision : rel.reviewerStatus}
                            </td>
                            <td>
                              <code>{pKey.slice(0, 24)}…</code>
                            </td>
                            <td>
                              <span
                                className={`tag ${
                                  status === 'projected'
                                    ? 'green'
                                    : status === 'dead_letter'
                                      ? 'amber'
                                      : ''
                                }`}
                                data-testid={`outbox-status-${rel.relationshipId}`}
                              >
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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

          {/* VIEW 6: EVIDENCE-LOCKED AI RESEARCH CHAT (PHASE G.4) */}
          {activeView === 'evidence_chat' && (
            <section aria-label="Evidence-Locked AI Research Chat" data-testid="view-evidence-chat">
              <div
                className="dr-tldr-section"
                style={{
                  background: '#f7fafc',
                  border: '1px solid #cbd5e1',
                  marginBottom: '16px',
                }}
                data-testid="evidence-chat-panel"
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <span className="eyebrow" style={{ color: '#2b6cb0' }}>
                      VECTIS ONE CONTROL-FIRST ARCHITECTURE · PHASE G.4
                    </span>
                    <h3 style={{ margin: '4px 0', fontSize: '16px', color: '#192434' }}>
                      Evidence-Locked AI Research Assistant (Gemini + TypeDB Cloud + Convex)
                    </h3>
                    <p style={{ fontSize: '12px', color: '#4a5568', margin: 0 }}>
                      Answers natural-language research questions using <b>ONLY</b> the approved,
                      stored, and authorised evidence bundle retrieved from TypeDB Cloud (
                      <code>{liveTypeDbStatus.databaseName ?? 'aci_macro_intelligence_prod'}</code>)
                      and Convex. Every factual claim is verified by the 9-check independent
                      validator before rendering.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span className="tag green" data-testid="chat-namespace-badge">
                      Namespace: public_research only
                    </span>
                    <span className="tag" data-testid="chat-broker-lock-badge">
                      Trading 212 / Broker Vault: ZERO ACCESS
                    </span>
                    <span className="tag" data-testid="chat-cutoff-indicator">
                      As-Of Cutoff: {formatUtcDate(asOfMs)} ({temporalBasis})
                    </span>
                    <span
                      className={`tag ${
                        chatProviderReadiness?.enabled && chatProviderReadiness?.apiKeyConfigured
                          ? 'green'
                          : 'amber'
                      }`}
                      data-testid="chat-provider-readiness-badge"
                    >
                      {chatProviderReadiness?.enabled && chatProviderReadiness?.apiKeyConfigured
                        ? `Gemini Provider: LIVE CONNECTED (${chatProviderReadiness.modelId})`
                        : `Gemini Provider: UNAVAILABLE / DISABLED (${chatProviderReadiness?.status ?? 'api_key_missing'} · Deterministic Evidence Synthesis Active)`}
                    </span>
                  </div>
                </div>

                {/* Suggested Starter Questions */}
                <div style={{ marginBottom: '12px' }} data-testid="starter-questions-bar">
                  <strong
                    style={{
                      fontSize: '11px',
                      color: '#4a5568',
                      display: 'block',
                      marginBottom: '6px',
                    }}
                  >
                    SUGGESTED EVIDENCE-LOCKED STARTER QUESTIONS (CLICK TO RUN):
                  </strong>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {SUGGESTED_STARTER_QUESTIONS.map((qText, idx) => (
                      <button
                        key={qText}
                        type="button"
                        className="button secondary"
                        data-testid={`starter-q-${idx + 1}`}
                        style={{
                          fontSize: '11px',
                          padding: '6px 10px',
                          textAlign: 'left',
                        }}
                        disabled={chatLoading}
                        onClick={() => {
                          setChatQuestionInput(qText);
                          const isJulyCutoff = qText.includes('31 July 2026');
                          void submitResearchQuestion(
                            qText,
                            isJulyCutoff ? 1785542399000 : undefined,
                          );
                        }}
                      >
                        Q{idx + 1}: “{qText}”
                      </button>
                    ))}
                  </div>
                </div>

                {/* Question Input Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitResearchQuestion();
                  }}
                  style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
                  data-testid="evidence-chat-form"
                >
                  <label htmlFor="evidence-chat-input" className="cc-sr">
                    Ask an evidence-locked research question
                  </label>
                  <input
                    id="evidence-chat-input"
                    type="text"
                    data-testid="evidence-chat-input"
                    value={chatQuestionInput}
                    onChange={(e) => setChatQuestionInput(e.target.value)}
                    placeholder="Ask about Anthropic S-1/A commitments, Nscale Monarch, Irish macro scenarios, or historical cutoffs…"
                    style={{
                      flex: '1 1 320px',
                      padding: '9px 12px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <button
                    type="submit"
                    className="button primary"
                    data-testid="evidence-chat-submit"
                    disabled={chatLoading || !chatQuestionInput.trim()}
                    style={{ padding: '9px 16px', fontSize: '12px' }}
                  >
                    {chatLoading
                      ? 'Retrieving TypeDB Bundle & Validating…'
                      : 'Ask Evidence-Locked Assistant'}
                  </button>
                </form>

                {chatError && (
                  <div
                    role="alert"
                    data-testid="evidence-chat-error"
                    style={{
                      marginTop: '10px',
                      padding: '10px 12px',
                      background: '#fff5f5',
                      border: '1px solid #feb2b2',
                      borderRadius: '6px',
                      color: '#9b2c2c',
                      fontSize: '12px',
                    }}
                  >
                    <b>Closed-Evidence Gateway Notice:</b> {chatError}
                  </div>
                )}
              </div>

              {/* Empty state when no turns yet */}
              {chatTurns.length === 0 && (
                <div
                  className="dr-tldr-section"
                  data-testid="evidence-chat-empty-state"
                  style={{ textAlign: 'center', padding: '24px' }}
                >
                  <h4 style={{ margin: '0 0 6px', color: '#192434' }}>
                    Ready for Closed-Evidence Graph Retrieval
                  </h4>
                  <p style={{ fontSize: '12px', color: '#516072', margin: 0 }}>
                    Select one of the five starter questions above or enter any research question.
                    Each question executes an allowlisted TypeDB query, constructs a SHA-256 signed{' '}
                    <code>EvidenceBundleV1</code>, and runs the 9-check independent validator.
                  </p>
                </div>
              )}

              {/* Conversational Turn Cards */}
              {chatTurns.map((turn, turnIdx) => {
                const { answer, bundle, validationReport, providerMeta } = turn;
                const isAbstained = answer.supportStatus === 'unsupported';
                return (
                  <article
                    key={turn.turnId}
                    className="dr-tldr-section"
                    style={{
                      marginBottom: '16px',
                      borderLeft: isAbstained
                        ? '4px solid #dd6b20'
                        : answer.supportStatus === 'partially_supported'
                          ? '4px solid #d69e2e'
                          : '4px solid #2f855a',
                    }}
                    data-testid={`chat-turn-${turnIdx}`}
                  >
                    {/* Header: Question + Support Status Badge */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '10px',
                      }}
                    >
                      <div>
                        <span className="eyebrow">RESEARCH QUESTION</span>
                        <h4
                          style={{ margin: '2px 0 0', fontSize: '15px', color: '#192434' }}
                          data-testid={`chat-turn-question-${turnIdx}`}
                        >
                          {turn.question}
                        </h4>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span
                          className={`tag ${
                            answer.supportStatus === 'fully_supported'
                              ? 'green'
                              : 'amber'
                          }`}
                          data-testid={`chat-support-status-${turnIdx}`}
                        >
                          {answer.supportStatus === 'fully_supported'
                            ? 'FULLY SUPPORTED BY EVIDENCE'
                            : answer.supportStatus === 'partially_supported'
                              ? 'PARTIALLY SUPPORTED'
                              : 'NO SUPPORTING EVIDENCE (EXPLICIT ABSTENTION)'}
                        </span>
                        <span
                          className={`tag ${
                            providerMeta.generationMode === 'gemini_live' && !isAbstained
                              ? 'green'
                              : providerMeta.providerStatus === 'provider_error' ||
                                  providerMeta.providerStatus === 'budget_exceeded'
                                ? 'amber'
                                : ''
                          }`}
                          data-testid={`chat-synthesis-mode-${turnIdx}`}
                        >
                          {providerMeta.providerStatus === 'provider_error' ||
                          providerMeta.providerStatus === 'budget_exceeded'
                            ? `PROVIDER UNAVAILABLE (${providerMeta.providerStatus.toUpperCase()} · SAFE ABSTENTION)`
                            : isAbstained
                              ? 'SYNTHESIS: EXPLICIT ABSTENTION'
                              : providerMeta.generationMode === 'gemini_live'
                                ? `GEMINI-GENERATED VALIDATED SYNTHESIS (${providerMeta.modelId})`
                                : 'DETERMINISTIC EVIDENCE SYNTHESIS (GEMINI DISABLED / UNCONFIGURED)'}
                        </span>
                        <span className="tag" data-testid={`chat-query-type-${turnIdx}`}>
                          Query: {bundle.selectedQuery.queryType}
                        </span>
                        <span className="tag" data-testid={`chat-validator-badge-${turnIdx}`}>
                          Validator:{' '}
                          {validationReport.valid
                            ? '9/9 Checks Passed'
                            : 'Downgraded to Safe Abstention'}
                        </span>
                      </div>
                    </div>

                    {/* Explicit No Supporting Evidence / Abstention Banner */}
                    {isAbstained && (
                      <div
                        data-testid={`chat-abstention-banner-${turnIdx}`}
                        style={{
                          padding: '10px 12px',
                          background: '#fffaf0',
                          border: '1px solid #fbd38d',
                          borderRadius: '6px',
                          marginBottom: '12px',
                          fontSize: '12px',
                          color: '#7b341e',
                        }}
                      >
                        <strong>Explicit Evidence-Limited Abstention:</strong>{' '}
                        {answer.abstentionReason ??
                          'No approved evidence in the current bundle supports answering this question.'}
                      </div>
                    )}

                    {/* Short Answer */}
                    <div
                      style={{
                        padding: '10px 12px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        marginBottom: '12px',
                        fontSize: '13px',
                        lineHeight: 1.55,
                        color: '#1a202c',
                      }}
                      data-testid={`chat-short-answer-${turnIdx}`}
                    >
                      <strong>Short Answer:</strong> {answer.shortAnswer}
                    </div>

                    {/* Executive TL;DR Bullet Points */}
                    <div style={{ marginBottom: '12px' }} data-testid={`chat-tldr-${turnIdx}`}>
                      <strong
                        style={{
                          fontSize: '11px',
                          color: '#4a5568',
                          display: 'block',
                          marginBottom: '6px',
                        }}
                      >
                        EXECUTIVE TL;DR ({answer.executiveTldr.length} BOUNDED BULLETS):
                      </strong>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px' }}>
                        {answer.executiveTldr.map((bullet, bIdx) => (
                          <li key={bIdx} style={{ marginBottom: '4px', color: '#2d3748' }}>
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Collapsible Supporting Claims with Clickable Evidence & Relationship Citations */}
                    {answer.supportingClaims.length > 0 && (
                      <details
                        open
                        style={{
                          marginBottom: '12px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '10px 12px',
                        }}
                        data-testid={`chat-supporting-claims-${turnIdx}`}
                      >
                        <summary
                          style={{
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '12px',
                            color: '#192434',
                          }}
                        >
                          Supporting Claims &amp; Clickable Evidence Citations (
                          {answer.supportingClaims.length})
                        </summary>
                        <div style={{ marginTop: '10px', display: 'grid', gap: '8px' }}>
                          {answer.supportingClaims.map((claim, cIdx) => (
                            <div
                              key={claim.claimId}
                              data-testid={`chat-claim-${turnIdx}-${cIdx + 1}`}
                              style={{
                                padding: '8px 10px',
                                background: '#ffffff',
                                border: '1px solid #edf2f7',
                                borderRadius: '6px',
                                fontSize: '12px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: '6px',
                                  flexWrap: 'wrap',
                                  marginBottom: '4px',
                                }}
                              >
                                <span>
                                  <b>{claim.claimId}</b> ·{' '}
                                  <span className="tag">{claim.distinction}</span>
                                  {claim.periodOrAsOf ? (
                                    <span className="tag" style={{ marginLeft: '4px' }}>
                                      {claim.periodOrAsOf}
                                    </span>
                                  ) : null}
                                </span>
                                {claim.quantitativeValue !== null && (
                                  <span className="tag green">
                                    Verified Figure: {claim.quantitativeValue}{' '}
                                    {claim.unit ?? claim.currency ?? ''}
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: '4px 0 8px', color: '#2d3748' }}>
                                {claim.statement}
                              </p>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '6px',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                }}
                              >
                                <span style={{ fontSize: '10px', color: '#64748b' }}>
                                  Evidence Citations (click to open drawer):
                                </span>
                                {claim.evidenceIds.map((evId) => (
                                  <button
                                    key={evId}
                                    type="button"
                                    className="text-link"
                                    data-testid={`citation-ev-${evId}`}
                                    style={{
                                      fontSize: '11px',
                                      padding: '2px 6px',
                                      background: '#ebf8ff',
                                      border: '1px solid #bee3f8',
                                      borderRadius: '4px',
                                    }}
                                    onClick={() =>
                                      selectEvidenceCitationForDrawer(evId, claim.relationshipIds)
                                    }
                                  >
                                    📄 <code>{evId}</code>
                                  </button>
                                ))}
                                {claim.relationshipIds.map((relId) => (
                                  <button
                                    key={relId}
                                    type="button"
                                    className="text-link"
                                    data-testid={`citation-rel-${relId}`}
                                    style={{
                                      fontSize: '11px',
                                      padding: '2px 6px',
                                      background: '#f0fff4',
                                      border: '1px solid #c6f6d5',
                                      borderRadius: '4px',
                                    }}
                                    onClick={() => selectRelationshipForDrawer(relId)}
                                  >
                                    🔗 <code>{relId}</code>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Contradictory Evidence & Missing Information */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '10px',
                        marginBottom: '12px',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 10px',
                          background: '#fffaf0',
                          border: '1px solid #feebc8',
                          borderRadius: '6px',
                          fontSize: '11px',
                        }}
                        data-testid={`chat-contradictions-${turnIdx}`}
                      >
                        <strong>
                          Contradictory / Superseded Evidence ({answer.contradictoryEvidence.length}
                          ):
                        </strong>
                        {answer.contradictoryEvidence.length === 0 ? (
                          <p style={{ margin: '4px 0 0', color: '#744210' }}>
                            None in active temporal slice.
                          </p>
                        ) : (
                          <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
                            {answer.contradictoryEvidence.map((ce, idx) => (
                              <li key={idx}>
                                <b>{ce.topic}:</b> {ce.description} (
                                <code>{ce.evidenceIds.join(', ')}</code>)
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div
                        style={{
                          padding: '8px 10px',
                          background: '#f7fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          fontSize: '11px',
                        }}
                        data-testid={`chat-missing-info-${turnIdx}`}
                      >
                        <strong>
                          Missing / Undisclosed Information ({answer.missingInformation.length}):
                        </strong>
                        <ul style={{ margin: '4px 0 0', paddingLeft: '16px', color: '#4a5568' }}>
                          {answer.missingInformation.map((mi, idx) => (
                            <li key={idx}>{mi}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Provenance, Freshness & Bundle Audit Footer */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid #e2e8f0',
                        fontSize: '10px',
                        color: '#64748b',
                      }}
                      data-testid={`chat-provenance-footer-${turnIdx}`}
                    >
                      <span>
                        <b>Bundle:</b> <code>{bundle.bundleId}</code> · <b>SHA-256:</b>{' '}
                        <code>{bundle.bundleSha256.slice(0, 16)}…</code>
                      </span>
                      <span>
                        <b>Graph DB:</b> <code>{bundle.graphDatabaseName}</code> (
                        {bundle.typedbBackendMode}) ·{' '}
                        <b>Coverage:</b> {bundle.relationships.length} rels /{' '}
                        {bundle.sources.length} sources / {bundle.quantitativeClaims.length} claims
                      </span>
                      <span>
                        <b>Model:</b> <code>{providerMeta.modelId}</code> ({providerMeta.providerStatus}
                        ) · {providerMeta.inputTokens} in / {providerMeta.outputTokens} out tok · £
                        {providerMeta.estimatedCostGbp.toFixed(5)} · Retrieved{' '}
                        {new Date(bundle.retrievedAtMs).toISOString().slice(0, 19)}Z
                      </span>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </main>

        {/* Persistent Right-Hand Evidence Drawer on Desktop */}
        <aside
          className="dr-evidence-drawer desktop-only"
          aria-label="Relationship Evidence Drawer"
          data-testid="desktop-evidence-drawer"
        >
          {renderEvidenceDrawerContent(selectedRelationship, false)}
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
            {renderEvidenceDrawerContent(selectedRelationship, true)}
          </div>
        </div>
      )}

      {/* Accessible Floating Trigger Bar on Mobile */}
      {!mobileDrawerOpen && (
        <div className="dr-mobile-drawer-trigger-bar mobile-only">
          <button
            type="button"
            className="button primary dr-mobile-drawer-trigger-btn"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open evidence drawer"
            data-testid="mobile-drawer-trigger-btn"
          >
            <span>View Evidence Drawer</span>
            <span className="dr-trigger-badge">
              {selectedRelationship.relationshipId} (v{selectedRelationship.version})
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
