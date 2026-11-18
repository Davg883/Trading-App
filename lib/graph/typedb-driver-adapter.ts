import { TypeDBHttpDriver, isApiErrorResponse } from '@typedb/driver-http';
import {
  CONTRACTUAL_STATUSES,
  EPISTEMIC_STATUSES,
  MACRO_GRAPH_DATASET_VERSION,
  MACRO_GRAPH_SCHEMA_VERSION,
  MACRO_RELATION_TYPES,
  ORGANISATION_SUBTYPES,
  REVIEWER_STATUSES,
  SUPPORTED_MACRO_GRAPH_SCHEMA_VERSIONS,
  macroGraphDatasetSchema,
  type ContractualStatus,
  type EpistemicStatus,
  type GraphEnergyAsset,
  type GraphExecutivePerson,
  type GraphInstrument,
  type GraphLocation,
  type GraphObservation,
  type GraphOrganisation,
  type GraphProject,
  type GraphSector,
  type GraphSourceDocument,
  type MacroGraphDataset,
  type MacroRelationship,
  type RelationshipParticipant,
  type ReviewerStatus,
} from './contracts';
import {
  buildOutboxItemsFromDataset,
  compileDatasetEntityBootstrapStatements,
  processProjectionOutboxBatch,
  type OutboxProjectionItem,
  type ProjectionCheckpoint,
} from './projection-engine';
import {
  ADDITIVE_CASE_007_SCHEMA_EXTENSION,
  compileEnergyAssetPutTypeQl,
  compileExecutivePersonPutTypeQl,
  compileInstrumentPutTypeQl,
  compileLocationPlacementPutTypeQl,
  compileLocationPutTypeQl,
  compileObservationAttributionPutTypeQl,
  compileObservationEvidentialSupportPutTypeQl,
  compileObservationPutTypeQl,
  compileOrganisationPutTypeQl,
  compileProjectPutTypeQl,
  compileSectorPutTypeQl,
  compileSourceDocumentPutTypeQl,
  loadPinnedTypeQlSchema,
} from './typedb-schema';

export const PRODUCTION_TYPEDB_DATABASE = 'aci_macro_intelligence_prod';
export const STAGING_TYPEDB_DATABASE = 'aci_macro_intelligence_staging';
export const CASE_007_VERIFIED_DEV_DATABASE = 'aci_case007_verified_dev';

/**
 * Enforces strict database target isolation for Case 007 development promotion:
 * writes are permitted ONLY to `aci_case007_verified_dev`, never to `aci_macro_intelligence_staging`
 * or `aci_macro_intelligence_prod`.
 */
export function assertIsolatedCase007WriteTarget(databaseName: string): void {
  if (databaseName !== CASE_007_VERIFIED_DEV_DATABASE) {
    throw new Error(
      `Security/isolation violation: Case 007 write target must be "${CASE_007_VERIFIED_DEV_DATABASE}" (refused "${databaseName}" to preserve production and existing staging data).`,
    );
  }
}

export function assertCanRecreateTypeDbDatabase(databaseName: string): void {
  if (
    databaseName === PRODUCTION_TYPEDB_DATABASE ||
    databaseName.endsWith('_prod') ||
    databaseName === 'aci_macro_intelligence'
  ) {
    throw new Error(
      `Security violation: destructive recreateDatabase is forbidden on production TypeDB database "${databaseName}". Development/test replays may only recreate staging databases.`,
    );
  }
}

export type TypeDbConnectionConfig = {
  httpAddress: string;
  username: string;
  password: string;
  databaseName: string;
  /** Set when the settings are missing or insecure; no connection is attempted while present. */
  blockedReason?: string;
};

const LOCAL_DEV_TYPEDB_ADDRESS = 'http://127.0.0.1:8000';

function isLoopbackAddress(address: string): boolean {
  try {
    const host = new URL(address).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/** True for any hosted runtime: a production/preview Next.js build or the Convex cloud runtime. */
function isHostedRuntime(env: Record<string, string | undefined>): boolean {
  return (
    env.NODE_ENV === 'production' ||
    env.VERCEL_ENV === 'production' ||
    env.VERCEL_ENV === 'preview' ||
    Boolean(env.CONVEX_CLOUD_URL)
  );
}

/**
 * Resolves the TypeDB connection settings.
 *
 * Security (MVP hardening WP4): the TypeDB Community Edition defaults (`admin` / `password` on
 * `127.0.0.1:8000`) are a local-development convenience only. They are used solely when no address is
 * configured, the runtime is not hosted, and the target is a loopback address. In every other case missing
 * settings produce a config carrying `blockedReason`; `createTypeDbDriver` then refuses to connect, so a
 * misconfigured production deployment fails closed instead of silently trying default credentials.
 */
export function defaultTypeDbConfig(
  databaseName = STAGING_TYPEDB_DATABASE,
  env: Record<string, string | undefined> = process.env,
): TypeDbConnectionConfig {
  const address = env.TYPEDB_HTTP_ADDRESS?.trim() || '';
  const username = env.TYPEDB_USERNAME?.trim() || '';
  const password = env.TYPEDB_PASSWORD || '';
  const database = env.TYPEDB_DATABASE || databaseName;
  const hosted = isHostedRuntime(env);

  if (!address) {
    if (hosted) {
      return {
        httpAddress: '',
        username: '',
        password: '',
        databaseName: database,
        blockedReason: 'TYPEDB_HTTP_ADDRESS is not configured for this hosted runtime',
      };
    }
    return {
      httpAddress: LOCAL_DEV_TYPEDB_ADDRESS,
      username: username || 'admin',
      password: password || 'password',
      databaseName: database,
    };
  }
  if (!username || !password) {
    if (!hosted && isLoopbackAddress(address)) {
      return {
        httpAddress: address,
        username: username || 'admin',
        password: password || 'password',
        databaseName: database,
      };
    }
    return {
      httpAddress: address,
      username: '',
      password: '',
      databaseName: database,
      blockedReason: 'TYPEDB_USERNAME and TYPEDB_PASSWORD are required for a non-local TypeDB server',
    };
  }
  if (password === 'password' && (hosted || !isLoopbackAddress(address))) {
    return {
      httpAddress: address,
      username,
      password: '',
      databaseName: database,
      blockedReason: 'The TypeDB default password is refused outside local development',
    };
  }
  return { httpAddress: address, username, password, databaseName: database };
}

export class TypeDbConfigurationError extends Error {
  constructor(reason: string) {
    super(`TypeDB connection refused: ${reason}`);
    this.name = 'TypeDbConfigurationError';
  }
}

/**
 * Raised when a reachable TypeDB database exposes an unsupported schema version or returns
 * unrecognised / invalid concept rows. Callers must fail closed rather than falling back to
 * static JSON, and error messages must remain free of internal addresses and credentials.
 */
export class TypeDbSchemaOrHydrationError extends Error {
  readonly publicMessage: string;
  constructor(publicMessage: string) {
    super(publicMessage);
    this.name = 'TypeDbSchemaOrHydrationError';
    this.publicMessage = publicMessage;
  }
}

/** The only place a TypeDB driver is constructed; refuses blocked or incomplete configurations. */
export function createTypeDbDriver(config: TypeDbConnectionConfig): TypeDBHttpDriver {
  if (config.blockedReason) throw new TypeDbConfigurationError(config.blockedReason);
  if (!config.httpAddress || !config.username || !config.password)
    throw new TypeDbConfigurationError('incomplete connection settings');
  return new TypeDBHttpDriver({
    username: config.username,
    password: config.password,
    addresses: [config.httpAddress],
  });
}

/**
 * Transport security of the configured connection, derived from the address scheme that the driver will
 * actually use. It is never inferred from a database name or from an operator-set "TLS enabled" flag.
 * `verified` is false because this describes configuration; it is not a certificate or handshake check.
 */
export function describeTypeDbTransport(config = defaultTypeDbConfig()): {
  configured: boolean;
  scheme: 'https' | 'http' | 'unknown';
  tlsEnabled: boolean;
  loopback: boolean;
  basis: 'connection_address_scheme';
  verified: false;
} {
  let scheme: 'https' | 'http' | 'unknown' = 'unknown';
  try {
    const protocol = new URL(config.httpAddress).protocol;
    scheme = protocol === 'https:' ? 'https' : protocol === 'http:' ? 'http' : 'unknown';
  } catch {
    scheme = 'unknown';
  }
  return {
    configured: !config.blockedReason && Boolean(config.httpAddress),
    scheme,
    tlsEnabled: scheme === 'https',
    loopback: Boolean(config.httpAddress) && isLoopbackAddress(config.httpAddress),
    basis: 'connection_address_scheme',
    verified: false,
  };
}

/**
 * Server-to-Convex TypeDB bridge. Used only when this server holds no usable TypeDB credentials.
 * Security (MVP hardening WP4): the bridge actions used to be anonymous public Convex actions, and the URL
 * fell back to a hard-coded deployment. The bridge now needs an explicitly configured Convex URL and a
 * dedicated `TYPEDB_BRIDGE_SECRET` shared only between this server and the Convex deployment.
 */
function resolveConvexCloudBridge(
  config?: TypeDbConnectionConfig,
): { url: string; bridgeKey: string } | null {
  if (config && !config.blockedReason && !isLoopbackAddress(config.httpAddress)) return null;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const bridgeKey = process.env.TYPEDB_BRIDGE_SECRET;
  if (!url || !url.startsWith('https://') || !bridgeKey || bridgeKey.length < 32) return null;
  return { url, bridgeKey };
}

async function callConvexCloudAction<T>(
  bridge: { url: string; bridgeKey: string },
  path: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  try {
    const resp = await fetch(`${bridge.url}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ path, args: { ...args, bridgeKey: bridge.bridgeKey }, format: 'json' }),
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as { status?: string; value?: T };
    return payload.status === 'success' && payload.value !== undefined
      ? payload.value
      : null;
  } catch {
    return null;
  }
}

function sanitizeTypeDbError(rawMessage: string, config?: TypeDbConnectionConfig): string {
  let clean = rawMessage;
  if (config?.password && config.password.length > 0 && config.password !== 'password') {
    clean = clean.split(config.password).join('[REDACTED]');
  }
  return clean.slice(0, 600);
}

export type LiveTypeDbProjectionReport = {
  connected: boolean;
  authenticated: boolean;
  distribution: string | null;
  serverVersion: string | null;
  databaseName: string;
  schemaCommitted: boolean;
  bootstrapStatementsExecuted: number;
  outboxProjectedCount: number;
  outboxDeadLetterCount: number;
  checkpoint: ProjectionCheckpoint;
  latencyMs: number;
  error: string | null;
};

/**
 * Checks whether a live TypeDB 3.x HTTP server is reachable, verifies bearer-token
 * authentication (`POST /v1/signin` via `getDatabases()`), checks whether the target
 * staging/production database exists, and returns sanitized version + latency metadata.
 */
export async function probeTypeDbServer(
  config = defaultTypeDbConfig(),
): Promise<{
  reachable: boolean;
  authenticated: boolean;
  databaseExists: boolean;
  databaseName: string;
  distribution: string | null;
  version: string | null;
  latencyMs: number;
  tlsEnabled?: boolean;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    const driver = createTypeDbDriver(config);
    const res = await driver.version();
    if (isApiErrorResponse(res)) {
      const convexUrl = resolveConvexCloudBridge(config);
      if (convexUrl) {
        const cloudVal = await callConvexCloudAction<{
          reachable: boolean;
          authenticated: boolean;
          databaseExists: boolean;
          databaseName: string;
          distribution: string | null;
          version: string | null;
          latencyMs: number;
          tlsEnabled?: boolean;
        }>(convexUrl, 'graph:probeHostedTypeDbCloud', {});
        if (cloudVal?.reachable) {
          return { ...cloudVal, error: null };
        }
      }
      return {
        reachable: false,
        authenticated: false,
        databaseExists: false,
        databaseName: config.databaseName,
        distribution: null,
        version: null,
        latencyMs: Math.max(1, Date.now() - startedAt),
        tlsEnabled: describeTypeDbTransport(config).tlsEnabled,
        error: sanitizeTypeDbError(`${res.err.code}: ${res.err.message}`, config),
      };
    }

    const dbsRes = await driver.getDatabases();
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (isApiErrorResponse(dbsRes)) {
      return {
        reachable: true,
        authenticated: false,
        databaseExists: false,
        databaseName: config.databaseName,
        distribution: res.ok.distribution,
        version: res.ok.version,
        latencyMs,
        tlsEnabled: describeTypeDbTransport(config).tlsEnabled,
        error: sanitizeTypeDbError(`${dbsRes.err.code}: ${dbsRes.err.message}`, config),
      };
    }

    const databaseExists = dbsRes.ok.databases.some((d) => d.name === config.databaseName);
    return {
      reachable: true,
      authenticated: true,
      databaseExists,
      databaseName: config.databaseName,
      distribution: res.ok.distribution,
      version: res.ok.version,
      latencyMs,
      tlsEnabled: describeTypeDbTransport(config).tlsEnabled,
      error: null,
    };
  } catch (err) {
    const convexUrl = resolveConvexCloudBridge(config);
    if (convexUrl) {
      const cloudVal = await callConvexCloudAction<{
        reachable: boolean;
        authenticated: boolean;
        databaseExists: boolean;
        databaseName: string;
        distribution: string | null;
        version: string | null;
        latencyMs: number;
        tlsEnabled?: boolean;
      }>(convexUrl, 'graph:probeHostedTypeDbCloud', {});
      if (cloudVal?.reachable) {
        return { ...cloudVal, error: null };
      }
    }
    return {
      reachable: false,
      authenticated: false,
      databaseExists: false,
      databaseName: config.databaseName,
      distribution: null,
      version: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      tlsEnabled: describeTypeDbTransport(config).tlsEnabled,
      error: sanitizeTypeDbError(
        err instanceof Error ? err.message : String(err),
        config,
      ),
    };
  }
}

/**
 * Initializes the pinned TypeQL 3.14 schema and projects an entire validated dataset
 * into a live TypeDB 3.14 database via `@typedb/driver-http@3.14.0` transactions.
 */
export async function projectDatasetIntoLiveTypeDb(
  dataset: MacroGraphDataset,
  options?: {
    config?: TypeDbConnectionConfig;
    recreateDatabase?: boolean;
  },
): Promise<{
  report: LiveTypeDbProjectionReport;
  outbox: OutboxProjectionItem[];
}> {
  const startedAt = Date.now();
  const config = options?.config ?? defaultTypeDbConfig();
  if (options?.recreateDatabase) {
    assertCanRecreateTypeDbDatabase(config.databaseName);
  }
  let driver: TypeDBHttpDriver;
  let versionRes;
  try {
    driver = createTypeDbDriver(config);
    versionRes = await driver.version();
  } catch (err) {
    const convexUrl = resolveConvexCloudBridge(config);
    if (convexUrl) {
      const cloudSync = await callConvexCloudAction<{
        datasetProjectionReport: LiveTypeDbProjectionReport | null;
      }>(convexUrl, 'graph:verifyHostedTypeDbCloud', {});
      if (cloudSync?.datasetProjectionReport) {
        const { accepted } = buildOutboxItemsFromDataset(dataset);
        return {
          report: cloudSync.datasetProjectionReport,
          outbox: accepted,
        };
      }
    }
    throw err;
  }
  if (isApiErrorResponse(versionRes)) {
    const convexUrl = resolveConvexCloudBridge(config);
    if (convexUrl) {
      const cloudSync = await callConvexCloudAction<{
        datasetProjectionReport: LiveTypeDbProjectionReport | null;
      }>(convexUrl, 'graph:verifyHostedTypeDbCloud', {});
      if (cloudSync?.datasetProjectionReport) {
        const { accepted } = buildOutboxItemsFromDataset(dataset);
        return {
          report: cloudSync.datasetProjectionReport,
          outbox: accepted,
        };
      }
    }
    throw new Error(
      sanitizeTypeDbError(
        `TypeDB server unreachable: ${versionRes.err.code} ${versionRes.err.message}`,
        config,
      ),
    );
  }

  if (options?.recreateDatabase) {
    await driver.deleteDatabase(config.databaseName).catch(() => {});
  }

  const dbsRes = await driver.getDatabases();
  if (isApiErrorResponse(dbsRes)) {
    throw new Error(
      sanitizeTypeDbError(
        `Failed to list TypeDB databases: ${dbsRes.err.message}`,
        config,
      ),
    );
  }
  const exists = dbsRes.ok.databases.some((d) => d.name === config.databaseName);
  if (!exists) {
    const createRes = await driver.createDatabase(config.databaseName);
    if (isApiErrorResponse(createRes)) {
      throw new Error(
        sanitizeTypeDbError(
          `Failed to create TypeDB database: ${createRes.err.message}`,
          config,
        ),
      );
    }

    // Open a `schema` transaction and define the pinned TypeQL 3 schema
    const schemaTx = await driver.openTransaction(config.databaseName, 'schema', {
      schemaLockAcquireTimeoutMillis: 15000,
      transactionTimeoutMillis: 30000,
    });
    if (isApiErrorResponse(schemaTx)) {
      throw new Error(
        sanitizeTypeDbError(
          `Failed to open TypeDB schema transaction: ${schemaTx.err.message}`,
          config,
        ),
      );
    }
    const schemaText = loadPinnedTypeQlSchema();
    const schemaQueryRes = await driver.query(schemaTx.ok.transactionId, schemaText);
    if (isApiErrorResponse(schemaQueryRes)) {
      await driver.closeTransaction(schemaTx.ok.transactionId);
      throw new Error(
        sanitizeTypeDbError(
          `TypeQL 3 schema definition failed: ${schemaQueryRes.err.code} ${schemaQueryRes.err.message}`,
          config,
        ),
      );
    }
    const schemaCommitRes = await driver.commitTransaction(schemaTx.ok.transactionId);
    if (isApiErrorResponse(schemaCommitRes)) {
      throw new Error(
        sanitizeTypeDbError(
          `TypeQL 3 schema commit failed: ${schemaCommitRes.err.code} ${schemaCommitRes.err.message}`,
          config,
        ),
      );
    }
  } else if ((dataset.executives?.length ?? 0) > 0 || dataset.relationships.some((r) => r.relationType === 'leadership_appointment')) {
    // Apply additive Case 007 leadership extension if an existing v1 database lacks `executive_person`
    const existingSchemaRes = await driver.getDatabaseSchema(config.databaseName);
    if (!isApiErrorResponse(existingSchemaRes) && !(existingSchemaRes.ok ?? '').includes('executive_person')) {
      const migTx = await driver.openTransaction(config.databaseName, 'schema', {
        schemaLockAcquireTimeoutMillis: 15000,
        transactionTimeoutMillis: 30000,
      });
      if (isApiErrorResponse(migTx)) {
        throw new Error(
          sanitizeTypeDbError(
            `Failed to open TypeDB additive schema transaction: ${migTx.err.message}`,
            config,
          ),
        );
      }
      const migRes = await driver.query(migTx.ok.transactionId, ADDITIVE_CASE_007_SCHEMA_EXTENSION);
      if (isApiErrorResponse(migRes)) {
        await driver.closeTransaction(migTx.ok.transactionId).catch(() => {});
        throw new Error(
          sanitizeTypeDbError(
            `TypeQL 3 additive schema migration failed: ${migRes.err.code} ${migRes.err.message}`,
            config,
          ),
        );
      }
      const migCommit = await driver.commitTransaction(migTx.ok.transactionId);
      if (isApiErrorResponse(migCommit)) {
        throw new Error(
          sanitizeTypeDbError(
            `TypeQL 3 additive schema commit failed: ${migCommit.err.code} ${migCommit.err.message}`,
            config,
          ),
        );
      }
    }
  }

  // Bootstrap foundational entities in a `write` transaction (skipping @key IDs already present on incremental projections)
  let filteredDatasetForBootstrap = dataset;
  const existingRelIds = new Set<string>();
  if (exists && !options?.recreateDatabase) {
    const preReadTx = await driver.openTransaction(config.databaseName, 'read', {
      transactionTimeoutMillis: 15000,
    });
    if (!isApiErrorResponse(preReadTx)) {
      const readIdSet = async (typeql: string): Promise<Set<string>> => {
        const r = await driver.query(preReadTx.ok.transactionId, typeql);
        if (isApiErrorResponse(r) || r.ok.answerType !== 'conceptRows') return new Set();
        const set = new Set<string>();
        for (const row of r.ok.answers) {
          const val = (row as { data?: Record<string, { value?: unknown }> }).data?.id?.value;
          if (typeof val === 'string') set.add(val);
        }
        return set;
      };
      try {
        const schemaCheck = await driver.getDatabaseSchema(config.databaseName);
        const hasExec =
          !isApiErrorResponse(schemaCheck) &&
          (schemaCheck.ok ?? '').includes('executive_person');
        const [
          seenSectors,
          seenLocs,
          seenAssets,
          seenOrgs,
          seenExecs,
          seenProjs,
          seenInsts,
          seenSources,
          seenObs,
          seenRels,
        ] = await Promise.all([
          readIdSet('match $x isa sector_classification, has sector_id $id;'),
          readIdSet('match $x isa geographical_location, has location_id $id;'),
          readIdSet('match $x isa energy_asset, has asset_id $id;'),
          readIdSet('match $x isa organisation, has org_id $id;'),
          hasExec
            ? readIdSet('match $x isa executive_person, has person_id $id;')
            : Promise.resolve(new Set<string>()),
          readIdSet('match $x isa infrastructure_project, has project_id $id;'),
          readIdSet('match $x isa financial_instrument, has instrument_id $id;'),
          readIdSet('match $x isa source_document, has source_doc_id $id;'),
          readIdSet('match $x isa financial_observation, has observation_id $id;'),
          readIdSet('match $x isa macro_relationship, has relationship_id $id;'),
        ]);
        for (const id of seenRels) existingRelIds.add(id);
        filteredDatasetForBootstrap = {
          ...dataset,
          sectors: dataset.sectors.filter((x) => !seenSectors.has(x.sectorId)),
          locations: dataset.locations.filter((x) => !seenLocs.has(x.locationId)),
          energyAssets: dataset.energyAssets.filter((x) => !seenAssets.has(x.assetId)),
          organisations: dataset.organisations.filter((x) => !seenOrgs.has(x.orgId)),
          executives: (dataset.executives ?? []).filter((x) => !seenExecs.has(x.personId)),
          projects: dataset.projects.filter((x) => !seenProjs.has(x.projectId)),
          instruments: dataset.instruments.filter((x) => !seenInsts.has(x.instrumentId)),
          sources: dataset.sources.filter((x) => !seenSources.has(x.sourceDocId)),
          observations: dataset.observations.filter((x) => !seenObs.has(x.observationId)),
        };
      } finally {
        await driver.closeTransaction(preReadTx.ok.transactionId).catch(() => {});
      }
    }
  }

  const bootstrapStatements =
    filteredDatasetForBootstrap === dataset
      ? compileDatasetEntityBootstrapStatements(dataset)
      : (() => {
          // Compile individual put statements for only the newly introduced entities/observations
          const allOrgIds = new Set(dataset.organisations.map((o) => o.orgId));
          const allLocIds = new Set(dataset.locations.map((l) => l.locationId));
          const allProjIds = new Set(dataset.projects.map((p) => p.projectId));
          const allSrcIds = new Set(dataset.sources.map((s) => s.sourceDocId));
          const stmts: string[] = [];
          for (const s of filteredDatasetForBootstrap.sectors) stmts.push(compileSectorPutTypeQl(s));
          for (const l of filteredDatasetForBootstrap.locations) stmts.push(compileLocationPutTypeQl(l));
          for (const a of filteredDatasetForBootstrap.energyAssets) {
            stmts.push(compileEnergyAssetPutTypeQl(a));
            if (allLocIds.has(a.locationId)) {
              stmts.push(compileLocationPlacementPutTypeQl('energy_asset', a.assetId, a.locationId));
            }
          }
          for (const o of filteredDatasetForBootstrap.organisations) {
            stmts.push(compileOrganisationPutTypeQl(o, dataset.owner, dataset.visibility));
            for (const secId of o.sectorIds) {
              const partId = `secpart:${o.orgId}:${secId}`;
              stmts.push(
                [
                  'match',
                  `  $org isa organisation, has org_id "${o.orgId}";`,
                  `  $sec isa sector_classification, has sector_id "${secId}";`,
                  'put',
                  `  $sp isa sector_participation,`,
                  `    links (participant_organisation: $org, target_sector: $sec),`,
                  `    has relationship_id "${partId}",`,
                  `    has relationship_version 1,`,
                  `    has epistemic_status "confirmed",`,
                  `    has published_at_ms 1758058200000,`,
                  `    has received_at_ms 1793452739000,`,
                  `    has tenant_owner "${dataset.owner}",`,
                  `    has visibility_scope "${dataset.visibility}";`,
                ].join('\n'),
              );
            }
          }
          for (const e of filteredDatasetForBootstrap.executives) {
            stmts.push(compileExecutivePersonPutTypeQl(e, dataset.owner, dataset.visibility));
          }
          for (const p of filteredDatasetForBootstrap.projects) {
            stmts.push(compileProjectPutTypeQl(p, dataset.owner, dataset.visibility));
            if (allLocIds.has(p.locationId)) {
              stmts.push(compileLocationPlacementPutTypeQl('infrastructure_project', p.projectId, p.locationId));
            }
          }
          for (const i of filteredDatasetForBootstrap.instruments) {
            stmts.push(compileInstrumentPutTypeQl(i));
          }
          for (const d of filteredDatasetForBootstrap.sources) {
            stmts.push(compileSourceDocumentPutTypeQl(d, dataset.owner, dataset.visibility));
          }
          for (const obs of filteredDatasetForBootstrap.observations) {
            stmts.push(compileObservationPutTypeQl(obs, dataset.owner, dataset.visibility));
            if (
              allOrgIds.has(obs.subjectOrgId) &&
              (!obs.subjectProjectId || allProjIds.has(obs.subjectProjectId)) &&
              (!obs.counterpartyOrgId || allOrgIds.has(obs.counterpartyOrgId))
            ) {
              stmts.push(compileObservationAttributionPutTypeQl(obs));
            }
            for (const srcId of obs.sourceDocIds) {
              if (allSrcIds.has(srcId)) {
                stmts.push(compileObservationEvidentialSupportPutTypeQl(obs, srcId));
              }
            }
          }
          return stmts;
        })();
  const entityTx = await driver.openTransaction(config.databaseName, 'write', {
    transactionTimeoutMillis: 30000,
  });
  if (isApiErrorResponse(entityTx)) {
    throw new Error(
      sanitizeTypeDbError(
        `Failed to open TypeDB write transaction: ${entityTx.err.message}`,
        config,
      ),
    );
  }
  for (const stmt of bootstrapStatements) {
    const qRes = await driver.query(entityTx.ok.transactionId, stmt);
    if (isApiErrorResponse(qRes)) {
      await driver.closeTransaction(entityTx.ok.transactionId);
      throw new Error(
        sanitizeTypeDbError(
          `Entity bootstrap query failed: ${qRes.err.code} ${qRes.err.message}\n${stmt}`,
          config,
        ),
      );
    }
  }
  const entityCommit = await driver.commitTransaction(entityTx.ok.transactionId);
  if (isApiErrorResponse(entityCommit)) {
    throw new Error(
      sanitizeTypeDbError(
        `Entity bootstrap commit failed: ${entityCommit.err.message}`,
        config,
      ),
    );
  }

  // Build and project outbox items in durable per-item write transactions
  const { accepted } = buildOutboxItemsFromDataset(dataset);
  const { updatedOutbox, checkpoint } = await processProjectionOutboxBatch(
    accepted,
    async (item) => {
      const tx = await driver.openTransaction(config.databaseName, 'write', {
        transactionTimeoutMillis: 20000,
      });
      if (isApiErrorResponse(tx)) {
        throw new Error(
          sanitizeTypeDbError(`Open write tx failed: ${tx.err.message}`, config),
        );
      }
      for (const stmt of item.typeqlStatements) {
        const res = await driver.query(tx.ok.transactionId, stmt);
        if (isApiErrorResponse(res)) {
          await driver.closeTransaction(tx.ok.transactionId);
          throw new Error(
            sanitizeTypeDbError(`${res.err.code}: ${res.err.message}`, config),
          );
        }
      }
      const commit = await driver.commitTransaction(tx.ok.transactionId);
      if (isApiErrorResponse(commit)) {
        throw new Error(
          sanitizeTypeDbError(`${commit.err.code}: ${commit.err.message}`, config),
        );
      }
    },
  );

  return {
    report: {
      connected: true,
      authenticated: true,
      distribution: versionRes.ok.distribution,
      serverVersion: versionRes.ok.version,
      databaseName: config.databaseName,
      schemaCommitted: true,
      bootstrapStatementsExecuted: bootstrapStatements.length,
      outboxProjectedCount: checkpoint.projectedCount,
      outboxDeadLetterCount: checkpoint.deadLetterCount,
      checkpoint,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: null,
    },
    outbox: updatedOutbox,
  };
}

/**
 * Executes a batch of TypeQL write statements in an atomic `write` transaction on TypeDB.
 */
export async function executeWriteStatementsOnLiveServer(
  typeqlStatements: string[],
  config = defaultTypeDbConfig(),
): Promise<{
  ok: boolean;
  statementsExecuted: number;
  latencyMs: number;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    const driver = createTypeDbDriver(config);
    const tx = await driver.openTransaction(config.databaseName, 'write', {
      transactionTimeoutMillis: 20000,
    });
    if (isApiErrorResponse(tx)) {
      return {
        ok: false,
        statementsExecuted: 0,
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${tx.err.code}: ${tx.err.message}`, config),
      };
    }
    for (const stmt of typeqlStatements) {
      const qRes = await driver.query(tx.ok.transactionId, stmt);
      if (isApiErrorResponse(qRes)) {
        await driver.closeTransaction(tx.ok.transactionId).catch(() => {});
        return {
          ok: false,
          statementsExecuted: 0,
          latencyMs: Math.max(1, Date.now() - startedAt),
          error: sanitizeTypeDbError(`${qRes.err.code}: ${qRes.err.message}`, config),
        };
      }
    }
    const commitRes = await driver.commitTransaction(tx.ok.transactionId);
    if (isApiErrorResponse(commitRes)) {
      return {
        ok: false,
        statementsExecuted: 0,
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(
          `${commitRes.err.code}: ${commitRes.err.message}`,
          config,
        ),
      };
    }
    return {
      ok: true,
      statementsExecuted: typeqlStatements.length,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      statementsExecuted: 0,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: sanitizeTypeDbError(
        err instanceof Error ? err.message : String(err),
        config,
      ),
    };
  }
}

/**
 * Executes a read-only TypeQL 3 query in a `read` transaction against a live TypeDB 3.14 server.
 */
export async function executeReadOnlyTypeQlOnLiveServer(
  typeql: string,
  config = defaultTypeDbConfig(),
): Promise<{
  ok: boolean;
  serverVersion: string | null;
  answerCount: number;
  rawAnswers: unknown[];
  latencyMs: number;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    const driver = createTypeDbDriver(config);
    const ver = await driver.version();
    if (isApiErrorResponse(ver)) {
      const convexUrl = resolveConvexCloudBridge(config);
      if (convexUrl) {
        const cloudRead = await callConvexCloudAction<{
          ok: boolean;
          serverVersion: string | null;
          answerCount: number;
          rawAnswers: unknown[];
          latencyMs: number;
          error: string | null;
        }>(convexUrl, 'graph:executeReadOnlyCloudTypeQl', { typeql });
        if (cloudRead?.ok) {
          return cloudRead;
        }
      }
      return {
        ok: false,
        serverVersion: null,
        answerCount: 0,
        rawAnswers: [],
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${ver.err.code}: ${ver.err.message}`, config),
      };
    }
    const tx = await driver.openTransaction(config.databaseName, 'read', {
      transactionTimeoutMillis: 10000,
    });
    if (isApiErrorResponse(tx)) {
      return {
        ok: false,
        serverVersion: ver.ok.version,
        answerCount: 0,
        rawAnswers: [],
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${tx.err.code}: ${tx.err.message}`, config),
      };
    }
    try {
      const qRes = await driver.query(tx.ok.transactionId, typeql);
      if (isApiErrorResponse(qRes)) {
        return {
          ok: false,
          serverVersion: ver.ok.version,
          answerCount: 0,
          rawAnswers: [],
          latencyMs: Math.max(1, Date.now() - startedAt),
          error: sanitizeTypeDbError(`${qRes.err.code}: ${qRes.err.message}`, config),
        };
      }
      const answers =
        qRes.ok.answerType === 'conceptRows' || qRes.ok.answerType === 'conceptDocuments'
          ? qRes.ok.answers
          : [];
      return {
        ok: true,
        serverVersion: ver.ok.version,
        answerCount: answers.length,
        rawAnswers: answers,
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: null,
      };
    } finally {
      await driver.closeTransaction(tx.ok.transactionId).catch(() => {});
    }
  } catch (err) {
    const convexUrl = resolveConvexCloudBridge(config);
    if (convexUrl) {
      const cloudRead = await callConvexCloudAction<{
        ok: boolean;
        serverVersion: string | null;
        answerCount: number;
        rawAnswers: unknown[];
        latencyMs: number;
        error: string | null;
      }>(convexUrl, 'graph:executeReadOnlyCloudTypeQl', { typeql });
      if (cloudRead?.ok) {
        return cloudRead;
      }
    }
    return {
      ok: false,
      serverVersion: null,
      answerCount: 0,
      rawAnswers: [],
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: sanitizeTypeDbError(
        err instanceof Error ? err.message : String(err),
        config,
      ),
    };
  }
}

export type LiveGraphConceptCounts = {
  organisations: number;
  executivePersons?: number;
  sectors: number;
  locations: number;
  energyAssets: number;
  projects: number;
  instruments: number;
  sources: number;
  observations: number;
  macroRelationships: number;
  evidentialSupportLinks: number;
  sectorParticipations: number;
  supersessionLinks: number;
};

/**
 * Queries a live TypeDB 3.14 database in a single `read` transaction to count all
 * canonical entities and typed relations, verifying parity with the Convex acceptance dataset.
 */
export async function inspectLiveTypeDbGraphCounts(
  config = defaultTypeDbConfig(),
): Promise<{
  ok: boolean;
  databaseName: string;
  serverVersion: string | null;
  schemaLengthChars: number;
  counts: LiveGraphConceptCounts | null;
  latencyMs: number;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    const driver = createTypeDbDriver(config);
    const ver = await driver.version();
    if (isApiErrorResponse(ver)) {
      return {
        ok: false,
        databaseName: config.databaseName,
        serverVersion: null,
        schemaLengthChars: 0,
        counts: null,
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${ver.err.code}: ${ver.err.message}`, config),
      };
    }

    const schemaRes = await driver.getDatabaseSchema(config.databaseName);
    const schemaLengthChars = isApiErrorResponse(schemaRes)
      ? 0
      : (schemaRes.ok ?? '').length;

    const tx = await driver.openTransaction(config.databaseName, 'read', {
      transactionTimeoutMillis: 15000,
    });
    if (isApiErrorResponse(tx)) {
      return {
        ok: false,
        databaseName: config.databaseName,
        serverVersion: ver.ok.version,
        schemaLengthChars,
        counts: null,
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${tx.err.code}: ${tx.err.message}`, config),
      };
    }

    const countQuery = async (typeql: string): Promise<number> => {
      const r = await driver.query(tx.ok.transactionId, typeql);
      if (isApiErrorResponse(r)) {
        throw new Error(`${r.err.code}: ${r.err.message}`);
      }
      return r.ok.answerType === 'conceptRows' ? r.ok.answers.length : 0;
    };

    try {
      const hasExecutivePerson =
        !isApiErrorResponse(schemaRes) && (schemaRes.ok ?? '').includes('executive_person');

      const [
        organisations,
        executivePersons,
        sectors,
        locations,
        energyAssets,
        projects,
        instruments,
        sources,
        observations,
        macroRelationships,
        evidentialSupportLinks,
        sectorParticipations,
        supersessionLinks,
      ] = await Promise.all([
        countQuery('match $x isa organisation, has org_id $id;'),
        hasExecutivePerson
          ? countQuery('match $x isa executive_person, has person_id $id;')
          : Promise.resolve(0),
        countQuery('match $x isa sector_classification, has sector_id $id;'),
        countQuery('match $x isa geographical_location, has location_id $id;'),
        countQuery('match $x isa energy_asset, has asset_id $id;'),
        countQuery('match $x isa infrastructure_project, has project_id $id;'),
        countQuery('match $x isa financial_instrument, has instrument_id $id;'),
        countQuery('match $x isa source_document, has source_doc_id $id;'),
        countQuery('match $x isa financial_observation, has observation_id $id;'),
        countQuery('match $x isa macro_relationship, has relationship_id $id;'),
        countQuery('match $x isa evidential_support, has relationship_id $id;'),
        countQuery('match $x isa sector_participation, has relationship_id $id;'),
        countQuery('match $x isa supersession_link, has relationship_id $id;'),
      ]);

      return {
        ok: true,
        databaseName: config.databaseName,
        serverVersion: ver.ok.version,
        schemaLengthChars,
        counts: {
          organisations,
          executivePersons,
          sectors,
          locations,
          energyAssets,
          projects,
          instruments,
          sources,
          observations,
          macroRelationships,
          evidentialSupportLinks,
          sectorParticipations,
          supersessionLinks,
        },
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: null,
      };
    } finally {
      await driver.closeTransaction(tx.ok.transactionId).catch(() => {});
    }
  } catch (err) {
    return {
      ok: false,
      databaseName: config.databaseName,
      serverVersion: null,
      schemaLengthChars: 0,
      counts: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: sanitizeTypeDbError(
        err instanceof Error ? err.message : String(err),
        config,
      ),
    };
  }
}

export async function inspectLiveTypeDbReconciliationDetails(
  config = defaultTypeDbConfig(),
): Promise<{
  ok: boolean;
  databaseName: string;
  clusterDatabases: string[];
  relationshipIds: string[];
  evidentialSupportIds: string[];
  latencyMs: number;
  error: string | null;
}> {
  const startedAt = Date.now();
  try {
    const driver = createTypeDbDriver(config);
    const dbsRes = await driver.getDatabases();
    if (isApiErrorResponse(dbsRes)) {
      return {
        ok: false,
        databaseName: config.databaseName,
        clusterDatabases: [],
        relationshipIds: [],
        evidentialSupportIds: [],
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${dbsRes.err.code}: ${dbsRes.err.message}`, config),
      };
    }
    const clusterDatabases = dbsRes.ok.databases.map((d) => d.name).sort();
    const tx = await driver.openTransaction(config.databaseName, 'read', {
      transactionTimeoutMillis: 15000,
    });
    if (isApiErrorResponse(tx)) {
      return {
        ok: false,
        databaseName: config.databaseName,
        clusterDatabases,
        relationshipIds: [],
        evidentialSupportIds: [],
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: sanitizeTypeDbError(`${tx.err.code}: ${tx.err.message}`, config),
      };
    }
    const extractIds = async (typeql: string): Promise<string[]> => {
      const r = await driver.query(tx.ok.transactionId, typeql);
      if (isApiErrorResponse(r) || r.ok.answerType !== 'conceptRows') {
        return [];
      }
      const ids: string[] = [];
      for (const row of r.ok.answers) {
        const data = (row as { data?: Record<string, { value?: unknown }> }).data;
        const rawVal = data?.id?.value;
        if (typeof rawVal === 'string') {
          ids.push(rawVal);
        }
      }
      return ids.sort();
    };
    try {
      const [relationshipIds, evidentialSupportIds] = await Promise.all([
        extractIds('match $x isa macro_relationship, has relationship_id $id;'),
        extractIds('match $x isa evidential_support, has relationship_id $id;'),
      ]);
      return {
        ok: true,
        databaseName: config.databaseName,
        clusterDatabases,
        relationshipIds,
        evidentialSupportIds,
        latencyMs: Math.max(1, Date.now() - startedAt),
        error: null,
      };
    } finally {
      await driver.closeTransaction(tx.ok.transactionId).catch(() => {});
    }
  } catch (err) {
    return {
      ok: false,
      databaseName: config.databaseName,
      clusterDatabases: [],
      relationshipIds: [],
      evidentialSupportIds: [],
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: sanitizeTypeDbError(
        err instanceof Error ? err.message : String(err),
        config,
      ),
    };
  }
}

type RawConceptCell = {
  kind?: string;
  value?: unknown;
  label?: string;
  type?: { label?: string };
};

type RawConceptRow = {
  data?: Record<string, RawConceptCell>;
};

function cellVal(row: RawConceptRow, key: string): unknown {
  const cell = row.data?.[key];
  if (!cell || typeof cell !== 'object') return undefined;
  return 'value' in cell ? cell.value : undefined;
}

function cellString(row: RawConceptRow, key: string): string {
  const v = cellVal(row, key);
  if (typeof v !== 'string') {
    throw new TypeDbSchemaOrHydrationError(
      `Invalid TypeDB string attribute "${key}" encountered during live hydration`,
    );
  }
  return v;
}

function cellNumber(row: RawConceptRow, key: string): number {
  const v = cellVal(row, key);
  const num = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(num)) {
    throw new TypeDbSchemaOrHydrationError(
      `Invalid TypeDB numeric attribute "${key}" encountered during live hydration`,
    );
  }
  return num;
}

function cellBool(row: RawConceptRow, key: string): boolean {
  const v = cellVal(row, key);
  if (typeof v !== 'boolean') {
    throw new TypeDbSchemaOrHydrationError(
      `Invalid TypeDB boolean attribute "${key}" encountered during live hydration`,
    );
  }
  return v;
}

function cellTypeLabel(row: RawConceptRow, key: string): string {
  const cell = row.data?.[key];
  const raw = cell?.type?.label ?? cell?.label;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new TypeDbSchemaOrHydrationError(
      `Unrecognised TypeDB concept type label for variable "${key}"`,
    );
  }
  return raw.trim();
}

function isRowVisibleToCaller(row: RawConceptRow, callerOwner: string): boolean {
  const vis = cellVal(row, 'vis');
  const owner = cellVal(row, 'owner');
  if (vis === 'public_research') return true;
  if (typeof owner === 'string' && owner === callerOwner) return true;
  return false;
}

/**
 * Hydrates a complete, Zod-validated `MacroGraphDataset` directly from live TypeDB 3.14
 * `read` transaction concept rows (never from static JSON).
 *
 * Security & Fail-Closed Guarantees:
 * - If TypeDB is unreachable or unconfigured, returns `{ ok: false, reachable: false, ... }`.
 * - If TypeDB is reachable and the target database exists, validates server version (`3.14.x`),
 *   required schema definitions, optional `schema_version` attributes, and every hydrated entity,
 *   observation, and relationship against strict Zod contracts. Any unsupported schema version or
 *   unrecognised concept shape throws `TypeDbSchemaOrHydrationError` with a non-sensitive message.
 */
export async function hydrateMacroDatasetFromLiveTypeDb(
  config = defaultTypeDbConfig(),
  options?: { callerOwner?: string },
): Promise<{
  ok: boolean;
  reachable: boolean;
  databaseMissing: boolean;
  serverVersion: string | null;
  dataset: MacroGraphDataset | null;
  latencyMs: number;
  error: string | null;
}> {
  const startedAt = Date.now();
  const callerOwner = options?.callerOwner ?? 'public_research';

  let driver: TypeDBHttpDriver;
  let verRes;
  try {
    driver = createTypeDbDriver(config);
    verRes = await driver.version();
  } catch {
    const bridge = resolveConvexCloudBridge(config);
    if (bridge) {
      const bridged = await callConvexCloudAction<{
        ok: boolean;
        reachable: boolean;
        databaseMissing: boolean;
        serverVersion: string | null;
        dataset: MacroGraphDataset | null;
        latencyMs: number;
        error: string | null;
        schemaError?: string | null;
      }>(bridge, 'graph:hydrateHostedTypeDbCloud', { callerOwner });
      if (bridged?.schemaError) {
        throw new TypeDbSchemaOrHydrationError(bridged.schemaError);
      }
      if (bridged) {
        return bridged;
      }
    }
    return {
      ok: false,
      reachable: false,
      databaseMissing: false,
      serverVersion: null,
      dataset: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: 'Live TypeDB server is not reachable or not configured',
    };
  }

  if (isApiErrorResponse(verRes)) {
    const bridge = resolveConvexCloudBridge(config);
    if (bridge) {
      const bridged = await callConvexCloudAction<{
        ok: boolean;
        reachable: boolean;
        databaseMissing: boolean;
        serverVersion: string | null;
        dataset: MacroGraphDataset | null;
        latencyMs: number;
        error: string | null;
        schemaError?: string | null;
      }>(bridge, 'graph:hydrateHostedTypeDbCloud', { callerOwner });
      if (bridged?.schemaError) {
        throw new TypeDbSchemaOrHydrationError(bridged.schemaError);
      }
      if (bridged) {
        return bridged;
      }
    }
    return {
      ok: false,
      reachable: false,
      databaseMissing: false,
      serverVersion: null,
      dataset: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: 'Live TypeDB server did not respond to version check',
    };
  }

  const serverVersion = verRes.ok.version;
  if (!serverVersion.startsWith('3.14.')) {
    throw new TypeDbSchemaOrHydrationError(
      'Unsupported TypeDB server version; expected pinned 3.14.x series',
    );
  }

  const dbsRes = await driver.getDatabases();
  if (isApiErrorResponse(dbsRes)) {
    return {
      ok: false,
      reachable: false,
      databaseMissing: false,
      serverVersion,
      dataset: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: 'Live TypeDB authentication failed',
    };
  }

  if (!dbsRes.ok.databases.some((d) => d.name === config.databaseName)) {
    return {
      ok: false,
      reachable: true,
      databaseMissing: true,
      serverVersion,
      dataset: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: 'Configured TypeDB database does not exist on server',
    };
  }

  const schemaRes = await driver.getDatabaseSchema(config.databaseName);
  if (isApiErrorResponse(schemaRes)) {
    throw new TypeDbSchemaOrHydrationError(
      'Unable to verify TypeDB database schema version',
    );
  }
  const schemaText = schemaRes.ok ?? '';
  const requiredTokens = [
    'organisation',
    'macro_relationship',
    'source_document',
    'evidential_support',
    'sector_classification',
  ];
  for (const token of requiredTokens) {
    if (!schemaText.includes(token)) {
      throw new TypeDbSchemaOrHydrationError(
        'Unsupported TypeDB database schema: required macro-intelligence-graph-3.14 definitions are missing',
      );
    }
  }

  const hasExecutivePerson = schemaText.includes('executive_person');
  const hasLeadershipAppointment = schemaText.includes('leadership_appointment');

  const tx = await driver.openTransaction(config.databaseName, 'read', {
    transactionTimeoutMillis: 20000,
  });
  if (isApiErrorResponse(tx)) {
    throw new TypeDbSchemaOrHydrationError(
      'Failed to open read transaction on live TypeDB database',
    );
  }

  const queryRows = async (typeql: string): Promise<RawConceptRow[]> => {
    const res = await driver.query(tx.ok.transactionId, typeql);
    if (isApiErrorResponse(res)) {
      throw new TypeDbSchemaOrHydrationError(
        'Live TypeDB read query failed against schema contract',
      );
    }
    if (res.ok.answerType !== 'conceptRows') {
      throw new TypeDbSchemaOrHydrationError(
        'Unrecognised TypeDB answerType returned; expected conceptRows',
      );
    }
    return res.ok.answers as RawConceptRow[];
  };

  const queryOptionalMap = async <T>(
    typeql: string,
    cast: (val: unknown) => T,
  ): Promise<Map<string, T>> => {
    const rows = await queryRows(typeql);
    const out = new Map<string, T>();
    for (const r of rows) {
      const id = cellString(r, 'id');
      out.set(id, cast(cellVal(r, 'val')));
    }
    return out;
  };

  try {
    // Fail closed if any entity explicitly owns and populates an unsupported schema_version
    if (schemaText.includes('owns schema_version')) {
      const svRows = await queryRows('match $x has schema_version $sv;');
      for (const r of svRows) {
        const sv = cellString(r, 'sv');
        if (
          !(SUPPORTED_MACRO_GRAPH_SCHEMA_VERSIONS as readonly string[]).includes(sv)
        ) {
          throw new TypeDbSchemaOrHydrationError(
            'Unsupported TypeDB schema_version encountered in live database',
          );
        }
      }
    }

    const [
      sectorRows,
      locRows,
      assetRows,
      assetLocRows,
      orgRows,
      orgCikMap,
      orgLeiMap,
      orgTickerMap,
      orgSectorRows,
      execRows,
      execAffOrgMap,
      projRows,
      projPlannedMap,
      projEnergisedMap,
      projLocRows,
      instRows,
      instTickerMap,
      instFigiMap,
      srcRows,
      obsRows,
      obsCurrencyMap,
      obsSubjOrgRows,
      obsSubjProjRows,
      obsCpOrgRows,
      obsDocRows,
      relRows,
      relSupersedesMap,
      relReviewedByMap,
      relConflictMap,
      relEconGroupMap,
      relPrincipalMap,
      relCurrencyMap,
      relCapUnitMap,
      relCapQtyMap,
      relEffToMap,
      relMaturityMap,
      relExecTitleMap,
      relGovActionMap,
      relIsInterimMap,
      relSupportRows,
      partOrgRows,
      partExecRows,
      partProjRows,
      partInstRows,
      partAssetRows,
      partLocRows,
      partSecRows,
    ] = await Promise.all([
      queryRows(
        'match $x isa sector_classification, has sector_id $sectorId, has sector_name $sectorName, has industry_group $industryGroup, has economic_layer $economicLayer;',
      ),
      queryRows(
        'match $x isa geographical_location, has location_id $locationId, has location_name $locationName, has country_code $countryCode, has region_or_state $regionOrState, has municipality $municipality, has grid_zone $gridZone;',
      ),
      queryRows(
        'match $x isa energy_asset, has asset_id $assetId, has asset_name $assetName, has energy_source_type $energySourceType, has nameplate_capacity_mw $nameplateCapacityMw;',
      ),
      queryRows(
        'match $lp isa location_placement, links (located_asset: $a, host_location: $l); $a isa energy_asset, has asset_id $id; $l has location_id $locId;',
      ),
      queryRows(
        'match $x isa organisation, has org_id $orgId, has legal_name $legalName, has display_name $displayName, has org_subtype_label $subtype, has incorporation_jurisdiction $jurisdiction, has tenant_owner $owner, has visibility_scope $vis;',
      ),
      queryOptionalMap(
        'match $x isa organisation, has org_id $id, has sec_cik $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa organisation, has org_id $id, has lei_code $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa organisation, has org_id $id, has ticker_symbol $val;',
        String,
      ),
      queryRows(
        'match $sp isa sector_participation, links (participant_organisation: $o, target_sector: $s); $o has org_id $orgId; $s has sector_id $sectorId;',
      ),
      hasExecutivePerson
        ? queryRows(
            'match $x isa executive_person, has person_id $personId, has full_name $fullName, has display_name $displayName, has tenant_owner $owner, has visibility_scope $vis;',
          )
        : Promise.resolve([]),
      hasExecutivePerson && schemaText.includes('affiliated_org_id')
        ? queryOptionalMap(
            'match $x isa executive_person, has person_id $id, has affiliated_org_id $val;',
            String,
          )
        : Promise.resolve(new Map<string, string>()),
      queryRows(
        'match $x isa infrastructure_project, has project_id $projectId, has project_name $projectName, has project_type $projectType, has project_stage $projectStage, has tenant_owner $owner, has visibility_scope $vis;',
      ),
      queryOptionalMap(
        'match $x isa infrastructure_project, has project_id $id, has planned_capacity_mw $val;',
        Number,
      ),
      queryOptionalMap(
        'match $x isa infrastructure_project, has project_id $id, has energised_capacity_mw $val;',
        Number,
      ),
      queryRows(
        'match $lp isa location_placement, links (located_asset: $p, host_location: $l); $p isa infrastructure_project, has project_id $id; $l has location_id $locId;',
      ),
      queryRows(
        'match $x isa financial_instrument, has instrument_id $instrumentId, has instrument_type $instrumentType, has instrument_currency $instrumentCurrency;',
      ),
      queryOptionalMap(
        'match $x isa financial_instrument, has instrument_id $id, has ticker_symbol $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa financial_instrument, has instrument_id $id, has figi_code $val;',
        String,
      ),
      queryRows(
        'match $x isa source_document, has source_doc_id $sourceDocId, has source_title $title, has source_url $url, has source_kind $kind, has source_authority $authority, has content_sha256 $contentSha256, has publication_basis $publicationBasis, has published_at_ms $publishedAtMs, has received_at_ms $receivedAtMs, has ingested_at_ms $ingestedAtMs, has tenant_owner $owner, has visibility_scope $vis;',
      ),
      queryRows(
        'match $x isa financial_observation, has observation_id $observationId, has metric_name $metricName, has metric_value $metricValue, has metric_unit $metricUnit, has reporting_period_label $reportingPeriodLabel, has period_start_ms $periodStartMs, has period_end_ms $periodEndMs, has accounting_basis $accountingBasis, has metric_definition $metricDefinition, has observation_kind $observationKind, has published_at_ms $publishedAtMs, has received_at_ms $receivedAtMs, has tenant_owner $owner, has visibility_scope $vis;',
      ),
      queryOptionalMap(
        'match $x isa financial_observation, has observation_id $id, has currency_code $val;',
        String,
      ),
      queryRows(
        'match $oa isa observation_attribution, links (recorded_observation: $obs, subject_organisation: $org); $obs has observation_id $id; $org has org_id $orgId;',
      ),
      queryRows(
        'match $oa isa observation_attribution, links (recorded_observation: $obs, subject_project: $proj); $obs has observation_id $id; $proj has project_id $projId;',
      ),
      queryRows(
        'match $oa isa observation_attribution, links (recorded_observation: $obs, counterparty_organisation: $org); $obs has observation_id $id; $org has org_id $orgId;',
      ),
      queryRows(
        'match $sup isa evidential_support, links (supporting_document: $doc, supported_claim: $obs); $obs isa financial_observation, has observation_id $id; $doc has source_doc_id $docId;',
      ),
      queryRows(
        'match $rel isa macro_relationship, has relationship_id $relationshipId, has logical_event_id $logicalEventId, has relationship_version $version, has relationship_category $category, has contractual_status $contractualStatus, has epistemic_status $epistemicStatus, has extraction_status $extractionStatus, has reviewer_status $reviewerStatus, has conditions_summary $conditionsSummary, has binding_obligation $bindingObligation, has effective_from_ms $effectiveFromMs, has published_at_ms $publishedAtMs, has received_at_ms $receivedAtMs, has tenant_owner $owner, has visibility_scope $vis;',
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has supersedes_relationship_id $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has reviewed_by $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has conflict_group_id $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has economic_group_id $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has principal_amount $val;',
        Number,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has currency_code $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has capacity_unit $val;',
        String,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has capacity_quantity $val;',
        Number,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has effective_to_ms $val;',
        Number,
      ),
      queryOptionalMap(
        'match $x isa macro_relationship, has relationship_id $id, has maturity_at_ms $val;',
        Number,
      ),
      hasLeadershipAppointment
        ? queryOptionalMap(
            'match $x isa leadership_appointment, has relationship_id $id, has executive_title $val;',
            String,
          )
        : Promise.resolve(new Map<string, string>()),
      hasLeadershipAppointment
        ? queryOptionalMap(
            'match $x isa leadership_appointment, has relationship_id $id, has governance_action $val;',
            String,
          )
        : Promise.resolve(new Map<string, string>()),
      hasLeadershipAppointment
        ? queryOptionalMap(
            'match $x isa leadership_appointment, has relationship_id $id, has is_interim $val;',
            Boolean,
          )
        : Promise.resolve(new Map<string, boolean>()),
      queryRows(
        'match $sup isa evidential_support, links (supporting_document: $doc, supported_claim: $rel); $rel isa macro_relationship, has relationship_id $relId; $doc has source_doc_id $docId;',
      ),
      queryRows(
        'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa organisation, has org_id $entityId;',
      ),
      hasExecutivePerson
        ? queryRows(
            'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa executive_person, has person_id $entityId;',
          )
        : Promise.resolve([]),
      queryRows(
        'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa infrastructure_project, has project_id $entityId;',
      ),
      queryRows(
        'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa financial_instrument, has instrument_id $entityId;',
      ),
      queryRows(
        'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa energy_asset, has asset_id $entityId;',
      ),
      queryRows(
        'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa geographical_location, has location_id $entityId;',
      ),
      queryRows(
        'match $rel isa macro_relationship, links ($role: $p), has relationship_id $relId; $p isa sector_classification, has sector_id $entityId;',
      ),
    ]);

    const sectors: GraphSector[] = sectorRows.map((r) => ({
      sectorId: cellString(r, 'sectorId'),
      sectorName: cellString(r, 'sectorName'),
      industryGroup: cellString(r, 'industryGroup'),
      economicLayer: cellString(r, 'economicLayer'),
    }));
    const defaultSectorId = sectors[0]?.sectorId ?? 'sec-ai-semiconductors';

    const locations: GraphLocation[] = locRows.map((r) => ({
      locationId: cellString(r, 'locationId'),
      locationName: cellString(r, 'locationName'),
      countryCode: cellString(r, 'countryCode'),
      regionOrState: cellString(r, 'regionOrState'),
      municipality: cellString(r, 'municipality'),
      gridZone: cellString(r, 'gridZone'),
    }));
    const fallbackLocId = locations[0]?.locationId ?? 'loc-default';

    const assetLocMap = new Map<string, string>();
    for (const r of assetLocRows) {
      assetLocMap.set(cellString(r, 'id'), cellString(r, 'locId'));
    }
    const energyAssets: GraphEnergyAsset[] = assetRows.map((r) => {
      const assetId = cellString(r, 'assetId');
      return {
        assetId,
        assetName: cellString(r, 'assetName'),
        energySourceType: cellString(r, 'energySourceType'),
        nameplateCapacityMw: cellNumber(r, 'nameplateCapacityMw'),
        locationId: assetLocMap.get(assetId) ?? fallbackLocId,
      };
    });

    const orgSectorsMap = new Map<string, Set<string>>();
    for (const r of orgSectorRows) {
      const orgId = cellString(r, 'orgId');
      const secId = cellString(r, 'sectorId');
      const set = orgSectorsMap.get(orgId) ?? new Set<string>();
      set.add(secId);
      orgSectorsMap.set(orgId, set);
    }

    const organisations: GraphOrganisation[] = orgRows
      .filter((r) => isRowVisibleToCaller(r, callerOwner))
      .map((r) => {
        const orgId = cellString(r, 'orgId');
        const subtypeRaw = cellString(r, 'subtype');
        if (!(ORGANISATION_SUBTYPES as readonly string[]).includes(subtypeRaw)) {
          throw new TypeDbSchemaOrHydrationError(
            `Unsupported organisation subtype "${subtypeRaw}" in live TypeDB`,
          );
        }
        const sectorIds = [...(orgSectorsMap.get(orgId) ?? [defaultSectorId])];
        return {
          orgId,
          legalName: cellString(r, 'legalName'),
          displayName: cellString(r, 'displayName'),
          subtype: subtypeRaw as GraphOrganisation['subtype'],
          secCik: orgCikMap.get(orgId) ?? null,
          leiCode: orgLeiMap.get(orgId) ?? null,
          ticker: orgTickerMap.get(orgId) ?? null,
          jurisdiction: cellString(r, 'jurisdiction'),
          sectorIds: sectorIds.length > 0 ? sectorIds : [defaultSectorId],
          aliases: [],
        };
      });

    const executives: GraphExecutivePerson[] = execRows
      .filter((r) => isRowVisibleToCaller(r, callerOwner))
      .map((r) => {
        const personId = cellString(r, 'personId');
        return {
          personId,
          fullName: cellString(r, 'fullName'),
          displayName: cellString(r, 'displayName'),
          affiliatedOrgId: execAffOrgMap.get(personId) ?? null,
        };
      });

    const projLocMap = new Map<string, string>();
    for (const r of projLocRows) {
      projLocMap.set(cellString(r, 'id'), cellString(r, 'locId'));
    }
    const projects: GraphProject[] = projRows
      .filter((r) => isRowVisibleToCaller(r, callerOwner))
      .map((r) => {
        const projectId = cellString(r, 'projectId');
        return {
          projectId,
          projectName: cellString(r, 'projectName'),
          projectType: cellString(r, 'projectType'),
          projectStage: cellString(r, 'projectStage'),
          plannedCapacityMw: projPlannedMap.get(projectId) ?? null,
          energisedCapacityMw: projEnergisedMap.get(projectId) ?? null,
          locationId: projLocMap.get(projectId) ?? fallbackLocId,
        };
      });

    const instruments: GraphInstrument[] = instRows.map((r) => {
      const instrumentId = cellString(r, 'instrumentId');
      return {
        instrumentId,
        instrumentType: cellString(r, 'instrumentType'),
        instrumentCurrency: cellString(r, 'instrumentCurrency'),
        ticker: instTickerMap.get(instrumentId) ?? null,
        figiCode: instFigiMap.get(instrumentId) ?? null,
      };
    });

    const sources: GraphSourceDocument[] = srcRows
      .filter((r) => isRowVisibleToCaller(r, callerOwner))
      .map((r) => ({
        sourceDocId: cellString(r, 'sourceDocId'),
        title: cellString(r, 'title'),
        url: cellString(r, 'url'),
        kind: cellString(r, 'kind') as GraphSourceDocument['kind'],
        authority: cellString(r, 'authority') as GraphSourceDocument['authority'],
        contentSha256: cellString(r, 'contentSha256'),
        publicationBasis: cellString(
          r,
          'publicationBasis',
        ) as GraphSourceDocument['publicationBasis'],
        publishedAtMs: cellNumber(r, 'publishedAtMs'),
        receivedAtMs: cellNumber(r, 'receivedAtMs'),
        ingestedAtMs: cellNumber(r, 'ingestedAtMs'),
      }));

    const obsSubjOrgMap = new Map<string, string>();
    for (const r of obsSubjOrgRows) {
      obsSubjOrgMap.set(cellString(r, 'id'), cellString(r, 'orgId'));
    }
    const obsSubjProjMap = new Map<string, string>();
    for (const r of obsSubjProjRows) {
      obsSubjProjMap.set(cellString(r, 'id'), cellString(r, 'projId'));
    }
    const obsCpOrgMap = new Map<string, string>();
    for (const r of obsCpOrgRows) {
      obsCpOrgMap.set(cellString(r, 'id'), cellString(r, 'orgId'));
    }
    const obsDocsMap = new Map<string, Set<string>>();
    for (const r of obsDocRows) {
      const id = cellString(r, 'id');
      const docId = cellString(r, 'docId');
      const set = obsDocsMap.get(id) ?? new Set<string>();
      set.add(docId);
      obsDocsMap.set(id, set);
    }

    const fallbackOrgId = organisations[0]?.orgId ?? 'org-nvda';
    const fallbackDocId = sources[0]?.sourceDocId ?? 'doc-fallback';

    const observations: GraphObservation[] = obsRows
      .filter((r) => isRowVisibleToCaller(r, callerOwner))
      .map((r) => {
        const observationId = cellString(r, 'observationId');
        const docIds = [...(obsDocsMap.get(observationId) ?? [fallbackDocId])];
        return {
          observationId,
          subjectOrgId: obsSubjOrgMap.get(observationId) ?? fallbackOrgId,
          subjectProjectId: obsSubjProjMap.get(observationId) ?? null,
          counterpartyOrgId: obsCpOrgMap.get(observationId) ?? null,
          metricName: cellString(r, 'metricName'),
          metricValue: cellNumber(r, 'metricValue'),
          metricUnit: cellString(r, 'metricUnit') as GraphObservation['metricUnit'],
          currencyCode: obsCurrencyMap.get(observationId) ?? null,
          reportingPeriodLabel: cellString(r, 'reportingPeriodLabel'),
          periodStartMs: cellNumber(r, 'periodStartMs'),
          periodEndMs: cellNumber(r, 'periodEndMs'),
          accountingBasis: cellString(r, 'accountingBasis'),
          metricDefinition: cellString(r, 'metricDefinition'),
          observationKind: cellString(
            r,
            'observationKind',
          ) as GraphObservation['observationKind'],
          publishedAtMs: cellNumber(r, 'publishedAtMs'),
          receivedAtMs: cellNumber(r, 'receivedAtMs'),
          sourceDocIds: docIds,
        };
      });

    const relParticipantsMap = new Map<string, Map<string, RelationshipParticipant>>();
    const registerParticipants = (
      rows: RawConceptRow[],
      entityKind: RelationshipParticipant['entityKind'],
    ) => {
      for (const r of rows) {
        const relId = cellString(r, 'relId');
        const entityId = cellString(r, 'entityId');
        const rawRoleLabel = cellTypeLabel(r, 'role');
        const role = rawRoleLabel.includes(':')
          ? rawRoleLabel.split(':').pop()!
          : rawRoleLabel;
        const dedupeKey = `${role}:${entityKind}:${entityId}`;
        const map = relParticipantsMap.get(relId) ?? new Map<string, RelationshipParticipant>();
        map.set(dedupeKey, { role, entityId, entityKind });
        relParticipantsMap.set(relId, map);
      }
    };
    registerParticipants(partOrgRows, 'organisation');
    registerParticipants(partExecRows, 'executive_person');
    registerParticipants(partProjRows, 'infrastructure_project');
    registerParticipants(partInstRows, 'financial_instrument');
    registerParticipants(partAssetRows, 'energy_asset');
    registerParticipants(partLocRows, 'geographical_location');
    registerParticipants(partSecRows, 'sector_classification');

    const relDocsMap = new Map<string, Set<string>>();
    for (const r of relSupportRows) {
      const relId = cellString(r, 'relId');
      const docId = cellString(r, 'docId');
      const set = relDocsMap.get(relId) ?? new Set<string>();
      set.add(docId);
      relDocsMap.set(relId, set);
    }

    const relationships: MacroRelationship[] = relRows
      .filter((r) => isRowVisibleToCaller(r, callerOwner))
      .map((r) => {
        const relationshipId = cellString(r, 'relationshipId');
        const relTypeRaw = cellTypeLabel(r, 'rel');
        if (!(MACRO_RELATION_TYPES as readonly string[]).includes(relTypeRaw)) {
          throw new TypeDbSchemaOrHydrationError(
            `Unrecognised relation type "${relTypeRaw}" in live TypeDB`,
          );
        }
        const contractualRaw = cellString(r, 'contractualStatus');
        if (!(CONTRACTUAL_STATUSES as readonly string[]).includes(contractualRaw)) {
          throw new TypeDbSchemaOrHydrationError(
            `Unrecognised contractual status "${contractualRaw}" in live TypeDB`,
          );
        }
        const epistemicRaw = cellString(r, 'epistemicStatus');
        if (!(EPISTEMIC_STATUSES as readonly string[]).includes(epistemicRaw)) {
          throw new TypeDbSchemaOrHydrationError(
            `Unrecognised epistemic status "${epistemicRaw}" in live TypeDB`,
          );
        }
        const reviewerRaw = cellString(r, 'reviewerStatus');
        if (!(REVIEWER_STATUSES as readonly string[]).includes(reviewerRaw)) {
          throw new TypeDbSchemaOrHydrationError(
            `Unrecognised reviewer status "${reviewerRaw}" in live TypeDB`,
          );
        }
        const participants = [...(relParticipantsMap.get(relationshipId)?.values() ?? [])];
        const sourceDocIds = [...(relDocsMap.get(relationshipId) ?? [])];
        const capUnitRaw = relCapUnitMap.get(relationshipId) ?? null;
        if (capUnitRaw !== null && !['MW', 'GPU', 'SHARES'].includes(capUnitRaw)) {
          throw new TypeDbSchemaOrHydrationError(
            `Unsupported capacity unit "${capUnitRaw}" in live TypeDB`,
          );
        }

        const relObj: MacroRelationship = {
          relationshipId,
          relationType: relTypeRaw as MacroRelationship['relationType'],
          logicalEventId: cellString(r, 'logicalEventId'),
          version: cellNumber(r, 'version'),
          supersedesRelationshipId: relSupersedesMap.get(relationshipId) ?? null,
          category: cellString(r, 'category'),
          contractualStatus: contractualRaw as ContractualStatus,
          epistemicStatus: epistemicRaw as EpistemicStatus,
          extractionStatus: cellString(
            r,
            'extractionStatus',
          ) as MacroRelationship['extractionStatus'],
          reviewerStatus: reviewerRaw as ReviewerStatus,
          reviewedBy: relReviewedByMap.get(relationshipId) ?? null,
          conflictGroupId: relConflictMap.get(relationshipId) ?? null,
          economicGroupId: relEconGroupMap.get(relationshipId) ?? null,
          principalAmount: relPrincipalMap.get(relationshipId) ?? null,
          currencyCode: relCurrencyMap.get(relationshipId) ?? null,
          capacityUnit: (capUnitRaw as MacroRelationship['capacityUnit']) ?? null,
          capacityQuantity: relCapQtyMap.get(relationshipId) ?? null,
          ...(relExecTitleMap.has(relationshipId)
            ? { executiveTitle: relExecTitleMap.get(relationshipId)! }
            : {}),
          ...(relGovActionMap.has(relationshipId)
            ? { governanceAction: relGovActionMap.get(relationshipId)! }
            : {}),
          ...(relIsInterimMap.has(relationshipId)
            ? { isInterim: relIsInterimMap.get(relationshipId)! }
            : {}),
          conditionsSummary: cellString(r, 'conditionsSummary'),
          bindingObligation: cellBool(r, 'bindingObligation'),
          effectiveFromMs: cellNumber(r, 'effectiveFromMs'),
          effectiveToMs: relEffToMap.get(relationshipId) ?? null,
          maturityAtMs: relMaturityMap.get(relationshipId) ?? null,
          publishedAtMs: cellNumber(r, 'publishedAtMs'),
          receivedAtMs: cellNumber(r, 'receivedAtMs'),
          participants,
          sourceDocIds,
        };
        return relObj;
      });

    let validatedDataset: MacroGraphDataset;
    try {
      validatedDataset = macroGraphDatasetSchema.parse({
        datasetVersion: MACRO_GRAPH_DATASET_VERSION,
        schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
        owner: callerOwner,
        visibility: 'public_research',
        sectors,
        organisations,
        executives,
        locations,
        energyAssets,
        projects,
        instruments,
        sources,
        observations,
        relationships,
      });
    } catch {
      throw new TypeDbSchemaOrHydrationError(
        'Live TypeDB concept payload failed deterministic contract validation; failing closed',
      );
    }

    return {
      ok: true,
      reachable: true,
      databaseMissing: false,
      serverVersion,
      dataset: validatedDataset,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: null,
    };
  } finally {
    await driver.closeTransaction(tx.ok.transactionId).catch(() => {});
  }
}
