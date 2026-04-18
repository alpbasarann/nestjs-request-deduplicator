import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DeduplicatorStorageAdapter } from './adapters/deduplicator-storage.adapter';
import {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
} from './constants';
import { generateHash, getExtractedFields } from './utils';
import { isRequestDeduplicatorOptions } from './request-deduplicator.metadata';
import { StateFactory } from './state-factory';

import type { DeduplicatorRequest } from './models';
import { RequestDeduplicatorModuleOptions } from './adapters/module-options.adapter';

@Injectable()
export class RequestDeduplicatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REQUEST_DEDUPLICATOR_ADAPTER_TOKEN) private readonly adapter: DeduplicatorStorageAdapter,
    @Inject(REQUEST_DEDUPLICATOR_OPTIONS_TOKEN) private readonly moduleOptions: RequestDeduplicatorModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const decoratorOptions = this.getDecoratorOptions(context);
    if (!decoratorOptions) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const req = request as unknown as Record<string, unknown>;
    const deduplicationKey = this.getDeduplicationKey(request, decoratorOptions);
    const duplicatedRequest = await this.adapter.findByKey(deduplicationKey);

    if (!duplicatedRequest) {
      return StateFactory.forNoRecord().handle({
        request,
        req,
        deduplicationKey,
        adapter: this.adapter,
        moduleOptions: this.moduleOptions,
      });
    }

    return StateFactory.forState(duplicatedRequest.state).handle({
      request,
      req,
      deduplicationKey,
      adapter: this.adapter,
      moduleOptions: this.moduleOptions,
      existingRecord: duplicatedRequest,
    });
  }

  private getDecoratorOptions(context: ExecutionContext): DeduplicatorRequest | null {
    const decoratorOptions = this.reflector.get<unknown>(
      REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY,
      context.getHandler(),
    );
    return isRequestDeduplicatorOptions(decoratorOptions) ? decoratorOptions : null;
  }

  private getDeduplicationKey(request: Request, options: DeduplicatorRequest): string {
    const dedupFields = getExtractedFields(
      request,
      options,
    );
    return generateHash(dedupFields);
  }
}
