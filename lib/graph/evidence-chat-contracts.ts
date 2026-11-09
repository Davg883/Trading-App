import { z } from 'zod';
import {
  ALLOWLISTED_QUERY_TYPES,
  CONTRACTUAL_STATUSES,
  EPISTEMIC_STATUSES,
  MACRO_GRAPH_SCHEMA_VERSION,
  type AllowlistedQueryType,
} from './contracts';

export const ALLOWLISTED_GRAPH_QUERIES = ALLOWLISTED_QUERY_TYPES;
export type AllowlistedGraphQueryType = AllowlistedQueryType;
export const epistemicStatusSchema = z.enum(EPISTEMIC_STATUSES);
export const contractualStatusSchema = z.enum(CONTRACTUAL_STATUSES);

/**
 * Phase G.4 — Evidence-Locked AI Chat & Knowledge Graph Demonstration Contracts.
 *
 * Defines:
 * 1. Versioned, immutable Evidence Bundle contract (`evidence-bundle-g4-v1`).
 * 2. Structured Evidence-Locked Answer schema (`evidence-locked-answer-g4-v1`).
 * 3. Independent semantic, numerical, temporal, and security validation report schema.
 * 4. Hard retrieval & budget limits.
 */

export const EVIDENCE_BUNDLE_VERSION = 'evidence-bundle-g4-v1' as const;
export const EVIDENCE_LOCKED_ANSWER_VERSION = 'evidence-locked-answer-g4-v1' as const;

export const EVIDENCE_RETRIEVAL_LIMITS = {
  maxTraversalDepth: 2,
  maxRelationships: 25,
  maxEvidenceDocuments: 15,
  maxExcerptCharsPerDoc: 600,
  maxTotalInputTokens: 6000,
  maxRequestDurationMs: 15000,
  maxRequestCostGbp: 0.05,
  defaultDailyBudgetCeilingGbp: 2.0,
} as const;

export const SUGGESTED_STARTER_QUESTIONS = [
  'Which AI infrastructure investments share documented financial counterparties?',
  'What are the documented financing and infrastructure relationships relevant to Ireland?',
  'What did our system know about Anthropic on 31 July 2026?',
  'What evidence supports the largest compute commitments?',
  'Which statements in the graph remain reported or unverified?',
] as const;

export const temporalBasisSchema = z.enum(['publication', 'receipt']);
export type TemporalBasis = z.infer<typeof temporalBasisSchema>;

export const bundleOrganisationSchema = z
  .object({
    orgId: z.string().min(1).max(120),
    displayName: z.string().min(1).max(200),
    legalName: z.string().min(1).max(240),
    subtype: z.string().min(1).max(80),
    ticker: z.string().max(20).nullable(),
    secCik: z.string().max(20).nullable(),
    jurisdiction: z.string().min(2).max(20),
    sectorIds: z.array(z.string().min(1).max(120)),
  })
  .strict();

export const bundleRelationshipSchema = z
  .object({
    relationshipId: z.string().min(1).max(120),
    logicalEventId: z.string().min(1).max(120),
    version: z.number().int().positive(),
    supersedesRelationshipId: z.string().min(1).max(120).nullable(),
    relationshipType: z.string().min(1).max(80),
    epistemicStatus: epistemicStatusSchema,
    contractualStatus: contractualStatusSchema,
    summary: z.string().min(1).max(1000),
    principalAmount: z.number().nonnegative().nullable(),
    currency: z.string().max(10).nullable(),
    capacityMw: z.number().nonnegative().nullable(),
    validFromMs: z.number().int().nonnegative(),
    validToMs: z.number().int().nonnegative().nullable(),
    publishedAtMs: z.number().int().nonnegative(),
    receivedAtMs: z.number().int().nonnegative(),
    participants: z.array(
      z
        .object({
          role: z.string().min(1).max(60),
          entityKind: z.string().min(1).max(60),
          entityId: z.string().min(1).max(120),
          entityLabel: z.string().min(1).max(200),
        })
        .strict(),
    ),
    sourceDocIds: z.array(z.string().min(1).max(120)).min(1),
    parentCommitmentEnvelopeId: z.string().min(1).max(120).nullable(),
  })
  .strict();

export const bundleSourceDocumentSchema = z
  .object({
    docId: z.string().min(1).max(120),
    title: z.string().min(1).max(500),
    publisher: z.string().min(1).max(200),
    sourceTier: z.string().min(1).max(60),
    url: z.string().url().startsWith('https://'),
    publishedAtMs: z.number().int().nonnegative(),
    receivedAtMs: z.number().int().nonnegative(),
    sha256Hash: z.string().regex(/^[0-9a-f]{64}$/),
    excerpt: z.string().min(1).max(EVIDENCE_RETRIEVAL_LIMITS.maxExcerptCharsPerDoc),
  })
  .strict();

export const bundleQuantitativeClaimSchema = z
  .object({
    claimId: z.string().min(1).max(120),
    title: z.string().min(1).max(500),
    classification: z.enum([
      'observed',
      'reported',
      'proposed',
      'modelled_scenario',
      'interpretation',
      'unverified',
    ]),
    commitmentBucket: z
      .enum([
        'equity_ownership',
        'debt',
        'guarantees',
        'compute_purchase_commitments',
        'planned_investments',
      ])
      .nullable(),
    subjectEntityId: z.string().min(1).max(120),
    counterpartyEntityIds: z.array(z.string().min(1).max(120)),
    relationshipId: z.string().min(1).max(120).nullable(),
    parentCommitmentEnvelopeId: z.string().min(1).max(120).nullable(),
    quantitativeValue: z.number().finite().nullable(),
    unit: z.enum(['USD', 'MW', 'percent', 'percentage_points']).nullable(),
    asOfDate: z.string().min(4).max(32),
    publishedAtMs: z.number().int().nonnegative(),
    receivedAtMs: z.number().int().nonnegative(),
    assumptionsAndBasis: z.string().min(1).max(600),
    sourceDocIds: z.array(z.string().min(1).max(120)).min(1),
    promotedToConfirmedGraph: z.boolean(),
  })
  .strict();

export const bundleScenarioSummarySchema = z
  .object({
    scenarioId: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    classification: z.enum(['observed', 'modelled_scenario']),
    usEquityShockPct: z.number().finite(),
    horizonLabel: z.string().min(1).max(120),
    irishMddImpactPct: z.number().finite(),
    irishInvestmentImpactPct: z.number().finite().nullable(),
    irishExportsImpactPct: z.number().finite().nullable(),
    irishEmploymentGrowthDeltaPp: z.number().finite().nullable(),
    fiscalAndTaxChannelSummary: z.string().min(1).max(500),
    sourceDocIds: z.array(z.string().min(1).max(120)).min(1),
  })
  .strict();

export const bundleCommitmentArithmeticSchema = z
  .object({
    naiveComputeCommitmentsSumUsd: z.number().nonnegative(),
    deduplicatedComputeCommitmentsUsd: z.number().nonnegative(),
    doubleCountPreventedUsd: z.number().nonnegative(),
    signedDebtAndCoInvestmentUsd: z.number().nonnegative(),
    signedGuaranteesUsd: z.number().nonnegative(),
    signedEquityAndConvertibleBackingCapUsd: z.number().nonnegative(),
  })
  .strict();

export const evidenceBundleSchema = z
  .object({
    bundleId: z.string().min(1).max(120),
    version: z.literal(EVIDENCE_BUNDLE_VERSION),
    requesterId: z.string().min(1).max(500),
    retrievedAtMs: z.number().int().positive(),
    namespace: z.literal('public_research'),
    graphDatabaseName: z.string().min(1).max(120),
    graphSchemaVersion: z.literal(MACRO_GRAPH_SCHEMA_VERSION),
    typedbBackendMode: z.enum(['typedb_live', 'deterministic_mirror']),
    typedbServerVersion: z.string().max(60).nullable(),
    typedbLiveQueryLatencyMs: z.number().int().nonnegative().nullable(),
    typedbLiveAnswerCount: z.number().int().nonnegative().nullable(),
    projectionCheckpoint: z
      .object({
        lastProjectedSequence: z.number().int().nonnegative(),
        lastProjectionKey: z.string().max(160).nullable(),
        projectedCount: z.number().int().nonnegative(),
        reconciled: z.boolean(),
      })
      .strict(),
    historicalCutoffMs: z.number().int().nonnegative(),
    historicalCutoffIso: z.string().min(10).max(40),
    temporalBasis: temporalBasisSchema,
    question: z.string().min(3).max(1000),
    selectedQuery: z
      .object({
        queryType: z.enum(ALLOWLISTED_GRAPH_QUERIES),
        focalEntityId: z.string().max(120).nullable(),
        sectorId: z.string().max(120).nullable(),
        relationshipId: z.string().max(120).nullable(),
        maxDepth: z.union([z.literal(1), z.literal(2)]),
        intentCategory: z.enum([
          'shared_counterparties',
          'ireland_macro_contagion',
          'historical_cutoff_knowledge',
          'compute_commitments_evidence',
          'reported_or_unverified_claims',
          'project_dependencies',
          'entity_relationships',
          'out_of_scope_or_unsupported',
          'security_blocked',
        ]),
        intentRationale: z.string().min(1).max(400),
      })
      .strict(),
    organisations: z.array(bundleOrganisationSchema),
    relationships: z
      .array(bundleRelationshipSchema)
      .max(EVIDENCE_RETRIEVAL_LIMITS.maxRelationships),
    sources: z
      .array(bundleSourceDocumentSchema)
      .max(EVIDENCE_RETRIEVAL_LIMITS.maxEvidenceDocuments),
    quantitativeClaims: z.array(bundleQuantitativeClaimSchema),
    scenarios: z.array(bundleScenarioSummarySchema),
    commitmentLedger: bundleCommitmentArithmeticSchema,
    excludedByHistoricalCutoffCount: z.number().int().nonnegative(),
    quarantinedAdversarialSourcesCount: z.number().int().nonnegative(),
    dataQualityWarnings: z.array(z.string().min(1).max(500)),
    estimatedBundleTokens: z.number().int().nonnegative(),
    bundleSha256: z.string().regex(/^[0-9a-f]{64}$/),
    executionAuthority: z.literal('none'),
  })
  .strict();

export type EvidenceBundleV1 = z.infer<typeof evidenceBundleSchema>;

export const supportingClaimDistinctionSchema = z.enum([
  'source_fact',
  'deterministic_arithmetic',
  'modelled_scenario',
  'reported_unverified',
  'interpretation',
]);

export const supportingClaimItemSchema = z
  .object({
    claimId: z.string().min(1).max(120),
    statement: z.string().min(1).max(800),
    distinction: supportingClaimDistinctionSchema,
    evidenceIds: z.array(z.string().min(1).max(120)).min(1),
    relationshipIds: z.array(z.string().min(1).max(120)),
    quantitativeValue: z.number().finite().nullable(),
    unit: z.enum(['USD', 'MW', 'percent', 'percentage_points']).nullable(),
    currency: z.string().max(10).nullable(),
    periodOrAsOf: z.string().max(60).nullable(),
  })
  .strict();

export type SupportingClaimItem = z.infer<typeof supportingClaimItemSchema>;

export const contradictoryEvidenceItemSchema = z
  .object({
    topic: z.string().min(1).max(200),
    description: z.string().min(1).max(600),
    relationshipIds: z.array(z.string().min(1).max(120)),
    evidenceIds: z.array(z.string().min(1).max(120)).min(1),
  })
  .strict();

export const supportStatusSchema = z.enum([
  'fully_supported',
  'partially_supported',
  'unsupported',
]);
export type AnswerSupportStatus = z.infer<typeof supportStatusSchema>;

export const evidenceLockedAnswerSchema = z
  .object({
    version: z.literal(EVIDENCE_LOCKED_ANSWER_VERSION),
    bundleId: z.string().min(1).max(120),
    bundleSha256: z.string().regex(/^[0-9a-f]{64}$/),
    shortAnswer: z.string().min(1).max(800),
    executiveTldr: z.array(z.string().min(1).max(400)).min(1).max(6),
    supportingClaims: z.array(supportingClaimItemSchema).max(15),
    relevantRelationshipIds: z.array(z.string().min(1).max(120)).max(25),
    contradictoryEvidence: z.array(contradictoryEvidenceItemSchema).max(10),
    missingInformation: z.array(z.string().min(1).max(400)).max(10),
    historicalCutoffUsed: z
      .object({
        asOfMs: z.number().int().nonnegative(),
        asOfIso: z.string().min(10).max(40),
        temporalBasis: temporalBasisSchema,
      })
      .strict(),
    supportStatus: supportStatusSchema,
    abstentionReason: z.string().max(500).nullable(),
    suggestedFollowUpQuestions: z.array(z.string().min(1).max(240)).min(1).max(5),
    executionAuthority: z.literal('none'),
  })
  .strict();

export type EvidenceLockedAnswer = z.infer<typeof evidenceLockedAnswerSchema>;
export type EvidenceLockedAnswerV1 = EvidenceLockedAnswer;

export const answerValidationCheckSchema = z
  .object({
    checkId: z.enum([
      'schema_valid',
      'bundle_hash_bound',
      'evidence_ids_in_bundle',
      'relationship_ids_in_bundle',
      'historical_cutoff_respected',
      'numerical_claims_verified',
      'deterministic_arithmetic_verified',
      'no_private_or_broker_leakage',
      'no_prompt_injection_override',
    ]),
    passed: z.boolean(),
    detail: z.string().min(1).max(500),
  })
  .strict();

export const answerValidationReportSchema = z
  .object({
    valid: z.boolean(),
    actionTaken: z.enum(['accepted', 'downgraded_to_abstention', 'rejected_security_violation']),
    checks: z.array(answerValidationCheckSchema),
    invalidEvidenceIds: z.array(z.string()),
    invalidRelationshipIds: z.array(z.string()),
    unverifiedNumbers: z.array(z.string()),
    temporalViolations: z.array(z.string()),
    securityViolations: z.array(z.string()),
    validatedAtMs: z.number().int().positive(),
  })
  .strict();

export type AnswerValidationReport = z.infer<typeof answerValidationReportSchema>;

export type GeminiInferenceTelemetry = {
  provider: 'google_genai_sdk';
  modelId: string;
  modelVerifiedViaEndpoint: boolean;
  generationMode: 'gemini_live' | 'deterministic_evidence_synthesis' | 'abstention_only';
  providerStatus:
    | 'succeeded'
    | 'disabled_by_default'
    | 'api_key_not_configured'
    | 'budget_exceeded'
    | 'rate_limited'
    | 'provider_error'
    | 'security_blocked';
  requestId?: string | null;
  thinkingTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostGbp: number;
  actualCostGbp: number | null;
  errorCode: string | null;
  sanitisedError: string | null;
};

export type EvidenceChatTurnResult = {
  turnId: string;
  question: string;
  createdAtMs: number;
  bundle: EvidenceBundleV1;
  answer: EvidenceLockedAnswer;
  validation: AnswerValidationReport;
  telemetry: GeminiInferenceTelemetry;
  executionAuthority: 'none';
};

export type IntentSelectionResult = {
  queryType: AllowlistedGraphQueryType;
  focalEntityId: string | null;
  sectorId: string | null;
  relationshipId: string | null;
  maxDepth: 1 | 2;
  intentCategory: EvidenceBundleV1['selectedQuery']['intentCategory'];
  intentRationale: string;
  securityBlockedReason: string | null;
};
