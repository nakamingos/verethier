import { Injectable, Logger, Optional } from '@nestjs/common';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields, VerifierRole } from '@/models/verifier-role.interface';
import { normalizeBitcoinAddress } from '@/utils/wallet-address.util';
import { buildOrdinalTraitSnapshot, matchesOrdinalTrait, ordinalCollectionId, ordinalTrait, ordinalTraitHash, ORDINAL_INSCRIPTION_ID, usableOrdinalTraitSnapshot } from '@/utils/ordinal-rule.util';
import { InscriptionCriteria } from '@/models/inscription-criteria.interface';
import { inscriptionCriteria, inscriptionCriteriaCapacity, parseInscriptionCriteria } from '@/utils/inscription-rule.util';
import { OrdinalCheckDetails, OrdinalTraitSnapshot } from '@/models/ordinal-collection.interface';
import { DbService } from './db.service';
import { NftCheckContext } from './nft-ownership.service';
import { OrdnetOwnershipService } from './ordnet-ownership.service';
import { OrdinalRequestWork, ordinalRequestWork, OrdinalsRequestScheduler } from './ordinals-request-scheduler.service';
import { OrdinalCollectionCacheService } from './ordinal-collection-cache.service';
import { OrdinalWalletInventoryService } from './ordinal-wallet-inventory.service';

const API_URL = 'https://api.secretkeylabs.io';
const PAGE_LIMIT = 25;
const MAX_PAGES = 40;
const UNAVAILABLE = 'Ordinals verification is temporarily unavailable. Please try again.';
class XverseSummaryError extends Error {}
class XverseConflictError extends Error {}

@Injectable()
export class OrdinalsOwnershipService {
  private readonly collections = new Map<string, { expires: number; data: { id: string; name: string } }>();
  private readonly collectionLookups = new Map<string, { data: Promise<{ id: string; name: string }>; work: OrdinalRequestWork }>();

  constructor(@Optional() private readonly ordnet?: OrdnetOwnershipService, @Optional() private readonly db?: DbService,
    @Optional() private readonly requests: OrdinalsRequestScheduler = new OrdinalsRequestScheduler(),
    @Optional() private readonly catalog?: OrdinalCollectionCacheService,
    @Optional() private readonly inventories?: OrdinalWalletInventoryService) {}

  async refreshScheduledCatalogs(context: NftCheckContext): Promise<void> {
    if (this.catalog && this.provider() === 'ordnet') await this.catalog.refreshScheduled(context);
  }

  async checkSetupHealth(rule: VerifierRole): Promise<void> {
    if (!inscriptionCriteria(rule) && this.provider(rule) === 'ordnet') {
      await this.ordnet.prepareRule(rule.slug);
    } else if (rule.slug) {
      await this.loadCollection(ordinalCollectionId(rule.slug), { priority: 'interactive' });
    } else {
      const criteria = inscriptionCriteria(rule);
      if (criteria?.kind !== 'ids') throw new Error('A wallet check is needed for number inventories.');
      await this.readOwners([criteria.ids[0]], { priority: 'interactive' });
    }
    if (ordinalTrait(rule).enabled && this.provider(rule) !== 'ordnet') await this.ordnet.prepareRule(rule.slug);
  }

  async refreshCollection(slug: string): Promise<{ slug: string; count: number; fetched_at: string }> {
    if (!this.catalog || this.provider() !== 'ordnet') throw new Error('Collection metadata refresh requires ORDINALS_PROVIDER=ordnet.');
    const catalog = await this.catalog.refresh(slug, { priority: 'background' });
    return { slug: catalog.slug, count: catalog.items.size, fetched_at: catalog.fetched_at };
  }

  private provider(rule?: Partial<VerifierRole>): 'xverse' | 'ordnet' {
    const provider = EnvironmentConfig.ORDINALS_PROVIDER;
    if (provider !== 'xverse' && provider !== 'ordnet') throw new Error('ORDINALS_PROVIDER must be xverse or ordnet.');
    // ord.net's documented ownership API is collection-scoped. Route these
    // unsupported lookups through the same provider layer to Xverse.
    if (rule && inscriptionCriteria(rule)) return 'xverse';
    if (provider === 'ordnet' && !this.ordnet) throw new Error('ord.net verification is not configured.');
    return provider;
  }

  async prepareRule(slug: string): Promise<NftRuleFields & { slug: string }> {
    const id = ordinalCollectionId(slug);
    const collection = this.provider() === 'ordnet' ? await this.ordnet.prepareRule(id) : await this.getCollection(id);
    return {
      asset_type: 'ordinal', slug: collection.id, chain_id: null,
      collection_name: collection.name, contract_address: null, token_standard: null, token_ids: null,
    };
  }

  async prepareInscriptionRule(ids: string | null, numbers: string | null, minItems: number): Promise<NftRuleFields & { slug: null }> {
    const criteria = parseInscriptionCriteria(ids, numbers);
    if (!criteria) throw new Error('Enter inscription_ids or inscription_numbers.');
    if (!Number.isSafeInteger(minItems) || minItems < 1 || BigInt(minItems) > inscriptionCriteriaCapacity(criteria)) {
      throw new Error('Minimum items cannot exceed the number of selected inscriptions.');
    }
    const fields: NftRuleFields & { slug: null } = {
      asset_type: 'ordinal', slug: null, chain_id: null, collection_name: null,
      contract_address: null, token_standard: null, token_ids: null, inscription_criteria: criteria,
    };
    this.provider(fields);
    if (!EnvironmentConfig.XVERSE_API_KEY) throw new Error('Specific inscription rules require XVERSE_API_KEY on the backend for lookup validation and fallback.');
    // Validate exact IDs before creating a Discord role. Number selections are
    // predicates, so they need no lookup or expansion during setup.
    if (criteria.kind === 'ids') await this.savedIdOwners(criteria.ids, { checks: new Map() });
    return fields;
  }

  async prepareTraitSnapshot(rule: NftRuleFields & { slug: string }): Promise<OrdinalTraitSnapshot> {
    if (!this.ordnet) throw new Error('Ordinals trait setup requires ord.net.');
    const snapshot = await this.liveTraitSnapshot(rule, { checks: new Map() });
    if (!snapshot.inscription_ids.length) throw new Error('No inscriptions match this attribute. Check the trait key and value.');
    return snapshot;
  }

  async suggestions(slug: string, key?: string): Promise<string[]> {
    if (!this.ordnet) return [];
    if (this.catalog && this.provider() === 'ordnet') return this.catalog.suggestions(slug, key);
    return this.ordnet.suggestions(ordinalCollectionId(slug), key);
  }

  private checkKey(rule: VerifierRole, addresses: string[]): string {
    const criteria = inscriptionCriteria(rule);
    if (criteria) return JSON.stringify(['ordinal', this.provider(rule), criteria, addresses]);
    const trait = ordinalTrait(rule);
    return JSON.stringify(['ordinal', this.provider(), ordinalCollectionId(rule.slug), addresses,
      ...(trait.enabled ? [rule.id, ordinalTraitHash(rule), rule.min_items || 1] : [])]);
  }

  checkDetails(rule: VerifierRole, wallets: string[], context: NftCheckContext): OrdinalCheckDetails | undefined {
    const addresses = [...new Set(wallets.map(normalizeBitcoinAddress))].sort();
    return context.ordinalDetails?.get(this.checkKey(rule, addresses));
  }

  async count(rule: VerifierRole, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    const criteria = inscriptionCriteria(rule);
    const collectionId = criteria ? null : ordinalCollectionId(rule.slug);
    const trait = ordinalTrait(rule);
    const addresses = [...new Set(wallets.map(normalizeBitcoinAddress))].sort();
    if (!addresses.length) return 0n;
    const run = context || { checks: new Map() };
    const provider = this.provider(rule);
    const key = this.checkKey(rule, addresses);
    if (!run.checks.has(key)) run.checks.set(key, this.inventories && (criteria || provider === 'ordnet')
      ? this.readCachedRule(rule, addresses, run, key)
      : criteria ? this.readSelection(criteria, addresses, run, key)
      : this.readRule(rule, collectionId, addresses, run, key, provider, trait.enabled));
    return run.checks.get(key);
  }

  async matchingAssets(rule: VerifierRole, wallets: string[], context: NftCheckContext): Promise<Map<string, bigint>> {
    const addresses = [...new Set(wallets.map(normalizeBitcoinAddress))].sort();
    if (!addresses.length) return new Map();
    if (!this.inventories) throw new Error(UNAVAILABLE);
    const criteria = inscriptionCriteria(rule);
    let catalog: Awaited<ReturnType<OrdinalCollectionCacheService['snapshot']>> | null = null;
    const trait = ordinalTrait(rule);
    if (!criteria) {
      try { catalog = await this.catalog.snapshot(rule.slug, context); }
      catch {
        // An outage must not force us to discard a complete, usable trait list.
        const snapshot = trait.enabled ? usableOrdinalTraitSnapshot(rule) : null;
        if (trait.enabled && !snapshot) throw new Error(UNAVAILABLE);
        const collectionId = ordinalCollectionId(rule.slug);
        await this.getCollection(collectionId, ordinalRequestWork(context));
        const ids = await this.walletIds(collectionId, addresses, context);
        return new Map([...ids].filter(id => !trait.enabled || snapshot.inscription_ids.includes(id)).map(id => [id, 1n]));
      }
    }
    const matching = new Map<string, bigint>();
    for (const wallet of addresses) {
      const inventory = await this.inventories.inventory(wallet, context, criteria?.kind === 'numbers',
        (address, work) => this.readInventory(address, work));
      if (criteria?.kind === 'numbers' && inventory.numbers?.size !== inventory.ids.size) throw new Error(UNAVAILABLE);
      for (const id of inventory.ids) {
        const item = catalog?.items.get(id);
        const matches = criteria?.kind === 'ids' ? criteria.ids.includes(id)
          : criteria?.kind === 'numbers' ? criteria.ranges.some(([start, end]) => inventory.numbers.get(id) >= start && inventory.numbers.get(id) <= end)
          : item && (!trait.enabled || matchesOrdinalTrait(item.traits, rule));
        if (matches) matching.set(id, 1n);
      }
    }
    return matching;
  }

  private async readCachedRule(rule: VerifierRole, addresses: string[], context: NftCheckContext, key: string): Promise<bigint> {
    const criteria = inscriptionCriteria(rule);
    const catalog = criteria ? null : await this.catalog.snapshot(rule.slug, context);
    const traits = criteria ? null : ordinalTrait(rule);
    const owned = new Set<string>();
    const numbers = new Map<string, number>();
    const providers = new Set<OrdinalCheckDetails['provider']>();
    for (const wallet of addresses) {
      const inventory = await this.inventories.inventory(wallet, context, criteria?.kind === 'numbers',
        (address, work) => this.readInventory(address, work));
      providers.add(inventory.provider);
      for (const id of inventory.ids) owned.add(id);
      if (inventory.numbers) for (const [id, number] of inventory.numbers) {
        if (numbers.has(id) && numbers.get(id) !== number) throw new Error(UNAVAILABLE);
        numbers.set(id, number);
      }
    }
    this.detail(context, key, { provider: providers.size === 1 ? [...providers][0] : 'mixed',
      source: catalog ? 'collection-cache' : 'live', ...(catalog ? { snapshot_fetched_at: catalog.fetched_at } : {}) });
    if (criteria?.kind === 'ids') return BigInt(criteria.ids.filter(id => owned.has(id)).length);
    if (criteria?.kind === 'numbers') {
      if (numbers.size !== owned.size) throw new Error(UNAVAILABLE);
      return BigInt([...numbers.values()].filter(number => criteria.ranges.some(([start, end]) => number >= start && number <= end)).length);
    }
    let count = 0n;
    for (const id of owned) {
      const item = catalog.items.get(id);
      if (item && (!traits.enabled || matchesOrdinalTrait(item.traits, rule))) count++;
    }
    return count;
  }

  private async readSelection(criteria: InscriptionCriteria, addresses: string[], context: NftCheckContext, key: string): Promise<bigint> {
    this.detail(context, key, { provider: 'xverse', source: 'live' });
    if (criteria.kind === 'ids') {
      const owners = await this.savedIdOwners(criteria.ids, context);
      const wallets = new Set(addresses);
      return BigInt([...owners.values()].filter(owner => wallets.has(owner)).length);
    }
    context.ordinalInventories ||= new Map();
    const inscriptions = new Map<string, number>();
    // Read once per wallet/run and share the complete inventory with all number
    // rules. Bounds stay compact even for a sub-100k or larger selection.
    for (const wallet of addresses) {
      if (!context.ordinalInventories.has(wallet)) context.ordinalInventories.set(wallet, this.readInventory(wallet, ordinalRequestWork(context)));
      for (const [id, number] of await context.ordinalInventories.get(wallet)) {
        if (inscriptions.has(id) && inscriptions.get(id) !== number) throw new Error(UNAVAILABLE);
        inscriptions.set(id, number);
      }
    }
    return BigInt([...inscriptions.values()].filter(number => criteria.ranges.some(([start, end]) => number >= start && number <= end)).length);
  }

  private async readInventory(wallet: string, work: OrdinalRequestWork): Promise<Map<string, number>> {
    const items = new Map<string, number>();
    const numbers = new Set<number>();
    let offset = 0;
    let total: number | undefined;
    for (let page = 0; page <= MAX_PAGES; page++) {
      const data = await this.request(`/v1/ordinals/address/${wallet}/inscriptions?limit=${PAGE_LIMIT}&offset=${offset}`, false, false, work);
      if (!data || !Array.isArray(data.items) || data.offset !== offset) throw new Error(UNAVAILABLE);
      const limit = this.integer(data.limit);
      // Live responses are paginated despite older full-list documentation.
      // Require consistent pages and a complete final page before using zero.
      if (limit > PAGE_LIMIT || data.items.length > limit || (!limit && (offset > 0 || data.items.length))) throw new Error(UNAVAILABLE);
      if (data.total != null) {
        const currentTotal = this.integer(data.total);
        if (total !== undefined && total !== currentTotal) throw new Error(UNAVAILABLE);
        total = currentTotal;
        if (total > PAGE_LIMIT * MAX_PAGES) throw new Error(UNAVAILABLE);
        if (data.items.length !== Math.min(limit, total - offset)) throw new Error(UNAVAILABLE);
      }
      for (const item of data.items) {
        if (!item || typeof item.id !== 'string' || !ORDINAL_INSCRIPTION_ID.test(item.id) || items.has(item.id)
          || !Number.isSafeInteger(item.number) || numbers.has(item.number)
          || typeof item.currentAddress !== 'string' || normalizeBitcoinAddress(item.currentAddress) !== wallet
          || item.currentAddress !== item.currentAddress.trim()
          || !/^[0-9a-f]{64}:\d+$/.test(item.currentOutput)) throw new Error(UNAVAILABLE);
        items.set(item.id, item.number);
        numbers.add(item.number);
      }
      offset += data.items.length;
      if (items.size > PAGE_LIMIT * MAX_PAGES) throw new Error(UNAVAILABLE);
      if (total !== undefined && offset === total) return items;
      if (data.items.length < limit || !limit) {
        if (total !== undefined) throw new Error(UNAVAILABLE);
        return items;
      }
    }
    throw new Error(UNAVAILABLE);
  }

  private async liveTraitSnapshot(rule: Partial<VerifierRole>, context: NftCheckContext): Promise<OrdinalTraitSnapshot> {
    context.ordinalSnapshots ||= new Map();
    const key = ordinalTraitHash(rule);
    if (!context.ordinalSnapshots.has(key)) context.ordinalSnapshots.set(key,
      (this.catalog && this.provider() === 'ordnet' ? this.catalog.snapshot(rule.slug, context)
        : this.ordnet.snapshot(rule.slug, context)).then(collection => buildOrdinalTraitSnapshot(rule, collection)));
    return context.ordinalSnapshots.get(key);
  }

  private detail(context: NftCheckContext, key: string, detail: OrdinalCheckDetails) {
    context.ordinalDetails ||= new Map();
    context.ordinalDetails.set(key, detail);
  }

  private async readRule(rule: VerifierRole, collectionId: string, addresses: string[], context: NftCheckContext,
    key: string, provider: 'xverse' | 'ordnet', traits: boolean): Promise<bigint> {
    if (provider === 'ordnet') {
      this.detail(context, key, { provider: 'ordnet', source: 'live' });
      try {
        if (!traits) return await this.ordnet.count(collectionId, addresses, context);
        const snapshot = await this.liveTraitSnapshot(rule, context);
        // Refresh only after a complete trait scan. Ownership stays ephemeral.
        rule.ordinal_trait_snapshot = snapshot;
        if (this.db && rule.id != null) {
          context.ordinalSnapshotWrites ||= new Map();
          const writeKey = JSON.stringify([rule.id, snapshot.criteria_hash, snapshot.fetched_at]);
          if (!context.ordinalSnapshotWrites.has(writeKey)) context.ordinalSnapshotWrites.set(writeKey,
            this.db.cacheOrdinalTraitSnapshot(rule, snapshot).catch(() => Logger.warn('Ordinals trait snapshot could not be saved; live verification continues.')));
          await context.ordinalSnapshotWrites.get(writeKey);
        }
        const collection = await this.ordnet.snapshot(collectionId, context);
        const owners = new Set(addresses);
        let count = 0n;
        for (const id of snapshot.inscription_ids) {
          const owner = collection.items.get(id).owner;
          if (owner === null) throw new Error(UNAVAILABLE);
          if (owners.has(owner)) count++;
        }
        return count;
      } catch (error) {
        if (!EnvironmentConfig.XVERSE_API_KEY) throw error;
      }
    }
    this.detail(context, key, { provider: 'xverse', source: traits ? 'trait-snapshot' : 'live' });
    // Xverse must recognize the exact collection before absence can mean zero.
    if (provider === 'ordnet' || traits) await this.getCollection(collectionId, ordinalRequestWork(context));
    if (!traits) return this.readCount(collectionId, addresses, context);
    return this.readTraitFallback(rule, collectionId, addresses, context, key);
  }

  private async walletIds(collectionId: string, addresses: string[], context: NftCheckContext): Promise<Set<string>> {
    context.ordinalIds ||= new Map();
    const ids = new Set<string>();
    for (const wallet of addresses) {
      const key = JSON.stringify([wallet, collectionId]);
      if (!context.ordinalIds.has(key)) context.ordinalIds.set(key, this.readIds(wallet, collectionId, ordinalRequestWork(context)));
      for (const id of await context.ordinalIds.get(key)) ids.add(id);
    }
    return ids;
  }

  private async readTraitFallback(rule: VerifierRole, collectionId: string, addresses: string[], context: NftCheckContext, key: string): Promise<bigint> {
    const snapshot = usableOrdinalTraitSnapshot(rule);
    if (snapshot) {
      try {
        let count = 0n;
        if (context.ordinalMode === 'scheduled') {
          const owners = await this.savedIdOwners(snapshot.inscription_ids, context);
          const wallets = new Set(addresses);
          for (const owner of owners.values()) if (wallets.has(owner)) count++;
        } else {
          const owned = await this.walletIds(collectionId, addresses, context);
          for (const id of snapshot.inscription_ids) if (owned.has(id)) count++;
        }
        if (count >= BigInt(rule.min_items || 1)) {
          // Large scheduled batches may outlive the snapshot's remaining age.
          if (!usableOrdinalTraitSnapshot({ ...rule, ordinal_trait_snapshot: snapshot })) throw new Error(UNAVAILABLE);
          // If another rule already fetched this wallet's collection count,
          // contradictory ownership responses must not grant or revoke a role.
          for (const wallet of addresses) {
            const summary = context.ordinalSummaries?.get(wallet);
            if (summary) {
              let counts: Map<string, bigint>;
              try { counts = await summary; } catch { continue; }
              let matches = 0n;
              if (context.ordinalMode === 'scheduled') {
                for (const id of snapshot.inscription_ids) if (await context.ordinalOwners.get(id) === wallet) matches++;
              } else {
                const ids = await context.ordinalIds.get(JSON.stringify([wallet, collectionId]));
                for (const id of snapshot.inscription_ids) if (ids.has(id)) matches++;
              }
              if (matches > (counts.get(collectionId) || 0n)) throw new XverseConflictError(UNAVAILABLE);
            }
            if (context.ordinalMode === 'scheduled') {
              const knownIds = context.ordinalIds?.get(JSON.stringify([wallet, collectionId]));
              if (knownIds) {
                let ids: Set<string>;
                try { ids = await knownIds; } catch { continue; }
                for (const id of snapshot.inscription_ids) {
                  if (await context.ordinalOwners.get(id) === wallet && !ids.has(id)) throw new XverseConflictError(UNAVAILABLE);
                }
              }
            }
          }
          this.detail(context, key, { provider: 'xverse', source: 'trait-snapshot', snapshot_fetched_at: snapshot.fetched_at });
          return count;
        }
      } catch (error) {
        if (error instanceof XverseConflictError) throw error;
        // An incomplete snapshot ownership check cannot prove ineligibility.
      }
    }
    // A complete collection count is an upper bound on matching trait items.
    // A missing cached ID could have been replaced by a newly matching item.
    const total = await this.readCount(collectionId, addresses, context);
    if (total < BigInt(rule.min_items || 1)) {
      this.detail(context, key, { provider: 'xverse', source: 'collection-upper-bound' });
      return total;
    }
    throw new Error(UNAVAILABLE);
  }

  private async savedIdOwners(ids: string[], context: NftCheckContext): Promise<Map<string, string>> {
    context.ordinalOwners ||= new Map();
    const missing = ids.filter(id => !context.ordinalOwners.has(id));
    let tail: Promise<unknown> = Promise.resolve();
    // Publish pending lookups before awaiting to share overlapping concurrent rules.
    for (let start = 0; start < missing.length; start += PAGE_LIMIT) {
      const chunk = missing.slice(start, start + PAGE_LIMIT);
      // Queue one chunk at a time so large trait lists cannot expire while
      // waiting behind hundreds of provider requests.
      const batch = tail.then(() => this.readOwners(chunk, ordinalRequestWork(context)));
      tail = batch;
      for (const id of chunk) {
        const owner = batch.then(result => result.get(id));
        owner.catch(() => undefined); // The caller awaits every result below.
        context.ordinalOwners.set(id, owner);
      }
    }
    return new Map(await Promise.all(ids.map(async id => [id, await context.ordinalOwners.get(id)] as const)));
  }

  private async readOwners(ids: string[], work: OrdinalRequestWork): Promise<Map<string, string>> {
    const data = await this.request('/v1/inscriptions/batch?' + new URLSearchParams({ inscriptionIds: ids.join(',') }), false, false, work);
    if (!Array.isArray(data) || data.length !== ids.length) throw new Error(UNAVAILABLE);
    const requested = new Set(ids);
    const owners = new Map<string, string>();
    for (const item of data) {
      if (!item || !requested.has(item.id) || owners.has(item.id) || typeof item.currentAddress !== 'string'
        || item.currentAddress !== item.currentAddress.trim()) throw new Error(UNAVAILABLE);
      try { bitcoinAddress.toOutputScript(item.currentAddress, networks.bitcoin); }
      catch { throw new Error(UNAVAILABLE); }
      owners.set(item.id, /^bc1/i.test(item.currentAddress) ? item.currentAddress.toLowerCase() : item.currentAddress);
    }
    return owners;
  }

  private async readCount(collectionId: string, addresses: string[], context: NftCheckContext): Promise<bigint> {
    if (context.ordinalIds?.has(JSON.stringify([addresses[0], collectionId]))) {
      return BigInt((await this.walletIds(collectionId, addresses, context)).size);
    }
    if (addresses.length === 1) {
      context.ordinalSummaries ||= new Map();
      const wallet = addresses[0];
      if (!context.ordinalSummaries.has(wallet)) context.ordinalSummaries.set(wallet, this.readSummary(wallet, ordinalRequestWork(context)));
      try {
        return (await context.ordinalSummaries.get(wallet)).get(collectionId) || 0n;
      } catch (error) {
        if (!(error instanceof XverseSummaryError)) throw error;
        // Xverse returns 500 for some empty-wallet summaries. Require a complete
        // collection-specific response before deciding the wallet owns zero.
      }
    }
    // A count alone cannot deduplicate an inscription transferred between stacked wallets.
    return BigInt((await this.walletIds(collectionId, addresses, context)).size);
  }

  private async readSummary(wallet: string, work: OrdinalRequestWork): Promise<Map<string, bigint>> {
    const counts = new Map<string, bigint>();
    let total: number | undefined;
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request(`/v1/ordinals/address/${wallet}/collections?limit=${PAGE_LIMIT}&offset=${offset}`, false, true, work);
      const currentTotal = this.integer(data.totalCollections);
      if (total !== undefined && total !== currentTotal) throw new Error(UNAVAILABLE);
      total = currentTotal;
      const limit = this.integer(data.limit);
      if (!limit || limit > PAGE_LIMIT || data.offset !== offset || !Array.isArray(data.items)
        || data.items.length !== Math.min(limit, total - offset)) throw new Error(UNAVAILABLE);
      for (const item of data.items) {
        const id = ordinalCollectionId(item.id);
        if (counts.has(id)) throw new Error(UNAVAILABLE);
        counts.set(id, BigInt(this.integer(item.total)));
      }
      offset += data.items.length;
      if (offset === total && counts.size === total) return counts;
    }
    throw new Error(UNAVAILABLE);
  }

  private async readIds(wallet: string, collectionId: string, work: OrdinalRequestWork): Promise<Set<string>> {
    const ids = new Set<string>();
    let total: number | undefined;
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request(`/v1/ordinals/address/${wallet}/inscriptions/collection/${encodeURIComponent(collectionId)}?limit=${PAGE_LIMIT}&offset=${offset}`, false, false, work);
      const currentTotal = this.integer(data.total);
      if (total !== undefined && total !== currentTotal) throw new Error(UNAVAILABLE);
      total = currentTotal;
      const limit = this.integer(data.limit);
      if (data.collectionId !== collectionId || !limit || limit > PAGE_LIMIT || data.offset !== offset
        || !Array.isArray(data.inscriptions) || data.inscriptions.length !== Math.min(limit, total - offset)) throw new Error(UNAVAILABLE);
      for (const item of data.inscriptions) {
        if (!item || !ORDINAL_INSCRIPTION_ID.test(item.id) || ids.has(item.id)
          || !/^[0-9a-f]{64}:\d+:\d+$/.test(item.currentLocation)) throw new Error(UNAVAILABLE);
        ids.add(item.id);
      }
      offset += data.inscriptions.length;
      if (offset === total && ids.size === total) return ids;
    }
    throw new Error(UNAVAILABLE);
  }

  private async getCollection(id: string, work: OrdinalRequestWork = { priority: 'interactive' }): Promise<{ id: string; name: string }> {
    const cached = this.collections.get(id);
    if (cached && cached.expires > Date.now()) return cached.data;
    const pending = this.collectionLookups.get(id);
    if (pending) {
      if (work.priority === 'interactive') this.requests.promote(pending.work);
      return pending.data;
    }
    const lookupWork = { priority: work.priority };
    const lookup = this.loadCollection(id, lookupWork);
    this.collectionLookups.set(id, { data: lookup, work: lookupWork });
    lookup.then(() => this.collectionLookups.delete(id), () => this.collectionLookups.delete(id));
    return lookup;
  }

  private async loadCollection(id: string, work: OrdinalRequestWork): Promise<{ id: string; name: string }> {
    const data = await this.request(`/v1/ordinals/collections/${encodeURIComponent(id)}`, true, false, work);
    if (data.id !== id || typeof data.name !== 'string' || !data.name.trim()) throw new Error(UNAVAILABLE);
    const collection = { id, name: data.name.trim().slice(0, 100) };
    if (this.collections.size >= 200) this.collections.clear();
    this.collections.set(id, { expires: Date.now() + 300000, data: collection });
    return collection;
  }

  private integer(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(UNAVAILABLE);
    return value;
  }

  private request(path: string, setup = false, summary = false, work: OrdinalRequestWork = { priority: 'interactive' }): Promise<any> {
    if (!EnvironmentConfig.XVERSE_API_KEY) {
      return Promise.reject(new Error('Ordinals verification is not configured. Set XVERSE_API_KEY on the backend.'));
    }
    return this.requests.enqueue('xverse', work, async queueWait => {
      if (queueWait > 45000) throw new Error(UNAVAILABLE);
      for (let attempt = 0; attempt < 3; attempt++) {
        let retryDelay = 1000 * (attempt + 1);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(API_URL + path, {
            headers: { 'x-api-key': EnvironmentConfig.XVERSE_API_KEY, Accept: 'application/json' },
            signal: controller.signal, redirect: 'error',
          });
          if (setup && response.status === 404) throw new Error('This collection was not found on Xverse. Check its collection slug.');
          if (response.ok) return await response.json();
          if (summary && response.status === 500) throw new XverseSummaryError(UNAVAILABLE);
          if (response.status !== 429 && response.status < 500) throw new Error(UNAVAILABLE);
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) retryDelay = Math.min(retryAfter * 1000, 3000);
        } catch (error) {
          if (error instanceof XverseSummaryError || error.message?.includes('not found on Xverse') || error.message === UNAVAILABLE) throw error;
          if (attempt === 2) throw new Error(UNAVAILABLE);
        } finally {
          clearTimeout(timeout);
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      throw new Error(UNAVAILABLE);
    });
  }
}
