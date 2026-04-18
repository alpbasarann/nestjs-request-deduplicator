import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { DeduplicatorStorageAdapter } from './adapters/deduplicator-storage.adapter';
import {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_KEY_PROPERTY,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
} from './constants';
import { DeduplicatorState, LogLevel } from './enums';
import type { RequestDeduplicatorModuleOptions } from './adapters';


/**
 * Extract HTTP status from a thrown error without using instanceof,
 * which can break across file:-linked module boundaries.
 */
function extractErrorStatus(err: unknown): number {
  if (
    err &&
    typeof err === 'object' &&
    'getStatus' in err &&
    typeof (err as Record<string, unknown>)['getStatus'] === 'function'
  ) {
    return (err as { getStatus(): number }).getStatus();
  }
  return 500;
}

/**
 * Extract the response body from a thrown error without using instanceof.
 */
function extractErrorBody(err: unknown): unknown {
  if (
    err &&
    typeof err === 'object' &&
    'getResponse' in err &&
    typeof (err as Record<string, unknown>)['getResponse'] === 'function'
  ) {
    return (err as { getResponse(): unknown }).getResponse();
  }
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

@Injectable()
export class RequestDeduplicatorInterceptor implements NestInterceptor {
  constructor(
    @Inject(REQUEST_DEDUPLICATOR_ADAPTER_TOKEN) private readonly adapter: DeduplicatorStorageAdapter,
    @Inject(REQUEST_DEDUPLICATOR_OPTIONS_TOKEN) private readonly moduleOptions: RequestDeduplicatorModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const req = request as unknown as Record<string, unknown>;

    const deduplicationKey = req[REQUEST_DEDUPLICATOR_KEY_PROPERTY] as string | undefined;

    // No key — guard did not mark this request (no @RequestDeduplicator() decorator); pass through
    if (!deduplicationKey) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const statusCode: number = response.statusCode ?? 200;
        // Fire-and-forget: the response is already committed to the client by the time tap runs.
        // The storage write cannot block or alter the response, so failures are logged and swallowed.
        this.updateStateFireAndForget(
          deduplicationKey,
          DeduplicatorState.COMPLETED,
          responseBody,
          statusCode,
          'RequestDeduplicatorInterceptor: failed to mark record as COMPLETED',
        );
      }),
      catchError((err: unknown) => {
        const responseStatus = extractErrorStatus(err);
        const responseBody = extractErrorBody(err);

        // Fire-and-forget: the handler error is re-thrown to the client on the next line.
        // The storage write must not delay or replace that error, so failures are logged and swallowed.
        this.updateStateFireAndForget(
          deduplicationKey,
          DeduplicatorState.FAILED,
          responseBody,
          responseStatus,
          'RequestDeduplicatorInterceptor: failed to mark record as FAILED',
        );

        return throwError(() => err);
      }),
    );
  }

  private updateStateFireAndForget(
    deduplicationKey: string,
    state: DeduplicatorState,
    responseBody: unknown,
    responseStatus: number,
    failureMessage: string,
  ): void {
    void this.adapter
      .updateState(deduplicationKey, state, responseBody, responseStatus)
      .catch((err: unknown) => {
        this.log(LogLevel.ERROR, failureMessage, {
          deduplicationKey,
          error: err instanceof Error ? err.message : String(err),
          errorType: err instanceof Error ? err.constructor.name : typeof err,
          stack: err instanceof Error ? err.stack : undefined,
        });
      });
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const { logging } = this.moduleOptions;
    switch (logging.mode) {
      case 'silent':
        return;
      case 'logged':
        try {
          logging.logger(level, message, meta);
        } catch {
          // logger threw — ignore to avoid masking operational errors
        }
        return;
    }
  }
}
