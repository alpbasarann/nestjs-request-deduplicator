/**
 * DeduplicatorStorageAdapter contract tests using MockDeduplicatorAdapter.
 */
import { DeduplicatorState } from '../src/enums';
import { randomUUID } from 'crypto';
import { MockDeduplicatorAdapter } from './mocks/mock.adapter';

describe('DeduplicatorStorageAdapter contract (MockDeduplicatorAdapter)', () => {
  let adapter: MockDeduplicatorAdapter;

  beforeEach(() => {
    adapter = new MockDeduplicatorAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('initialize() is idempotent — safe to call multiple times', async () => {
    await adapter.initialize();
    await adapter.initialize();
    await adapter.initialize();
    expect(adapter.initializeCalled).toBe(3);
  });

  it('create() then findByKey() round-trip', async () => {
    const key = 'hash-abc-123';
    await adapter.create({
      id: randomUUID(),
      deduplicationKey: key,
      state: DeduplicatorState.IN_PROGRESS,
    });

    const found = await adapter.findByKey(key);
    expect(found).not.toBeNull();
    expect(found!.deduplicationKey).toBe(key);
    expect(found!.state).toBe(DeduplicatorState.IN_PROGRESS);
    expect(found!.createdAt).toBeInstanceOf(Date);
  });

  it('findByKey() returns null for non-existent key', async () => {
    expect(await adapter.findByKey('non-existent')).toBeNull();
  });

  it('updateState() transitions IN_PROGRESS → COMPLETED with response', async () => {
    const key = 'hash-state-transition';
    await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DeduplicatorState.IN_PROGRESS });

    await adapter.updateState(key, DeduplicatorState.COMPLETED, { result: 'ok' }, 200);

    const updated = await adapter.findByKey(key);
    expect(updated!.state).toBe(DeduplicatorState.COMPLETED);
    expect(updated!.responseBody).toEqual({ result: 'ok' });
    expect(updated!.responseStatus).toBe(200);
  });

  it('updateState() transitions IN_PROGRESS → FAILED with error details', async () => {
    const key = 'hash-fail';
    await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DeduplicatorState.IN_PROGRESS });

    await adapter.updateState(key, DeduplicatorState.FAILED, { message: 'Something went wrong' }, 500);

    const updated = await adapter.findByKey(key);
    expect(updated!.state).toBe(DeduplicatorState.FAILED);
    expect(updated!.responseBody).toEqual({ message: 'Something went wrong' });
    expect(updated!.responseStatus).toBe(500);
  });

  it('create() allows multiple records with same key (FAILED records coexist with COMPLETED)', async () => {
    const key = 'hash-duplicate';
    const originalId = randomUUID();
    await adapter.create({
      id: originalId,
      deduplicationKey: key,
      state: DeduplicatorState.COMPLETED,
      responseBody: { id: '123' },
      responseStatus: 201,
    });

    await adapter.create({
      id: randomUUID(),
      deduplicationKey: key,
      state: DeduplicatorState.FAILED,
      responseBody: { message: 'Duplicate request: this operation has already been completed' },
      responseStatus: 409,
    });

    const found = await adapter.findByKey(key);
    expect(found!.state).toBe(DeduplicatorState.COMPLETED);
    expect(found!.id).toBe(originalId);
    expect(adapter.getAllByKey(key)).toHaveLength(2);
  });

  it('findByKey() prefers COMPLETED/IN_PROGRESS over FAILED records', async () => {
    const key = 'hash-priority';
    const primaryId = randomUUID();

    adapter.set({
      id: primaryId,
      deduplicationKey: key,
      state: DeduplicatorState.COMPLETED,
      responseBody: { result: 'ok' },
      responseStatus: 200,
      createdAt: new Date(Date.now() - 2000),
    });
    adapter.set({
      id: randomUUID(),
      deduplicationKey: key,
      state: DeduplicatorState.FAILED,
      responseBody: { message: 'Duplicate request' },
      responseStatus: 409,
      createdAt: new Date(),
    });

    const found = await adapter.findByKey(key);
    expect(found!.state).toBe(DeduplicatorState.COMPLETED);
    expect(found!.id).toBe(primaryId);
  });

});
