import { of, throwError } from 'rxjs';
import { RequestDeduplicatorInterceptor } from '../src/request-deduplicator.interceptor';

import { REQUEST_DEDUPLICATOR_KEY_PROPERTY } from '../src/constants';
import { DeduplicatorStorageAdapter } from '../src/adapters/deduplicator-storage.adapter';
import { MockDeduplicatorAdapter } from './mocks/mock.adapter';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DeduplicatorState } from '../src';
import type { RequestDeduplicatorModuleOptions } from '../src';

function makeContext(deduplicationKey?: string) {
  const mockRequest: Record<string, unknown> = { headers: {}, body: {} };
  if (deduplicationKey) {
    mockRequest[REQUEST_DEDUPLICATOR_KEY_PROPERTY] = deduplicationKey;
  }

  const mockResponse = {
    statusCode: 201,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return {
    ctx: {
      getHandler: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as ExecutionContext,
    mockResponse,
  };
}

describe('RequestDeduplicatorInterceptor', () => {
  let interceptor: RequestDeduplicatorInterceptor;
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
    adapter = {
      initialize: jest.fn().mockResolvedValue(undefined),
      findByKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
      updateState: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeduplicatorStorageAdapter>;

    interceptor = new RequestDeduplicatorInterceptor(adapter, moduleOptions);
  });

  it('passes through without calling updateState when no deduplication key on request', (done) => {
    const { ctx } = makeContext();
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(of({ result: 'ok' })) };

    interceptor.intercept(ctx, handler).subscribe({
      next: (val) => {
        expect(val).toEqual({ result: 'ok' });
        expect(adapter.updateState).not.toHaveBeenCalled();
      },
      complete: done,
    });
  });

  it('calls updateState(COMPLETED, body, status) on success', (done) => {
    const { ctx } = makeContext('test-key');
    const responseBody = { orderId: 'o1' };
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(of(responseBody)) };

    interceptor.intercept(ctx, handler).subscribe({
      next: () => {
        setTimeout(() => {
          expect(adapter.updateState).toHaveBeenCalledWith(
            'test-key',
            DeduplicatorState.COMPLETED,
            responseBody,
            expect.any(Number),
          );
          done();
        }, 10);
      },
    });
  });

  it('calls updateState(FAILED, errorBody, errorStatus) on HttpException and re-throws', (done) => {
    const { ctx } = makeContext('test-key');
    const error = new HttpException({ message: 'Not found' }, HttpStatus.NOT_FOUND);
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(throwError(() => error)) };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        setTimeout(() => {
          expect(adapter.updateState).toHaveBeenCalledWith(
            'test-key',
            DeduplicatorState.FAILED,
            expect.objectContaining({ message: 'Not found' }),
            HttpStatus.NOT_FOUND,
          );
          done();
        }, 10);
      },
    });
  });

  it('calls updateState(FAILED, String(primitive), 500) when a non-Error primitive is thrown', (done) => {
    // Covers the `return { message: String(err) }` fallback in extractErrorBody —
    // thrown value is neither an HttpException nor an Error instance.
    const { ctx } = makeContext('test-key');
    const handler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => 'plain string error')),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe('plain string error');
        setTimeout(() => {
          expect(adapter.updateState).toHaveBeenCalledWith(
            'test-key',
            DeduplicatorState.FAILED,
            { message: 'plain string error' },
            500,
          );
          done();
        }, 10);
      },
    });
  });

  it('calls updateState(FAILED, message, 500) on generic Error', (done) => {
    const { ctx } = makeContext('test-key');
    const error = new Error('Something exploded');
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(throwError(() => error)) };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        setTimeout(() => {
          expect(adapter.updateState).toHaveBeenCalledWith(
            'test-key',
            DeduplicatorState.FAILED,
            { message: 'Something exploded' },
            500,
          );
          done();
        }, 10);
      },
    });
  });

  it('still re-throws even if updateState fails', (done) => {
    const { ctx } = makeContext('test-key');
    const error = new Error('Handler error');
    adapter.updateState.mockRejectedValue(new Error('Storage unavailable'));
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(throwError(() => error)) };

    interceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        done();
      },
    });
  });

  it('passes response body through unchanged', (done) => {
    const { ctx } = makeContext('test-key');
    const responseBody = { complex: { nested: 'data' }, array: [1, 2, 3] };
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(of(responseBody)) };

    interceptor.intercept(ctx, handler).subscribe({
      next: (val) => {
        expect(val).toBe(responseBody);
        done();
      },
    });
  });

  it('does not crash when logger throws inside tap (updateState failure)', (done) => {
    adapter.updateState.mockRejectedValue(new Error('Storage down'));

    const throwingInterceptor = new RequestDeduplicatorInterceptor(adapter, {
      ...moduleOptions,
      logging: { mode: 'logged', logger: () => { throw new Error('Logger exploded'); } },
    });

    const { ctx } = makeContext('test-key');
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(of({ ok: true })) };

    throwingInterceptor.intercept(ctx, handler).subscribe({
      next: (val) => {
        expect(val).toEqual({ ok: true });
        // Give the async catch chain time to run
        setTimeout(done, 20);
      },
      error: done,
    });
  });

  it('does not crash when logger throws inside catchError (updateState failure)', (done) => {
    adapter.updateState.mockRejectedValue(new Error('Storage down'));

    const throwingInterceptor = new RequestDeduplicatorInterceptor(adapter, {
      ...moduleOptions,
      logging: { mode: 'logged', logger: () => { throw new Error('Logger exploded'); } },
    });

    const { ctx } = makeContext('test-key');
    const error = new HttpException({ message: 'Bad' }, HttpStatus.BAD_REQUEST);
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(throwError(() => error)) };

    throwingInterceptor.intercept(ctx, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        setTimeout(done, 20);
      },
    });
  });

  it('response is delivered to the client before a slow updateState resolves', (done) => {
    const events: string[] = [];

    adapter.updateState.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => { events.push('updateState'); resolve(); }, 150)),
    );

    const { ctx } = makeContext('test-key');
    const handler: CallHandler = { handle: jest.fn().mockReturnValue(of({ orderId: '42' })) };

    interceptor.intercept(ctx, handler).subscribe({
      next: () => {
        events.push('client-received');
      },
      complete: () => {
        // client received the response first; updateState finishes later
        expect(events[0]).toBe('client-received');
        setTimeout(() => {
          expect(events).toContain('updateState');
          done();
        }, 200);
      },
    });
  });
});
