import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DEDUPLICATOR_STATES } from '../constants';
import { DuplicateRequestException } from '../duplicate-request.exception';
import { ExistingRecordStateHandler } from './base-state-handler';
import type { ExistingRecordStateContext } from './state-context';

/**
 * A COMPLETED record exists — this is a duplicate request.
 * Records the duplicate attempt (fire-and-forget) then throws 409.
 */
@Injectable()
export class CompletedStateHandler extends ExistingRecordStateHandler {
  async handle({
    adapter,
    request,
    deduplicationKey,
    moduleOptions,
  }: ExistingRecordStateContext): Promise<boolean> {
    const exception = new DuplicateRequestException();

    void adapter
      .create({
        id: randomUUID(),
        deduplicationKey,
        state: DEDUPLICATOR_STATES.FAILED,
        requestBody: request.body,
        responseBody: {
          statusCode: exception.statusCode,
          code: exception.code,
          message: exception.message,
        },
        responseStatus: exception.statusCode,
        statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
      })
      .catch((err: unknown) => {
        this.emitLog(
          moduleOptions,
          'error',
          'RequestDeduplicatorGuard: failed to record duplicate attempt',
          {
            deduplicationKey,
            error: err instanceof Error ? err.message : String(err),
            errorType: err instanceof Error ? err.constructor.name : typeof err,
            stack: err instanceof Error ? err.stack : undefined,
          },
        );
      });

    throw exception;
  }
}
