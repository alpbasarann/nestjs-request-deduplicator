import type { ExistingRecordStateHandler } from './base-state-handler';

/** DI injection token for the state-handler dispatch map. */
export const STATE_HANDLER_MAP = Symbol('STATE_HANDLER_MAP');

/**
 * Maps a `DEDUPLICATOR_STATES` value (e.g. `"COMPLETED"`) to the handler
 * responsible for that state. Built once at module startup via `useFactory`.
 */
export type StateHandlerMap = Map<string, ExistingRecordStateHandler>;
