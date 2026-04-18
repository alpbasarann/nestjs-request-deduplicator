import { LogLevel } from "../enums";
import { DeduplicatorStorageAdapter } from "./deduplicator-storage.adapter";

export type LoggerFn = (
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) => void;

/**
 * Logging configuration. A proper discriminated union:
 * - `{ mode: 'silent' }`              → runtime MUST NOT emit log events
 * - `{ mode: 'logged', logger: Fn }`  → runtime invokes `logger` for warn/error events
 *
 * The `mode` literal is the discriminator — narrow with `switch` / `===`.
 * No optional keys, no sentinel values.
 */
export type LoggingOptions =
  | { mode: 'silent' }
  | { mode: 'logged'; logger: LoggerFn };

/**
 * Module options — fully required, zero optionals.
 *
 * The caller writes out every key explicitly. The library does NOT ship a
 * spreadable defaults object on purpose: if a "default" value ever changes
 * in a future version, callers who copy-pasted the explicit value keep
 * their old behavior; there is no silent drift via `...DEFAULTS`.
 *
 * Typical / recommended values are noted in the JSDoc for each field.
 */
export type RequestDeduplicatorModuleOptions = {
  adapter: DeduplicatorStorageAdapter;
  tableName: string;
  /** Row id column name. Typical: `'id'`. */
  idFieldName: string;
  /** Deduplication-key column name. Typical: `'deduplication_key'`. */
  deduplicationKeyFieldName: string;
  /** Register as a NestJS global module? Typical: `true`. */
  isGlobal: boolean;
  /** Max age (seconds) for an IN_PROGRESS record before it's treated as stale/crashed. Typical: `30`. */
  inProgressTtl: number;
  /** Logging config — `{ mode: 'silent' }` to disable, `{ mode: 'logged', logger }` to enable. */
  logging: LoggingOptions;
};
