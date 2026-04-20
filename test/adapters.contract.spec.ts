/**
 * Runs the full adapter contract suite against MockDeduplicatorAdapter.
 * Real adapter authors should do the same with their own implementation:
 *
 *   import { runAdapterContractTests } from './adapter.contract';
 *   runAdapterContractTests(() => new MyAdapter(connectionString));
 */
import { runAdapterContractTests } from './adapter.contract';
import { MockDeduplicatorAdapter } from './mocks/mock.adapter';

runAdapterContractTests(() => new MockDeduplicatorAdapter());
