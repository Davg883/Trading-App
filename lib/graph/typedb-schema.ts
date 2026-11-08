import {
  MACRO_GRAPH_SCHEMA_VERSION,
  type AllowlistedQueryType,
  type GraphEnergyAsset,
  type GraphInstrument,
  type GraphLocation,
  type GraphObservation,
  type GraphOrganisation,
  type GraphProject,
  type GraphQueryRequest,
  type GraphSector,
  type GraphSourceDocument,
  type MacroRelationship,
} from './contracts';

const EMBEDDED_PINNED_TYPEQL_SCHEMA = `# AI Capital Intelligence — Phase G.1: Macro Intelligence TypeQL 3 Schema
# Schema Version: macro-intelligence-graph-3.14-v1
# Compatible Server: TypeDB 3.14.2 (Community Edition / TypeDB Cloud)
# Compatible Drivers: @typedb/driver-http@3.14.0, typedb-driver==3.14.0

define

  attribute schema_version, value string;
  attribute tenant_owner, value string;
  attribute visibility_scope, value string;

  attribute org_id, value string;
  attribute sec_cik, value string;
  attribute lei_code, value string;
  attribute ticker_symbol, value string;
  attribute legal_name, value string;
  attribute display_name, value string;
  attribute org_subtype_label, value string;
  attribute incorporation_jurisdiction, value string;

  attribute sector_id, value string;
  attribute sector_name, value string;
  attribute industry_group, value string;
  attribute economic_layer, value string;

  attribute project_id, value string;
  attribute project_name, value string;
  attribute project_type, value string;
  attribute project_stage, value string;
  attribute planned_capacity_mw, value double;
  attribute energised_capacity_mw, value double;

  attribute instrument_id, value string;
  attribute instrument_type, value string;
  attribute instrument_currency, value string;
  attribute figi_code, value string;

  attribute asset_id, value string;
  attribute asset_name, value string;
  attribute energy_source_type, value string;
  attribute nameplate_capacity_mw, value double;

  attribute location_id, value string;
  attribute location_name, value string;
  attribute country_code, value string;
  attribute region_or_state, value string;
  attribute municipality, value string;
  attribute grid_zone, value string;

  attribute source_doc_id, value string;
  attribute source_title, value string;
  attribute source_url, value string;
  attribute source_kind, value string;
  attribute source_authority, value string;
  attribute content_sha256, value string;
  attribute publication_basis, value string;

  attribute observation_id, value string;
  attribute metric_name, value string;
  attribute metric_value, value double;
  attribute metric_unit, value string;
  attribute reporting_period_label, value string;
  attribute period_start_ms, value integer;
  attribute period_end_ms, value integer;
  attribute accounting_basis, value string;
  attribute metric_definition, value string;
  attribute observation_kind, value string;

  attribute relationship_id, value string;
  attribute logical_event_id, value string;
  attribute relationship_version, value integer;
  attribute supersedes_relationship_id, value string;
  attribute relationship_category, value string;
  attribute contractual_status, value string;
  attribute epistemic_status, value string;
  attribute extraction_status, value string;
  attribute reviewer_status, value string;
  attribute reviewed_by, value string;
  attribute conflict_group_id, value string;
  attribute economic_group_id, value string;

  attribute principal_amount, value double;
  attribute currency_code, value string;
  attribute capacity_unit, value string;
  attribute capacity_quantity, value double;
  attribute conditions_summary, value string;
  attribute binding_obligation, value boolean;

  attribute effective_from_ms, value integer;
  attribute effective_to_ms, value integer;
  attribute maturity_at_ms, value integer;
  attribute published_at_ms, value integer;
  attribute received_at_ms, value integer;
  attribute ingested_at_ms, value integer;
  attribute projection_key, value string;

  entity organisation,
    owns org_id @key,
    owns legal_name,
    owns display_name,
    owns org_subtype_label,
    owns sec_cik,
    owns lei_code,
    owns ticker_symbol,
    owns incorporation_jurisdiction,
    owns tenant_owner,
    owns visibility_scope,
    plays supply_relationship:supplier,
    plays supply_relationship:recipient,
    plays procurement_relationship:buyer,
    plays procurement_relationship:vendor,
    plays financing_arrangement:financier,
    plays financing_arrangement:borrower,
    plays financing_arrangement:issuer,
    plays financing_arrangement:arranger,
    plays guarantee_arrangement:guarantor,
    plays guarantee_arrangement:borrower,
    plays guarantee_arrangement:beneficiary,
    plays ownership_stake:owner_entity,
    plays ownership_stake:owned_entity,
    plays operational_control:operator,
    plays leasing_agreement:lessor,
    plays leasing_agreement:lessee,
    plays leasing_agreement:lease_guarantor,
    plays project_dependency:dependent_organisation,
    plays sector_participation:participant_organisation,
    plays observation_attribution:subject_organisation,
    plays observation_attribution:counterparty_organisation;

  entity public_company, sub organisation;
  entity private_company, sub organisation;
  entity hyperscaler, sub public_company;
  entity semiconductor_supplier, sub public_company;
  entity specialist_compute_provider, sub organisation;
  entity ai_laboratory, sub private_company;
  entity utility_provider, sub organisation;
  entity government_body, sub organisation;

  entity sector_classification,
    owns sector_id @key,
    owns sector_name,
    owns industry_group,
    owns economic_layer,
    plays sector_participation:target_sector,
    plays project_dependency:impacted_sector;

  entity infrastructure_project,
    owns project_id @key,
    owns project_name,
    owns project_type,
    owns project_stage,
    owns planned_capacity_mw,
    owns energised_capacity_mw,
    owns tenant_owner,
    owns visibility_scope,
    plays supply_relationship:target_project,
    plays procurement_relationship:target_project,
    plays financing_arrangement:target_project,
    plays guarantee_arrangement:target_project,
    plays ownership_stake:owned_project,
    plays operational_control:operated_project,
    plays leasing_agreement:leased_project,
    plays project_dependency:dependent_project,
    plays project_dependency:prerequisite_project,
    plays location_placement:located_asset,
    plays observation_attribution:subject_project;

  entity financial_instrument,
    owns instrument_id @key,
    owns instrument_type,
    owns instrument_currency,
    owns ticker_symbol,
    owns figi_code,
    plays financing_arrangement:issued_instrument,
    plays ownership_stake:held_instrument;

  entity energy_asset,
    owns asset_id @key,
    owns asset_name,
    owns energy_source_type,
    owns nameplate_capacity_mw,
    plays operational_control:operated_energy_asset,
    plays project_dependency:prerequisite_energy_asset,
    plays location_placement:located_asset;

  entity geographical_location,
    owns location_id @key,
    owns location_name,
    owns country_code,
    owns region_or_state,
    owns municipality,
    owns grid_zone,
    plays location_placement:host_location,
    plays project_dependency:regulatory_jurisdiction;

  entity source_document,
    owns source_doc_id @key,
    owns source_title,
    owns source_url,
    owns source_kind,
    owns source_authority,
    owns content_sha256,
    owns publication_basis,
    owns published_at_ms,
    owns received_at_ms,
    owns ingested_at_ms,
    owns tenant_owner,
    owns visibility_scope,
    plays evidential_support:supporting_document;

  entity financial_observation,
    owns observation_id @key,
    owns metric_name,
    owns metric_value,
    owns metric_unit,
    owns currency_code,
    owns reporting_period_label,
    owns period_start_ms,
    owns period_end_ms,
    owns accounting_basis,
    owns metric_definition,
    owns observation_kind,
    owns published_at_ms,
    owns received_at_ms,
    owns tenant_owner,
    owns visibility_scope,
    plays observation_attribution:recorded_observation,
    plays evidential_support:supported_claim;

  relation macro_relationship @abstract,
    owns relationship_id @key,
    owns logical_event_id,
    owns relationship_version,
    owns supersedes_relationship_id,
    owns relationship_category,
    owns contractual_status,
    owns epistemic_status,
    owns extraction_status,
    owns reviewer_status,
    owns reviewed_by,
    owns conflict_group_id,
    owns economic_group_id,
    owns principal_amount,
    owns currency_code,
    owns capacity_unit,
    owns capacity_quantity,
    owns conditions_summary,
    owns binding_obligation,
    owns effective_from_ms,
    owns effective_to_ms,
    owns maturity_at_ms,
    owns published_at_ms,
    owns received_at_ms,
    owns projection_key,
    owns tenant_owner,
    owns visibility_scope,
    plays evidential_support:supported_claim,
    plays supersession_link:prior_assertion,
    plays supersession_link:superseding_assertion;

  relation supply_relationship, sub macro_relationship,
    relates supplier,
    relates recipient,
    relates target_project;

  relation procurement_relationship, sub macro_relationship,
    relates buyer,
    relates vendor,
    relates target_project;

  relation financing_arrangement, sub macro_relationship,
    relates financier,
    relates borrower,
    relates issuer,
    relates arranger,
    relates target_project,
    relates issued_instrument;

  relation guarantee_arrangement, sub macro_relationship,
    relates guarantor,
    relates borrower,
    relates beneficiary,
    relates target_project;

  relation ownership_stake, sub macro_relationship,
    relates owner_entity,
    relates owned_entity,
    relates owned_project,
    relates held_instrument;

  relation operational_control, sub macro_relationship,
    relates operator,
    relates operated_project,
    relates operated_energy_asset;

  relation leasing_agreement, sub macro_relationship,
    relates lessor,
    relates lessee,
    relates lease_guarantor,
    relates leased_project;

  relation project_dependency, sub macro_relationship,
    relates dependent_project,
    relates dependent_organisation,
    relates prerequisite_project,
    relates prerequisite_energy_asset,
    relates impacted_sector,
    relates regulatory_jurisdiction;

  relation sector_participation,
    owns relationship_id @key,
    owns relationship_version,
    owns epistemic_status,
    owns published_at_ms,
    owns received_at_ms,
    owns tenant_owner,
    owns visibility_scope,
    relates participant_organisation,
    relates target_sector,
    plays evidential_support:supported_claim;

  relation location_placement,
    owns relationship_id @key,
    relates located_asset,
    relates host_location;

  relation observation_attribution,
    owns relationship_id @key,
    relates recorded_observation,
    relates subject_organisation,
    relates subject_project,
    relates counterparty_organisation;

  relation evidential_support,
    owns relationship_id @key,
    owns contractual_status,
    owns binding_obligation,
    owns extraction_status,
    owns reviewer_status,
    owns received_at_ms,
    relates supporting_document,
    relates supported_claim;

  relation supersession_link,
    owns relationship_id @key,
    owns effective_from_ms,
    relates prior_assertion,
    relates superseding_assertion;
`;

let cachedSchemaText: string | null = null;

export function loadPinnedTypeQlSchema(): string {
  if (cachedSchemaText) return cachedSchemaText;
  cachedSchemaText = EMBEDDED_PINNED_TYPEQL_SCHEMA;
  return cachedSchemaText;
}

/**
 * Escapes a string value for safe interpolation into a parameter-bound TypeQL 3 literal.
 * Rejects control characters and null bytes to prevent TypeQL injection.
 */
export function escapeTypeQlString(value: string): string {
  if (/[\0\r\n]/.test(value)) {
    throw new Error('Newlines and null bytes are forbidden in TypeQL string parameters');
  }
  if (value.length > 4000) {
    throw new Error('TypeQL string parameter exceeds maximum length (4000)');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function formatTypeQlInt(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error('TypeQL integer parameter must be a safe integer');
  }
  return String(value);
}

export function formatTypeQlDouble(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('TypeQL double parameter must be finite');
  }
  const str = String(value);
  return str.includes('.') || str.includes('e') || str.includes('E') ? str : `${str}.0`;
}

/**
 * Compiles an idempotent TypeQL 3 `put` query for a canonical sector classification.
 */
export function compileSectorPutTypeQl(sector: GraphSector): string {
  return [
    'put',
    `  $s isa sector_classification,`,
    `    has sector_id ${escapeTypeQlString(sector.sectorId)},`,
    `    has sector_name ${escapeTypeQlString(sector.sectorName)},`,
    `    has industry_group ${escapeTypeQlString(sector.industryGroup)},`,
    `    has economic_layer ${escapeTypeQlString(sector.economicLayer)};`,
  ].join('\n');
}

/**
 * Compiles an idempotent TypeQL 3 `put` query for an organisation entity and its subtype.
 */
export function compileOrganisationPutTypeQl(
  org: GraphOrganisation,
  owner: string,
  visibility: string,
): string {
  const attrs: string[] = [
    `has org_id ${escapeTypeQlString(org.orgId)}`,
    `has legal_name ${escapeTypeQlString(org.legalName)}`,
    `has display_name ${escapeTypeQlString(org.displayName)}`,
    `has org_subtype_label ${escapeTypeQlString(org.subtype)}`,
    `has incorporation_jurisdiction ${escapeTypeQlString(org.jurisdiction)}`,
    `has tenant_owner ${escapeTypeQlString(owner)}`,
    `has visibility_scope ${escapeTypeQlString(visibility)}`,
  ];
  if (org.secCik) attrs.push(`has sec_cik ${escapeTypeQlString(org.secCik)}`);
  if (org.leiCode) attrs.push(`has lei_code ${escapeTypeQlString(org.leiCode)}`);
  if (org.ticker) attrs.push(`has ticker_symbol ${escapeTypeQlString(org.ticker)}`);
  return `put\n  $o isa ${org.subtype},\n    ${attrs.join(',\n    ')};`;
}

export function compileLocationPutTypeQl(loc: GraphLocation): string {
  return [
    'put',
    `  $l isa geographical_location,`,
    `    has location_id ${escapeTypeQlString(loc.locationId)},`,
    `    has location_name ${escapeTypeQlString(loc.locationName)},`,
    `    has country_code ${escapeTypeQlString(loc.countryCode)},`,
    `    has region_or_state ${escapeTypeQlString(loc.regionOrState)},`,
    `    has municipality ${escapeTypeQlString(loc.municipality)},`,
    `    has grid_zone ${escapeTypeQlString(loc.gridZone)};`,
  ].join('\n');
}

export function compileEnergyAssetPutTypeQl(asset: GraphEnergyAsset): string {
  return [
    'put',
    `  $a isa energy_asset,`,
    `    has asset_id ${escapeTypeQlString(asset.assetId)},`,
    `    has asset_name ${escapeTypeQlString(asset.assetName)},`,
    `    has energy_source_type ${escapeTypeQlString(asset.energySourceType)},`,
    `    has nameplate_capacity_mw ${formatTypeQlDouble(asset.nameplateCapacityMw)};`,
  ].join('\n');
}

export function compileProjectPutTypeQl(
  project: GraphProject,
  owner: string,
  visibility: string,
): string {
  const attrs: string[] = [
    `has project_id ${escapeTypeQlString(project.projectId)}`,
    `has project_name ${escapeTypeQlString(project.projectName)}`,
    `has project_type ${escapeTypeQlString(project.projectType)}`,
    `has project_stage ${escapeTypeQlString(project.projectStage)}`,
    `has tenant_owner ${escapeTypeQlString(owner)}`,
    `has visibility_scope ${escapeTypeQlString(visibility)}`,
  ];
  if (project.plannedCapacityMw !== null) {
    attrs.push(`has planned_capacity_mw ${formatTypeQlDouble(project.plannedCapacityMw)}`);
  }
  if (project.energisedCapacityMw !== null) {
    attrs.push(`has energised_capacity_mw ${formatTypeQlDouble(project.energisedCapacityMw)}`);
  }
  return `put\n  $p isa infrastructure_project,\n    ${attrs.join(',\n    ')};`;
}

export function compileInstrumentPutTypeQl(inst: GraphInstrument): string {
  const attrs: string[] = [
    `has instrument_id ${escapeTypeQlString(inst.instrumentId)}`,
    `has instrument_type ${escapeTypeQlString(inst.instrumentType)}`,
    `has instrument_currency ${escapeTypeQlString(inst.instrumentCurrency)}`,
  ];
  if (inst.ticker) attrs.push(`has ticker_symbol ${escapeTypeQlString(inst.ticker)}`);
  if (inst.figiCode) attrs.push(`has figi_code ${escapeTypeQlString(inst.figiCode)}`);
  return `put\n  $i isa financial_instrument,\n    ${attrs.join(',\n    ')};`;
}

export function compileSourceDocumentPutTypeQl(
  doc: GraphSourceDocument,
  owner: string,
  visibility: string,
): string {
  return [
    'put',
    `  $d isa source_document,`,
    `    has source_doc_id ${escapeTypeQlString(doc.sourceDocId)},`,
    `    has source_title ${escapeTypeQlString(doc.title)},`,
    `    has source_url ${escapeTypeQlString(doc.url)},`,
    `    has source_kind ${escapeTypeQlString(doc.kind)},`,
    `    has source_authority ${escapeTypeQlString(doc.authority)},`,
    `    has content_sha256 ${escapeTypeQlString(doc.contentSha256)},`,
    `    has publication_basis ${escapeTypeQlString(doc.publicationBasis)},`,
    `    has published_at_ms ${formatTypeQlInt(doc.publishedAtMs)},`,
    `    has received_at_ms ${formatTypeQlInt(doc.receivedAtMs)},`,
    `    has ingested_at_ms ${formatTypeQlInt(doc.ingestedAtMs)},`,
    `    has tenant_owner ${escapeTypeQlString(owner)},`,
    `    has visibility_scope ${escapeTypeQlString(visibility)};`,
  ].join('\n');
}

export function compileObservationPutTypeQl(
  obs: GraphObservation,
  owner: string,
  visibility: string,
): string {
  const attrs: string[] = [
    `has observation_id ${escapeTypeQlString(obs.observationId)}`,
    `has metric_name ${escapeTypeQlString(obs.metricName)}`,
    `has metric_value ${formatTypeQlDouble(obs.metricValue)}`,
    `has metric_unit ${escapeTypeQlString(obs.metricUnit)}`,
    `has reporting_period_label ${escapeTypeQlString(obs.reportingPeriodLabel)}`,
    `has period_start_ms ${formatTypeQlInt(obs.periodStartMs)}`,
    `has period_end_ms ${formatTypeQlInt(obs.periodEndMs)}`,
    `has accounting_basis ${escapeTypeQlString(obs.accountingBasis)}`,
    `has metric_definition ${escapeTypeQlString(obs.metricDefinition)}`,
    `has observation_kind ${escapeTypeQlString(obs.observationKind)}`,
    `has published_at_ms ${formatTypeQlInt(obs.publishedAtMs)}`,
    `has received_at_ms ${formatTypeQlInt(obs.receivedAtMs)}`,
    `has tenant_owner ${escapeTypeQlString(owner)}`,
    `has visibility_scope ${escapeTypeQlString(visibility)}`,
  ];
  if (obs.currencyCode) attrs.push(`has currency_code ${escapeTypeQlString(obs.currencyCode)}`);
  return `put\n  $obs isa financial_observation,\n    ${attrs.join(',\n    ')};`;
}

const ENTITY_KEY_ATTR_BY_KIND: Record<
  MacroRelationship['participants'][number]['entityKind'],
  string
> = {
  organisation: 'org_id',
  infrastructure_project: 'project_id',
  financial_instrument: 'instrument_id',
  energy_asset: 'asset_id',
  geographical_location: 'location_id',
  sector_classification: 'sector_id',
};

/**
 * Compiles a TypeQL 3 `match ... put` statement for an N-ary typed relationship
 * and its evidential support links.
 */
export function compileRelationshipInsertTypeQl(
  rel: MacroRelationship,
  projectionKey: string,
  owner: string,
  visibility: string,
): string {
  const matchClauses: string[] = [];
  const rolePlayers: string[] = [];

  rel.participants.forEach((p, idx) => {
    const varName = `$p${idx}`;
    const keyAttr = ENTITY_KEY_ATTR_BY_KIND[p.entityKind];
    matchClauses.push(
      `  ${varName} isa ${p.entityKind}, has ${keyAttr} ${escapeTypeQlString(p.entityId)};`,
    );
    rolePlayers.push(`${p.role}: ${varName}`);
  });

  const attrs: string[] = [
    `has relationship_id ${escapeTypeQlString(rel.relationshipId)}`,
    `has logical_event_id ${escapeTypeQlString(rel.logicalEventId)}`,
    `has relationship_version ${formatTypeQlInt(rel.version)}`,
    `has relationship_category ${escapeTypeQlString(rel.category)}`,
    `has contractual_status ${escapeTypeQlString(rel.contractualStatus)}`,
    `has epistemic_status ${escapeTypeQlString(rel.epistemicStatus)}`,
    `has extraction_status ${escapeTypeQlString(rel.extractionStatus)}`,
    `has reviewer_status ${escapeTypeQlString(rel.reviewerStatus)}`,
    `has conditions_summary ${escapeTypeQlString(rel.conditionsSummary)}`,
    `has binding_obligation ${rel.bindingObligation ? 'true' : 'false'}`,
    `has effective_from_ms ${formatTypeQlInt(rel.effectiveFromMs)}`,
    `has published_at_ms ${formatTypeQlInt(rel.publishedAtMs)}`,
    `has received_at_ms ${formatTypeQlInt(rel.receivedAtMs)}`,
    `has projection_key ${escapeTypeQlString(projectionKey)}`,
    `has tenant_owner ${escapeTypeQlString(owner)}`,
    `has visibility_scope ${escapeTypeQlString(visibility)}`,
  ];

  if (rel.supersedesRelationshipId) {
    attrs.push(
      `has supersedes_relationship_id ${escapeTypeQlString(rel.supersedesRelationshipId)}`,
    );
  }
  if (rel.reviewedBy) {
    attrs.push(`has reviewed_by ${escapeTypeQlString(rel.reviewedBy)}`);
  }
  if (rel.conflictGroupId) {
    attrs.push(`has conflict_group_id ${escapeTypeQlString(rel.conflictGroupId)}`);
  }
  if (rel.economicGroupId) {
    attrs.push(`has economic_group_id ${escapeTypeQlString(rel.economicGroupId)}`);
  }
  if (rel.principalAmount !== null) {
    attrs.push(`has principal_amount ${formatTypeQlDouble(rel.principalAmount)}`);
  }
  if (rel.currencyCode) {
    attrs.push(`has currency_code ${escapeTypeQlString(rel.currencyCode)}`);
  }
  if (rel.capacityUnit) {
    attrs.push(`has capacity_unit ${escapeTypeQlString(rel.capacityUnit)}`);
  }
  if (rel.capacityQuantity !== null) {
    attrs.push(`has capacity_quantity ${formatTypeQlDouble(rel.capacityQuantity)}`);
  }
  if (rel.effectiveToMs !== null) {
    attrs.push(`has effective_to_ms ${formatTypeQlInt(rel.effectiveToMs)}`);
  }
  if (rel.maturityAtMs !== null) {
    attrs.push(`has maturity_at_ms ${formatTypeQlInt(rel.maturityAtMs)}`);
  }

  return [
    'match',
    ...matchClauses,
    'put',
    `  $rel isa ${rel.relationType},`,
    `    links (${rolePlayers.join(', ')}),`,
    `    ${attrs.join(',\n    ')};`,
  ].join('\n');
}

export function compileEvidentialSupportInsertTypeQl(
  rel: MacroRelationship,
  sourceDocId: string,
): string {
  const supportId = `evsup:${rel.relationshipId}:${sourceDocId}`;
  return [
    'match',
    `  $rel isa macro_relationship, has relationship_id ${escapeTypeQlString(rel.relationshipId)};`,
    `  $doc isa source_document, has source_doc_id ${escapeTypeQlString(sourceDocId)};`,
    'put',
    `  $sup isa evidential_support,`,
    `    links (supporting_document: $doc, supported_claim: $rel),`,
    `    has relationship_id ${escapeTypeQlString(supportId)},`,
    `    has contractual_status ${escapeTypeQlString(rel.contractualStatus)},`,
    `    has binding_obligation ${rel.bindingObligation ? 'true' : 'false'},`,
    `    has extraction_status ${escapeTypeQlString(rel.extractionStatus)},`,
    `    has reviewer_status ${escapeTypeQlString(rel.reviewerStatus)},`,
    `    has received_at_ms ${formatTypeQlInt(rel.receivedAtMs)};`,
  ].join('\n');
}

/**
 * Compiles an allowlisted, parameter-bound read-only TypeQL 3 query template.
 * Never accepts raw TypeQL from callers.
 */
export function buildAllowlistedTypeQlQuery(
  request: GraphQueryRequest,
  callerOwner: string,
): { queryType: AllowlistedQueryType; typeql: string; schemaVersion: string } {
  const asOfMs = request.asOfMs ?? Date.now();
  const limit = Math.min(request.maxEdges ?? 50, 100);
  const temporalAttr =
    request.temporalBasis === 'publication' ? 'published_at_ms' : 'received_at_ms';
  const ownerLit = escapeTypeQlString(callerOwner);

  switch (request.queryType) {
    case 'organisation_relationship_summary': {
      const orgId = escapeTypeQlString(request.organisationId ?? 'org-nscale');
      const typeql = [
        '# Allowlisted Template: organisation_relationship_summary',
        'match',
        `  $org isa organisation, has org_id ${orgId};`,
        '  $rel isa macro_relationship, links ($org, $counterparty),',
        '    has relationship_id $relId,',
        '    has contractual_status $cStatus,',
        '    has epistemic_status $eStatus,',
        '    has published_at_ms $pubMs,',
        '    has received_at_ms $recMs,',
        '    has visibility_scope $vis,',
        '    has tenant_owner $owner;',
        `  $pubMs <= ${formatTypeQlInt(asOfMs)};`,
        `  ${temporalAttr === 'received_at_ms' ? `$recMs <= ${formatTypeQlInt(asOfMs)};` : ''}`,
        `  { $vis == "public_research"; } or { $owner == ${ownerLit}; };`,
        `limit ${formatTypeQlInt(limit)};`,
      ]
        .filter(Boolean)
        .join('\n');
      return {
        queryType: request.queryType,
        typeql,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      };
    }

    case 'project_dependency_network': {
      const projectId = escapeTypeQlString(request.projectId ?? 'proj-monarch-wv');
      const typeql = [
        '# Allowlisted Template: project_dependency_network (bounded 1-2 hops)',
        'match',
        `  $proj isa infrastructure_project, has project_id ${projectId};`,
        '  $rel isa macro_relationship, links ($proj, $participant),',
        '    has relationship_id $relId,',
        '    has contractual_status $cStatus,',
        '    has epistemic_status $eStatus,',
        '    has published_at_ms $pubMs,',
        '    has received_at_ms $recMs;',
        `  $pubMs <= ${formatTypeQlInt(asOfMs)};`,
        `  ${temporalAttr === 'received_at_ms' ? `$recMs <= ${formatTypeQlInt(asOfMs)};` : ''}`,
        `limit ${formatTypeQlInt(limit)};`,
      ]
        .filter(Boolean)
        .join('\n');
      return {
        queryType: request.queryType,
        typeql,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      };
    }

    case 'shared_counterparty_exposure': {
      const orgId = escapeTypeQlString(request.organisationId ?? 'org-nvda');
      const typeql = [
        '# Allowlisted Template: shared_counterparty_exposure',
        'match',
        `  $hub isa organisation, has org_id ${orgId};`,
        '  $rel1 isa macro_relationship, links ($hub, $counterparty),',
        '    has relationship_id $relId1,',
        '    has published_at_ms $pub1,',
        '    has received_at_ms $rec1;',
        '  $rel2 isa macro_relationship, links ($counterparty, $downstream),',
        '    has relationship_id $relId2,',
        '    has published_at_ms $pub2,',
        '    has received_at_ms $rec2;',
        `  $pub1 <= ${formatTypeQlInt(asOfMs)};`,
        `  $pub2 <= ${formatTypeQlInt(asOfMs)};`,
        `limit ${formatTypeQlInt(limit)};`,
      ].join('\n');
      return {
        queryType: request.queryType,
        typeql,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      };
    }

    case 'sector_connections': {
      const sectorId = escapeTypeQlString(request.sectorId ?? 'sec-specialist-neoclouds');
      const typeql = [
        '# Allowlisted Template: sector_connections',
        'match',
        `  $sec isa sector_classification, has sector_id ${sectorId};`,
        '  $part isa sector_participation, links (target_sector: $sec, participant_organisation: $org);',
        '  $rel isa macro_relationship, links ($org, $counterparty),',
        '    has relationship_id $relId,',
        '    has published_at_ms $pubMs,',
        '    has received_at_ms $recMs;',
        `  $pubMs <= ${formatTypeQlInt(asOfMs)};`,
        `limit ${formatTypeQlInt(limit)};`,
      ].join('\n');
      return {
        queryType: request.queryType,
        typeql,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      };
    }

    case 'as_known_at_date_graph': {
      const typeql = [
        '# Allowlisted Template: as_known_at_date_graph',
        'match',
        '  $rel isa macro_relationship,',
        '    has relationship_id $relId,',
        '    has logical_event_id $logicalId,',
        '    has relationship_version $ver,',
        '    has contractual_status $cStatus,',
        '    has epistemic_status $eStatus,',
        '    has published_at_ms $pubMs,',
        '    has received_at_ms $recMs,',
        '    has visibility_scope $vis,',
        '    has tenant_owner $owner;',
        `  $pubMs <= ${formatTypeQlInt(asOfMs)};`,
        `  ${temporalAttr === 'received_at_ms' ? `$recMs <= ${formatTypeQlInt(asOfMs)};` : ''}`,
        `  { $vis == "public_research"; } or { $owner == ${ownerLit}; };`,
        `limit ${formatTypeQlInt(limit)};`,
      ]
        .filter(Boolean)
        .join('\n');
      return {
        queryType: request.queryType,
        typeql,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      };
    }

    case 'relationship_source_evidence': {
      const relId = escapeTypeQlString(
        request.relationshipId ?? 'rel-anthropic-monarch-services-r1',
      );
      const typeql = [
        '# Allowlisted Template: relationship_source_evidence',
        'match',
        `  $rel isa macro_relationship, has relationship_id ${relId};`,
        '  $sup isa evidential_support, links (supported_claim: $rel, supporting_document: $doc),',
        '    has contractual_status $cStatus,',
        '    has binding_obligation $binding;',
        '  $doc has source_doc_id $docId, has source_url $url, has published_at_ms $pubMs, has received_at_ms $recMs;',
        `limit ${formatTypeQlInt(limit)};`,
      ].join('\n');
      return {
        queryType: request.queryType,
        typeql,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      };
    }
  }
}
