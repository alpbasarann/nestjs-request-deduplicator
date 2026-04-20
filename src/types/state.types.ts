import type { DEDUPLICATOR_STATES } from '../constants';


export type DeduplicatorState =
  (typeof DEDUPLICATOR_STATES)[keyof typeof DEDUPLICATOR_STATES];