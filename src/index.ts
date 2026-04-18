// Module
export { RequestDeduplicatorModule } from './request-deduplicator.module';

// Exceptions
export { DuplicateRequestException } from './models/errors';

// Guard & Interceptor
export { RequestDeduplicatorGuard } from './request-deduplicator.guard';
export { RequestDeduplicatorInterceptor } from './request-deduplicator.interceptor';

// Decorator
export { RequestDeduplicator } from './request-deduplicator.decorator';

// Abstract adapters (Contracts) — extend this to build your own storage backend
export { DeduplicatorStorageAdapter, RequestDeduplicatorModuleOptions } from './adapters';

// Models
export { DeduplicatorState, LogLevel } from './enums';
export type { DeduplicatorRecord, DeduplicatorRequest as RequestDeduplicatorOptions } from './models';

// Constants (for advanced / custom-adapter use)
export {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY,
} from './constants';

// Utilities (for testing / custom adapter authors)
export { extractFields, getExtractedFields, generateHash } from './utils';
export type { ExtractedFields, RequestLike } from './utils';

// Validation helper (for custom integrations)
export { validateRequestDeduplicatorOptions } from './request-deduplicator.module';
