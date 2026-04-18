import { DeduplicatorState } from "../enums";


export type DeduplicatorRecord = {
  /** Unique per-record UUID. Use as primary key in your adapter. */
  id: string;
  /** SHA-256 hash of the extracted request fields. Used for deduplication lookup. */
  deduplicationKey: string;
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
}

export type DeduplicatorRequest = {
  /**
   * Field names to pick from `request.body`.
   * Supports dot-notation for nested access (e.g. `'user.id'`).
   *
   * @example
   * body: ['userId', 'productId', 'amount']
   */
  body?: string[];
  /**
   * Header names to pick from `request.headers` (case-insensitive).
   *
   * @example
   * headers: ['x-client-id', 'x-session-token']
   */
  headers?: string[];
  /**
   * Query parameter names to pick from `request.query`.
   * Supports dot-notation for nested access (e.g. `'filter.status'`).
   *
   * @example
   * query: ['tenantId', 'version']
   */
  query?: string[];
  /**
   * Route parameter names to pick from `request.params`.
   *
   * @example
   * params: ['orderId', 'userId']
   */
  params?: string[];
  /** Overrides module-level deduplicationKeyFieldName for this route */
  keyName?: string;
}

