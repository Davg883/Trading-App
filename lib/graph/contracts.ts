import { z } from 'zod';

export const MACRO_GRAPH_SCHEMA_VERSION = 'macro-intelligence-graph-3.14-v1' as const;
export const MACRO_GRAPH_DATASET_VERSION = 'macro-graph-dataset-g1-v1' as const;
export const PINNED_TYPEDB_SERVER_VERSION = '3.14.2' as const;
export const PINNED_TYPEDB_HTTP_DRIVER_VERSION = '3.14.0' as const;
export const PINNED_TYPEDB_PYTHON_DRIVER_VERSION = '3.14.0' as const;

export const ORGANISATION_SUBTYPES = [
  'public_company',
  'private_company',
  'hyperscaler',
  'semiconductor_supplier',
  'specialist_compute_provider',
  'ai_laboratory',
  'utility_provider',
  'government_body',
] as const;

export const MACRO_RELATION_TYPES = [
  'supply_relationship',
  'procurement_relationship',
  'financing_arrangement',
  'guarantee_arrangement',
  'ownership_stake',
  'operational_control',
  'leasing_agreement',
  'project_dependency',
] as const;

export const EPISTEMIC_STATUSES = [
  'confirmed',
  'reported',
  'proposed',
  'inferred',
  'hypothetical',
] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export const CONTRACTUAL_STATUSES = [
  'reported_discussion',
  'announced',
  'signed',
  'funded',
  'cancelled',
  'expired',
  'inferred_architecture',
] as const;
export type ContractualStatus = (typeof CONTRACTUAL_STATUSES)[number];

export const REVIEWER_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'conflicting_pending_review',
  'quarantined',
] as const;
export type ReviewerStatus = (typeof REVIEWER_STATUSES)[number];

export const VISIBILITY_SCOPES = ['public_research', 'private_tenant'] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

export const ALLOWLISTED_QUERY_TYPES = [
  'organisation_relationship_summary',
  'project_dependency_network',
  'shared_counterparty_exposure',
  'sector_connections',
  'as_known_at_date_graph',
  'relationship_source_evidence',
] as const;
export type AllowlistedQueryType = (typeof ALLOWLISTED_QUERY_TYPES)[number];

const nonEmptyId = z.string().trim().min(1).max(240);
const safeText = z.string().trim().min(1).max(4000);
const timestampMs = z.number().int().nonnegative().max(8_640_000_000_000_000);

export const sectorSchema = z
  .object({
    sectorId: nonEmptyId,
    sectorName: safeText,
    industryGroup: safeText,
    economicLayer: safeText,
  })
  .strict();
export type GraphSector = z.infer<typeof sectorSchema>;

export const organisationSchema = z
  .object({
    orgId: nonEmptyId,
    legalName: safeText,
    displayName: safeText,
    subtype: z.enum(ORGANISATION_SUBTYPES),
    secCik: z
      .string()
      .regex(/^\d{10}$/)
      .nullable(),
    leiCode: z
      .string()
      .regex(/^[A-Z0-9]{20}$/)
      .nullable(),
    ticker: z
      .string()
      .regex(/^[A-Z0-9.-]{1,12}$/)
      .nullable(),
    jurisdiction: z.string().trim().min(2).max(32),
    sectorIds: z.array(nonEmptyId).min(1).max(10),
    aliases: z.array(safeText).max(25).default([]),
  })
  .strict();
export type GraphOrganisation = z.infer<typeof organisationSchema>;

export const locationSchema = z
  .object({
    locationId: nonEmptyId,
    locationName: safeText,
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    regionOrState: z.string().trim().min(1).max(64),
    municipality: z.string().trim().min(1).max(120),
    gridZone: z.string().trim().min(1).max(120),
  })
  .strict();
export type GraphLocation = z.infer<typeof locationSchema>;

export const energyAssetSchema = z
  .object({
    assetId: nonEmptyId,
    assetName: safeText,
    energySourceType: safeText,
    nameplateCapacityMw: z.number().finite().nonnegative(),
    locationId: nonEmptyId,
  })
  .strict();
export type GraphEnergyAsset = z.infer<typeof energyAssetSchema>;

export const infrastructureProjectSchema = z
  .object({
    projectId: nonEmptyId,
    projectName: safeText,
    projectType: safeText,
    projectStage: safeText,
    plannedCapacityMw: z.number().finite().nonnegative().nullable(),
    energisedCapacityMw: z.number().finite().nonnegative().nullable(),
    locationId: nonEmptyId,
  })
  .strict();
export type GraphProject = z.infer<typeof infrastructureProjectSchema>;

export const financialInstrumentSchema = z
  .object({
    instrumentId: nonEmptyId,
    instrumentType: safeText,
    instrumentCurrency: z.string().regex(/^[A-Z]{3}$/),
    ticker: z
      .string()
      .regex(/^[A-Z0-9.-]{1,12}$/)
      .nullable(),
    figiCode: z
      .string()
      .regex(/^BBG[A-Z0-9]{9}$/)
      .nullable(),
  })
  .strict();
export type GraphInstrument = z.infer<typeof financialInstrumentSchema>;

export const sourceDocumentSchema = z
  .object({
    sourceDocId: nonEmptyId,
    title: safeText,
    url: z
      .string()
      .url()
      .startsWith('https://')
      .refine((s) => {
        const parsed = new URL(s);
        return !parsed.username && !parsed.password;
      }, 'Credentials in source URLs are forbidden'),
    kind: z.enum(['filing', 'company', 'news', 'regulator']),
    authority: z.enum(['primary', 'secondary']),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    publicationBasis: z.enum([
      'sec_edgar_acceptance',
      'exact_utc',
      'updated_utc',
      'date_upper_bound',
      'retrieval_upper_bound',
    ]),
    publishedAtMs: timestampMs,
    receivedAtMs: timestampMs,
    ingestedAtMs: timestampMs,
  })
  .strict()
  .refine(
    (doc) => doc.receivedAtMs >= doc.publishedAtMs,
    'Trusted receipt timestamp cannot precede publication timestamp',
  );
export type GraphSourceDocument = z.infer<typeof sourceDocumentSchema>;

export const financialObservationSchema = z
  .object({
    observationId: nonEmptyId,
    subjectOrgId: nonEmptyId,
    subjectProjectId: nonEmptyId.nullable(),
    counterpartyOrgId: nonEmptyId.nullable(),
    metricName: safeText,
    metricValue: z.number().finite(),
    metricUnit: z.enum(['currency', 'MW', 'GPU', 'ratio']),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    reportingPeriodLabel: safeText,
    periodStartMs: timestampMs,
    periodEndMs: timestampMs,
    accountingBasis: safeText,
    metricDefinition: safeText,
    observationKind: z.enum(['reported', 'derived', 'forecast']),
    publishedAtMs: timestampMs,
    receivedAtMs: timestampMs,
    sourceDocIds: z.array(nonEmptyId).min(1).max(25),
  })
  .strict()
  .refine(
    (obs) => obs.periodEndMs >= obs.periodStartMs && obs.receivedAtMs >= obs.publishedAtMs,
    'Observation period and receipt chronology must be valid',
  );
export type GraphObservation = z.infer<typeof financialObservationSchema>;

export const relationshipParticipantSchema = z
  .object({
    role: z.string().trim().min(1).max(64),
    entityId: nonEmptyId,
    entityKind: z.enum([
      'organisation',
      'infrastructure_project',
      'financial_instrument',
      'energy_asset',
      'geographical_location',
      'sector_classification',
    ]),
  })
  .strict();
export type RelationshipParticipant = z.infer<typeof relationshipParticipantSchema>;

export const macroRelationshipSchema = z
  .object({
    relationshipId: nonEmptyId,
    relationType: z.enum(MACRO_RELATION_TYPES),
    logicalEventId: nonEmptyId,
    version: z.number().int().positive(),
    supersedesRelationshipId: nonEmptyId.nullable(),
    category: safeText,
    contractualStatus: z.enum(CONTRACTUAL_STATUSES),
    epistemicStatus: z.enum(EPISTEMIC_STATUSES),
    extractionStatus: z.enum([
      'verified_primary_filing',
      'verified_company_release',
      'corroborated_secondary_news',
      'inferred_from_filing_context',
      'hypothetical_scenario',
    ]),
    reviewerStatus: z.enum(REVIEWER_STATUSES),
    reviewedBy: nonEmptyId.nullable(),
    conflictGroupId: nonEmptyId.nullable(),
    economicGroupId: nonEmptyId.nullable(),
    principalAmount: z.number().finite().nonnegative().nullable(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    capacityUnit: z.enum(['MW', 'GPU']).nullable(),
    capacityQuantity: z.number().finite().nonnegative().nullable(),
    conditionsSummary: safeText,
    bindingObligation: z.boolean(),
    effectiveFromMs: timestampMs,
    effectiveToMs: timestampMs.nullable(),
    maturityAtMs: timestampMs.nullable(),
    publishedAtMs: timestampMs,
    receivedAtMs: timestampMs,
    participants: z.array(relationshipParticipantSchema).min(2).max(10),
    sourceDocIds: z.array(nonEmptyId).min(1).max(25),
  })
  .strict()
  .superRefine((rel, ctx) => {
    if (rel.receivedAtMs < rel.publishedAtMs) {
      ctx.addIssue({
        code: 'custom',
        message: 'Relationship receipt timestamp cannot precede publication timestamp',
      });
    }
    if ((rel.principalAmount !== null) !== (rel.currencyCode !== null && rel.principalAmount !== null)) {
      if (rel.principalAmount !== null && !rel.currencyCode) {
        ctx.addIssue({
          code: 'custom',
          message: 'Principal amount requires an ISO currency code',
        });
      }
    }
    if (
      rel.epistemicStatus === 'confirmed' &&
      !['verified_primary_filing', 'verified_company_release'].includes(rel.extractionStatus)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Confirmed epistemic status requires primary filing or official company disclosure',
      });
    }
    if (
      ['signed', 'funded'].includes(rel.contractualStatus) &&
      rel.epistemicStatus !== 'confirmed'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Signed or funded contractual status cannot be inferred from news speculation',
      });
    }
  });
export type MacroRelationship = z.infer<typeof macroRelationshipSchema>;

export const macroGraphDatasetSchema = z
  .object({
    datasetVersion: z.literal(MACRO_GRAPH_DATASET_VERSION),
    schemaVersion: z.literal(MACRO_GRAPH_SCHEMA_VERSION),
    owner: nonEmptyId,
    visibility: z.enum(VISIBILITY_SCOPES),
    sectors: z.array(sectorSchema).min(1).max(50),
    organisations: z.array(organisationSchema).min(6).max(200),
    locations: z.array(locationSchema).min(1).max(200),
    energyAssets: z.array(energyAssetSchema).max(200),
    projects: z.array(infrastructureProjectSchema).min(1).max(200),
    instruments: z.array(financialInstrumentSchema).min(1).max(200),
    sources: z.array(sourceDocumentSchema).min(1).max(500),
    observations: z.array(financialObservationSchema).max(1000),
    relationships: z.array(macroRelationshipSchema).min(1).max(1000),
  })
  .strict();
export type MacroGraphDataset = z.infer<typeof macroGraphDatasetSchema>;

export const graphQueryRequestSchema = z
  .object({
    queryType: z.enum(ALLOWLISTED_QUERY_TYPES),
    organisationId: nonEmptyId.optional(),
    projectId: nonEmptyId.optional(),
    sectorId: nonEmptyId.optional(),
    relationshipId: nonEmptyId.optional(),
    asOfMs: timestampMs.optional(),
    temporalBasis: z.enum(['receipt', 'publication']).default('receipt'),
    maxDepth: z.number().int().min(1).max(2).default(2),
    maxNodes: z.number().int().min(1).max(50).default(25),
    maxEdges: z.number().int().min(1).max(100).default(50),
    includeSuperseded: z.boolean().default(false),
    includeConflicting: z.boolean().default(true),
  })
  .strict();
export type GraphQueryRequest = z.infer<typeof graphQueryRequestSchema>;

export type GraphNodeView = {
  id: string;
  label: string;
  kind:
    | 'organisation'
    | 'infrastructure_project'
    | 'sector_classification'
    | 'energy_asset'
    | 'geographical_location'
    | 'financial_instrument';
  subtype: string;
  secCik: string | null;
  leiCode: string | null;
  ticker: string | null;
  sectorIds: string[];
  metadata: Record<string, string | number | boolean | null>;
};

export type GraphEdgeView = {
  relationshipId: string;
  relationType: MacroRelationship['relationType'];
  logicalEventId: string;
  version: number;
  supersedesRelationshipId: string | null;
  supersededByRelationshipId: string | null;
  category: string;
  contractualStatus: ContractualStatus;
  epistemicStatus: EpistemicStatus;
  reviewerStatus: ReviewerStatus;
  conflictGroupId: string | null;
  principalAmount: number | null;
  currencyCode: string | null;
  capacityQuantity: number | null;
  capacityUnit: 'MW' | 'GPU' | null;
  conditionsSummary: string;
  bindingObligation: boolean;
  publishedAtMs: number;
  receivedAtMs: number;
  effectiveFromMs: number;
  effectiveToMs: number | null;
  participants: Array<RelationshipParticipant & { label: string }>;
  sources: GraphSourceDocument[];
};

export type TldrStatement = {
  id: string;
  text: string;
  epistemicStatus: EpistemicStatus;
  contractualStatus: ContractualStatus | null;
  relationshipIds: string[];
  sourceDocIds: string[];
};

export type MacroTldrSummary = {
  generatedAtMs: number;
  asOfMs: number;
  temporalBasis: 'receipt' | 'publication';
  nonCausationNotice: string;
  whatChanged: TldrStatement[];
  whyItMatters: TldrStatement[];
  connectedEntitiesAndSectors: TldrStatement[];
  supportingEvidence: TldrStatement[];
  uncertainties: TldrStatement[];
  nextInformationToCollect: TldrStatement[];
};

export type GraphQueryResponse = {
  queryType: AllowlistedQueryType;
  schemaVersion: typeof MACRO_GRAPH_SCHEMA_VERSION;
  backendMode: 'typedb_live' | 'deterministic_mirror';
  typedbServerVersion: string | null;
  asOfMs: number;
  temporalBasis: 'receipt' | 'publication';
  compiledTypeQl: string;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  observations: GraphObservation[];
  conflicts: Array<{
    conflictGroupId: string;
    logicalEventId: string;
    assertions: GraphEdgeView[];
    resolutionRule: string;
  }>;
  excludedByCutoffCount: number;
  supersededHiddenCount: number;
  tldr: MacroTldrSummary;
  executionAuthority: 'none';
};
