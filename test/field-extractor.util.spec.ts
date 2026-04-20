import { getExtractedFields, extractFields, RequestLike } from '../src/key/field-extractor';

function makeRequest(overrides: Partial<RequestLike> = {}): RequestLike {
  return { headers: {}, body: {}, query: {}, params: {}, ...overrides };
}

describe('getExtractedFields', () => {
  describe('body extraction', () => {
    it('picks specified fields from request.body under body.* keys', () => {
      const req = makeRequest({ body: { accountId: 'a1', resourceId: 'r1', note: 'ignore me' } });
      const result = getExtractedFields(req, ['accountId', 'resourceId']);
      expect(result['body.accountId']).toBe('a1');
      expect(result['body.resourceId']).toBe('r1');
      expect(result['body.note']).toBeUndefined();
    });

    it('supports dot-notation for nested body fields', () => {
      const req = makeRequest({ body: { user: { id: 'u1', role: 'admin' } } });
      const result = getExtractedFields(req, ['user.id']);
      expect(result['body.user.id']).toBe('u1');
    });

    it('returns undefined for missing body fields', () => {
      const req = makeRequest({ body: { accountId: 'a1' } });
      const result = getExtractedFields(req, ['accountId', 'missing']);
      expect(result['body.missing']).toBeUndefined();
    });

    it('returns undefined for missing intermediate nested field', () => {
      const req = makeRequest({ body: { user: null } });
      const result = getExtractedFields(req, ['user.id']);
      expect(result['body.user.id']).toBeUndefined();
    });

    it('preserves null values (distinct from undefined)', () => {
      const req = makeRequest({ body: { amount: null } });
      const result = getExtractedFields(req, ['amount']);
      expect(result['body.amount']).toBeNull();
    });
  });

  describe('header extraction', () => {
    it('picks specified headers under header.* keys', () => {
      const req = makeRequest({ headers: { 'x-request-id': 'abc', 'x-correlation-id': 'tok' } });
      const result = getExtractedFields(req, [], ['x-request-id']);
      expect(result['header.x-request-id']).toBe('abc');
    });

    it('normalizes header lookup to lowercase', () => {
      const req = makeRequest({ headers: { 'x-request-id': 'abc' } });
      const result = getExtractedFields(req, [], ['X-Request-Id']);
      expect(result['header.X-Request-Id']).toBe('abc');
    });

    it('returns undefined for missing headers', () => {
      const req = makeRequest({ headers: {} });
      const result = getExtractedFields(req, [], ['x-missing']);
      expect(result['header.x-missing']).toBeUndefined();
    });
  });

  describe('query extraction', () => {
    it('picks specified query params under query.* keys', () => {
      const req = makeRequest({ query: { tenantId: 'tenant-1', version: '2' } });
      const result = getExtractedFields(req, [], [], ['tenantId', 'version']);
      expect(result['query.tenantId']).toBe('tenant-1');
      expect(result['query.version']).toBe('2');
    });

    it('returns undefined for missing query params', () => {
      const req = makeRequest({ query: {} });
      const result = getExtractedFields(req, [], [], ['missing']);
      expect(result['query.missing']).toBeUndefined();
    });

    it('supports dot-notation for nested query objects', () => {
      const req = makeRequest({ query: { filter: { status: 'active' } as unknown } });
      const result = getExtractedFields(req, [], [], ['filter.status']);
      expect(result['query.filter.status']).toBe('active');
    });
  });

  describe('params extraction', () => {
    it('picks specified route params under param.* keys', () => {
      const req = makeRequest({ params: { recordId: 'REC-123', accountId: 'a-1' } });
      const result = getExtractedFields(req, [], [], [], ['recordId', 'accountId']);
      expect(result['param.recordId']).toBe('REC-123');
      expect(result['param.accountId']).toBe('a-1');
    });

    it('returns undefined for missing route params', () => {
      const req = makeRequest({ params: {} });
      const result = getExtractedFields(req, [], [], [], ['missing']);
      expect(result['param.missing']).toBeUndefined();
    });
  });

  describe('mixed sources', () => {
    it('combines body, headers, query, and params in one call', () => {
      const req = makeRequest({
        headers: { 'x-request-id': 'req-42' },
        body: { accountId: 'a1', amount: 99 },
        query: { version: '2' },
        params: { recordId: 'REC-1' },
      });
      const result = getExtractedFields(req, ['accountId', 'amount'], ['x-request-id'], ['version'], ['recordId']);
      expect(result['body.accountId']).toBe('a1');
      expect(result['body.amount']).toBe(99);
      expect(result['header.x-request-id']).toBe('req-42');
      expect(result['query.version']).toBe('2');
      expect(result['param.recordId']).toBe('REC-1');
    });

    it('body and header with same name do not collide (different prefixes)', () => {
      // Express normalizes header keys to lowercase, so 'accountId' header is stored as 'accountid'
      const req = makeRequest({
        headers: { 'accountid': 'from-header' },
        body: { accountId: 'from-body' },
      });
      const result = getExtractedFields(req, ['accountId'], ['accountId']);
      expect(result['body.accountId']).toBe('from-body');
      expect(result['header.accountId']).toBe('from-header');
    });
  });

  describe('output ordering', () => {
    it('returns keys sorted alphabetically for determinism', () => {
      const req = makeRequest({
        headers: { 'x-request-id': 'c1' },
        body: { z: 'last', a: 'first' },
        query: { page: '1' },
        params: { id: '42' },
      });
      const result = getExtractedFields(req, ['z', 'a'], ['x-request-id'], ['page'], ['id']);
      const keys = Object.keys(result);
      expect(keys).toEqual([...keys].sort());
    });
  });

  describe('security: prototype pollution prevention', () => {
    it('rejects __proto__ in a body field name', () => {
      expect(() => getExtractedFields(makeRequest(), ['__proto__'])).toThrow(/Forbidden key/);
    });

    it('rejects constructor in a body field name', () => {
      expect(() => getExtractedFields(makeRequest(), ['constructor'])).toThrow(/Forbidden key/);
    });

    it('rejects forbidden segment in a header name', () => {
      expect(() => getExtractedFields(makeRequest(), [], ['__proto__'])).toThrow(/Forbidden key/);
    });

    it('rejects forbidden segment in a query field name', () => {
      expect(() => getExtractedFields(makeRequest(), [], [], ['__proto__'])).toThrow(/Forbidden key/);
    });

    it('rejects forbidden segment in a params field name', () => {
      expect(() => getExtractedFields(makeRequest(), [], [], [], ['__proto__'])).toThrow(/Forbidden key/);
    });

    it('rejects forbidden segment anywhere in a dot-path', () => {
      expect(() => getExtractedFields(makeRequest(), ['user.__proto__'])).toThrow(/Forbidden key/);
    });

    it('rejects field keys that are too long', () => {
      expect(() => getExtractedFields(makeRequest(), ['a'.repeat(257)])).toThrow(/exceeds maximum length/);
    });
  });

  describe('edge cases', () => {
    it('returns empty object when all source arrays are empty', () => {
      expect(getExtractedFields(makeRequest())).toEqual({});
    });

    it('returns a new sorted object on each call (no mutation)', () => {
      const req = makeRequest({ body: { b: 2, a: 1 } });
      const r1 = getExtractedFields(req, ['b', 'a']);
      const r2 = getExtractedFields(req, ['b', 'a']);
      expect(r1).toEqual(r2);
      expect(r1).not.toBe(r2);
    });
  });
});

describe('extractFields', () => {
  it('validates and sorts a pre-built resolved data object', () => {
    const result = extractFields({ z: 'last', a: 'first' });
    expect(Object.keys(result)).toEqual(['a', 'z']);
  });

  it('rejects forbidden keys', () => {
    expect(() => extractFields({ ['__proto__']: 'x' })).toThrow(/Forbidden key/);
  });
});
