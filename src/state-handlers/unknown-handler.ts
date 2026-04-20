import { Injectable } from '@nestjs/common';
import { ExistingRecordStateHandler } from './base-state-handler';
import type { ExistingRecordStateContext } from './state-context';

/** Unrecognized record state → log a warning and let the request through. */
@Injectable()
export class UnknownStateHandler extends ExistingRecordStateHandler {
  async handle({
    existingRecord,
    deduplicationKey,
    moduleOptions,
  }: ExistingRecordStateContext): Promise<boolean> {
    this.emitLog(
      moduleOptions,
      'warn',
      `RequestDeduplicatorGuard: unknown state "${existingRecord.state}" for key "${deduplicationKey}"`,
    );
    return true;
  }
}
