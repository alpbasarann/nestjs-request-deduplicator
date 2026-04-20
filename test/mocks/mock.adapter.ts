import { DeduplicatorStorageAdapter } from '../../src/adapters/storage.adapter';
import { DeduplicatorRecord } from '../../src/interfaces/record.interface';
import { DEDUPLICATOR_STATES } from '../../src/constants';
import type { DeduplicatorState } from '../../src/types/state.types';
import type { StatusChangeLog } from '../../src/types/status-change-log.types';

/**
 * In-memory DeduplicatorStorageAdapter.
 *
 * Multiple records per deduplicationKey are supported — rejection records
 * (FAILED) coexist with the active record.
 *
 * findByKey returns the active record in this priority order:
 *   1. COMPLETED or IN_PROGRESS if one exists
 *   2. Otherwise the most-recent FAILED record
 */
export class MockDeduplicatorAdapter extends DeduplicatorStorageAdapter {
  private allRecords: DeduplicatorRecord[] = [];
  public initializeCalled = 0;
  public closeCalled = 0;

  async initialize(): Promise<void> {
    this.initializeCalled++;
  }

  async findByKey(key: string): Promise<DeduplicatorRecord | null> {
    const active = this.allRecords.find(
      (r) =>
        r.deduplicationKey === key &&
        (r.state === DEDUPLICATOR_STATES.COMPLETED || r.state === DEDUPLICATOR_STATES.IN_PROGRESS),
    );
    if (active) return active;

    const failed = [...this.allRecords]
      .filter((r) => r.deduplicationKey === key)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return failed ?? null;
  }

  async create(record: Omit<DeduplicatorRecord, 'createdAt'>): Promise<DeduplicatorRecord> {
    const full: DeduplicatorRecord = { ...record, createdAt: new Date() };
    this.allRecords.push(full);
    return full;
  }

  async updateState(
    key: string,
    state: DeduplicatorState,
    responseBody?: unknown,
    responseStatus?: number,
  ): Promise<void> {
    const active = await this.findByKey(key);
    if (!active) return;
    const idx = this.allRecords.findIndex((r) => r.id === active.id);
    if (idx === -1) return;
    const newLogEntry: StatusChangeLog = { from: active.state, to: state, changedAt: new Date() };
    this.allRecords[idx] = {
      ...this.allRecords[idx],
      state,
      ...(responseBody !== undefined ? { responseBody } : {}),
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      statusChangeLogs: [...this.allRecords[idx].statusChangeLogs, newLogEntry],
    };
  }

  async close(): Promise<void> {
    this.closeCalled++;
    this.allRecords = [];
  }

  /** Returns all stored records. */
  getAll(): DeduplicatorRecord[] {
    return [...this.allRecords];
  }

  /** Returns all records for a given deduplication key. */
  getAllByKey(key: string): DeduplicatorRecord[] {
    return this.allRecords.filter((r) => r.deduplicationKey === key);
  }

  /** Returns the active record for a given deduplication key. */
  async get(key: string): Promise<DeduplicatorRecord | undefined> {
    return (await this.findByKey(key)) ?? undefined;
  }

  /** Seeds a record directly into the store. */
  set(record: DeduplicatorRecord): void {
    this.allRecords.push(record);
  }
}
