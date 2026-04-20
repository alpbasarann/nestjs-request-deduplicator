/**
 * DeduplicatorStorageAdapter contract tests using MockDeduplicatorAdapter.
 */
import { DEDUPLICATOR_STATES } from '../src/constants';
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
      state: DEDUPLICATOR_STATES.IN_PROGRESS,
      statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }],
    });

    const found = await adapter.findByKey(key);
    expect(found).not.toBeNull();
    expect(found!.deduplicationKey).toBe(key);
    expect(found!.state).toBe(DEDUPLICATOR_STATES.IN_PROGRESS);
    expect(found!.createdAt).toBeInstanceOf(Date);
  });

  it('findByKey() returns null for non-existent key', async () => {
    expect(await adapter.findByKey('non-existent')).toBeNull();
  });

  it('updateState() transitions IN_PROGRESS → COMPLETED with response', async () => {
    const key = 'hash-state-transition';
    await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DEDUPLICATOR_STATES.IN_PROGRESS, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }] });

    await adapter.updateState(key, DEDUPLICATOR_STATES.COMPLETED, { result: 'ok' }, 200);

    const updated = await adapter.findByKey(key);
    expect(updated!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
    expect(updated!.responseBody).toEqual({ result: 'ok' });
    expect(updated!.responseStatus).toBe(200);
  });

  it('updateState() transitions IN_PROGRESS → FAILED with error details', async () => {
    const key = 'hash-fail';
    await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DEDUPLICATOR_STATES.IN_PROGRESS, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }] });

    await adapter.updateState(key, DEDUPLICATOR_STATES.FAILED, { message: 'Something went wrong' }, 500);

    const updated = await adapter.findByKey(key);
    expect(updated!.state).toBe(DEDUPLICATOR_STATES.FAILED);
    expect(updated!.responseBody).toEqual({ message: 'Something went wrong' });
    expect(updated!.responseStatus).toBe(500);
  });

  it('create() allows multiple records with same key (FAILED records coexist with COMPLETED)', async () => {
    const key = 'hash-duplicate';
    const originalId = randomUUID();
    await adapter.create({
      id: originalId,
      deduplicationKey: key,
      state: DEDUPLICATOR_STATES.COMPLETED,
      responseBody: { id: '123' },
      responseStatus: 201,
      statusChangeLogs: [
        { from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() },
        { from: DEDUPLICATOR_STATES.IN_PROGRESS, to: DEDUPLICATOR_STATES.COMPLETED, changedAt: new Date() },
      ],
    });

    await adapter.create({
      id: randomUUID(),
      deduplicationKey: key,
      state: DEDUPLICATOR_STATES.FAILED,
      responseBody: { message: 'Duplicate request: this operation has already been completed' },
      responseStatus: 409,
      statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
    });

    const found = await adapter.findByKey(key);
    expect(found!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
    expect(found!.id).toBe(originalId);
    expect(adapter.getAllByKey(key)).toHaveLength(2);
  });

  it('findByKey() prefers COMPLETED/IN_PROGRESS over FAILED records', async () => {
    const key = 'hash-priority';
    const primaryId = randomUUID();

    adapter.set({
      id: primaryId,
      deduplicationKey: key,
      state: DEDUPLICATOR_STATES.COMPLETED,
      responseBody: { result: 'ok' },
      responseStatus: 200,
      statusChangeLogs: [
        { from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date(Date.now() - 2000) },
        { from: DEDUPLICATOR_STATES.IN_PROGRESS, to: DEDUPLICATOR_STATES.COMPLETED, changedAt: new Date(Date.now() - 1000) },
      ],
      createdAt: new Date(Date.now() - 2000),
    });
    adapter.set({
      id: randomUUID(),
      deduplicationKey: key,
      state: DEDUPLICATOR_STATES.FAILED,
      responseBody: { message: 'Duplicate request' },
      responseStatus: 409,
      statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
      createdAt: new Date(),
    });

    const found = await adapter.findByKey(key);
    expect(found!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
    expect(found!.id).toBe(primaryId);
  });

});
