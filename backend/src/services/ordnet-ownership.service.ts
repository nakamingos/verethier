import { Injectable, Optional } from '@nestjs/common';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { OrdinalCollectionSnapshot } from '@/models/ordinal-collection.interface';
import { NftCheckContext } from './nft-ownership.service';
import { ordinalCollectionId } from '@/utils/ordinal-rule.util';
import { OrdnetUnavailableError } from '@/utils/ordnet-error.util';
import { OrdnetApiService } from './ordnet-api.service';
import { OrdinalRequestWork, ordinalRequestWork, OrdinalsRequestScheduler } from './ordinals-request-scheduler.service';

const PAGE_LIMIT = 100;
const MAX_PAGES = 200;
const TRAIT_MENU_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type TraitItem = { traits?: Array<{ type: string; value: string }> | null };
type TraitSuggestions = Map<string, Set<string>>;
type CollectionScan = {
  work: OrdinalRequestWork;
  items: OrdinalCollectionSnapshot['items'];
  listeners: Set<(items: Iterable<TraitItem>) => void>;
  result: Promise<OrdinalCollectionSnapshot>;
};

@Injectable()
export class OrdnetOwnershipService {
  private readonly traitSuggestions = new Map<string, { expires: number; traits: Promise<TraitSuggestions> }>();
  private readonly scans = new Map<string, CollectionScan>();
  constructor(private readonly api: OrdnetApiService, @Optional() private readonly requests?: OrdinalsRequestScheduler) {}

  async suggestions(slug: string, key?: string): Promise<string[]> {
    const id = ordinalCollectionId(slug);
    let cached = this.traitSuggestions.get(id);
    if (!cached || cached.expires <= Date.now()) {
      const values: TraitSuggestions = new Map();
      let firstPage: (traits: TraitSuggestions) => void;
      let failed: (error: unknown) => void;
      const traits = new Promise<TraitSuggestions>((resolve, reject) => {
        firstPage = resolve;
        failed = reject;
      });
      if (this.traitSuggestions.size >= 100) this.traitSuggestions.clear();
      // Keep one shared scan alive while it fills the cache, even for large collections.
      cached = { expires: Infinity, traits };
      this.traitSuggestions.set(id, cached);
      const entry = cached;
      // Return the first page promptly, then add rare values from the remaining pages.
      void this.collectionScan(id, { priority: 'background' }, items => {
        this.suggestionMap(items, values);
        firstPage(values);
      }).then(collection => {
        // A join after the last page (including an empty collection) may miss its callback.
        this.suggestionMap(collection.items.values(), values);
        firstPage(values);
        if (this.traitSuggestions.get(id) === entry) entry.expires = Date.now() + TRAIT_MENU_TTL_MS;
      }, error => {
        if (this.traitSuggestions.get(id) === entry) this.traitSuggestions.delete(id);
        failed(error);
      });
    }
    const traits = await cached.traits;
    if (!key) return [...traits.keys()].sort((a, b) => a.localeCompare(b));
    const values = new Set<string>();
    for (const [type, entries] of traits) if (type.toLowerCase() === key.trim().toLowerCase()) {
      for (const value of entries) values.add(value);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }

  private suggestionMap(items: Iterable<TraitItem>, result: TraitSuggestions = new Map()): TraitSuggestions {
    for (const item of items) for (const trait of item.traits || []) {
      if (typeof trait?.type !== 'string' || typeof trait.value !== 'string') continue;
      const key = trait.type.trim();
      const value = trait.value.trim();
      if (!key || !value || key.length > 100 || value.length > 100) continue;
      if (!result.has(key) && result.size < 100) result.set(key, new Set());
      const values = result.get(key);
      if (values) values.add(value);
    }
    return result;
  }

  async prepareRule(slug: string): Promise<{ id: string; name: string }> {
    const id = ordinalCollectionId(slug);
    const data = await this.api.get('/collection-stats/floors?' + new URLSearchParams({ slugs: id }));
    if (data?.success !== true || !Array.isArray(data.data) || data.data.length > 1) throw new OrdnetUnavailableError('invalid collection lookup response');
    if (!data.data.length) throw new Error('This collection was not found on ord.net. Check its collection slug.');
    if (data.data[0]?.slug !== id) throw new OrdnetUnavailableError('collection lookup returned a different slug');
    // The public API documents canonical slugs but no collection display-name endpoint.
    return { id, name: id };
  }

  async count(slug: string, wallets: string[], context: NftCheckContext): Promise<bigint> {
    const collection = await this.snapshot(slug, context);
    const addresses = new Set(wallets);
    let count = 0n;
    for (const item of collection.items.values()) {
      // A null owner means unknown ownership, not a verified non-holder or burn.
      if (item.owner === null) throw new OrdnetUnavailableError(`collection ${collection.slug} contains an unknown owner`);
      if (addresses.has(item.owner)) count++;
    }
    return count;
  }

  snapshot(slug: string, context: NftCheckContext): Promise<OrdinalCollectionSnapshot> {
    const id = ordinalCollectionId(slug);
    context.ordinalCollections ||= new Map();
    const key = JSON.stringify(['ordnet', id]);
    if (!context.ordinalCollections.has(key)) context.ordinalCollections.set(key, this.collectionScan(id, ordinalRequestWork(context)));
    return context.ordinalCollections.get(key);
  }

  promoteScan(slug: string): void {
    const scan = this.scans.get(ordinalCollectionId(slug));
    if (scan) {
      this.requests?.promote(scan.work);
      scan.work.priority = 'interactive';
    }
  }

  private collectionScan(id: string, work: OrdinalRequestWork, onPage?: (items: Iterable<TraitItem>) => void): Promise<OrdinalCollectionSnapshot> {
    let scan = this.scans.get(id);
    if (scan) {
      if (work.priority === 'interactive') {
        this.requests?.promote(scan.work);
        scan.work.priority = 'interactive';
      }
      if (onPage) {
        scan.listeners.add(onPage);
        // An autocomplete request joining midway must also see earlier pages.
        if (scan.items.size) onPage(scan.items.values());
      }
      return scan.result;
    }
    scan = { work: { priority: work.priority }, items: new Map(), listeners: new Set(onPage ? [onPage] : []), result: undefined };
    this.scans.set(id, scan);
    const entry = scan;
    scan.result = this.readCollection(id, scan).then(collection => {
      if (this.traitSuggestions.size >= 100) this.traitSuggestions.clear();
      this.traitSuggestions.set(id, {
        expires: Date.now() + TRAIT_MENU_TTL_MS,
        traits: Promise.resolve(this.suggestionMap(collection.items.values())),
      });
      return collection;
    }).finally(() => {
      // Completed ownership is retained only by its existing run contexts.
      // A later independent verification starts a fresh scan, including after errors.
      if (this.scans.get(id) === entry) this.scans.delete(id);
    });
    return scan.result;
  }

  private async readCollection(id: string, scan: CollectionScan): Promise<OrdinalCollectionSnapshot> {
    const fetchedAt = new Date().toISOString();
    const items = scan.items;
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), sort: 'oldest', ...(cursor ? { cursor } : {}) });
      const data = await this.api.get(`/collection/${id}/inscriptions?${params}`, scan.work);
      const pagination = data?.pagination;
      if (!Array.isArray(data?.items) || data.items.length > PAGE_LIMIT || !pagination
        || !Number.isSafeInteger(pagination.pageSize) || pagination.pageSize < 1 || pagination.pageSize > PAGE_LIMIT
        || data.items.length > pagination.pageSize || typeof pagination.hasNext !== 'boolean') throw new OrdnetUnavailableError(`collection ${id}: invalid page ${page + 1} pagination`);
      for (const item of data.items) {
        if (!item || !/^[0-9a-f]{64}i\d+$/.test(item.inscriptionId) || item.id !== item.inscriptionId) {
          throw new OrdnetUnavailableError(`collection ${id}: invalid inscription identifier on page ${page + 1}`);
        }
        // The live API's card payload can leave supplemental memberships empty.
        // The explicit collection slug identifies the collection being returned.
        if (item.collection !== id || !Array.isArray(item.collections)) {
          throw new OrdnetUnavailableError(`collection ${id}: invalid collection fields on page ${page + 1}`);
        }
        if (items.has(item.inscriptionId)) throw new OrdnetUnavailableError(`collection ${id}: duplicate inscription across pages`);
        let owner: string | null = null;
        if (item.owner !== null) {
          if (typeof item.owner !== 'string' || item.owner !== item.owner.trim()) throw new OrdnetUnavailableError(`collection ${id}: invalid owner on page ${page + 1}`);
          try { bitcoinAddress.toOutputScript(item.owner, networks.bitcoin); }
          catch { throw new OrdnetUnavailableError(`collection ${id}: invalid owner address on page ${page + 1}`); }
          owner = /^bc1/i.test(item.owner) ? item.owner.toLowerCase() : item.owner;
        }
        const traits = Array.isArray(item.traits) && item.traits.every(trait => trait && typeof trait.type === 'string'
          && trait.type.trim() && typeof trait.value === 'string' && trait.value.trim())
          ? item.traits.map(trait => ({ type: trait.type, value: trait.value })) : null;
        items.set(item.inscriptionId, { owner, traits });
      }
      if (!pagination.hasNext) {
        if (pagination.nextCursor !== null) throw new OrdnetUnavailableError(`collection ${id}: final page has an unexpected cursor`);
        for (const listener of scan.listeners) listener(data.items);
        return { slug: id, items, fetched_at: fetchedAt };
      }
      if (!data.items.length || typeof pagination.nextCursor !== 'string' || !pagination.nextCursor
        || pagination.nextCursor.length > 4096 || cursors.has(pagination.nextCursor)) throw new OrdnetUnavailableError(`collection ${id}: empty continuing page or invalid/repeated cursor`);
      for (const listener of scan.listeners) listener(data.items);
      cursor = pagination.nextCursor;
      cursors.add(cursor);
    }
    throw new OrdnetUnavailableError(`collection ${id}: exceeded ${MAX_PAGES} pages`);
  }
}
