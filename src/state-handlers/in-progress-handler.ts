import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DEFAULT_IN_PROGRESS_TTL_MS, DEDUPLICATOR_STATES } from '../constants';
import { ExistingRecordStateHandler } from './base-state-handler';
import type { ExistingRecordStateContext } from './state-context';

/**
 * An IN_PROGRESS record exists for this key.
 *
 * Within TTL  → the original request is still running. Allow this request through
 *               and let it overwrite the same record to COMPLETED or FAILED when done.
 *               No new record is created; the existing one is stamped on the request so
 *               the interceptor can call updateState() on it directly.
 *
 * Beyond TTL  → the original request crashed or stalled.
 *               Mark the stale record as FAILED (preserving the audit trail),
 *               then create a fresh IN_PROGRESS record for this new attempt.
 */
@Injectable()
export class InProgressStateHandler extends ExistingRecordStateHandler {
  async handle(ctx: ExistingRecordStateContext): Promise<boolean> {
    const { existingRecord, moduleOptions, adapter, request, deduplicationKey } = ctx;

    const ttlMs = moduleOptions.inProgressTtl ?? DEFAULT_IN_PROGRESS_TTL_MS;
    const ageMs = Date.now() - existingRecord.createdAt.getTime();

    if (ageMs <= ttlMs) {
      // Still within TTL — overwrite the existing IN_PROGRESS record when done.
      this.stampKey(ctx);
      this.stampRecord(ctx);
      return true;
    }

    // Beyond TTL — stale/crashed record: retire it as FAILED, start a fresh one.
    await adapter.updateState(
      deduplicationKey,
      DEDUPLICATOR_STATES.FAILED,
      { message: 'Request timed out: IN_PROGRESS record exceeded TTL without completing' },
      408,
    );

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
