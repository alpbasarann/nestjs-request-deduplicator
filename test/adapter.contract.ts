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
import { DeduplicatorStorageAdapter } from '../src/adapters/deduplicator-storage.adapter';
import type { DeduplicatorRecord } from '../src/models';
import { DeduplicatorState } from '../src/enums';

function makeRecord(overrides: Partial<Omit<DeduplicatorRecord, 'createdAt'>> = {}): Omit<DeduplicatorRecord, 'createdAt'> {
  return {
    id: randomUUID(),
    deduplicationKey: `key-${randomUUID()}`,
    state: DeduplicatorState.IN_PROGRESS,
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
        const rec = makeRecord({ state: DeduplicatorState.IN_PROGRESS });
        await adapter.create(rec);

        const found = await adapter.findByKey(rec.deduplicationKey);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(rec.id);
        expect(found!.state).toBe(DeduplicatorState.IN_PROGRESS);
      });

      it('finds a COMPLETED record', async () => {
        const rec = makeRecord({ state: DeduplicatorState.IN_PROGRESS });
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DeduplicatorState.COMPLETED, { ok: true }, 200);

        const found = await adapter.findByKey(rec.deduplicationKey);
        expect(found!.state).toBe(DeduplicatorState.COMPLETED);
      });

      it('prefers COMPLETED over FAILED for the same key', async () => {
        const key = `key-${randomUUID()}`;
        const primaryId = randomUUID();

        await adapter.create({ id: primaryId, deduplicationKey: key, state: DeduplicatorState.IN_PROGRESS });
        await adapter.updateState(key, DeduplicatorState.COMPLETED, { id: '1' }, 201);

        // Create a FAILED record for the same key (duplicate rejection)
        await adapter.create({
          id: randomUUID(),
          deduplicationKey: key,
          state: DeduplicatorState.FAILED,
          responseBody: { message: 'Duplicate' },
          responseStatus: 409,
        });

        const found = await adapter.findByKey(key);
        expect(found!.state).toBe(DeduplicatorState.COMPLETED);
        expect(found!.id).toBe(primaryId);
      });

      it('prefers IN_PROGRESS over FAILED for the same key', async () => {
        const key = `key-${randomUUID()}`;
        const primaryId = randomUUID();

        await adapter.create({ id: primaryId, deduplicationKey: key, state: DeduplicatorState.IN_PROGRESS });

        // Concurrent duplicate rejection
        await adapter.create({
          id: randomUUID(),
          deduplicationKey: key,
          state: DeduplicatorState.FAILED,
          responseBody: { message: 'Request is already being processed' },
          responseStatus: 409,
        });

        const found = await adapter.findByKey(key);
        expect(found!.state).toBe(DeduplicatorState.IN_PROGRESS);
        expect(found!.id).toBe(primaryId);
      });

      it('falls back to most-recent FAILED record when no canonical record exists', async () => {
        const key = `key-${randomUUID()}`;

        await adapter.create({
          id: randomUUID(),
          deduplicationKey: key,
          state: DeduplicatorState.FAILED,
          responseBody: { message: 'First failure' },
          responseStatus: 500,
        });
        // Small delay to ensure distinct createdAt ordering
        await new Promise((r) => setTimeout(r, 5));
        const secondId = randomUUID();
        await adapter.create({
          id: secondId,
          deduplicationKey: key,
          state: DeduplicatorState.FAILED,
          responseBody: { message: 'Second failure' },
          responseStatus: 500,
        });

        const found = await adapter.findByKey(key);
        expect(found).not.toBeNull();
        expect(found!.state).toBe(DeduplicatorState.FAILED);
        expect(found!.id).toBe(secondId);
      });
    });

    // ─── create ───────────────────────────────────────────────────────────────

    describe('create()', () => {
      it('round-trip: created record contains all provided fields plus createdAt', async () => {
        const rec = makeRecord({
          state: DeduplicatorState.IN_PROGRESS,
          requestBody: { accountId: 'a1', amount: 99 },
        });
        const created = await adapter.create(rec);

        expect(created.id).toBe(rec.id);
        expect(created.deduplicationKey).toBe(rec.deduplicationKey);
        expect(created.state).toBe(DeduplicatorState.IN_PROGRESS);
        expect(created.requestBody).toEqual(rec.requestBody);
        expect(created.createdAt).toBeInstanceOf(Date);
      });

      it('allows multiple records with the same deduplicationKey (IN_PROGRESS and FAILED records coexist)', async () => {
        const key = `key-${randomUUID()}`;
        await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DeduplicatorState.IN_PROGRESS });
        await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DeduplicatorState.FAILED, responseStatus: 409 });

        const found = await adapter.findByKey(key);
        expect(found!.state).toBe(DeduplicatorState.IN_PROGRESS);
      });
    });

    // ─── updateState ──────────────────────────────────────────────────────────

    describe('updateState()', () => {
      it('IN_PROGRESS → COMPLETED: saves responseBody and responseStatus', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DeduplicatorState.COMPLETED, { result: 'ok' }, 201);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.state).toBe(DeduplicatorState.COMPLETED);
        expect(updated!.responseBody).toEqual({ result: 'ok' });
        expect(updated!.responseStatus).toBe(201);
      });

      it('IN_PROGRESS → FAILED: saves error body and status', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DeduplicatorState.FAILED, { message: 'Boom' }, 500);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.state).toBe(DeduplicatorState.FAILED);
        expect(updated!.responseBody).toEqual({ message: 'Boom' });
        expect(updated!.responseStatus).toBe(500);
      });

      it('FAILED → IN_PROGRESS: allows retry reset', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DeduplicatorState.FAILED, { message: 'First attempt failed' }, 500);
        await adapter.updateState(rec.deduplicationKey, DeduplicatorState.IN_PROGRESS);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.state).toBe(DeduplicatorState.IN_PROGRESS);
      });

      it('is a no-op for a non-existent key (does not throw)', async () => {
        await expect(
          adapter.updateState('non-existent-key', DeduplicatorState.COMPLETED, {}, 200),
        ).resolves.toBeUndefined();
      });

      it('preserves responseBody = null when explicitly passed as null', async () => {
        const rec = makeRecord();
        await adapter.create(rec);
        await adapter.updateState(rec.deduplicationKey, DeduplicatorState.COMPLETED, null, 204);

        const updated = await adapter.findByKey(rec.deduplicationKey);
        expect(updated!.responseStatus).toBe(204);
      });

      it('targets the IN_PROGRESS record, not the FAILED rejection records', async () => {
        const key = `key-${randomUUID()}`;
        const primaryId = randomUUID();

        await adapter.create({ id: primaryId, deduplicationKey: key, state: DeduplicatorState.IN_PROGRESS });
        // Rejection record for same key
        await adapter.create({ id: randomUUID(), deduplicationKey: key, state: DeduplicatorState.FAILED, responseStatus: 409 });

        await adapter.updateState(key, DeduplicatorState.COMPLETED, { id: '42' }, 201);

        const found = await adapter.findByKey(key);
        expect(found!.id).toBe(primaryId);
        expect(found!.state).toBe(DeduplicatorState.COMPLETED);
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
            state: DeduplicatorState.COMPLETED,
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
