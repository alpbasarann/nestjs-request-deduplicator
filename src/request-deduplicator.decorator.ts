import { SetMetadata } from '@nestjs/common';
import { REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY } from './constants';
import { DeduplicatorRequest } from './models';



/**
 * Marks a route handler as idempotent.
 *
 * Place `@UseGuards(RequestDeduplicatorGuard)` and
 * `@UseInterceptors(RequestDeduplicatorInterceptor)` on the controller (or handler),
 * then add this decorator to specify which fields form the deduplication key.
 *
 * @example
 * @RequestDeduplicator({ body: ['userId', 'productId'], headers: ['x-client-id'] })
 * async createOrder(@Body() body: CreateOrderDto) { ... }
 */
export const RequestDeduplicator = (request: DeduplicatorRequest) =>
  SetMetadata(REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY, request);
