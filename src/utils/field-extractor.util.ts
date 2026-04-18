import {
  FORBIDDEN_PATH_SEGMENTS,
  MAX_FIELD_PATH_LENGTH,
  MAX_PATH_SEGMENT_LENGTH,
} from '../constants';
import type { DeduplicatorRequest } from '../models';

export interface ExtractedFields {
  [key: string]: unknown;
}

/**
 * Minimal request surface we need. `body`/`query`/`params` are `unknown` so
 * express's native `Request` (with `ParsedQs` / `ParamsDictionary` / `any` body)
 * is directly assignable — `safeGet` handles the traversal internally.
 */
export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

/**
 * Validates a single field key.
 * Rejects dangerous names that could cause prototype pollution.
 */
export function validateKey(key: string): void {
  if (key.length > MAX_FIELD_PATH_LENGTH) {
    throw new RangeError(
      `Field key exceeds maximum length of ${MAX_FIELD_PATH_LENGTH} characters: "${key.slice(0, 64)}..."`,
    );
  }

  const segments = key.split('.');

  for (const segment of segments) {
    if (segment.length === 0) {
      throw new SyntaxError(`Field key contains an empty segment: "${key}"`);
    }

    if (segment.length > MAX_PATH_SEGMENT_LENGTH) {
      throw new RangeError(
        `Field key segment exceeds maximum length of ${MAX_PATH_SEGMENT_LENGTH} characters in: "${key}"`,
      );
    }

    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new Error(
        `Forbidden key detected: "${segment}" in "${key}". Prototype pollution is not allowed.`,
      );
    }
  }
}

/**
 * Safely traverse a nested object using dot-notation segments.
 * Returns undefined if any intermediate value is missing or not traversable.
 */
function safeGet(obj: unknown, segments: string[]): unknown {
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

/**
 * Pick deduplication fields from the incoming request according to the
 * decorator options, and return a deterministically-sorted map ready for hashing.
 *
 * - `body` fields support dot-notation for nested access (e.g. 'user.id')
 * - `headers` are looked up case-insensitively
 * - `query` fields are picked from the parsed query string (dot-notation supported)
 * - `params` fields are picked from route parameters (e.g. ':recordId')
 */
export function getExtractedFields(
  request: RequestLike,
  options: DeduplicatorRequest = {},
): ExtractedFields {
  const { body = [], headers = [], query = [], params = [] } = options;
  const result: Record<string, unknown> = {};

  for (const field of body) {
    validateKey(field);
    result[`body.${field}`] = safeGet(request.body, field.split('.'));
  }

  for (const header of headers) {
    validateKey(header);
    result[`header.${header}`] = request.headers[header.toLowerCase()];
  }

  for (const field of query) {
    validateKey(field);
    result[`query.${field}`] = safeGet(request.query, field.split('.'));
  }

  for (const field of params) {
    validateKey(field);
    result[`param.${field}`] = safeGet(request.params, field.split('.'));
  }

  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Prepare a pre-built field map for deterministic hashing — validates every key
 * and returns an alphabetically-sorted copy.
 *
 * Use this when you're deduplicating a **non-HTTP context** where
 * `getExtractedFields` doesn't fit — e.g.:
 *   - Queue consumers (RabbitMQ / Kafka / SQS)
 *   - gRPC / WebSocket / scheduled-job handlers
 *   - Custom `DeduplicatorStorageAdapter` implementations that build keys
 *     outside the Guard pipeline
 *   - Dedup key maps whose fields come from user input or plugins (dynamic keys)
 *
 * Pair with `generateHash` to get the **same hash guarantees the Guard
 * provides**: deterministic output (sorted keys → identical hash regardless
 * of input property order) and prototype-pollution safety (keys like
 * `__proto__`, `constructor`, `prototype` are rejected).
 *
 * @example
 * import { extractFields, generateHash } from 'nestjs-request-deduplicator';
 *
 * // A queue consumer building its own dedup key
 * const hash = generateHash(extractFields({
 *   userId: message.user,
 *   orderId: message.order,
 *   correlationId: message.traceId,
 * }));
 *
 * @throws {Error} if any key contains a forbidden segment (`__proto__`, `constructor`, `prototype`)
 * @throws {RangeError} if any key exceeds the maximum length
 */
export function extractFields(resolvedData: Record<string, unknown>): ExtractedFields {
  for (const key of Object.keys(resolvedData)) {
    validateKey(key);
  }
  return Object.fromEntries(
    Object.entries(resolvedData).sort(([a], [b]) => a.localeCompare(b)),
  );
}
