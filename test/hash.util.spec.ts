import { generateHash, ExtractedFields } from '../src/utils';

describe('generateHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const result = generateHash({ 'body.userId': '123' });
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic: same input always produces same hash', () => {
    const fields: ExtractedFields = {
      'body.userId': 'abc',
      'body.orderTotal': 99.99,
      'header.x-client-id': 'client-1',
    };
    const h1 = generateHash(fields);
    const h2 = generateHash(fields);
    expect(h1).toBe(h2);
  });

  it('produces same hash regardless of key insertion order', () => {
    const fields1: ExtractedFields = {
      'body.userId': 'abc',
      'body.orderTotal': 99.99,
    };
    const fields2: ExtractedFields = {
      'body.orderTotal': 99.99,
      'body.userId': 'abc',
    };
    expect(generateHash(fields1)).toBe(generateHash(fields2));
  });

  it('produces different hashes for different values', () => {
    const h1 = generateHash({ 'body.userId': 'user-1' });
    const h2 = generateHash({ 'body.userId': 'user-2' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different keys', () => {
    const h1 = generateHash({ 'body.userId': 'same' });
    const h2 = generateHash({ 'body.email': 'same' });
    expect(h1).not.toBe(h2);
  });

  it('handles undefined values deterministically', () => {
    const h1 = generateHash({ 'body.missing': undefined });
    const h2 = generateHash({ 'body.missing': undefined });
    expect(h1).toBe(h2);
  });

  it('handles nested objects deterministically', () => {
    const h1 = generateHash({ 'body.user': { id: 1, name: 'Alice' } });
    const h2 = generateHash({ 'body.user': { name: 'Alice', id: 1 } });
    expect(h1).toBe(h2);
  });

  it('handles empty object', () => {
    const result = generateHash({});
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles arrays', () => {
    const h1 = generateHash({ 'body.items': ['a', 'b', 'c'] });
    const h2 = generateHash({ 'body.items': ['a', 'b', 'c'] });
    expect(h1).toBe(h2);
    const h3 = generateHash({ 'body.items': ['a', 'c', 'b'] });
    // Array order matters — different order = different hash
    expect(h1).not.toBe(h3);
  });

  it('handles null values', () => {
    const h1 = generateHash({ 'body.value': null });
    const h2 = generateHash({ 'body.value': null });
    expect(h1).toBe(h2);
    const h3 = generateHash({ 'body.value': undefined });
    expect(h1).not.toBe(h3);
  });

  describe('type coercion resistance', () => {
    it('produces different hashes for string "1" vs number 1', () => {
      const h1 = generateHash({ 'body.count': '1' });
      const h2 = generateHash({ 'body.count': 1 });
      expect(h1).not.toBe(h2);
    });

    it('produces different hashes for false vs "false"', () => {
      const h1 = generateHash({ 'body.flag': false });
      const h2 = generateHash({ 'body.flag': 'false' });
      expect(h1).not.toBe(h2);
    });

    it('0 vs false: different (JSON preserves both as distinct literals)', () => {
      // 0 → {"body.v":0}   false → {"body.v":false}
      expect(generateHash({ 'body.v': 0 })).not.toBe(generateHash({ 'body.v': false }));
    });

    it('0 vs null: different', () => {
      // 0 → {"body.v":0}   null → {"body.v":null}
      expect(generateHash({ 'body.v': 0 })).not.toBe(generateHash({ 'body.v': null }));
    });

    it('false vs null: different', () => {
      // false → {"body.v":false}   null → {"body.v":null}
      expect(generateHash({ 'body.v': false })).not.toBe(generateHash({ 'body.v': null }));
    });

    it('null vs undefined: different (undefined key is omitted by JSON.stringify; null key is preserved)', () => {
      // null  → {"body.v":null}
      // undefined → {}  (key omitted — field absent from JSON body)
      const hashNull = generateHash({ 'body.v': null });
      const hashUndefined = generateHash({ 'body.v': undefined });
      expect(hashNull).not.toBe(hashUndefined);
    });

    it('undefined vs absent key: same (both represent "field not present in request")', () => {
      // A field listed in `fields` but missing from the body → undefined
      // An empty extracted-fields map → {}
      // Both serialize to {} — intentionally treated as equivalent (JSON has no undefined)
      const hashUndefined = generateHash({ 'body.v': undefined });
      const hashAbsent = generateHash({});
      expect(hashUndefined).toBe(hashAbsent);
    });

    it('produces different hashes for 0 vs null vs undefined vs false', () => {
      // JSON serialization: undefined values on object keys are OMITTED entirely,
      // so { 'body.v': undefined } serializes as {} — distinct from null, 0, and false.
      const hashes = [
        generateHash({ 'body.v': 0 }),        // {"body.v":0}
        generateHash({ 'body.v': null }),      // {"body.v":null}
        generateHash({ 'body.v': undefined }), // {} — key is omitted by JSON.stringify
        generateHash({ 'body.v': false }),     // {"body.v":false}
      ];
      const unique = new Set(hashes);
      expect(unique.size).toBe(4);
    });
  });

  describe('security: depth limit', () => {
    it('throws RangeError for objects nested deeper than 50 levels', () => {
      let deep: Record<string, unknown> = { leaf: 'value' };
      for (let i = 0; i < 55; i++) {
        deep = { child: deep };
      }
      expect(() => generateHash({ 'body.nested': deep })).toThrow(RangeError);
      expect(() => generateHash({ 'body.nested': deep })).toThrow(/maximum nesting depth/);
    });

    it('does not throw for shallow nested objects (10 levels)', () => {
      let deep: Record<string, unknown> = { leaf: 'value' };
      for (let i = 0; i < 10; i++) {
        deep = { child: deep };
      }
      expect(() => generateHash({ 'body.nested': deep })).not.toThrow();
    });
  });

  describe('security: circular reference handling', () => {
    it('throws for circular object references (caught by depth guard before JSON.stringify)', () => {
      // Circular references cause infinite recursion which the depth guard intercepts first.
      // The resulting error is a RangeError (depth exceeded), not a TypeError from JSON.stringify.
      const circular: Record<string, unknown> = { a: 1 };
      circular['self'] = circular;
      expect(() => generateHash({ 'body.data': circular })).toThrow(RangeError);
      expect(() => generateHash({ 'body.data': circular })).toThrow(/maximum nesting depth/);
    });

    it('throws TypeError when JSON.stringify fails due to a custom toJSON method that throws', () => {
      // An object with a toJSON() that throws bypasses the depth guard (no infinite recursion)
      // and reaches JSON.stringify, which then calls toJSON() and propagates the error.
      // Our catch block wraps it in a descriptive TypeError.
      const badValue = {
        toJSON: () => {
          throw new Error('Custom serialization error in toJSON');
        },
      };
      expect(() => generateHash({ 'body.v': badValue as unknown as Record<string, unknown> })).toThrow(TypeError);
      expect(() => generateHash({ 'body.v': badValue as unknown as Record<string, unknown> })).toThrow(
        /Failed to serialize fields for deduplication hashing/,
      );
    });
  });
});
