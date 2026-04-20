export const REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY = 'request-deduplicator:options';
export const REQUEST_DEDUPLICATOR_ADAPTER_TOKEN = 'REQUEST_DEDUPLICATOR_ADAPTER';
export const REQUEST_DEDUPLICATOR_OPTIONS_TOKEN = 'REQUEST_DEDUPLICATOR_OPTIONS';

/** Stamped on the request by the guard so the interceptor can update state after the handler */
export const REQUEST_DEDUPLICATOR_KEY_PROPERTY = '__deduplicatorKey';

/** Stamped on the request by the guard for FAILED retries — holds the prior record */
export const REQUEST_DEDUPLICATOR_RECORD_PROPERTY = '__deduplicatorRecord';

export const DEFAULT_ID_FIELD_NAME = 'id';
export const DEFAULT_DEDUPLICATION_KEY_FIELD_NAME = 'deduplication_key';

/** Maximum number of fields allowed per @RequestDeduplicator() decorator */
export const MAX_FIELDS_PER_DEDUPLICATOR = 50;

/** Maximum length of a single field path string */
export const MAX_FIELD_PATH_LENGTH = 256;

/** Maximum length of a single path segment */
export const MAX_PATH_SEGMENT_LENGTH = 128;

/** Regex for validating tableName */
export const TABLE_NAME_REGEX = /^[A-Za-z_][a-zA-Z0-9_]{0,62}$/;

/** Forbidden path segments that could cause prototype pollution */
export const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Default TTL in milliseconds for an IN_PROGRESS record to be considered actively running.
 * Records older than this are assumed to belong to a crashed request and are recoverable.
 */
export const DEFAULT_IN_PROGRESS_TTL_MS = 10000;

/** States of a deduplication record. */
export const DEDUPLICATOR_STATES = {
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  } as const;
  