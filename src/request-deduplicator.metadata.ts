import { DeduplicatorRequest } from "./models";


/**
 * Type guard: returns true if `value` is a valid RequestDeduplicatorOptions object.
 * Used by the guard to skip routes that don't have the decorator applied.
 */
export function isRequestDeduplicatorOptions(value: unknown): value is DeduplicatorRequest {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const v = value as Record<string, unknown>;

  const isStringArray = (arr: unknown) =>
    Array.isArray(arr) && arr.length > 0 && (arr as unknown[]).every((f) => typeof f === 'string');

  const hasBody    = isStringArray(v['body']);
  const hasHeaders = isStringArray(v['headers']);
  const hasQuery   = isStringArray(v['query']);
  const hasParams  = isStringArray(v['params']);

  if (!hasBody && !hasHeaders && !hasQuery && !hasParams) return false;

  if (v['keyName'] !== undefined && typeof v['keyName'] !== 'string') return false;

  return true;
}
