import { createCache } from 'cache-manager';
import { BoundedMap, boundedCacheOptions } from '../src/utils/bounded-cache.util';

describe('bounded in-memory cache', () => {
  it('drops the oldest-written entries once the limit is reached', () => {
    const map = new BoundedMap<string, number>(3);
    for (let i = 0; i < 5; i++) map.set(`k${i}`, i);
    expect([...map.keys()]).toEqual(['k2', 'k3', 'k4']);
  });

  it('treats a rewritten key as the newest entry', () => {
    const map = new BoundedMap<string, number>(3);
    map.set('a', 1).set('b', 2).set('c', 3);
    map.set('a', 10).set('d', 4);
    expect([...map.keys()]).toEqual(['c', 'a', 'd']);
    expect(map.get('a')).toBe(10);
  });

  it('rejects an invalid size', () => {
    expect(() => new BoundedMap(0)).toThrow('Invalid cache size');
    expect(() => new BoundedMap(1.5)).toThrow('Invalid cache size');
  });

  it('caps a real cache and still expires entries after their lifetime in milliseconds', async () => {
    const cache = createCache(boundedCacheOptions(2));
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBe(3);
    await cache.set('short', 'x', 20);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(await cache.get('short')).toBeNull();
  });
});
