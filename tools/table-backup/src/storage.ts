// Access to the tables of the data account and to the backup container.
//
// Both accept either a connection string (Azurite, local tests, the e2e restore drill) or an
// account name with Microsoft Entra ID credentials from `az login` (CI after azure/login, the
// owner's machine). Nothing here prints endpoints or account names.
import {
  TableClient,
  type TableEntity,
  TableServiceClient,
  type TransactionAction,
} from '@azure/data-tables';
import { AzureCliCredential, type TokenCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { type BackupEntity, fromSdkEntity, toSdkEntity } from './edm.ts';

export type Connection = { connectionString: string } | { account: string };

const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/;
const MAX_BATCH_ROWS = 100;
// A transaction may carry 4 MiB; stay well below it.
const MAX_BATCH_BYTES = 2_500_000;

let credential: TokenCredential | undefined;
function cliCredential(): TokenCredential {
  credential ??= new AzureCliCredential();
  return credential;
}

function isLocal(connectionString: string): boolean {
  return /UseDevelopmentStorage=true|=http:\/\//i.test(connectionString);
}

function accountUrl(account: string, service: 'table' | 'blob'): string {
  if (!ACCOUNT_NAME.test(account)) throw new Error('invalid storage account name');
  return `https://${account}.${service}.core.windows.net`;
}

/**
 * The Table service marks a Double only by a decimal point in the JSON number ("5.0"), which
 * JSON.parse loses, so the SDK would read a whole-number Double back as an Int32. This adds the
 * explicit `@odata.type` annotation for every number literal with a decimal point or exponent
 * before the SDK parses the response. Int32 values never carry either.
 */
export function annotateDoubles(body: string): string {
  const parsed: unknown = JSON.parse(
    body,
    function (
      this: Record<string, unknown>,
      key: string,
      value: unknown,
      context?: { source?: string },
    ) {
      if (
        typeof value === 'number' &&
        typeof context?.source === 'string' &&
        /[.eE]/.test(context.source) &&
        !Array.isArray(this) &&
        !(`${key}@odata.type` in this)
      ) {
        this[`${key}@odata.type`] = 'Edm.Double';
      }
      return value;
    },
  );
  return JSON.stringify(parsed);
}

function addDoublePolicy(client: TableClient): TableClient {
  client.pipeline.addPolicy(
    {
      name: 'weddingplanner-annotate-doubles',
      async sendRequest(request, next) {
        const response = await next(request);
        const type = response.headers.get('content-type') ?? '';
        if (response.bodyAsText && /application\/json/i.test(type)) {
          response.bodyAsText = annotateDoubles(response.bodyAsText);
        }
        return response;
      },
    },
    // Closer to the wire than the SDK's deserialization, so it sees the raw body first.
    { afterPhase: 'Deserialize' },
  );
  return client;
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? (error.statusCode as number)
    : undefined;
}

function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const e = error as { code?: unknown; message?: unknown };
  return `${typeof e.code === 'string' ? e.code : ''} ${typeof e.message === 'string' ? e.message : ''}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TableStore {
  readonly #service: TableServiceClient;
  readonly #client: (table: string) => TableClient;

  constructor(connection: Connection) {
    if ('connectionString' in connection) {
      const options = { allowInsecureConnection: isLocal(connection.connectionString) };
      this.#service = TableServiceClient.fromConnectionString(connection.connectionString, options);
      this.#client = (table) =>
        addDoublePolicy(
          TableClient.fromConnectionString(connection.connectionString, table, options),
        );
    } else {
      const url = accountUrl(connection.account, 'table');
      this.#service = new TableServiceClient(url, cliCredential());
      this.#client = (table) => addDoublePolicy(new TableClient(url, table, cliCredential()));
    }
  }

  /** Table names, sorted; only those starting with `prefix` (case-sensitive) when given. */
  async listTables(prefix = ''): Promise<string[]> {
    const names: string[] = [];
    for await (const table of this.#service.listTables()) {
      if (table.name?.startsWith(prefix)) names.push(table.name);
    }
    return names.sort();
  }

  async readEntities(table: string): Promise<BackupEntity[]> {
    const entities: BackupEntity[] = [];
    const client = this.#client(table);
    for await (const entity of client.listEntities({ disableTypeConversion: true })) {
      entities.push(fromSdkEntity(entity as Record<string, unknown>));
    }
    return entities;
  }

  async state(table: string): Promise<'missing' | 'empty' | 'non-empty'> {
    try {
      const pages = this.#client(table).listEntities().byPage({ maxPageSize: 1 });
      const first = await pages.next();
      return !first.done && first.value.length > 0 ? 'non-empty' : 'empty';
    } catch (error) {
      if (statusOf(error) === 404) return 'missing';
      throw error;
    }
  }

  /** Creates the table; waits while a table of the same name is still being deleted. */
  async createTable(table: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#service.createTable(table);
        return;
      } catch (error) {
        if (attempt < 30 && statusOf(error) === 409 && /TableBeingDeleted/i.test(codeOf(error))) {
          await sleep(5000);
          continue;
        }
        throw error;
      }
    }
  }

  async deleteTable(table: string): Promise<void> {
    await this.#service.deleteTable(table);
  }

  /** Upserts (replace) in transactions: one partition each, at most 100 rows and ~2.5 MB. */
  async upsertEntities(table: string, entities: readonly BackupEntity[]): Promise<void> {
    const client = this.#client(table);
    const byPartition = new Map<string, BackupEntity[]>();
    for (const entity of entities) {
      const list = byPartition.get(entity.partitionKey) ?? [];
      list.push(entity);
      byPartition.set(entity.partitionKey, list);
    }
    for (const partition of byPartition.values()) {
      let batch: TransactionAction[] = [];
      let bytes = 0;
      const flush = async () => {
        if (batch.length > 0) await client.submitTransaction(batch);
        batch = [];
        bytes = 0;
      };
      for (const entity of partition) {
        const sdk = toSdkEntity(entity) as TableEntity;
        const size = JSON.stringify(sdk).length * 2;
        if (
          batch.length >= MAX_BATCH_ROWS ||
          (batch.length > 0 && bytes + size > MAX_BATCH_BYTES)
        ) {
          await flush();
        }
        batch.push(['upsert', sdk, 'Replace']);
        bytes += size;
      }
      await flush();
    }
  }
}

export class BackupStore {
  readonly #container: ContainerClient;

  constructor(connection: Connection, containerName: string) {
    const service =
      'connectionString' in connection
        ? BlobServiceClient.fromConnectionString(connection.connectionString)
        : new BlobServiceClient(accountUrl(connection.account, 'blob'), cliCredential());
    this.#container = service.getContainerClient(containerName);
  }

  /** Creates the container (local use and tests; in Azure it comes from Bicep). */
  async ensureContainer(): Promise<void> {
    await this.#container.createIfNotExists();
  }

  /** Writes a new blob. Never overwrites: an existing blob fails the call (and WORM forbids it). */
  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    await this.#container.getBlockBlobClient(path).uploadData(data, {
      conditions: { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  async get(path: string): Promise<Buffer> {
    try {
      return await this.#container.getBlobClient(path).downloadToBuffer();
    } catch (error) {
      if (statusOf(error) === 404) throw new Error(`backup file ${path} not found`);
      throw error;
    }
  }

  async list(prefix?: string): Promise<{ name: string; bytes: number }[]> {
    const blobs: { name: string; bytes: number }[] = [];
    const options = prefix === undefined ? {} : { prefix };
    for await (const blob of this.#container.listBlobsFlat(options)) {
      blobs.push({ name: blob.name, bytes: blob.properties.contentLength ?? 0 });
    }
    return blobs;
  }
}
