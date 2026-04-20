import { applyDecorators, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common';
import { REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY } from './constants';
import { RequestDeduplicatorOptions } from './interfaces/options.interface';
import { RequestDeduplicatorGuard } from './guard';
import { RequestDeduplicatorInterceptor } from './interceptor';

/**
 * Marks a route handler as idempotent.
 *
 * Bundles `SetMetadata`, `UseGuards(RequestDeduplicatorGuard)`, and
 * `UseInterceptors(RequestDeduplicatorInterceptor)` into a single decorator —
 * no separate `@UseGuards` or `@UseInterceptors` needed on the controller.
 *
 * @example
 * @RequestDeduplicator({ body: ['userId', 'productId'], headers: ['x-client-id'] })
 * async createOrder(@Body() body: CreateOrderDto) { ... }
 */
export function RequestDeduplicator(options: RequestDeduplicatorOptions): MethodDecorator {
  return applyDecorators(
    SetMetadata(REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY, options),
    UseGuards(RequestDeduplicatorGuard),
    UseInterceptors(RequestDeduplicatorInterceptor),
  );
}
