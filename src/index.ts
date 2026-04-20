// Module
export { RequestDeduplicatorModule } from './module';

// Exceptions
export { DuplicateRequestException } from './duplicate-request.exception';

// Guard & Interceptor
export { RequestDeduplicatorGuard } from './guard';
export { RequestDeduplicatorInterceptor } from './interceptor';

// Decorator
export { RequestDeduplicator } from './decorator';

// Abstract adapter — extend this to build your own storage backend
export { DeduplicatorStorageAdapter } from './adapters/storage.adapter';

// Interfaces
export type { DeduplicatorRecord } from './interfaces/record.interface';
export type {
  RequestDeduplicatorModuleOptions,
  RequestDeduplicatorOptions,
} from './interfaces/options.interface';

// Types
export type { LogLevel, LoggerFn, LoggingConfig } from './types/logging.types';
export type { DeduplicatorState } from './types/state.types';
export type { StatusChangeLog } from './types/status-change-log.types';

// Constants (for advanced / custom-adapter use)
export {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY,
  DEFAULT_IN_PROGRESS_TTL_MS,
  DEDUPLICATOR_STATES
} from './constants';

// Key extraction & hashing (for testing / custom adapter authors)
export { getExtractedFields, extractFields } from './key/field-extractor';
export type { ExtractedFields, RequestLike } from './key/field-extractor';
export { generateHash } from './key/hasher';

// Validation helper (for custom integrations)
export { validateRequestDeduplicatorOptions } from './module';
