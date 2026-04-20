import { DeduplicatorStorageAdapter } from '../adapters/storage.adapter';
import { LoggingConfig } from '../types/logging.types';

export interface RequestDeduplicatorModuleOptions {
  adapter: DeduplicatorStorageAdapter;
  tableName: string;
  idFieldName?: string;
  deduplicationKeyFieldName?: string;
  /**
   * Whether to register this module as a NestJS global module.
   * Default: `true`. Set to `false` when you need multiple adapter instances
   * in different feature modules (e.g. one Postgres module + one Redis module).
   */
  global?: boolean;
  /**
   * Maximum age in milliseconds for an IN_PROGRESS record to be considered actively running.
   * Requests older than this are treated as stale/crashed and allowed to retry.
   * Default: 30 000 ms (30 seconds).
   */
  inProgressTtl?: number;
  /**
   * Controls logging of internal events (unknown states, adapter write failures, etc.).
   *
   * @example
   * logging: { mode: 'silent' }
   * logging: { mode: 'logged', logger: (level, msg, meta) => winstonLogger[level](msg, meta) }
   */
  logging?: LoggingConfig;
}

export interface RequestDeduplicatorOptions {
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
