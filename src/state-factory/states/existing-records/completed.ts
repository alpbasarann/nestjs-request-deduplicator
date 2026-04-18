import { randomUUID } from 'crypto';
import { DeduplicatorState, LogLevel } from '../../../enums';
import { DuplicateRequestException } from '../../../models/errors';
import { ExistingRecordState } from './existing-record';
import type { ExistingRecordStateContext } from '../../state-context';

/** Completed record exists → this is a duplicate; record the attempt (fire-and-forget) and throw 409. */
export class CompletedState extends ExistingRecordState {
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
        state: DeduplicatorState.FAILED,
        requestBody: request.body,
        responseBody: {
          statusCode: exception.statusCode,
          code: exception.code,
          message: exception.message,
        },
        responseStatus: exception.statusCode,
      })
      .catch((err: unknown) => {
        this.log(
          moduleOptions,
          LogLevel.ERROR,
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
