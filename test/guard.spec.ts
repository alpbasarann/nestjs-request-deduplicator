import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { RequestDeduplicatorGuard } from '../src/guard';
import { DuplicateRequestException } from '../src/duplicate-request.exception';
import {
  DEDUPLICATOR_STATES,
  REQUEST_DEDUPLICATOR_ADAPTER_TOKEN,
  REQUEST_DEDUPLICATOR_OPTIONS_TOKEN,
  REQUEST_DEDUPLICATOR_KEY_PROPERTY,
  REQUEST_DEDUPLICATOR_RECORD_PROPERTY,
} from '../src/constants';
import type { DeduplicatorState } from '../src/types/state.types';
import { DeduplicatorRecord } from '../src/interfaces/record.interface';
import { DeduplicatorStorageAdapter } from '../src/adapters/storage.adapter';
import type { RequestDeduplicatorModuleOptions } from '../src/interfaces/options.interface';
import { MockDeduplicatorAdapter } from './mocks/mock.adapter';
import {
  CompletedStateHandler,
  FailedStateHandler,
  InProgressStateHandler,
  NoRecordHandler,
  STATE_HANDLER_MAP,
  StateHandlerMap,
  UnknownStateHandler,
} from '../src/state-handlers';

function makeRecord(overrides: Partial<DeduplicatorRecord> = {}): DeduplicatorRecord {
  return {
    id: 'test-id',
    deduplicationKey: 'test-hash',
    state: DEDUPLICATOR_STATES.IN_PROGRESS,
    statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }],
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
  };

  async function buildGuard(
    overrideOptions?: Partial<RequestDeduplicatorModuleOptions>,
  ): Promise<RequestDeduplicatorGuard> {
    const opts = { ...moduleOptions, ...overrideOptions };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestDeduplicatorGuard,
        { provide: Reflector, useValue: reflector },
        { provide: REQUEST_DEDUPLICATOR_ADAPTER_TOKEN, useValue: adapter },
        { provide: REQUEST_DEDUPLICATOR_OPTIONS_TOKEN, useValue: opts },
        NoRecordHandler,
        CompletedStateHandler,
        InProgressStateHandler,
        FailedStateHandler,
        UnknownStateHandler,
        {
          provide: STATE_HANDLER_MAP,
          useFactory: (
            completed: CompletedStateHandler,
            inProgress: InProgressStateHandler,
            failed: FailedStateHandler,
          ): StateHandlerMap =>
            new Map([
              [DEDUPLICATOR_STATES.COMPLETED, completed],
              [DEDUPLICATOR_STATES.IN_PROGRESS, inProgress],
              [DEDUPLICATOR_STATES.FAILED, failed],
            ]),
          inject: [CompletedStateHandler, InProgressStateHandler, FailedStateHandler],
        },
      ],
    }).compile();
    return moduleRef.get(RequestDeduplicatorGuard);
  }

  beforeEach(async () => {
    reflector = { get: jest.fn() } as unknown as jest.Mocked<Reflector>;

    adapter = {
      initialize: jest.fn().mockResolvedValue(undefined),
      findByKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(makeRecord()),
      updateState: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeduplicatorStorageAdapter>;

    guard = await buildGuard();
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
        state: DEDUPLICATOR_STATES.IN_PROGRESS,
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
      makeRecord({ id: 'original-id', state: DEDUPLICATOR_STATES.COMPLETED }),
    );

    const duplicateBody = { accountId: 'a1' };
    const ctx = makeContext(decoratorOptions, duplicateBody);

    await expect(
      guard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        state: DEDUPLICATOR_STATES.FAILED,
        requestBody: duplicateBody,
        responseStatus: 409,
        responseBody: expect.objectContaining({
          message: expect.stringContaining('already been completed'),
        }),
      }),
    );
  });

  it('IN_PROGRESS within TTL → allows through, stamps existing record, does not create or updateState', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const activeRecord = makeRecord({ id: 'in-progress-id', state: DEDUPLICATOR_STATES.IN_PROGRESS, createdAt: new Date() });
    adapter.findByKey.mockResolvedValue(activeRecord);

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    const result = await guard.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY]).toBeDefined();
    // Existing IN_PROGRESS record is stamped so the interceptor overwrites it on completion
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_RECORD_PROPERTY]).toBe(activeRecord);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.updateState).not.toHaveBeenCalled();
  });

  it('stale IN_PROGRESS (beyond TTL) → marks old record FAILED, creates new IN_PROGRESS, allows through', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const staleCreatedAt = new Date(Date.now() - 60_000);
    const staleRecord = makeRecord({ id: 'stale-id', state: DEDUPLICATOR_STATES.IN_PROGRESS, createdAt: staleCreatedAt });
    adapter.findByKey.mockResolvedValue(staleRecord);

    const requestBody = { accountId: 'a1' };
    const ctx = makeContext(decoratorOptions, requestBody);
    const result = await guard.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY]).toBeDefined();
    // Stale record is no longer stamped — it has been retired as FAILED
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_RECORD_PROPERTY]).toBeUndefined();
    // Stale record is marked FAILED with a timeout reason
    expect(adapter.updateState).toHaveBeenCalledWith(
      expect.any(String),
      DEDUPLICATOR_STATES.FAILED,
      expect.objectContaining({ message: expect.stringContaining('timed out') }),
      408,
    );
    // A fresh IN_PROGRESS record is created for this new attempt
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        state: DEDUPLICATOR_STATES.IN_PROGRESS,
        requestBody,
      }),
    );
  });

  it('uses configurable inProgressTtl: record within custom TTL → allowed (overwrite), beyond custom TTL → FAILED + new', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);

    const customGuard = await buildGuard({ inProgressTtl: 10_000 });

    // Within TTL → allowed through (will overwrite existing record)
    adapter.findByKey.mockResolvedValue(
      makeRecord({ state: DEDUPLICATOR_STATES.IN_PROGRESS, createdAt: new Date(Date.now() - 5_000) }),
    );
    const ctxBlocked = makeContext(decoratorOptions);
    const withinResult = await customGuard.canActivate(
      ctxBlocked as unknown as import('@nestjs/common').ExecutionContext,
    );
    expect(withinResult).toBe(true);

    adapter.updateState.mockClear();
    adapter.create.mockClear();

    // Beyond TTL → stale record marked FAILED, new IN_PROGRESS created, allowed through
    adapter.findByKey.mockResolvedValue(
      makeRecord({ state: DEDUPLICATOR_STATES.IN_PROGRESS, createdAt: new Date(Date.now() - 15_000) }),
    );
    const ctxAllowed = makeContext(decoratorOptions);
    const result = await customGuard.canActivate(
      ctxAllowed as unknown as import('@nestjs/common').ExecutionContext,
    );
    expect(result).toBe(true);
    expect(adapter.updateState).toHaveBeenCalledWith(expect.any(String), DEDUPLICATOR_STATES.FAILED, expect.any(Object), 408);
    expect(adapter.create).toHaveBeenCalledWith(expect.objectContaining({ state: DEDUPLICATOR_STATES.IN_PROGRESS }));
  });

  it('allows re-processing FAILED record by creating a new IN_PROGRESS record (original FAILED is preserved)', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const failedRecord = makeRecord({ id: 'failed-id', state: DEDUPLICATOR_STATES.FAILED });
    adapter.findByKey.mockResolvedValue(failedRecord);

    const requestBody = { accountId: 'a1' };
    const ctx = makeContext(decoratorOptions, requestBody);
    const result = await guard.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    // Must create a NEW record rather than mutating the existing FAILED one
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        state: DEDUPLICATOR_STATES.IN_PROGRESS,
        requestBody,
      }),
    );
    // The original FAILED record must not be touched
    expect(adapter.updateState).not.toHaveBeenCalled();
    // The old FAILED record is still stamped on the request for reference
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_RECORD_PROPERTY]).toBe(failedRecord);
    expect(ctx.mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY]).toBeDefined();
  });

  it('returns true and logs a warning for an unknown state', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    const unknownStateRecord = makeRecord({ state: 'PENDING' as unknown as DeduplicatorState });
    adapter.findByKey.mockResolvedValue(unknownStateRecord);

    const loggerCalls: Array<[string, string]> = [];
    const guardWithLogger = await buildGuard({
      logging: { mode: 'logged', logger: (level, message) => { loggerCalls.push([level, message]); } },
    });

    const ctx = makeContext(decoratorOptions, { accountId: 'a1' });
    const result = await guardWithLogger.canActivate(
      ctx as unknown as import('@nestjs/common').ExecutionContext,
    );

    expect(result).toBe(true);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(loggerCalls).toHaveLength(1);
    expect(loggerCalls[0][0]).toBe('warn');
    expect(loggerCalls[0][1]).toMatch(/unknown state/i);
  });

  it('does not crash when logger throws on unknown state', async () => {
    const decoratorOptions = { body: ['accountId'] };
    reflector.get.mockReturnValue(decoratorOptions);
    adapter.findByKey.mockResolvedValue(makeRecord({ state: 'MYSTERY' as unknown as DeduplicatorState }));

    const throwingGuard = await buildGuard({
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
    adapter.findByKey.mockResolvedValue(makeRecord({ state: DEDUPLICATOR_STATES.COMPLETED }));

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
    adapter.findByKey.mockResolvedValue(makeRecord({ state: DEDUPLICATOR_STATES.COMPLETED }));
    adapter.create.mockRejectedValue(new Error('Storage down'));

    const throwingGuard = await buildGuard({
      logging: { mode: 'logged', logger: () => { throw new Error('Logger exploded'); } },
    });

    const ctx = makeContext(decoratorOptions);
    await expect(
      throwingGuard.canActivate(ctx as unknown as import('@nestjs/common').ExecutionContext),
    ).rejects.toThrow(DuplicateRequestException);
  });
});
