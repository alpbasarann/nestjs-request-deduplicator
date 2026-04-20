import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DEDUPLICATOR_STATES } from '../constants';
import { BaseStateHandler } from './base-state-handler';
import type { BaseStateContext } from './state-context';

/** No record found for this key → create an IN_PROGRESS record, stamp the request, and continue. */
@Injectable()
export class NoRecordHandler extends BaseStateHandler {
  async handle(ctx: BaseStateContext): Promise<boolean> {
    const { adapter, request, deduplicationKey } = ctx;

    await adapter.create({
      id: randomUUID(),
      deduplicationKey,
      state: DEDUPLICATOR_STATES.IN_PROGRESS,
      requestBody: request.body,
      statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }],
    });

    this.stampKey(ctx);
    return true;
  }
}
