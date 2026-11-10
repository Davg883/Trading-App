import { TypeDBHttpDriver, isApiErrorResponse } from '@typedb/driver-http';
import { type MacroGraphDataset } from './contracts';
import {
  buildOutboxItemsFromDataset,
  compileDatasetEntityBootstrapStatements,
  processProjectionOutboxBatch,
  type OutboxProjectionItem,
  type ProjectionCheckpoint,
} from './projection-engine';
import { loadPinnedTypeQlSchema } from './typedb-schema';

export const PRODUCTION_TYPEDB_DATABASE = 'aci_macro_intelligence_prod';
export const STAGING_TYPEDB_DATABASE = 'aci_macro_intelligence_staging';

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
  }

  // Bootstrap foundational entities in a `write` transaction
  const bootstrapStatements = compileDatasetEntityBootstrapStatements(dataset);
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
      const [
        organisations,
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
