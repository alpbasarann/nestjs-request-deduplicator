import { Reflector } from '@nestjs/core';
import { RequestDeduplicatorGuard } from '../src/request-deduplicator.guard';
import { DuplicateRequestException } from '../src/models/errors';

import {
  REQUEST_DEDUPLICATOR_KEY_PROPERTY,
  REQUEST_DEDUPLICATOR_RECORD_PROPERTY,
} from '../src/constants';
import { DeduplicatorStorageAdapter } from '../src/adapters/deduplicator-storage.adapter';

import { MockDeduplicatorAdapter } from './mocks/mock.adapter';
import { DeduplicatorState, LogLevel } from '../src';
import type { DeduplicatorRecord, RequestDeduplicatorModuleOptions } from '../src';

function makeRecord(overrides: Partial<DeduplicatorRecord> = {}): DeduplicatorRecord {
  return {
    id: 'test-id',
    deduplicationKey: 'test-hash',
    state: DeduplicatorState.IN_PROGRESS,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeContext(decoratorOptions: unknown, requestBody: unknown = { accountId: 'a1' }) {
  const mockRequest: Record<string, unknown> = {
    headers: { 'x-request-id': 'abc' },
    body: requestBody,
    query: {},
    params: {},
  };

  return {
    getHandler: jest.fn().mockReturnValue({}),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
    getRequest: jest.fn().mockReturnValue(mockRequest),
    mockRequest,
    decoratorOptions,
  };
}

describe('RequestDeduplicatorGuard', () => {
  let guard: RequestDeduplicatorGuard;
  let reflector: jest.Mocked<Reflector>;
  let adapter: jest.Mocked<DeduplicatorStorageAdapter>;
  const moduleOptions: RequestDeduplicatorModuleOptions = {
    adapter: new MockDeduplicatorAdapter(),
    tableName: 'deduplicator',
    idFieldName: 'id',
    deduplicationKeyFieldName: 'deduplication_key',
    isGlobal: true,
    inProgressTtl: 30,
    logging: { mode: 'silent' },
  };

  beforeEach(() => {
    reflector = { get: jest.fn() } as unknown as jest.Mocked<Reflector>;

    adapter = {
      initialize: jest.fn().mockResolvedValue(undefined),
      findByKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(makeRecord()),
      updateState: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeduplicatorStorageAdapter>;

    guard = new RequestDeduplicatorGuard(reflector, adapter, moduleOptions);
  });

  it('passes through when no @RequestDeduplicator() decorator is present', async () => {
    reflector.get.mockReturnValue(undefined);
    const ctx = makeContext(undefined);
    const result = await guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext);
    expect(result).toBe(true);
    expect(adapter.findByKey).not.toHaveBeenCalled();
  });

  it('passes through when metadata is not valid RequestDeduplicatorOptions', async () => {
    reflector.get.mockReturnValue({ notFields: [] });
    const ctx = makeContext({ notFields: [] });
    const result = await guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext);
    expect(result).toBe(true);
    expect(adapter.findByKey).not.toHaveBeenCalled();
  });

  it('creates IN_PROGRESS record with requestBody and stamps deduplication key', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(null);

    const requestBody = { accountId: 'a1' };
    const ctx = makeContext(decoratorOptions, requestBody);
    const result = await guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext);

    expect(result).toBe(true);
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        state: DeduplicatorState.IN_PROGRESS,
        requestBody,
      }),
    );
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY]).toBeDefined();
  });

  it('IN_PROGRESS record has requestBody but no responseBody or responseStatus', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(null);

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    await guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext);

    const createArg = adapter.create.mock.calls[0][0];
    expect(createArg).toHaveProperty('requestBody');
    expect(createArg).not.toHaveProperty('responseBody');
    expect(createArg).not.toHaveProperty('responseStatus');
  });

  it('throws 409, creates FAILED record with requestBody+responseBody+responseStatus for COMPLETED duplicate', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(
      makeRecord({ id: 'original-id', state: DeduplicatorState.COMPLETED }),
    );

    const duplicateBody = { accountId: 'a1' };
    const ctx = makeContext(decoratorOptions, duplicateBody);

    await expect(
      guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        state: DeduplicatorState.FAILED,
        requestBody: duplicateBody,
        responseStatus: 409,
        responseBody: expect.objectContaining({
          message: expect.stringContaining('already been completed'),
        }),
      }),
    );
  });

  it('throws 409 when IN_PROGRESS record is within the TTL window (concurrent request)', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(
      makeRecord({ id: 'in-progress-id', state: DeduplicatorState.IN_PROGRESS, createdAt: new Date() }),
    );

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    await expect(
      guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);

    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.updateState).not.toHaveBeenCalled();
  });

  it('allows through and sets keys when IN_PROGRESS record is beyond the TTL window (stale/crashed)', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const staleCreatedAt = new Date(Date.now() - 60_000);
    const staleRecord = makeRecord({ id: 'stale-id', state: DeduplicatorState.IN_PROGRESS, createdAt: staleCreatedAt });
    adapter.findByKey.mockResolvedValue(staleRecord);

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    const result = await guard.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY]).toBeDefined();
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_RECORD_PROPERTY]).toBe(staleRecord);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.updateState).not.toHaveBeenCalled();
  });

  it('uses configurable inProgressTtl: record within custom TTL → 409, beyond custom TTL → allow', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);

    const customGuard = new RequestDeduplicatorGuard(reflector, adapter, {
      ...moduleOptions,
      inProgressTtl: 10,
    });

    adapter.findByKey.mockResolvedValue(
      makeRecord({ state: DeduplicatorState.IN_PROGRESS, createdAt: new Date(Date.now() - 5_000) }),
    );
    const ctxBlocked = makeContext(decoratorOptions);
    await expect(
      customGuard.canActivate(ctxBlocked as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);

    adapter.findByKey.mockResolvedValue(
      makeRecord({ state: DeduplicatorState.IN_PROGRESS, createdAt: new Date(Date.now() - 15_000) }),
    );
    const ctxAllowed = makeContext(decoratorOptions);
    const result = await customGuard.canActivate(
      ctxAllowed as unknown as import('@nestjs/common').ExecutionContext,
    );
    expect(result).toBe(true);
  });

  it('allows re-processing FAILED record by resetting state to IN_PROGRESS', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const failedRecord = makeRecord({ id: 'failed-id', state: DeduplicatorState.FAILED });
    adapter.findByKey.mockResolvedValue(failedRecord);

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    const result = await guard.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    expect(adapter.updateState).toHaveBeenCalledWith(
      expect.any(String),
      DeduplicatorState.IN_PROGRESS,
    );
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_RECORD_PROPERTY]).toBe(failedRecord);
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY]).toBeDefined();
  });

  it('returns true and logs a warning for an unknown state', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const unknownStateRecord = makeRecord({ state: 'PENDING' as DeduplicatorState });
    adapter.findByKey.mockResolvedValue(unknownStateRecord);

    const loggerCalls: Array<[string, string]> = [];
    const guardWithLogger = new RequestDeduplicatorGuard(reflector, adapter, {
      ...moduleOptions,
      logging: { mode: 'logged', logger: (level, message) => { loggerCalls.push([level, message]); } },
    });

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    const result = await guardWithLogger.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(loggerCalls).toHaveLength(1);
    expect(loggerCalls[0][0]).toBe(LogLevel.WARN);
    expect(loggerCalls[0][1]).toMatch(/unknown state/i);
  });

  it('does not crash when logger throws on unknown state', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(makeRecord({ state: 'MYSTERY' as DeduplicatorState }));

    const throwingGuard = new RequestDeduplicatorGuard(reflector, adapter, {
      ...moduleOptions,
      logging: { mode: 'logged', logger: () => { throw new Error('Logger exploded'); } },
    });

    const ctx = makeContext(decoratorOptions);
    await expect(
      throwingGuard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).resolves.toBe(true);
  });

  it('duplicate create() is fire-and-forget: 409 is thrown before adapter.create resolves (COMPLETED)', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(makeRecord({ state: DeduplicatorState.COMPLETED }));

    let createResolved = false;
    adapter.create.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => { createResolved = true; resolve(makeRecord()); }, 200)),
    );

    const ctx = makeContext(decoratorOptions);
    await expect(
      guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);

    expect(createResolved).toBe(false);
  });

  it('does not crash when logger throws on duplicate adapter.create failure (COMPLETED state)', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(makeRecord({ state: DeduplicatorState.COMPLETED }));
    adapter.create.mockRejectedValue(new Error('Storage down'));

    const throwingGuard = new RequestDeduplicatorGuard(reflector, adapter, {
      ...moduleOptions,
      logging: { mode: 'logged', logger: () => { throw new Error('Logger exploded'); } },
    });

    const ctx = makeContext(decoratorOptions);
    await expect(
      throwingGuard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);
  });
});
