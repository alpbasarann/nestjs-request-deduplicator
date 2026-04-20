import { Injectable } from '@nestjs/common';
import {
  REQUEST_DEDUPLICATOR_KEY_PROPERTY,
  REQUEST_DEDUPLICATOR_RECORD_PROPERTY,
} from '../constants';
import type { RequestDeduplicatorModuleOptions } from '../interfaces/options.interface';
import type { BaseStateContext, ExistingRecordStateContext } from './state-context';

/**
 * Abstract base for all deduplication state handlers.
 * Generic over context so concrete handlers receive the narrowest type they need.
 *
 * `handle` returns `true` if the request should proceed, or throws
 * `DuplicateRequestException` to block it.
 */
@Injectable()
export abstract class BaseStateHandler<Ctx extends BaseStateContext = BaseStateContext> {
  abstract handle(ctx: Ctx): Promise<boolean>;

  /** Stamps the deduplication key onto the request so the interceptor can update state later. */
  protected stampKey(ctx: BaseStateContext): void {
    ctx.req[REQUEST_DEDUPLICATOR_KEY_PROPERTY] = ctx.deduplicationKey;
  }

  /** Stamps the existing record reference onto the request for downstream use. */
  protected stampRecord(ctx: ExistingRecordStateContext): void {
    ctx.req[REQUEST_DEDUPLICATOR_RECORD_PROPERTY] = ctx.existingRecord;
  }

  /**
   * Emits a log entry through the configured logger.
   * Respects `loggerOptions.silent` (suppresses all output) and `loggerOptions.level` (minimum level filter).
   * Swallows any error thrown by the logger to avoid masking operational failures.
   */
  protected emitLog(
    moduleOptions: RequestDeduplicatorModuleOptions,
    level: 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const { logging } = moduleOptions;
    if (!logging) return;
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

/**
 * Abstract intermediate for handlers that operate on a non-null existing record.
 * Fixes the generic `Ctx` to `ExistingRecordStateContext` so concrete subclasses
 * receive a guaranteed-present `existingRecord` with no null checks.
 */
@Injectable()
export abstract class ExistingRecordStateHandler extends BaseStateHandler<ExistingRecordStateContext> {}
