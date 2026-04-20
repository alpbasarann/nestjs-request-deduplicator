import { DeduplicatorRecord } from '../interfaces/record.interface';
import { DeduplicatorState } from '../types/state.types';

/**
 * Abstract base class for all request-deduplicator storage adapters.
 * Extend this class and implement all abstract methods to connect the package to your database.
 *
 * **Atomicity / race-condition safety**
 * To prevent two concurrent requests from both passing the IN_PROGRESS gate, the
 * `create()` method should enforce a unique constraint on `deduplicationKey` at the
 * database level (e.g. a UNIQUE index or an upsert-with-conflict strategy). Without
 * this, a narrow race window exists in which two identical requests can both read
 * `null` from `findByKey` and both proceed to create records simultaneously.
 *
 * All implementations must use parameterized queries / official driver APIs — never
 * interpolate user-supplied values directly into query strings.
 */
export abstract class DeduplicatorStorageAdapter {
  /**
   * Called by the module on startup. Creates table/collection/index if not exists.
   * Must be idempotent — safe to call multiple times.
   */
  abstract initialize(): Promise<void>;

  /**
   * Find a record by its deduplication key (SHA-256 hash).
   *
   * When multiple records share the same key, return in this priority order:
   * 1. COMPLETED
   * 2. IN_PROGRESS
   * 3. Most-recent FAILED
   *
   * Returns `null` if no record exists for the key.
   */
  abstract findByKey(deduplicationKey: string): Promise<DeduplicatorRecord | null>;

  /**
   * Create a new deduplicator record. `createdAt` is set by the adapter (use `new Date()`).
   *
   * `record.state` is a plain string (`'IN_PROGRESS'`, `'COMPLETED'`, `'FAILED'`) — pass it
   * directly to your parameterized query without any conversion.
   *
   * `record.statusChangeLogs` contains the initial log entry set by the caller
   * (e.g. `[{ from: null, to: 'IN_PROGRESS', changedAt: Date }]`). Persist it as-is.
   */
  abstract create(
    record: Omit<DeduplicatorRecord, 'createdAt'>,
  ): Promise<DeduplicatorRecord>;

  /**
   * Update the state (and optionally the response payload) of an existing record.
   *
   * `state` is a plain string (`'IN_PROGRESS'`, `'COMPLETED'`, `'FAILED'`) — pass it
   * directly to your parameterized query without any conversion.
   *
   * Use `findByKey` to locate the record, then update it by its `id`.
   * If no record exists for the key, this is a no-op.
   *
   * **statusChangeLogs**: append a new entry to the record's log:
   * ```
   * { from: existingRecord.state, to: state, changedAt: new Date() }
   * ```
   * This preserves the full audit trail of state transitions.
   */
  abstract updateState(
    deduplicationKey: string,
    state: DeduplicatorState,
    responseBody?: unknown,
    responseStatus?: number,
  ): Promise<void>;

  /**
   * Called on module destroy (`onModuleDestroy`). Close connections and release resources.
   */
  abstract close(): Promise<void>;
}
