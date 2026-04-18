import { DeduplicatorState } from '../enums';
import { BaseState } from './base-state';
import { NoRecordState } from './states/no-record';
import { CompletedState } from './states/existing-records/completed';
import { InProgressState } from './states/existing-records/in-progress';
import { FailedState } from './states/existing-records/failed';
import { UnknownState } from './states/existing-records/unknown';
import type { ExistingRecordStateContext, BaseStateContext } from './state-context';

/**
 * Dispatches to the appropriate state. States are stateless singletons.
 *
 * Two entry points, each returning a state whose context type exactly matches
 * the caller's situation:
 *   - `forNoRecord()`      → state that takes `BaseStateContext`
 *   - `forState(value)`    → state that takes `ExistingRecordStateContext`
 *
 * The factory itself never accepts nullable input — the presence/absence decision
 * lives at the adapter boundary (the guard), not here.
 *
 * Adding a new `DeduplicatorState`: TS forces you to extend `byState` below
 * (because it's typed as `Record<DeduplicatorState, BaseState<ExistingRecordStateContext>>`).
 */
export class StateFactory {
  private static readonly noRecord: BaseState<BaseStateContext> = new NoRecordState();
  private static readonly unknown: BaseState<ExistingRecordStateContext> = new UnknownState();
  private static readonly byState: Record<DeduplicatorState, BaseState<ExistingRecordStateContext>> = {
    [DeduplicatorState.COMPLETED]: new CompletedState(),
    [DeduplicatorState.IN_PROGRESS]: new InProgressState(),
    [DeduplicatorState.FAILED]: new FailedState(),
  };

  static forNoRecord(): BaseState<BaseStateContext> {
    return this.noRecord;
  }

  static forState(state: DeduplicatorState): BaseState<ExistingRecordStateContext> {
    return this.byState[state] ?? this.unknown;
  }
}
