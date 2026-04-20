import { createHash } from 'crypto';
import { ExtractedFields } from './field-extractor';

const MAX_SORT_DEPTH = 50;

/**
 * Recursively sort an object's keys at every nesting level to produce
 * a canonical representation — ensuring determinism regardless of insertion order.
 *
 * Throws RangeError if nesting exceeds MAX_SORT_DEPTH to prevent stack overflow
 * on pathologically deep payloads.
 */
function sortKeysDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_SORT_DEPTH) {
    throw new RangeError(
      `Request body exceeds maximum nesting depth of ${MAX_SORT_DEPTH} for deduplication hashing`,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key], depth + 1);
    }
    return sorted;
  }

  return value;
}

/**
 * Generate a SHA-256 deduplication hash from an extracted fields map.
 *
 * The function:
 * 1. Deep-sorts all keys for canonical ordering
 * 2. Serializes to JSON
 * 3. Returns the hex-encoded SHA-256 digest
 *
 * This is pure and deterministic: identical inputs always produce identical output.
 *
 * Throws RangeError if nesting depth exceeds 50 levels.
 * Throws TypeError if the value cannot be serialized (e.g. circular reference).
 */
export function generateHash(fields: ExtractedFields): string {
  const canonical = sortKeysDeep(fields);
  let serialized: string;
  try {
    serialized = JSON.stringify(canonical);
  } catch (err) {
    throw new TypeError(
      `Failed to serialize fields for deduplication hashing: ${String(err)}`,
    );
  }
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
