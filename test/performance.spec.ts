import { getExtractedFields, generateHash, RequestLike } from '../src/utils';

const ITERATIONS = 5_000;

function measureMs(fn: () => void, iterations: number): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

describe('performance: getExtractedFields', () => {
  it('small request (body + header) averages < 0.5 ms per call', () => {
    const req: RequestLike = { headers: { 'x-request-id': 'abc' }, body: { accountId: 'a1' }, query: {}, params: {} };
    const avg = measureMs(() => getExtractedFields(req, { body: ['accountId'], headers: ['x-request-id'] }), ITERATIONS);
    expect(avg).toBeLessThan(0.5);
  });

  it('50 body fields averages < 2 ms per call', () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) body[`field${i}`] = `value-${i}`;
    const req: RequestLike = { headers: {}, body, query: {}, params: {} };
    const fields = Array.from({ length: 50 }, (_, i) => `field${i}`);
    const avg = measureMs(() => getExtractedFields(req, { body: fields }), ITERATIONS);
    expect(avg).toBeLessThan(2);
  });

  it('missing fields averages < 0.5 ms per call', () => {
    const req: RequestLike = { headers: {}, body: {}, query: {}, params: {} };
    const avg = measureMs(
      () =>
        getExtractedFields(req, {
          body: ['missing1'],
          headers: ['x-absent'],
          query: ['q-missing'],
          params: ['p-missing'],
        }),
      ITERATIONS,
    );
    expect(avg).toBeLessThan(0.5);
  });
});

describe('performance: generateHash', () => {
  it('small field map averages < 0.5 ms per call', () => {
    const avg = measureMs(() => generateHash({ accountId: 'a1', tenantId: 't1' }), ITERATIONS);
    expect(avg).toBeLessThan(0.5);
  });

  it('50-field map averages < 2 ms per call', () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      fields[`field${i}`] = i % 5 === 0 ? null : i % 3 === 0 ? false : `value-${i}`;
    }
    const avg = measureMs(() => generateHash(fields), ITERATIONS);
    expect(avg).toBeLessThan(2);
  });

  it('1 000-key flat object averages < 5 ms per call', () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) fields[`key${i}`] = `value${i}`;
    const avg = measureMs(() => generateHash(fields), ITERATIONS / 10);
    expect(avg).toBeLessThan(5);
  });
});

describe('performance: getExtractedFields + generateHash combined (hot path)', () => {
  it('typical request (body + headers + query + params) averages < 1 ms per call', () => {
    const req: RequestLike = {
      headers: { 'x-request-id': 'req-42', 'x-correlation-id': 'corr-abc' },
      body: { accountId: 'a1', resourceId: 'res-99', amount: 199.99 },
      query: { version: '2' },
      params: { recordId: 'REC-1' },
    };
    const avg = measureMs(() => {
      const dedupFields = getExtractedFields(req, {
        body: ['accountId', 'resourceId', 'amount'],
        headers: ['x-request-id', 'x-correlation-id'],
        query: ['version'],
        params: ['recordId'],
      });
      generateHash(dedupFields);
    }, ITERATIONS);
    expect(avg).toBeLessThan(1);
  });
});
