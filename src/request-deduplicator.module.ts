import {
  DynamicModule,
  Inject,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeduplicatorStorageAdapter } from './adapters/deduplicator-storage.adapter';
import {
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  TABLE_NAME_REGEX,
  MAX_FIELDS_PER_DEDUPLICATOR,
  MAX_FIELD_PATH_LENGTH,
  FORBIDDEN_PATH_SEGMENTS,
} from './constants';
import { RequestDeduplicatorGuard } from './request-deduplicator.guard';
import { RequestDeduplicatorInterceptor } from './request-deduplicator.interceptor';
import { RequestDeduplicatorModuleOptions } from './adapters';

function validateModuleOptions(options: RequestDeduplicatorModuleOptions): void {
  if (!TABLE_NAME_REGEX.test(options.tableName)) {
    throw new Error(
      `Invalid tableName "${options.tableName}". Must match /^[A-Za-z_][a-zA-Z0-9_]{0,62}$/`,
    );
  }

  if (!(options.adapter instanceof DeduplicatorStorageAdapter)) {
    throw new Error(
      'options.adapter must be an instance of DeduplicatorStorageAdapter. ' +
      'Extend DeduplicatorStorageAdapter and pass an instance to forRoot({ adapter: new MyAdapter() }).',
    );
  }

  if (options.idFieldName.trim() === '') {
    throw new Error('idFieldName must be a non-empty string');
  }

  if (options.deduplicationKeyFieldName.trim() === '') {
    throw new Error('deduplicationKeyFieldName must be a non-empty string');
  }

  if (options.inProgressTtl <= 0) {
    throw new Error('inProgressTtl must be a positive number of seconds');
  }
}

/**
 * Validate options passed to @RequestDeduplicator() at registration time.
 */
export function validateRequestDeduplicatorOptions(options: {
  body?: string[];
  headers?: string[];
  query?: string[];
  params?: string[];
  keyName?: string;
}): void {
  const allFields = [
    ...(options.body ?? []),
    ...(options.headers ?? []),
    ...(options.query ?? []),
    ...(options.params ?? []),
  ];

  if (allFields.length === 0) {
    throw new Error('At least one field must be declared in body, headers, query, or params.');
  }

  if (allFields.length > MAX_FIELDS_PER_DEDUPLICATOR) {
    throw new Error(
      `Too many fields: ${allFields.length} exceeds maximum of ${MAX_FIELDS_PER_DEDUPLICATOR}`,
    );
  }

  for (const field of allFields) {
    if (typeof field !== 'string' || field.length > MAX_FIELD_PATH_LENGTH) {
      throw new Error(
        `Field key exceeds maximum length of ${MAX_FIELD_PATH_LENGTH}: "${String(field).slice(0, 64)}"`,
      );
    }
    for (const segment of field.split('.')) {
      if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
        throw new Error(`Forbidden key detected: "${segment}" in field "${field}"`);
      }
    }
  }

  if (options.keyName !== undefined && typeof options.keyName !== 'string') {
    throw new Error('keyName must be a string when provided');
  }
}

@Module({})
export class RequestDeduplicatorModule implements OnModuleInit, OnModuleDestroy {
  static forRoot(options: RequestDeduplicatorModuleOptions): DynamicModule {
    validateModuleOptions(options);

    return {
      module: RequestDeduplicatorModule,
      global: options.isGlobal,
      providers: [
        { provide: REQUEST_DEDUPLICATOR_ADAPTER_TOKEN, useValue: options.adapter },
        { provide: REQUEST_DEDUPLICATOR_OPTIONS_TOKEN, useValue: options },
        Reflector,
        RequestDeduplicatorGuard,
        RequestDeduplicatorInterceptor,
      ],
      exports: [
        REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
        REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
        Reflector,
        RequestDeduplicatorGuard,
        RequestDeduplicatorInterceptor,
      ],
    };
  }

  constructor(
    @Inject(REQUEST_DEDUPLICATOR_ADAPTER_TOKEN) private readonly adapter: DeduplicatorStorageAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.adapter.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    await this.adapter.close();
  }
}
