import { RequestDeduplicatorModule, validateRequestDeduplicatorOptions } from '../src/module';
import { TABLE_NAME_REGEX } from '../src/constants';
import { MockDeduplicatorAdapter } from './mocks/mock.adapter';

const validOptions = {
  adapter: new MockDeduplicatorAdapter(),
  tableName: 'deduplicator',
};

describe('RequestDeduplicatorModule.forRoot()', () => {
  it('throws for invalid tableName', () => {
    expect(() =>
      RequestDeduplicatorModule.forRoot({ ...validOptions, tableName: '123invalid' }),
    ).toThrow(/Invalid tableName/);
  });

  it('throws when adapter is not a DeduplicatorStorageAdapter instance', () => {
    expect(() =>
      RequestDeduplicatorModule.forRoot({ ...validOptions, adapter: {} as never }),
    ).toThrow(/DeduplicatorStorageAdapter/);
  });

  it('accepts valid options and returns a DynamicModule', () => {
    const result = RequestDeduplicatorModule.forRoot(validOptions);
    expect(result.module).toBe(RequestDeduplicatorModule);
    expect(result.global).toBe(true);
    expect(result.providers).toBeDefined();
    expect(result.exports).toBeDefined();
  });

  it('accepts optional idFieldName and deduplicationKeyFieldName', () => {
    expect(() =>
      RequestDeduplicatorModule.forRoot({
        ...validOptions,
        idFieldName: 'record_id',
        deduplicationKeyFieldName: 'dedup_key',
      }),
    ).not.toThrow();
  });

  describe('idFieldName validation', () => {
    it('throws when idFieldName is an empty string', () => {
      expect(() =>
        RequestDeduplicatorModule.forRoot({ ...validOptions, idFieldName: '' }),
      ).toThrow(/idFieldName/);
    });

    it('throws when idFieldName is whitespace only', () => {
      expect(() =>
        RequestDeduplicatorModule.forRoot({ ...validOptions, idFieldName: '   ' }),
      ).toThrow(/idFieldName/);
    });

    it('throws when idFieldName is tab character', () => {
      expect(() =>
        RequestDeduplicatorModule.forRoot({ ...validOptions, idFieldName: '\t' }),
      ).toThrow(/idFieldName/);
    });
  });
});

describe('validateRequestDeduplicatorOptions', () => {
  it('accepts body fields only', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({ body: ['accountId', 'resourceId'] }),
    ).not.toThrow();
  });

  it('accepts headers only', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({ headers: ['x-request-id'] }),
    ).not.toThrow();
  });

  it('accepts query only', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({ query: ['tenantId'] }),
    ).not.toThrow();
  });

  it('accepts params only', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({ params: ['orderId'] }),
    ).not.toThrow();
  });

  it('accepts all four sources together', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({
        body: ['accountId'], headers: ['x-request-id'], query: ['version'], params: ['orderId'],
      }),
    ).not.toThrow();
  });

  it('accepts optional keyName', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({ body: ['accountId'], keyName: 'custom_key' }),
    ).not.toThrow();
  });

  it('throws when none of body, headers, query, params is provided', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({} as never),
    ).toThrow(/At least one field/);
  });

  it('throws when all four sources are empty arrays', () => {
    expect(() =>
      validateRequestDeduplicatorOptions({ body: [], headers: [], query: [], params: [] }),
    ).toThrow(/At least one field/);
  });

  it('throws when total fields across all sources exceed 50', () => {
    const fields = Array.from({ length: 51 }, (_, i) => `field${i}`);
    expect(() => validateRequestDeduplicatorOptions({ body: fields })).toThrow(/Too many fields/);
  });

  it('counts fields from all sources toward the 50-field limit', () => {
    const quarter = Array.from({ length: 13 }, (_, i) => `f${i}`);
    expect(() =>
      validateRequestDeduplicatorOptions({
        body: quarter, headers: quarter, query: quarter, params: quarter,
      }),
    ).toThrow(/Too many fields/);
  });

  it('does not throw for exactly 50 fields', () => {
    const fields = Array.from({ length: 50 }, (_, i) => `field${i}`);
    expect(() => validateRequestDeduplicatorOptions({ body: fields })).not.toThrow();
  });

  describe('forbidden segment validation', () => {
    it('throws for a body field containing __proto__', () => {
      expect(() =>
        validateRequestDeduplicatorOptions({ body: ['__proto__'] }),
      ).toThrow(/Forbidden key/);
    });

    it('throws for a header field containing constructor', () => {
      expect(() =>
        validateRequestDeduplicatorOptions({ headers: ['constructor'] }),
      ).toThrow(/Forbidden key/);
    });

    it('throws for a query field containing __proto__', () => {
      expect(() =>
        validateRequestDeduplicatorOptions({ query: ['__proto__'] }),
      ).toThrow(/Forbidden key/);
    });

    it('throws for a params field containing prototype', () => {
      expect(() =>
        validateRequestDeduplicatorOptions({ params: ['prototype'] }),
      ).toThrow(/Forbidden key/);
    });

    it('throws for forbidden segment in dot-path body field', () => {
      expect(() =>
        validateRequestDeduplicatorOptions({ body: ['user.__proto__'] }),
      ).toThrow(/Forbidden key/);
    });
  });
});

describe('TABLE_NAME_REGEX', () => {
  const valid = ['deduplicator', 'Request_records', '_private', 'a', 'A_1'];
  const invalid = ['1starts_with_number', '', 'has-hyphen', 'has space', 'a'.repeat(64)];

  valid.forEach((name) => {
    it(`accepts valid tableName: "${name}"`, () => {
      expect(TABLE_NAME_REGEX.test(name)).toBe(true);
    });
  });

  invalid.forEach((name) => {
    it(`rejects invalid tableName: "${name.slice(0, 20)}"`, () => {
      expect(TABLE_NAME_REGEX.test(name)).toBe(false);
    });
  });
});
