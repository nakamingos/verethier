import { Injectable } from '@nestjs/common';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { OrdinalCollectionSnapshot } from '@/models/ordinal-collection.interface';
import { NftCheckContext } from './nft-ownership.service';
import { ordinalCollectionId } from '@/utils/ordinal-rule.util';
import { OrdnetUnavailableError } from '@/utils/ordnet-error.util';
import { OrdnetApiService } from './ordnet-api.service';

const PAGE_LIMIT = 100;
const MAX_PAGES = 200;

@Injectable()
export class OrdnetOwnershipService {
  constructor(private readonly api: OrdnetApiService) {}

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
    if (!context.ordinalCollections.has(key)) context.ordinalCollections.set(key, this.readCollection(id));
    return context.ordinalCollections.get(key);
  }

  private async readCollection(id: string): Promise<OrdinalCollectionSnapshot> {
    const items: OrdinalCollectionSnapshot['items'] = new Map();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), sort: 'oldest', ...(cursor ? { cursor } : {}) });
      const data = await this.api.get(`/collection/${id}/inscriptions?${params}`);
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
        return { slug: id, items };
      }
      if (!data.items.length || typeof pagination.nextCursor !== 'string' || !pagination.nextCursor
        || pagination.nextCursor.length > 4096 || cursors.has(pagination.nextCursor)) throw new OrdnetUnavailableError(`collection ${id}: empty continuing page or invalid/repeated cursor`);
      cursor = pagination.nextCursor;
      cursors.add(cursor);
    }
    throw new OrdnetUnavailableError(`collection ${id}: exceeded ${MAX_PAGES} pages`);
  }
}
