/**
 * End-to-end test using @nestjs/testing with MockDeduplicatorAdapter.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpException,
  HttpStatus,
  INestApplication,
  Module,
} from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { RequestDeduplicatorModule } from '../src/request-deduplicator.module';
import { RequestDeduplicatorGuard } from '../src/request-deduplicator.guard';
import { RequestDeduplicatorInterceptor } from '../src/request-deduplicator.interceptor';
import { RequestDeduplicator } from '../src/request-deduplicator.decorator';
import { DeduplicatorState } from '../src/enums';
import { MockDeduplicatorAdapter } from './mocks/mock.adapter';
import { getExtractedFields, generateHash } from '../src/utils';

// ─── Test controller ──────────────────────────────────────────────────────────

let handlerCallCount = 0;
let shouldThrow = false;

@Controller()
class TestController {
  @UseGuards(RequestDeduplicatorGuard)
  @UseInterceptors(RequestDeduplicatorInterceptor)
  @Post('/records')
  @HttpCode(201)
  @RequestDeduplicator({ body: ['accountId', 'amount'] })
  createRecord(@Body() body: { accountId: string; amount: number }) {
    handlerCallCount++;
    if (shouldThrow) throw new HttpException({ message: 'Payment failed' }, HttpStatus.PAYMENT_REQUIRED);
    return { recordId: `rec-${randomUUID()}`, accountId: body.accountId };
  }

  @Post('/no-deduplication')
  @HttpCode(200)
  noDeduplication(@Body() body: unknown) {
    return body;
  }

  @UseGuards(RequestDeduplicatorGuard)
  @UseInterceptors(RequestDeduplicatorInterceptor)
  @Post('/events')
  @HttpCode(202)
  @RequestDeduplicator({ body: ['eventId'] })
  createEvent(@Body() body: { eventId: string }) {
    handlerCallCount++;
    return { status: 'queued', eventId: body.eventId };
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RequestDeduplicator E2E', () => {
  let app: INestApplication;
  let adapter: MockDeduplicatorAdapter;

  beforeEach(async () => {
    handlerCallCount = 0;
    shouldThrow = false;
    adapter = new MockDeduplicatorAdapter();

    @Module({
      imports: [
        RequestDeduplicatorModule.forRoot({
          adapter,
          tableName: 'deduplicator_test',
          idFieldName: 'id',
          deduplicationKeyFieldName: 'deduplication_key',
          isGlobal: true,
          inProgressTtl: 30,
          logging: { mode: 'silent' },
        }),
      ],
      controllers: [TestController],
    })
    class TestAppModule {}

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('first request → IN_PROGRESS → COMPLETED; requestBody stored on record', async () => {
    const body = { accountId: 'a-1', amount: 99.99 };

    const response = await request(app.getHttpServer()).post('/records').send(body).expect(201);

    expect(response.body).toHaveProperty('recordId');
    expect(handlerCallCount).toBe(1);

    await new Promise((r) => setTimeout(r, 50));

    const records = adapter.getAll();
    expect(records).toHaveLength(1);
    expect(records[0].state).toBe(DeduplicatorState.COMPLETED);
    expect(records[0].requestBody).toEqual(body);
    expect(records[0].responseStatus).toBe(201);
    expect(records[0].responseBody).toHaveProperty('recordId');
  });

  it('duplicate request → 409; FAILED record has requestBody, responseBody, responseStatus=409', async () => {
    const body = { accountId: 'a-2', amount: 50.0 };

    await request(app.getHttpServer()).post('/records').send(body).expect(201);
    await new Promise((r) => setTimeout(r, 50));

    const second = await request(app.getHttpServer()).post('/records').send(body).expect(409);
    expect(second.body.message).toMatch(/already been completed/);
    expect(handlerCallCount).toBe(1);

    const allRecords = adapter.getAll();
    expect(allRecords).toHaveLength(2);

    const failedRecord = allRecords.find((r) => r.state === DeduplicatorState.FAILED);
    expect(failedRecord!.requestBody).toEqual(body);
    expect(failedRecord!.responseStatus).toBe(409);
    expect(failedRecord!.responseBody).toMatchObject({
      message: expect.stringContaining('already been completed'),
    });
  });

  it('stuck IN_PROGRESS record older than TTL (crashed request) → next request proceeds and settles the record', async () => {
    const body = { accountId: 'a-concurrent', amount: 5 };
    const key = generateTestHash(body);

    adapter.set({
      id: 'stuck-in-progress-id',
      deduplicationKey: key,
      state: DeduplicatorState.IN_PROGRESS,
      requestBody: body,
      createdAt: new Date(Date.now() - 60_000),
    });

    const response = await request(app.getHttpServer()).post('/records').send(body).expect(201);
    expect(response.body).toHaveProperty('recordId');
    expect(handlerCallCount).toBe(1);

    await new Promise((r) => setTimeout(r, 50));

    const found = await adapter.get(key);
    expect(found?.state).toBe(DeduplicatorState.COMPLETED);
    expect(found?.responseStatus).toBe(201);
  });

  it('handler error → FAILED record stores error body and status', async () => {
    shouldThrow = true;
    const body = { accountId: 'a-error', amount: 1 };

    await request(app.getHttpServer()).post('/records').send(body).expect(402);
    await new Promise((r) => setTimeout(r, 50));

    const records = adapter.getAll();
    expect(records).toHaveLength(1);
    expect(records[0].state).toBe(DeduplicatorState.FAILED);
    expect(records[0].responseStatus).toBe(402);
    expect(records[0].responseBody).toMatchObject({ message: 'Payment failed' });
  });

  it('non-deduplicated endpoint passes through normally', async () => {
    const body = { key: 'value' };
    const response = await request(app.getHttpServer()).post('/no-deduplication').send(body).expect(200);
    expect(response.body).toEqual(body);
  });

  it('multiple decorated routes are independent: deduplication keys do not bleed across routes', async () => {
    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-cross', amount: 1 })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    await request(app.getHttpServer())
      .post('/events')
      .send({ eventId: 'evt-123' })
      .expect(202);
    await new Promise((r) => setTimeout(r, 50));

    expect(handlerCallCount).toBe(2);

    await request(app.getHttpServer())
      .post('/events')
      .send({ eventId: 'evt-123' })
      .expect(409);

    expect(handlerCallCount).toBe(2);
  });

  it('large request body (~50 KB) is handled without errors or crashes', async () => {
    const largeString = 'x'.repeat(50_000);
    const body = { accountId: 'a-large', amount: 1, description: largeString };
    const response = await request(app.getHttpServer()).post('/records').send(body).expect(201);
    expect(response.body).toHaveProperty('recordId');
    expect(handlerCallCount).toBe(1);
  });

  it('different payloads are treated as separate requests', async () => {
    await request(app.getHttpServer()).post('/records').send({ accountId: 'a', amount: 10 }).expect(201);
    await new Promise((r) => setTimeout(r, 50));
    await request(app.getHttpServer()).post('/records').send({ accountId: 'a', amount: 20 }).expect(201);
    await new Promise((r) => setTimeout(r, 50));

    expect(handlerCallCount).toBe(2);
    expect(adapter.getAll().filter((r) => r.state === DeduplicatorState.COMPLETED)).toHaveLength(2);
  });

  it('null vs missing field: treated as separate requests', async () => {
    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-null', amount: null })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-null' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    expect(handlerCallCount).toBe(2);
    const completed = adapter.getAll().filter((r) => r.state === DeduplicatorState.COMPLETED);
    expect(completed).toHaveLength(2);
  });

  it('0 vs false as field value: treated as separate requests', async () => {
    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-zero', amount: 0 })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-zero', amount: false })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    expect(handlerCallCount).toBe(2);
  });

  it('0 vs null as field value: treated as separate requests', async () => {
    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-zero-null', amount: 0 })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-zero-null', amount: null })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    expect(handlerCallCount).toBe(2);
  });

  it('IN_PROGRESS record within TTL → concurrent request is blocked with 409', async () => {
    const body = { accountId: 'a-concurrent-val', amount: 77 };
    const key = generateTestHash(body);

    adapter.set({
      id: 'in-progress-concurrent',
      deduplicationKey: key,
      state: DeduplicatorState.IN_PROGRESS,
      requestBody: body,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer()).post('/records').send(body).expect(409);
    expect(res.body.message).toMatch(/already being processed/);
    expect(handlerCallCount).toBe(0);
  });

  it('identical null field values: treated as same request (deduplicated)', async () => {
    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-same-null', amount: null })
      .expect(201);
    await new Promise((r) => setTimeout(r, 50));

    await request(app.getHttpServer())
      .post('/records')
      .send({ accountId: 'a-same-null', amount: null })
      .expect(409);

    expect(handlerCallCount).toBe(1);
  });

  it('failed request → allows retry, resets to IN_PROGRESS → COMPLETED', async () => {
    const body = { accountId: 'a-fail', amount: 1 };
    const failedKey = generateTestHash(body);

    adapter.set({
      id: 'failed-original-id',
      deduplicationKey: failedKey,
      state: DeduplicatorState.FAILED,
      requestBody: body,
      responseBody: { message: 'Previous error' },
      responseStatus: 500,
      createdAt: new Date(),
    });

    const response = await request(app.getHttpServer()).post('/records').send(body).expect(201);
    expect(response.body).toHaveProperty('recordId');
    expect(handlerCallCount).toBe(1);

    await new Promise((r) => setTimeout(r, 50));

    const found = await adapter.get(failedKey);
    expect(found?.state).toBe(DeduplicatorState.COMPLETED);
    expect(found?.responseStatus).toBe(201);
  });
});

function generateTestHash(body: { accountId: string; amount: number }): string {
  return generateHash(getExtractedFields({ headers: {}, body, query: {}, params: {} }, { body: ['accountId', 'amount'] }));
}
