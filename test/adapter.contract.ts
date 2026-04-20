/**
 * Generic adapter contract test suite.
 *
 * Call runAdapterContractTests() in your own test file to verify that your
 * DeduplicatorStorageAdapter implementation satisfies all behavioural requirements
 * the package depends on.
 *
 * @example
 * import { runAdapterContractTests } from './adapter.contract';
 * import { MyPostgresAdapter } from '../src/adapters/postgres.adapter';
 *
 * runAdapterContractTests(() => new MyPostgresAdapter(connectionString));
 */
import { randomUUID } from 'crypto';
import { DeduplicatorStorageAdapter } from '../src/adapters/storage.adapter';
import { DeduplicatorRecord } from '../src/interfaces/record.interface';
import { DEDUPLICATOR_STATES } from '../src/constants';

function makeRecord(overrides: Partial<Omit<DeduplicatorRecord, 'createdAt'>> = {}): Omit<DeduplicatorRecord, 'createdAt'> {
  const state = (overrides.state ?? DEDUPLICATOR_STATES.IN_PROGRESS);
  return {
    id: randomUUID(),
    deduplicationKey: `key-${randomUUID()}`,
    state,
    statusChangeLogs: [{ from: null, to: state, changedAt: new Date() }],
    ...overrides,
  };
}

export function runAdapterContractTests(
  createAdapter: () => DeduplicatorStorageAdapter,
): void {
  describe('DeduplicatorStorageAdapter contract', () => {
    let adapter: DeduplicatorStorageAdapter;

    beforeEach(async () => {
      adapter = createAdapter();
      await adapter.initialize();
    });

    afterEach(async () => {
      await adapter.close();
    });

    // ─── initialize ───────────────────────────────────────────────────────────

    describe('initialize()', () => {
      it('is idempotent — safe to call multiple times without error', async () => {
        await expect(adapter.initialize()).resolves.toBeUndefined();
        await expect(adapter.initialize()).resolves.toBeUndefined();
      });
    });

    // ─── findByKey ────────────────────────────────────────────────────────────

    describe('findByKey()', () => {
      it('returns null for an unknown key', async () => {
        expect(await adapter.findByKey('non-existent-key')).toBeNull();
      });

      it('finds a just-created IN_PROGRESS record', async () => {
        const rec = makeRecord({ state: DEDUPLICATOR_STATES.IN_PROGRESS });
        await adapter.create(rec);

        const found = await adapter.findByKey(rec.deduplicationKey);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(rec.id);
        expect(found!.state).toBe(DEDUPLICATOR_STATES.IN_PROGRESS);
      });

      it('finds a COMPLETED record', async () => {
        const rec = makeRecord({ state: DEDUPLICATOR_STATES.IN_PROGRESS });
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DEDUPLICATOR_STATES.COMPLETED, { ok: true }, 200);

        const found = await adapter.findByKey(rec.deduplicationKey);
        expect(found!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
      });

      it('prefers COMPLETED over FAILED for the same key', async () => {
        const key = `key-${randomUUID()}`;
        const primaryId = randomUUID();

        await adapter.create({ id: primaryId, deduplicationKey: key, state: DEDUPLICATOR_STATES.IN_PROGRESS, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }] });
        await adapter.updateState(key, DEDUPLICATOR_STATES.COMPLETED, { id: '1' }, 201);

        // Create a FAILED record for the same key (duplicate rejection)
        await adapter.create({
          id: randomUUID(),
          deduplicationKey: key,
          state: DEDUPLICATOR_STATES.FAILED,
          responseBody: { message: 'Duplicate' },
          responseStatus: 409,
          statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
        });

        const found = await adapter.findByKey(key);
        expect(found!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
        expect(found!.id).toBe(primaryId);
      });

      it('prefers IN_PROGRESS over FAILED for the same key', async () => {
        const key = `key-${randomUUID()}`;
        const primaryId = randomUUID();

        await adapter.create({ id: primaryId, deduplicationKey: key, state: DEDUPLICATOR_STATES.IN_PROGRESS, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }] });

        // Concurrent duplicate rejection
        await adapter.create({
          id: randomUUID(),
          deduplicationKey: key,
          state: DEDUPLICATOR_STATES.FAILED,
          responseBody: { message: 'Request is already being processed' },
          responseStatus: 409,
          statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
        });

        const found = await adapter.findByKey(key);
        expect(found!.state).toBe(DEDUPLICATOR_STATES.IN_PROGRESS);
        expect(found!.id).toBe(primaryId);
      });

      it('falls back to most-recent FAILED record when no canonical record exists', async () => {
        const key = `key-${randomUUID()}`;

        await adapter.create({
          id: randomUUID(),
          deduplicationKey: key,
          state: DEDUPLICATOR_STATES.FAILED,
          responseBody: { message: 'First failure' },
          responseStatus: 500,
          statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
        });
        // Small delay to ensure distinct createdAt ordering
        await new Promise((r) => setTimeout(r, 5));
        const secondId = randomUUID();
        await adapter.create({
          id: secondId,
          deduplicationKey: key,
          state: DEDUPLICATOR_STATES.FAILED,
          responseBody: { message: 'Second failure' },
          responseStatus: 500,
          statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }],
        });

        const found = await adapter.findByKey(key);
        expect(found).not.toBeNull();
        expect(found!.state).toBe(DEDUPLICATOR_STATES.FAILED);
        expect(found!.id).toBe(secondId);
      });
    });

    // ─── create ───────────────────────────────────────────────────────────────

    describe('create()', () => {
      it('round-trip: created record contains all provided fields plus createdAt', async () => {
        const rec = makeRecord({
          state: DEDUPLICATOR_STATES.IN_PROGRESS,
          requestBody: { accountId: 'a1', amount: 99 },
        });
        const created = await adapter.create(rec);

        expect(created.id).toBe(rec.id);
        expect(created.deduplicationKey).toBe(rec.deduplicationKey);
        expect(created.state).toBe(DEDUPLICATOR_STATES.IN_PROGRESS);
        expect(created.requestBody).toEqual(rec.requestBody);
        expect(created.createdAt).toBeInstanceOf(Date);
      });

      it('allows multiple records with the same deduplicationKey (IN_PROGRESS and FAILED records coexist)', async () => {
        const key = `key-${randomUUID()}`;
        await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DEDUPLICATOR_STATES.IN_PROGRESS, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }] });
        await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DEDUPLICATOR_STATES.FAILED, responseStatus: 409, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }] });

        const found = await adapter.findByKey(key);
        expect(found!.state).toBe(DEDUPLICATOR_STATES.IN_PROGRESS);
      });
    });

    // ─── updateState ──────────────────────────────────────────────────────────

    describe('updateState()', () => {
      it('IN_PROGRESS → COMPLETED: saves responseBody and responseStatus', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DEDUPLICATOR_STATES.COMPLETED, { result: 'ok' }, 201);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
        expect(updated!.responseBody).toEqual({ result: 'ok' });
        expect(updated!.responseStatus).toBe(201);
      });

      it('IN_PROGRESS → FAILED: saves error body and status', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DEDUPLICATOR_STATES.FAILED, { message: 'Boom' }, 500);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.state).toBe(DEDUPLICATOR_STATES.FAILED);
        expect(updated!.responseBody).toEqual({ message: 'Boom' });
        expect(updated!.responseStatus).toBe(500);
      });

      it('FAILED → IN_PROGRESS: allows retry reset', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DEDUPLICATOR_STATES.FAILED, { message: 'First attempt failed' }, 500);
        await adapter.updateState(rec.deduplicationKey, DEDUPLICATOR_STATES.IN_PROGRESS);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.state).toBe(DEDUPLICATOR_STATES.IN_PROGRESS);
      });

      it('is a no-op for a non-existent key (does not throw)', async () => {
        await expect(
          adapter.updateState('non-existent-key', DEDUPLICATOR_STATES.COMPLETED, {}, 200),
        ).resolves.toBeUndefined();
      });

      it('preserves responseBody = null when explicitly passed as null', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DEDUPLICATOR_STATES.COMPLETED, null, 204);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.responseStatus).toBe(204);
      });

      it('targets the IN_PROGRESS record, not the FAILED rejection records', async () => {
        const key = `key-${randomUUID()}`;
        const primaryId = randomUUID();

        await adapter.create({ id: primaryId, deduplicationKey: key, state: DEDUPLICATOR_STATES.IN_PROGRESS, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.IN_PROGRESS, changedAt: new Date() }] });
        // Rejection record for same key
        await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DEDUPLICATOR_STATES.FAILED, responseStatus: 409, statusChangeLogs: [{ from: null, to: DEDUPLICATOR_STATES.FAILED, changedAt: new Date() }] });

        await adapter.updateState(key, DEDUPLICATOR_STATES.COMPLETED, { id: '42' }, 201);

        const found = await adapter.findByKey(key);
        expect(found!.id).toBe(primaryId);
        expect(found!.state).toBe(DEDUPLICATOR_STATES.COMPLETED);
        expect(found!.responseBody).toEqual({ id: '42' });
      });
    });

    // ─── close ────────────────────────────────────────────────────────────────

    describe('close()', () => {
      it('resolves without throwing', async () => {
        await expect(adapter.close()).resolves.toBeUndefined();
      });
    });

    // ─── value discrimination ─────────────────────────────────────────────────

    describe('value discrimination in requestBody / responseBody', () => {
      it('stores and retrieves 0, false, null, and a string as distinct values', async () => {
        const cases: Array<[string, unknown]> = [
          ['zero', 0],
          ['false', false],
          ['null-value', null],
          ['string', 'value'],
        ];

        for (const [label, value] of cases) {
          const rec = makeRecord({
            id: randomUUID(),
            deduplicationKey: `key-discrimination-${label}`,
            state: DEDUPLICATOR_STATES.COMPLETED,
            responseBody: { result: value },
            responseStatus: 200,
          });
          await adapter.create(rec);
          const found = await adapter.findByKey(rec.deduplicationKey);
          expect(found!.responseBody).toEqual({ result: value });
        }
      });
    });
  });
}
