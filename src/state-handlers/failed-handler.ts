import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DEDUPLICATOR_STATES } from '../constants';
import { ExistingRecordStateHandler } from './base-state-handler';
import type { ExistingRecordStateContext } from './state-context';

/**
 * A prior attempt with this key failed → create a new IN_PROGRESS record and allow the handler to retry.
 * The original FAILED record is left intact for audit purposes.
 * The interceptor will later call updateState(COMPLETED) which, via findByKey priority
 * (COMPLETED > IN_PROGRESS > most-recent FAILED), will update the new IN_PROGRESS record.
 */
@Injectable()
export class FailedStateHandler extends ExistingRecordStateHandler {
  async handle(ctx: ExistingRecordStateContext): Promise<boolean> {
    const { adapter, request, deduplicationKey } = ctx;

    await adapter.create({
      id: randomUUID(),
      deduplicationKey,
      state: DEDUPLICATOR_STATES.IN_PROGRESS,
      requestBody: request.body,
      statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }],
    });

    this.stampKey(ctx);
    this.stampRecord(ctx);
    return true;
  }
}
