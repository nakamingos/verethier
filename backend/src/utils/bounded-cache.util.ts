import Keyv from 'keyv';

/**
 * A Map that never holds more than `max` entries: writing past the limit drops
 * the oldest-written entries first. In-memory Keyv stores only remove an
 * expired entry when it is read, so without a bound unread entries would pile
 * up for as long as the process runs.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly max: number) {
    super();
    if (!Number.isSafeInteger(max) || max < 1) throw new Error('Invalid cache size');
  }
  override set(key: K, value: V): this {
    // Re-inserting moves a rewritten key to the newest position.
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    while (this.size > this.max) this.delete(this.keys().next().value as K);
    return this;
  }
}

/** Options for CacheModule.register(): an in-memory store holding at most `max` entries. */
export function boundedCacheOptions(max: number) {
  return { stores: [new Keyv({ store: new BoundedMap(max) })] };
}
