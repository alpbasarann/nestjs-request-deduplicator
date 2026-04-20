import type { Request } from 'express';
import type { DeduplicatorRecord } from '../interfaces/record.interface';
import type { DeduplicatorStorageAdapter } from '../adapters/storage.adapter';
import type { RequestDeduplicatorModuleOptions } from '../interfaces/options.interface';

/**
 * Base context — fields every state handler needs.
 * No record field here; the guard decides whether a record is present and builds
 * the appropriate context before dispatching.
 */
export type BaseStateContext = {
  request: Request;
  req: Record<string, unknown>;
  deduplicationKey: string;
  adapter: DeduplicatorStorageAdapter;
  moduleOptions: RequestDeduplicatorModuleOptions;
};

/**
 * Extends the base context with a guaranteed non-null existing record.
 * Supplied by the guard only when `adapter.findByKey` returned a record,
 * so handlers that receive this context never need a null check.
 */
export type ExistingRecordStateContext = BaseStateContext & {
  existingRecord: DeduplicatorRecord;
};
