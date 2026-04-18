import { DeduplicatorState } from '../../../enums';
import { ExistingRecordState } from './existing-record';
import type { ExistingRecordStateContext } from '../../state-context';

/** Prior attempt with this key failed → allow retry by resetting state to IN_PROGRESS. */
export class FailedState extends ExistingRecordState {
  async handle(ctx: ExistingRecordStateContext): Promise<boolean> {
    const { adapter, deduplicationKey } = ctx;
    await adapter.updateState(deduplicationKey, DeduplicatorState.IN_PROGRESS);
    this.setStampKey(ctx);
    this.setRecord(ctx);
    return true;
  }
}
