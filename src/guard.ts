import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DeduplicatorStorageAdapter } from './adapters/storage.adapter';
import {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  DEDUPLICATOR_STATES
} from './constants';
import { getExtractedFields } from './key/field-extractor';
import { generateHash } from './key/hasher';
import {
  RequestDeduplicatorOptions,
  RequestDeduplicatorModuleOptions,
} from './interfaces/options.interface';
import { isRequestDeduplicatorOptions } from './metadata';
import {
  BaseStateContext,
  CompletedStateHandler,
  ExistingRecordStateContext,
  FailedStateHandler,
  InProgressStateHandler,
  NoRecordHandler,
  STATE_HANDLER_MAP,
  StateHandlerMap,
  UnknownStateHandler,
} from './state-handlers';

@Injectable()
export class RequestDeduplicatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REQUEST_DEDUPLICATOR_ADAPTER_TOKEN) private readonly adapter: DeduplicatorStorageAdapter,
    @Inject(REQUEST_DEDUPLICATOR_OPTIONS_TOKEN) private readonly moduleOptions: RequestDeduplicatorModuleOptions,
    @Inject(STATE_HANDLER_MAP) private readonly handlers: StateHandlerMap,
    private readonly noRecordHandler: NoRecordHandler,
    private readonly unknownHandler: UnknownStateHandler,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const decoratorOptions = this.reflector.get<unknown>(
      REQUEST_DEDUPLICATOR_OPTIONS_METADATA_KEY,
      context.getHandler(),
    );

    if (!isRequestDeduplicatorOptions(decoratorOptions)) {
      return true;
    }

    const options: RequestDeduplicatorOptions = decoratorOptions;
    const request = context.switchToHttp().getRequest<Request>();
    const req = request as unknown as Record<string, unknown>;

    const extracted = getExtractedFields(
      {
        headers: request.headers as Record<string, string | string[] | undefined>,
        body: request.body,
        query: request.query as Record<string, unknown>,
        params: request.params as Record<string, unknown>,
      },
      options.body,
      options.headers,
      options.query,
      options.params,
    );
    const deduplicationKey = generateHash(extracted);

    const existing = await this.adapter.findByKey(deduplicationKey);

    const baseCtx: BaseStateContext = {
      request,
      req,
      deduplicationKey,
      adapter: this.adapter,
      moduleOptions: this.moduleOptions,
    };

    if (!existing) {
      return this.noRecordHandler.handle(baseCtx);
    }

    const existingCtx: ExistingRecordStateContext = {
      ...baseCtx,
      existingRecord: existing,
    };

    // existing.state is a plain string from the adapter — use it directly as the map key
    const handler = this.handlers.get(existing.state) ?? this.unknownHandler;
    return handler.handle(existingCtx);
  }
}
