import { isRequestDeduplicatorOptions } from '../src/metadata';

describe('isRequestDeduplicatorOptions', () => {
  describe('valid inputs → true', () => {
    it('accepts body fields only', () => {
      expect(isRequestDeduplicatorOptions({ body: ['accountId', 'resourceId'] })).toBe(true);
    });

    it('accepts headers only', () => {
      expect(isRequestDeduplicatorOptions({ headers: ['x-request-id'] })).toBe(true);
    });

    it('accepts query only', () => {
      expect(isRequestDeduplicatorOptions({ query: ['tenantId'] })).toBe(true);
    });

    it('accepts params only', () => {
      expect(isRequestDeduplicatorOptions({ params: ['orderId'] })).toBe(true);
    });

    it('accepts all four sources together', () => {
      expect(isRequestDeduplicatorOptions({
        body: ['accountId'], headers: ['x-request-id'], query: ['version'], params: ['orderId'],
      })).toBe(true);
    });

    it('accepts optional keyName', () => {
      expect(isRequestDeduplicatorOptions({ body: ['accountId'], keyName: 'my_key' })).toBe(true);
    });

    it('ignores unknown extra properties', () => {
      expect(isRequestDeduplicatorOptions({ body: ['accountId'], unknown: 42 })).toBe(true);
    });
  });

  describe('invalid inputs → false', () => {
    it('returns false for null', () => {
      expect(isRequestDeduplicatorOptions(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isRequestDeduplicatorOptions(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isRequestDeduplicatorOptions('accountId')).toBe(false);
    });

    it('returns false for an array', () => {
      expect(isRequestDeduplicatorOptions(['accountId'])).toBe(false);
    });

    it('returns false when none of body, headers, query, params is provided', () => {
      expect(isRequestDeduplicatorOptions({})).toBe(false);
    });

    it('returns false when all four sources are empty arrays', () => {
      expect(isRequestDeduplicatorOptions({ body: [], headers: [], query: [], params: [] })).toBe(false);
    });

    it('returns false when body is not an array', () => {
      expect(isRequestDeduplicatorOptions({ body: 'accountId' })).toBe(false);
    });

    it('returns false when body contains non-string entries', () => {
      expect(isRequestDeduplicatorOptions({ body: [42, 'accountId'] })).toBe(false);
    });

    it('returns false when headers is not an array', () => {
      expect(isRequestDeduplicatorOptions({ headers: 'x-request-id' })).toBe(false);
    });

    it('returns false when query is not an array', () => {
      expect(isRequestDeduplicatorOptions({ query: 'tenantId' })).toBe(false);
    });

    it('returns false when params contains non-string entries', () => {
      expect(isRequestDeduplicatorOptions({ params: [42] })).toBe(false);
    });

    it('returns false when keyName is not a string', () => {
      expect(isRequestDeduplicatorOptions({ body: ['accountId'], keyName: 123 })).toBe(false);
    });
  });
});
