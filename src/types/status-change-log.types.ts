import type { DeduplicatorState } from './state.types';

/**
 * A single entry in a record's status change history.
 * Appended on every state transition — by `create()` (initial entry) and by `updateState()`.
 */
export interface StatusChangeLog {
  /** State before the transition. `null` on the initial creation entry. */
  from: DeduplicatorState | null;
  /** State after the transition. */
  to: DeduplicatorState;
  /** Wall-clock time when the transition occurred. Set by the adapter. */
  changedAt: Date;
}
