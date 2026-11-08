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

export type TypeDbConnectionConfig = {
  httpAddress: string;
  username: string;
  password: string;
  databaseName: string;
};

export function defaultTypeDbConfig(databaseName = 'aci_macro_intelligence'): TypeDbConnectionConfig {
  return {
    httpAddress: process.env.TYPEDB_HTTP_ADDRESS || 'http://127.0.0.1:8000',
    username: process.env.TYPEDB_USERNAME || 'admin',
    password: process.env.TYPEDB_PASSWORD || 'password',
    databaseName: process.env.TYPEDB_DATABASE || databaseName,
  };
}

export type LiveTypeDbProjectionReport = {
  connected: boolean;
  distribution: string | null;
  serverVersion: string | null;
  databaseName: string;
  schemaCommitted: boolean;
  bootstrapStatementsExecuted: number;
  outboxProjectedCount: number;
  outboxDeadLetterCount: number;
  checkpoint: ProjectionCheckpoint;
  error: string | null;
};

/**
 * Checks whether a live TypeDB 3.x HTTP server is reachable and returns its version metadata.
 */
export async function probeTypeDbServer(
  config = defaultTypeDbConfig(),
): Promise<{
  reachable: boolean;
  distribution: string | null;
  version: string | null;
  error: string | null;
}> {
  try {
    const driver = new TypeDBHttpDriver({
      username: config.username,
      password: config.password,
      addresses: [config.httpAddress],
    });
    const res = await driver.version();
    if (isApiErrorResponse(res)) {
      return {
        reachable: false,
        distribution: null,
        version: null,
        error: `${res.err.code}: ${res.err.message}`,
      };
    }
    return {
      reachable: true,
      distribution: res.ok.distribution,
      version: res.ok.version,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      distribution: null,
      version: null,
      error: err instanceof Error ? err.message : String(err),
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
  const config = options?.config ?? defaultTypeDbConfig();
  const driver = new TypeDBHttpDriver({
    username: config.username,
    password: config.password,
    addresses: [config.httpAddress],
  });

  const versionRes = await driver.version();
  if (isApiErrorResponse(versionRes)) {
    throw new Error(`TypeDB server unreachable: ${versionRes.err.code} ${versionRes.err.message}`);
  }

  if (options?.recreateDatabase) {
    await driver.deleteDatabase(config.databaseName).catch(() => {});
  }

  const dbsRes = await driver.getDatabases();
  if (isApiErrorResponse(dbsRes)) {
    throw new Error(`Failed to list TypeDB databases: ${dbsRes.err.message}`);
  }
  const exists = dbsRes.ok.databases.some((d) => d.name === config.databaseName);
  if (!exists) {
    const createRes = await driver.createDatabase(config.databaseName);
    if (isApiErrorResponse(createRes)) {
      throw new Error(`Failed to create TypeDB database: ${createRes.err.message}`);
    }

    // Open a `schema` transaction and define the pinned TypeQL 3 schema
    const schemaTx = await driver.openTransaction(config.databaseName, 'schema');
    if (isApiErrorResponse(schemaTx)) {
      throw new Error(`Failed to open TypeDB schema transaction: ${schemaTx.err.message}`);
    }
    const schemaText = loadPinnedTypeQlSchema();
    const schemaQueryRes = await driver.query(schemaTx.ok.transactionId, schemaText);
    if (isApiErrorResponse(schemaQueryRes)) {
      await driver.closeTransaction(schemaTx.ok.transactionId);
      throw new Error(
        `TypeQL 3 schema definition failed: ${schemaQueryRes.err.code} ${schemaQueryRes.err.message}`,
      );
    }
    const schemaCommitRes = await driver.commitTransaction(schemaTx.ok.transactionId);
    if (isApiErrorResponse(schemaCommitRes)) {
      throw new Error(
        `TypeQL 3 schema commit failed: ${schemaCommitRes.err.code} ${schemaCommitRes.err.message}`,
      );
    }
  }

  // Bootstrap foundational entities in a `write` transaction
  const bootstrapStatements = compileDatasetEntityBootstrapStatements(dataset);
  const entityTx = await driver.openTransaction(config.databaseName, 'write');
  if (isApiErrorResponse(entityTx)) {
    throw new Error(`Failed to open TypeDB write transaction: ${entityTx.err.message}`);
  }
  for (const stmt of bootstrapStatements) {
    const qRes = await driver.query(entityTx.ok.transactionId, stmt);
    if (isApiErrorResponse(qRes)) {
      await driver.closeTransaction(entityTx.ok.transactionId);
      throw new Error(`Entity bootstrap query failed: ${qRes.err.code} ${qRes.err.message}\n${stmt}`);
    }
  }
  const entityCommit = await driver.commitTransaction(entityTx.ok.transactionId);
  if (isApiErrorResponse(entityCommit)) {
    throw new Error(`Entity bootstrap commit failed: ${entityCommit.err.message}`);
  }

  // Build and project outbox items in durable per-item write transactions
  const { accepted } = buildOutboxItemsFromDataset(dataset);
  const { updatedOutbox, checkpoint } = await processProjectionOutboxBatch(
    accepted,
    async (item) => {
      const tx = await driver.openTransaction(config.databaseName, 'write');
      if (isApiErrorResponse(tx)) {
        throw new Error(`Open write tx failed: ${tx.err.message}`);
      }
      for (const stmt of item.typeqlStatements) {
        const res = await driver.query(tx.ok.transactionId, stmt);
        if (isApiErrorResponse(res)) {
          await driver.closeTransaction(tx.ok.transactionId);
          throw new Error(`${res.err.code}: ${res.err.message}`);
        }
      }
      const commit = await driver.commitTransaction(tx.ok.transactionId);
      if (isApiErrorResponse(commit)) {
        throw new Error(`${commit.err.code}: ${commit.err.message}`);
      }
    },
  );

  return {
    report: {
      connected: true,
      distribution: versionRes.ok.distribution,
      serverVersion: versionRes.ok.version,
      databaseName: config.databaseName,
      schemaCommitted: true,
      bootstrapStatementsExecuted: bootstrapStatements.length,
      outboxProjectedCount: checkpoint.projectedCount,
      outboxDeadLetterCount: checkpoint.deadLetterCount,
      checkpoint,
      error: null,
    },
    outbox: updatedOutbox,
  };
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
  error: string | null;
}> {
  try {
    const driver = new TypeDBHttpDriver({
      username: config.username,
      password: config.password,
      addresses: [config.httpAddress],
    });
    const ver = await driver.version();
    if (isApiErrorResponse(ver)) {
      return {
        ok: false,
        serverVersion: null,
        answerCount: 0,
        rawAnswers: [],
        error: `${ver.err.code}: ${ver.err.message}`,
      };
    }
    const tx = await driver.openTransaction(config.databaseName, 'read', {
      transactionTimeoutMillis: 5000,
    });
    if (isApiErrorResponse(tx)) {
      return {
        ok: false,
        serverVersion: ver.ok.version,
        answerCount: 0,
        rawAnswers: [],
        error: `${tx.err.code}: ${tx.err.message}`,
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
          error: `${qRes.err.code}: ${qRes.err.message}`,
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
        error: null,
      };
    } finally {
      await driver.closeTransaction(tx.ok.transactionId).catch(() => {});
    }
  } catch (err) {
    return {
      ok: false,
      serverVersion: null,
      answerCount: 0,
      rawAnswers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
