import { DuplicateRequestException } from '../../../models/errors';
import { ExistingRecordState } from './existing-record';
import type { ExistingRecordStateContext } from '../../state-context';

/**
 * Another request with this key is currently in flight.
 * Within TTL → concurrent duplicate (409). Beyond TTL → treat as stale, allow retry.
 */
export class InProgressState extends ExistingRecordState {
  async handle(ctx: ExistingRecordStateContext): Promise<boolean> {
    const { existingRecord, moduleOptions } = ctx;
    const ttlMs = moduleOptions.inProgressTtl * 1000;
    const ageMs = Date.now() - existingRecord.createdAt.getTime();

    if (ageMs <= ttlMs) {
      throw new DuplicateRequestException('Request is already being processed');
    }

    this.setStampKey(ctx);
    this.setRecord(ctx);
    return true;
  }
}
