import { matchRule } from '../src/services/utils/match-rule.util';
describe('matchRule', () => {
  const baseRule = {
    slug: null,
    channel_id: null,
    attribute_key: null,
    attribute_value: null,
    min_items: 1,
  };
  const assets = [
    { slug: 'foo', attributes: { trait: 'bar' } },
    { slug: 'baz', attributes: { trait: 'qux' } },
  ];

  it('matches slug null/empty/ALL', () => {
    expect(matchRule({ slug: null }, [{ slug: 'foo', attributes: {} }])).toBe(true);
    expect(matchRule({ slug: '' }, [{ slug: 'foo', attributes: {} }])).toBe(true);
    expect(matchRule({ slug: 'ALL' }, [{ slug: 'foo', attributes: {} }])).toBe(true);
  });
  it('does not interpret comma-separated slugs as a collection selection', () => {
    expect(matchRule({ slug: 'foo,baz' }, assets)).toBe(false);
  });
  it('matches trait', () => {
    expect(matchRule({ attribute_key: 'foo', attribute_value: 'bar' }, [{ slug: 'x', attributes: { foo: 'bar' } }])).toBe(true);
    expect(matchRule({ attribute_key: 'foo', attribute_value: 'baz' }, [{ slug: 'x', attributes: { foo: 'bar' } }])).toBe(false);
    // Test empty strings are ignored
    expect(matchRule({ attribute_key: '', attribute_value: '' }, [{ slug: 'x', attributes: { foo: 'bar' } }])).toBe(true);
  });
  it('matches min_items', () => {
    expect(matchRule({ min_items: 2 }, [{}, {}])).toBe(true);
    expect(matchRule({ min_items: 3 }, [{}, {}])).toBe(false);
  });
  it('matches channel wildcard', () => {
    expect(matchRule({ channel_id: null }, [], 'abc')).toBe(true);
    expect(matchRule({ channel_id: 'abc' }, [], 'abc')).toBe(true);
    expect(matchRule({ channel_id: 'def' }, [], 'abc')).toBe(false);
  });

  it('matches wildcard slug (null, empty, and ALL)', () => {
    expect(matchRule({ ...baseRule, slug: null }, assets)).toBe(true);
    expect(matchRule({ ...baseRule, slug: '' }, assets)).toBe(true);
    expect(matchRule({ ...baseRule, slug: 'ALL' }, assets)).toBe(true);
  });

  it('rejects if trait key/value missing', () => {
    const rule = { ...baseRule, attribute_key: 'missing', attribute_value: 'nope' };
    expect(matchRule(rule, assets)).toBe(false);
  });

  it('accepts default min_items=1', () => {
    expect(matchRule({ ...baseRule, min_items: 1 }, assets)).toBe(true);
  });

  it('rejects if min_items > asset count', () => {
    expect(matchRule({ ...baseRule, min_items: 3 }, assets)).toBe(false);
  });

  it('accepts min_items=0 (no minimum requirement)', () => {
    expect(matchRule({ ...baseRule, min_items: 0 }, assets)).toBe(true);
  });
});
