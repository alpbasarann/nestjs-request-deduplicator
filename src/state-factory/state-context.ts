import type { Request } from 'express';
import type { DeduplicatorRecord } from '../models';
import type { DeduplicatorStorageAdapter } from '../adapters/deduplicator-storage.adapter';
import type { RequestDeduplicatorModuleOptions } from '../adapters';

/**
 * Base context — fields every state needs. No record field here; the factory
 * decides whether a record is available and dispatches accordingly. States
 * that need the record receive `ExistingRecordStateContext`, so there is never a
 * null to check at runtime.
 */
export type BaseStateContext = {
  request: Request;
  req: Record<string, unknown>;
  deduplicationKey: string;
  adapter: DeduplicatorStorageAdapter;
  moduleOptions: RequestDeduplicatorModuleOptions;
};

/** Extends the base with a guaranteed non-null record — supplied by the guard
 * only when `adapter.findByKey` returned a record. Consumed by subclasses of
 * `ExistingRecordState`. */
export type ExistingRecordStateContext = BaseStateContext & {
  existingRecord: DeduplicatorRecord;
};
