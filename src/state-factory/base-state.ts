import { LogLevel } from '../enums';
import {
  REQUEST_DEDUPLICATOR_KEY_PROPERTY,
  REQUEST_DEDUPLICATOR_RECORD_PROPERTY,
} from '../constants';
import type { RequestDeduplicatorModuleOptions } from '../adapters';
import type { ExistingRecordStateContext, BaseStateContext } from './state-context';

/**
 * Root abstract base for deduplication states.
 * Generic over the context shape — concrete states pick the narrowest
 * context they need. For states that operate on a record, extend the
 * intermediate `ExistingRecordState` which fixes `Ctx = ExistingRecordStateContext`.
 *
 * `handle` returns `true` if the request should continue; may throw
 * `DuplicateRequestException`.
 */
export abstract class BaseState<Ctx extends BaseStateContext = BaseStateContext> {
  abstract handle(ctx: Ctx): Promise<boolean>;

  protected setStampKey(ctx: BaseStateContext): void {
    ctx.req[REQUEST_DEDUPLICATOR_KEY_PROPERTY] = ctx.deduplicationKey;
  }

  protected setRecord(ctx: ExistingRecordStateContext): void {
    ctx.req[REQUEST_DEDUPLICATOR_RECORD_PROPERTY] = ctx.existingRecord;
  }

  protected log(
    moduleOptions: RequestDeduplicatorModuleOptions,
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    const { logging } = moduleOptions;
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
