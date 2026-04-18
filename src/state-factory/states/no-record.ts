import { randomUUID } from 'crypto';
import { DeduplicatorState } from '../../enums';
import { BaseState } from '../base-state';
import type { BaseStateContext } from '../state-context';

/** No record found for this key → create IN_PROGRESS, stamp the request, continue. */
export class NoRecordState extends BaseState {
  async handle(ctx: BaseStateContext): Promise<boolean> {
    const { adapter, request, deduplicationKey } = ctx;
    await adapter.create({
      id: randomUUID(),
      deduplicationKey,
      state: DeduplicatorState.IN_PROGRESS,
      requestBody: request.body,
    });
    this.setStampKey(ctx);
    return true;
  }
}
