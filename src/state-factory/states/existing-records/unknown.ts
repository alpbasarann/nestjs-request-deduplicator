import { LogLevel } from '../../../enums';
import { ExistingRecordState } from './existing-record';
import type { ExistingRecordStateContext } from '../../state-context';

/** Unrecognized record state → log a warning and let the request through. */
export class UnknownState extends ExistingRecordState {
  async handle({
    existingRecord,
    deduplicationKey,
    moduleOptions,
  }: ExistingRecordStateContext): Promise<boolean> {
    this.log(
      moduleOptions,
      LogLevel.WARN,
      `RequestDeduplicatorGuard: unknown state "${existingRecord.state}" for key "${deduplicationKey}"`,
    );
    return true;
  }
}
