import {
  FORBIDDEN_PATH_SEGMENTS,
  MAX_FIELD_PATH_LENGTH,
  MAX_PATH_SEGMENT_LENGTH,
} from '../constants';

export interface ExtractedFields {
  [key: string]: unknown;
}

/**
 * Represents an incoming HTTP request (minimal surface we need).
 */
export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
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
 * Extract deduplication fields directly from the incoming request.
 *
 * - `body` fields support dot-notation for nested access (e.g. 'user.id')
 * - `headers` are looked up case-insensitively
 * - `query` fields are picked from the parsed query string (dot-notation supported)
 * - `params` fields are picked from route parameters (e.g. ':recordId')
 *
 * The returned object is deterministically sorted, ready for hashing.
 */
export function getExtractedFields(
  request: RequestLike,
  body: string[] = [],
  headers: string[] = [],
  query: string[] = [],
  params: string[] = [],
): ExtractedFields {
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
    Object.entries(result).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * Validates all keys in a pre-built field map and returns a deterministically
 * sorted copy suitable for hashing.
 */
export function extractFields(resolvedData: Record<string, unknown>): ExtractedFields {
  for (const key of Object.keys(resolvedData)) {
    validateKey(key);
  }
  return Object.fromEntries(
    Object.entries(resolvedData).sort(([a], [b]) => a.localeCompare(b)),
  );
}
