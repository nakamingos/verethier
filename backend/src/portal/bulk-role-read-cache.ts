import { OrdinalCollectionSnapshot } from '@/models/ordinal-collection.interface';
import { NftCheckContext } from '@/services/nft-ownership.service';

const FRESH_MS = 60_000;
type Read = { promise: Promise<OrdinalCollectionSnapshot>; expires: number; failed: boolean };
type Window = { touched: number; collections: Map<string, Read> };

/** Only public collection responses are shared; member wallets/blocks stay local. */
export class BulkRoleReadCache {
  private readonly windows = new Map<string, Window>();

  member(key: string) {
    for (const [id, window] of this.windows) {
      for (const [slug,read] of window.collections) if(read.expires<=Date.now())window.collections.delete(slug);
      if (!window.collections.size && Date.now() - window.touched > 5 * 60_000) this.windows.delete(id);
    }
    let window = this.windows.get(key);
    if (!window) {
      if (this.windows.size >= 12) this.windows.delete(this.windows.keys().next().value);
      window = { touched: Date.now(), collections: new Map() };
      this.windows.set(key, window);
    }
    window.touched = Date.now();
    const used = new Set<Read>();
    const context: NftCheckContext = {
      checks: new Map(), ordinalMode: 'scheduled',
      ordinalCollectionRead: (slug, load) => {
        let read = window.collections.get(slug);
        if (!read || read.expires <= Date.now()) {
          const promise = load();
          read = { promise, expires: Infinity, failed: false };
          const entry = read;
          window.collections.set(slug, entry);
          // Reuse only after all pages have completed; in-flight scans share too.
          void promise.then(() => { entry.expires = Date.now() + FRESH_MS; }, () => {
            entry.failed = true; entry.expires = 0;
            if (window.collections.get(slug) === entry) window.collections.delete(slug);
          });
        }
        used.add(read);
        return read.promise;
      },
    };
    return { context, isFresh: () => [...used].every(read => read.failed || read.expires > Date.now()) };
  }

  clear(jobId: string) {
    for (const key of this.windows.keys()) if (key.startsWith(jobId + ':')) this.windows.delete(key);
  }
}

/** Bounded prefetching with results consumed in the original role order. */
export function bulkRoleChecks<T>(ids: string[], check: (id: string) => Promise<T>, limit = 3) {
  let next = 0, stopped = false;
  const deferred = ids.map(id => {
    let resolve: (value: { value?: T; error?: unknown; stopped?: boolean }) => void;
    const promise = new Promise<{ value?: T; error?: unknown; stopped?: boolean }>(done => { resolve = done; });
    return { id, promise, resolve: value => resolve(value) };
  });
  const done = Promise.all(Array.from({ length: Math.min(limit, ids.length) }, async () => {
    while (next < deferred.length) {
      const item = deferred[next++];
      if (stopped) { item.resolve({ stopped: true }); continue; }
      try { item.resolve({ value: await check(item.id) }); }
      catch (error) { item.resolve({ error }); }
    }
  }));
  return { results: new Map(deferred.map(item => [item.id, item.promise])), stop: () => { stopped = true; }, done };
}
