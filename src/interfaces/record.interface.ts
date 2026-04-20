import type { DeduplicatorState } from '../types/state.types';
import type { StatusChangeLog } from '../types/status-change-log.types';

export interface DeduplicatorRecord {
  /** Unique per-record UUID. Use as primary key in your adapter. */
  id: string;
  /** SHA-256 hash of the extracted request fields. Used for deduplication lookup. */
  deduplicationKey: string;
  /** Lifecycle state of the record. Stored as a plain string in all adapters. */
  state: DeduplicatorState;
  /**
   * The raw incoming request body stored at the time the record was created.
   * Present on all records (IN_PROGRESS, COMPLETED, FAILED).
   * Use this to inspect what was sent and compare originals vs duplicates for monitoring.
   */
  requestBody?: unknown;
  /**
   * The response body saved after the operation settles.
   * Set for COMPLETED (handler return value) and FAILED (error details or rejection message).
   * Undefined while IN_PROGRESS.
   */
  responseBody?: unknown;
  /**
   * The HTTP status code saved after the operation settles.
   * Set for COMPLETED (handler status) and FAILED (error or rejection status).
   * Undefined while IN_PROGRESS.
   */
  responseStatus?: number;
  createdAt: Date;
  /**
   * Append-only log of every state transition this record has gone through.
   * The first entry (from: null) represents the initial creation.
   * Subsequent entries are appended by the adapter on every `updateState()` call.
   *
   * Useful for auditing, debugging, and understanding the lifecycle of a request.
   *
   * @example
   * [
   *   { from: null,          to: 'IN_PROGRESS', changedAt: Date },
   *   { from: 'IN_PROGRESS', to: 'COMPLETED',   changedAt: Date },
   * ]
   */
  statusChangeLogs: StatusChangeLog[];
}
