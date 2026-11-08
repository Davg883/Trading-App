import fs from 'fs';
import path from 'path';
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

let cachedSchemaText: string | null = null;

export function loadPinnedTypeQlSchema(): string {
  if (cachedSchemaText) return cachedSchemaText;
  const schemaPath = path.join(process.cwd(), 'data', 'graph', 'macro-intelligence-schema.tql');
  cachedSchemaText = fs.readFileSync(schemaPath, 'utf8');
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
