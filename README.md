# nestjs-request-deduplicator

Prevent duplicate requests in NestJS. Add one decorator to a route and the library handles deduplication, state tracking, and response auditing. No database is bundled — you bring your own storage (Postgres, Redis, MongoDB, or anything else).

---

## How it works

1. A request arrives. The guard hashes the fields you chose (body, headers, query, params) into a SHA-256 key and looks it up in storage.
2. **No record** → creates an `IN_PROGRESS` record and lets the request through.
3. **`IN_PROGRESS` within TTL** → the original request is still running; lets this one through too and overwrites the same record when done.
4. **`IN_PROGRESS` beyond TTL** → the original request crashed; marks the stale record `FAILED` (408), creates a fresh `IN_PROGRESS` record, and lets the new request through.
5. **`FAILED`** → the prior attempt errored; leaves the `FAILED` record intact, creates a new `IN_PROGRESS` record, and lets the request through.
6. **`COMPLETED`** → blocks with `DuplicateRequestException` (409) and records the rejected attempt as a `FAILED` entry for audit.

Routes without `@RequestDeduplicator()` are never touched.

---

## Installation

```bash
npm install nestjs-request-deduplicator
```

---

## Quick start

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { RequestDeduplicatorModule } from 'nestjs-request-deduplicator';
import { MyAdapter } from './my.adapter';

@Module({
  imports: [
    RequestDeduplicatorModule.forRoot({
      adapter: new MyAdapter(),
      tableName: 'deduplicator_records',
      inProgressTtl: 10_000, // 10 seconds (default)
      logging: {
        mode: 'logged',
        logger: (level, message, meta) =>
          console[level](`[Deduplicator] ${message}`, meta ?? ''),
      },
    }),
  ],
})
export class AppModule {}
```

```typescript
// orders.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { RequestDeduplicator } from 'nestjs-request-deduplicator';

@Controller('orders')
export class OrdersController {
  @Post()
  @RequestDeduplicator({
    body:    ['accountId', 'productId', 'amount'],
    headers: ['x-request-id'],
  })
  async createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }
}
```

---

## Module options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `adapter` | `DeduplicatorStorageAdapter` | Yes | — | Your storage adapter instance |
| `tableName` | `string` | Yes | — | Table/collection name. Must match `/^[A-Za-z_][a-zA-Z0-9_]{0,62}$/` |
| `idFieldName` | `string` | No | `'id'` | Primary key column name used by your adapter |
| `deduplicationKeyFieldName` | `string` | No | `'deduplication_key'` | Column name for the SHA-256 hash key used by your adapter |
| `inProgressTtl` | `number` | No | `10000` | Milliseconds a record stays in `IN_PROGRESS` before being considered crashed. Within this window duplicate requests are allowed through to overwrite the record; beyond it the record is retired as `FAILED` and a new one is created |
| `global` | `boolean` | No | `true` | Register as a NestJS global module. Set to `false` when you need multiple adapter instances in different feature modules |
| `logging` | `LoggingConfig` | No | `undefined` | Log routing. Omitting silently discards all log events |

### `inProgressTtl`

Controls when a stuck `IN_PROGRESS` record is considered a crashed request vs an active one.

```typescript
RequestDeduplicatorModule.forRoot({
  adapter: new MyAdapter(),
  tableName: 'deduplicator_records',
  inProgressTtl: 30_000, // treat as crashed after 30 s
})
```

- **Within TTL** — the original request is assumed to still be running. A duplicate request is allowed through and will overwrite the same record to `COMPLETED` or `FAILED` when it finishes.
- **Beyond TTL** — the original request is assumed to have crashed silently (process restart, timeout, OOM). The stale record is marked `FAILED` with a 408 status and a timeout message. A new `IN_PROGRESS` record is created for the incoming request.

### `deduplicationKeyFieldName`

Lets you rename the deduplication key column in your database schema. Useful when integrating with an existing table that uses a different naming convention.

```typescript
RequestDeduplicatorModule.forRoot({
  adapter: new MyAdapter(),
  tableName: 'my_existing_table',
  deduplicationKeyFieldName: 'idempotency_hash', // instead of 'deduplication_key'
})
```

Your adapter reads this value from `moduleOptions.deduplicationKeyFieldName` and uses it as the column/field name in queries.

---

## Logging

### Modes

**`logged`** — route all events to your logger:

```typescript
logging: {
  mode: 'logged',
  logger: (level, message, meta) => console[level](`[Deduplicator] ${message}`, meta ?? ''),
}
```

Replace `console[level]` with any structured logger to integrate with your observability stack:

```typescript
// Winston
logging: { mode: 'logged', logger: (level, msg, meta) => winstonLogger[level](msg, meta) }

// Pino
logging: { mode: 'logged', logger: (level, msg, meta) => pinoLogger[level](meta ?? {}, msg) }

// NestJS Logger
const nestLogger = new Logger('Deduplicator');
logging: { mode: 'logged', logger: (level, msg, meta) => nestLogger[level](msg, meta) }
```

**`silent`** — explicitly discard all events:

```typescript
logging: { mode: 'silent' }
```

Use `silent` in unit tests, in environments where you control log aggregation at a different layer, or when running multiple adapter instances and monitoring them directly. Omitting `logging` entirely has the same effect.

### Events emitted

| Level | When | `meta` fields |
|---|---|---|
| `warn` | A record has an unrecognised state (not `IN_PROGRESS`, `COMPLETED`, or `FAILED`) — guard lets the request through | `deduplicationKey`, `state` |
| `error` | `adapter.updateState()` throws after the handler returns — client response already committed, error swallowed | `deduplicationKey`, `error`, `errorType`, `stack` |
| `error` | `adapter.create()` throws while recording a rejected duplicate — fire-and-forget, swallowed | `deduplicationKey`, `error`, `errorType`, `stack` |

---

## Decorator options

```typescript
@RequestDeduplicator({
  body:    ['accountId', 'amount'],
  headers: ['x-request-id'],
  query:   ['currency'],
  params:  ['orderId'],
})
```

At least one of `body`, `headers`, `query`, or `params` is required. Maximum 50 fields total across all four sources.

Dot-notation is supported for nested fields: `body: ['order.items.0.sku']` reads `request.body.order.items[0].sku`.

| Option | Type | Description |
|---|---|---|
| `body` | `string[]` | Body field paths. Supports dot-notation for nested access. |
| `headers` | `string[]` | Header names (case-insensitive). |
| `query` | `string[]` | Query parameter paths. Supports dot-notation. |
| `params` | `string[]` | Route parameter names. |
| `keyName` | `string` | Override `deduplicationKeyFieldName` for this route only. |

---

## Request lifecycle

```
First request
  Guard:       no record → create IN_PROGRESS → allow
  Handler:     runs
  Interceptor: updateState → COMPLETED (responseBody + responseStatus saved)

Duplicate of a completed request
  Guard:       COMPLETED record found → record rejection as FAILED (fire-and-forget)
               → throw DuplicateRequestException (409)
  Handler:     does not run

Concurrent duplicate within TTL (IN_PROGRESS, age ≤ inProgressTtl)
  Guard:       allow through, stamp existing record key on request
  Handler:     runs
  Interceptor: updateState → COMPLETED or FAILED on the same existing record

Crashed request — IN_PROGRESS beyond TTL (age > inProgressTtl)
  Guard:       updateState existing record → FAILED (408, timeout message)
               → create new IN_PROGRESS record → allow
  Handler:     runs
  Interceptor: updateState new record → COMPLETED or FAILED

Retry after failure (FAILED record exists)
  Guard:       leave FAILED record intact → create new IN_PROGRESS record → allow
  Handler:     runs again
  Interceptor: updateState new record → COMPLETED or FAILED
```

---

## State machine

```
                      ┌─────────────┐
   new request ──────▶│ IN_PROGRESS │
                      └──────┬──────┘
              success ───────┤──── error
                             │
                  ┌──────────┴───────────┐
                  ▼                      ▼
            ┌─────────┐            ┌────────┐
            │COMPLETED│            │ FAILED │
            └─────────┘            └────────┘
                 │                      │
    duplicate    │          new request with same key
    arrives      │                      │
                 ▼                      ▼
           throw 409          create new IN_PROGRESS
                              (old FAILED preserved)
```

**State meanings:**

| State | Meaning | What happens on next duplicate |
|---|---|---|
| `IN_PROGRESS` (within TTL) | Request is running | Allow through, overwrite this same record |
| `IN_PROGRESS` (beyond TTL) | Request crashed | Mark FAILED (408), create new IN_PROGRESS |
| `COMPLETED` | Request succeeded, response cached | Throw 409, record rejection as FAILED |
| `FAILED` | Request errored or timed out | Create new IN_PROGRESS, retry |

---

## Record shape

Every record stored by the adapter has this shape:

```typescript
interface DeduplicatorRecord {
  id: string;                    // UUID — primary key
  deduplicationKey: string;      // SHA-256 hex of the extracted fields
  state: DeduplicatorState;      // 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  requestBody?: unknown;         // Raw incoming body at the time of creation
  responseBody?: unknown;        // Response or error body — set on COMPLETED and FAILED
  responseStatus?: number;       // HTTP status — set on COMPLETED and FAILED
  statusChangeLogs: StatusChangeLog[]; // Full audit trail of state transitions
  createdAt: Date;               // Set by the adapter on create()
}

interface StatusChangeLog {
  from: DeduplicatorState | null; // null on the initial creation entry
  to: DeduplicatorState;
  changedAt: Date;
}
```

### `statusChangeLogs`

Every record carries a complete history of its state transitions. The first entry (`from: null`) is written by the caller at creation time. Every subsequent entry is appended by the adapter's `updateState()` implementation.

Example lifecycle of a successful request:

```json
[
  { "from": null,          "to": "IN_PROGRESS", "changedAt": "2024-01-01T10:00:00.000Z" },
  { "from": "IN_PROGRESS", "to": "COMPLETED",   "changedAt": "2024-01-01T10:00:00.412Z" }
]
```

Example of a crashed request (beyond TTL) followed by a successful retry:

```json
// Original record (crashed)
[
  { "from": null,          "to": "IN_PROGRESS", "changedAt": "2024-01-01T10:00:00.000Z" },
  { "from": "IN_PROGRESS", "to": "FAILED",      "changedAt": "2024-01-01T10:00:11.000Z" }
]

// New record (retry — separate document/row)
[
  { "from": null,          "to": "IN_PROGRESS", "changedAt": "2024-01-01T10:00:11.000Z" },
  { "from": "IN_PROGRESS", "to": "COMPLETED",   "changedAt": "2024-01-01T10:00:11.209Z" }
]
```

---

## Writing a storage adapter

Extend `DeduplicatorStorageAdapter` and implement all five abstract methods. `initialize()` is called on module startup and `close()` on shutdown — both automatically.

```typescript
import {
  DeduplicatorStorageAdapter,
  DeduplicatorRecord,
  DeduplicatorState,
  StatusChangeLog,
} from 'nestjs-request-deduplicator';

export class MyAdapter extends DeduplicatorStorageAdapter {
  async initialize(): Promise<void>  { /* create table/indexes */ }
  async findByKey(key: string): Promise<DeduplicatorRecord | null> { /* lookup */ }
  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> { /* insert */ }
  async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number): Promise<void> { /* update */ }
  async close(): Promise<void> { /* disconnect */ }
}
```

### `findByKey` — priority order

Multiple records can share the same `deduplicationKey` — for example, the active record plus several `FAILED` rejection records from duplicate attempts. Your implementation must return exactly one, in this priority:

1. `COMPLETED`
2. `IN_PROGRESS`
3. Most recent `FAILED`

Use two separate queries rather than one query with `ORDER BY` and `LIMIT`. The first query filters by `state IN ('COMPLETED', 'IN_PROGRESS')`; if nothing is found, the second query falls back to the most recent `FAILED`. This makes priority explicit and is covered by the compound index on `(deduplication_key, state)`.

### `create` — persisting `statusChangeLogs`

The caller always provides the initial `statusChangeLogs` array (one entry, `from: null`). Persist it as-is:

```typescript
async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
  const createdAt = new Date();
  // record.statusChangeLogs already contains the initial entry — persist it
  await db.insert({ ...record, createdAt });
  return { ...record, createdAt };
}
```

### `updateState` — appending to `statusChangeLogs`

Call `findByKey` first to get the current record (you need its `id` to target the right row, and its current `state` as the `from` value). Then append a new log entry:

```typescript
async updateState(key: string, state: DeduplicatorState, responseBody?: unknown, responseStatus?: number): Promise<void> {
  const current = await this.findByKey(key);
  if (!current) return;

  const newEntry: StatusChangeLog = { from: current.state, to: state, changedAt: new Date() };

  await db.update(
    { id: current.id },
    {
      state,
      ...(responseBody  !== undefined ? { responseBody }  : {}),
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      // append — do not overwrite the existing log
      statusChangeLogs: [...current.statusChangeLogs, newEntry],
    },
  );
}
```

> Do not write `UPDATE WHERE deduplication_key = …` — multiple records share the same key. Always target by `id`.

---

## Indexes

Every incoming request triggers at least one `findByKey` call before the handler runs. The right indexes make this O(log n); without them it degrades to a full table scan on every request.

### Recommended indexes

**Compound index — `(deduplication_key, state)`**

Covers the hot-path query: `WHERE deduplication_key = $1 AND state IN ('COMPLETED', 'IN_PROGRESS')`. Runs on every request that passes through a deduplicated route.

| Database | Statement |
|---|---|
| PostgreSQL | `CREATE INDEX ON deduplicator_records (deduplication_key, state);` |
| MongoDB | `db.deduplicator_records.createIndex({ deduplicationKey: 1, state: 1 })` |

**Single-field index — `deduplication_key`**

Covers the FAILED fallback query and the `findByKey` call inside `updateState`.

| Database | Statement |
|---|---|
| PostgreSQL | `CREATE INDEX ON deduplicator_records (deduplication_key);` |
| MongoDB | `db.deduplicator_records.createIndex({ deduplicationKey: 1 })` |

> Redis does not require explicit index management — canonical key lookups are O(1) and the failed sorted set supports O(log n) insertion and O(1) top-element retrieval.

### Do not create a unique index on `deduplication_key`

Multiple records intentionally share the same key — the active record plus `FAILED` rejection/audit records. A unique constraint causes `create()` to fail on the second request.

### Time complexity per request

| Operation | Complexity (SQL/Mongo with indexes) | Complexity (Redis) |
|---|---|---|
| `findByKey` (active path) | O(log n) — compound index scan | O(1) — canonical key get |
| `findByKey` (FAILED fallback) | O(log n) — single-field index scan | O(1) — sorted set top element |
| `create` | O(log n) — index insert | O(log n) — sorted set insert |
| `updateState` | O(log n) — findByKey + indexed update | O(1) hash update |
| **Total per request** | **2–4 index operations** | **2–3 Redis commands** |

---

## Adapter examples

### PostgreSQL

```bash
npm install pg @types/pg
```

```typescript
import { Pool } from 'pg';
import {
  DeduplicatorStorageAdapter,
  DeduplicatorRecord,
  DeduplicatorState,
  StatusChangeLog,
} from 'nestjs-request-deduplicator';

type Row = {
  id: string;
  deduplication_key: string;
  state: string;
  request_body: unknown;
  response_body: unknown;
  response_status: number | null;
  status_change_logs: StatusChangeLog[];
  created_at: Date;
};

function rowToRecord(row: Row): DeduplicatorRecord {
  return {
    id:               row.id,
    deduplicationKey: row.deduplication_key,
    state:            row.state as DeduplicatorState,
    requestBody:      row.request_body  ?? undefined,
    responseBody:     row.response_body ?? undefined,
    responseStatus:   row.response_status ?? undefined,
    statusChangeLogs: (row.status_change_logs ?? []).map((e) => ({
      ...e, changedAt: new Date(e.changedAt),
    })),
    createdAt: row.created_at,
  };
}

export class PostgresAdapter extends DeduplicatorStorageAdapter {
  private pool: Pool;

  constructor(
    private readonly connectionString: string,
    private readonly tableName: string,
  ) {
    super();
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id                  TEXT        PRIMARY KEY,
        deduplication_key   TEXT        NOT NULL,
        state               TEXT        NOT NULL,
        request_body        JSONB,
        response_body       JSONB,
        response_status     INTEGER,
        status_change_logs  JSONB       NOT NULL DEFAULT '[]',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Migrate existing tables that predate the status_change_logs column:
    await this.pool.query(`
      ALTER TABLE "${this.tableName}"
        ADD COLUMN IF NOT EXISTS status_change_logs JSONB NOT NULL DEFAULT '[]'
    `);
    // Recommended indexes — create once manually in your database:
    //   CREATE INDEX ON table_name (deduplication_key);
    //   CREATE INDEX ON table_name (deduplication_key, state);
  }

  async findByKey(deduplicationKey: string): Promise<DeduplicatorRecord | null> {
    // Priority 1 & 2: COMPLETED or IN_PROGRESS
    const { rows: activeRows } = await this.pool.query<Row>(
      `SELECT * FROM "${this.tableName}"
       WHERE deduplication_key = $1
         AND state IN ('COMPLETED', 'IN_PROGRESS')
       ORDER BY CASE state WHEN 'COMPLETED' THEN 1 ELSE 2 END ASC`,
      [deduplicationKey],
    );
    if (activeRows.length > 0) return rowToRecord(activeRows[0]);

    // Priority 3: most recent FAILED
    const { rows: failedRows } = await this.pool.query<Row>(
      `SELECT * FROM "${this.tableName}"
       WHERE deduplication_key = $1
       ORDER BY created_at DESC`,
      [deduplicationKey],
    );
    return failedRows.length > 0 ? rowToRecord(failedRows[0]) : null;
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const createdAt = new Date();
    await this.pool.query(
      `INSERT INTO "${this.tableName}"
         (id, deduplication_key, state, request_body, response_body, response_status, status_change_logs, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.deduplicationKey,
        record.state,
        record.requestBody  !== undefined ? JSON.stringify(record.requestBody)  : null,
        record.responseBody !== undefined ? JSON.stringify(record.responseBody) : null,
        record.responseStatus ?? null,
        JSON.stringify(record.statusChangeLogs),
        createdAt,
      ],
    );
    return { ...record, createdAt };
  }

  async updateState(
    deduplicationKey: string,
    state: DeduplicatorState,
    responseBody?: unknown,
    responseStatus?: number,
  ): Promise<void> {
    const current = await this.findByKey(deduplicationKey);
    if (!current) return;

    const newEntry: StatusChangeLog = { from: current.state, to: state, changedAt: new Date() };

    await this.pool.query(
      `UPDATE "${this.tableName}"
       SET
         state              = $1,
         response_body      = COALESCE($2::jsonb, response_body),
         response_status    = COALESCE($3::integer, response_status),
         status_change_logs = status_change_logs || $4::jsonb
       WHERE id = $5`,
      [
        state,
        responseBody  !== undefined ? JSON.stringify(responseBody) : null,
        responseStatus ?? null,
        JSON.stringify([newEntry]),
        current.id,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

### Redis

The Redis adapter uses three key types per deduplication key to support multiple coexisting records:

- `{prefix}:record:{id}` — Hash of one record's fields
- `{prefix}:canonical:{dedupKey}` — Points to the `id` of the active (`COMPLETED` / `IN_PROGRESS`) record
- `{prefix}:failed:{dedupKey}` — Sorted set of `FAILED` record ids, scored by `createdAt` timestamp

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import {
  DeduplicatorStorageAdapter,
  DeduplicatorRecord,
  DeduplicatorState,
  DEDUPLICATOR_STATES,
  StatusChangeLog,
} from 'nestjs-request-deduplicator';

export class RedisAdapter extends DeduplicatorStorageAdapter {
  private client: Redis;

  constructor(
    private readonly connectionString: string,
    private readonly keyPrefix: string = 'dedup',
    private readonly defaultTtlSeconds?: number,
  ) {
    super();
    this.client = new Redis(connectionString);
  }

  async initialize(): Promise<void> {
    await this.client.ping();
  }

  async findByKey(deduplicationKey: string): Promise<DeduplicatorRecord | null> {
    // Fast path: canonical key points to COMPLETED or IN_PROGRESS record
    const canonicalId = await this.client.get(`${this.keyPrefix}:canonical:${deduplicationKey}`);
    if (canonicalId) {
      const record = await this.getById(canonicalId);
      if (record) return record;
    }

    // Fallback: most recent FAILED
    const [failedId] = await this.client.zrevrange(`${this.keyPrefix}:failed:${deduplicationKey}`, 0, 0);
    return failedId ? this.getById(failedId) : null;
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const createdAt = new Date();
    const full: DeduplicatorRecord = { ...record, createdAt };

    const data: Record<string, string> = {
      id: full.id,
      deduplicationKey: full.deduplicationKey,
      state: full.state,
      createdAt: createdAt.toISOString(),
      statusChangeLogs: JSON.stringify(full.statusChangeLogs),
    };
    if (full.requestBody  !== undefined) data['requestBody']  = JSON.stringify(full.requestBody);
    if (full.responseBody !== undefined) data['responseBody'] = JSON.stringify(full.responseBody);
    if (full.responseStatus !== undefined) data['responseStatus'] = String(full.responseStatus);

    const pipeline = this.client.pipeline();
    pipeline.hset(`${this.keyPrefix}:record:${full.id}`, data);

    if (full.state === DEDUPLICATOR_STATES.COMPLETED || full.state === DEDUPLICATOR_STATES.IN_PROGRESS) {
      pipeline.set(`${this.keyPrefix}:canonical:${full.deduplicationKey}`, full.id);
      if (this.defaultTtlSeconds)
        pipeline.expire(`${this.keyPrefix}:canonical:${full.deduplicationKey}`, this.defaultTtlSeconds);
    } else {
      pipeline.zadd(`${this.keyPrefix}:failed:${full.deduplicationKey}`, createdAt.getTime(), full.id);
    }

    if (this.defaultTtlSeconds)
      pipeline.expire(`${this.keyPrefix}:record:${full.id}`, this.defaultTtlSeconds);

    await pipeline.exec();
    return full;
  }

  async updateState(
    deduplicationKey: string,
    state: DeduplicatorState,
    responseBody?: unknown,
    responseStatus?: number,
  ): Promise<void> {
    const current = await this.findByKey(deduplicationKey);
    if (!current) return;

    const newEntry: StatusChangeLog = { from: current.state, to: state, changedAt: new Date() };
    const updatedLogs = [...current.statusChangeLogs, newEntry];

    const updates: Record<string, string> = {
      state,
      statusChangeLogs: JSON.stringify(updatedLogs),
    };
    if (responseBody  !== undefined) updates['responseBody']  = JSON.stringify(responseBody);
    if (responseStatus !== undefined) updates['responseStatus'] = String(responseStatus);

    const pipeline = this.client.pipeline();
    pipeline.hset(`${this.keyPrefix}:record:${current.id}`, updates);

    if (state === DEDUPLICATOR_STATES.COMPLETED || state === DEDUPLICATOR_STATES.IN_PROGRESS) {
      pipeline.set(`${this.keyPrefix}:canonical:${deduplicationKey}`, current.id);
      if (this.defaultTtlSeconds)
        pipeline.expire(`${this.keyPrefix}:canonical:${deduplicationKey}`, this.defaultTtlSeconds);
      pipeline.zrem(`${this.keyPrefix}:failed:${deduplicationKey}`, current.id);
    } else {
      // Remove from canonical so findByKey falls back to the failed sorted set
      pipeline.del(`${this.keyPrefix}:canonical:${deduplicationKey}`);
      pipeline.zadd(`${this.keyPrefix}:failed:${deduplicationKey}`, current.createdAt.getTime(), current.id);
    }

    await pipeline.exec();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  private async getById(id: string): Promise<DeduplicatorRecord | null> {
    const data = await this.client.hgetall(`${this.keyPrefix}:record:${id}`);
    if (!data?.['id']) return null;

    let statusChangeLogs: StatusChangeLog[] = [];
    try {
      statusChangeLogs = (JSON.parse(data['statusChangeLogs'] ?? '[]') as StatusChangeLog[])
        .map((e) => ({ ...e, changedAt: new Date(e.changedAt) }));
    } catch { /* malformed — treat as empty */ }

    return {
      id: data['id'],
      deduplicationKey: data['deduplicationKey'] ?? '',
      state: (data['state'] ?? DEDUPLICATOR_STATES.FAILED) as DeduplicatorState,
      requestBody:    data['requestBody']    ? JSON.parse(data['requestBody'])    : undefined,
      responseBody:   data['responseBody']   ? JSON.parse(data['responseBody'])   : undefined,
      responseStatus: data['responseStatus'] ? Number(data['responseStatus'])     : undefined,
      statusChangeLogs,
      createdAt: new Date(data['createdAt'] ?? Date.now()),
    };
  }
}
```

### MongoDB

```bash
npm install mongodb
```

```typescript
import { MongoClient, Collection, Db } from 'mongodb';
import {
  DeduplicatorStorageAdapter,
  DeduplicatorRecord,
  DeduplicatorState,
  DEDUPLICATOR_STATES,
  StatusChangeLog,
} from 'nestjs-request-deduplicator';

interface DeduplicatorDoc {
  _id: string;
  deduplicationKey: string;
  state: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseStatus?: number;
  statusChangeLogs: StatusChangeLog[];
  createdAt: Date;
}

export class MongoAdapter extends DeduplicatorStorageAdapter {
  private client: MongoClient;
  private collection!: Collection<DeduplicatorDoc>;

  constructor(
    private readonly connectionUri: string,
    private readonly collectionName: string,
  ) {
    super();
    this.client = new MongoClient(connectionUri);
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    this.collection = this.client.db().collection<DeduplicatorDoc>(this.collectionName);
    // Recommended indexes — create once manually in your database:
    //   { deduplicationKey: 1 }
    //   { deduplicationKey: 1, state: 1 }
  }

  async findByKey(deduplicationKey: string): Promise<DeduplicatorRecord | null> {
    const doc =
      (await this.collection.findOne({
        deduplicationKey,
        state: { $in: [DEDUPLICATOR_STATES.COMPLETED, DEDUPLICATOR_STATES.IN_PROGRESS] },
      })) ??
      (await this.collection.findOne({ deduplicationKey }, { sort: { createdAt: -1 } }));

    if (!doc) return null;
    return {
      id:               doc._id,
      deduplicationKey: doc.deduplicationKey,
      state:            doc.state as DeduplicatorState,
      requestBody:      doc.requestBody,
      responseBody:     doc.responseBody,
      responseStatus:   doc.responseStatus,
      statusChangeLogs: (doc.statusChangeLogs ?? []).map((e) => ({
        ...e, changedAt: new Date(e.changedAt),
      })),
      createdAt:        doc.createdAt,
    };
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const full: DeduplicatorRecord = { ...record, createdAt: new Date() };
    const { id, ...rest } = full;
    await this.collection.insertOne({ _id: id, ...rest } as DeduplicatorDoc);
    return full;
  }

  async updateState(
    deduplicationKey: string,
    state: DeduplicatorState,
    responseBody?: unknown,
    responseStatus?: number,
  ): Promise<void> {
    const current = await this.findByKey(deduplicationKey);
    if (!current) return;

    const newEntry: StatusChangeLog = { from: current.state, to: state, changedAt: new Date() };

    await this.collection.updateOne(
      { _id: current.id },
      {
        $set: {
          state,
          ...(responseBody  !== undefined ? { responseBody }  : {}),
          ...(responseStatus !== undefined ? { responseStatus } : {}),
        },
        $push: { statusChangeLogs: newEntry },
      },
    );
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
```

---

## Record expiry

This package does not delete records. Use your database's built-in expiry:

| Database | Approach |
|---|---|
| MongoDB | Create a TTL index on `createdAt` with `expireAfterSeconds` |
| Redis | Pass `defaultTtlSeconds` to the adapter constructor |
| PostgreSQL | `pg_cron` or a NestJS `@Cron` task: `DELETE WHERE created_at < NOW() - INTERVAL '7 days'` |

---

## Error handling

### `DuplicateRequestException`

Add an exception filter to return a clean JSON response when the guard blocks a completed duplicate:

```typescript
// duplicate-request.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { DuplicateRequestException } from 'nestjs-request-deduplicator';

@Catch(DuplicateRequestException)
export class DuplicateRequestFilter implements ExceptionFilter {
  catch(exception: DuplicateRequestException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(exception.statusCode).json({
      statusCode: exception.statusCode,
      code:       exception.code,
      message:    exception.message,
    });
  }
}
```

```typescript
// main.ts
app.useGlobalFilters(new DuplicateRequestFilter());
```

Response body:

```json
{
  "statusCode": 409,
  "code": "DUPLICATE_REQUEST",
  "message": "This operation has already been completed"
}
```

> `DuplicateRequestException` extends plain `Error`, not NestJS's `HttpException`. When the package is installed via `file:` during local development, two separate copies of `@nestjs/common` can exist and `instanceof HttpException` checks break across the module boundary. Using a plain `Error` subclass avoids this.

### Behaviour table

| Situation | Result |
|---|---|
| Duplicate of a completed request | `409` via `DuplicateRequestFilter` |
| Concurrent request within TTL | Allowed through — overwrites same record when done |
| Crashed request (IN_PROGRESS beyond TTL) | Old record marked `FAILED`; new request proceeds normally |
| Failed request retry | Old `FAILED` record preserved; new request proceeds normally |
| Handler throws | Record settled as `FAILED`; next request with same key retries |
| Adapter throws during `findByKey` | `500` — guard does not catch adapter lookup errors |
| Adapter throws during `updateState` | Logged at `error` level; client response unaffected |
| Invalid `tableName` at startup | Throws at boot: `Invalid tableName "…"` |
| `adapter` wrong type at startup | Throws at boot: `options.adapter must be an instance of DeduplicatorStorageAdapter` |

---

## Contributing

You can contribute by fixing any missing or buggy parts you find in the project, and if you find it useful, a star would be greatly appreciated.

For questions or feedback, reach out at **alpbasaran99@gmail.com**.

---

## License

MIT — see [LICENSE](./LICENSE).
