import { DeduplicatorState } from '../enums';
import type { DeduplicatorRecord } from '../models';



/**
 * Abstract base class for all request-deduplicator storage adapters.
 * Extend this class and implement all methods to connect the package to your database.
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
   */
  abstract create(
    record: Omit<DeduplicatorRecord, 'createdAt'>,
  ): Promise<DeduplicatorRecord>;

  /**
   * Update the state (and optionally the response payload) of an existing record.
   *
   * Targeting rules:
   * - When transitioning to COMPLETED or FAILED: target the IN_PROGRESS record.
   * - When resetting a FAILED retry back to IN_PROGRESS: target the most-recent FAILED record.
   * - If no matching record exists for the key, this is a no-op.
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
