import { Injectable } from '@nestjs/common';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields, VerifierRole } from '@/models/verifier-role.interface';
import { normalizeBitcoinAddress } from '@/utils/wallet-address.util';
import { ordinalCollectionId } from '@/utils/ordinal-rule.util';
import { NftCheckContext } from './nft-ownership.service';

const API_URL = 'https://api.secretkeylabs.io';
const PAGE_LIMIT = 25;
const MAX_PAGES = 40;
const UNAVAILABLE = 'Ordinals verification is temporarily unavailable. Please try again.';
class XverseSummaryError extends Error {}

@Injectable()
export class OrdinalsOwnershipService {
  private requestTail: Promise<unknown> = Promise.resolve();
  private readonly collections = new Map<string, { expires: number; data: { id: string; name: string } }>();

  async prepareRule(slug: string): Promise<NftRuleFields & { slug: string }> {
    const collection = await this.getCollection(ordinalCollectionId(slug));
    return {
      asset_type: 'ordinal', slug: collection.id, chain_id: null,
      collection_name: collection.name, contract_address: null, token_standard: null, token_ids: null,
    };
  }

  async count(rule: VerifierRole, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    const collectionId = ordinalCollectionId(rule.slug);
    if ((rule.attribute_key && rule.attribute_key !== 'ALL') || (rule.attribute_value && rule.attribute_value !== 'ALL')) {
      throw new Error('Ordinals rules currently support collection ownership and quantity only.');
    }
    const addresses = [...new Set(wallets.map(normalizeBitcoinAddress))].sort();
    if (!addresses.length) return 0n;
    const run = context || { checks: new Map() };
    const key = JSON.stringify(['ordinal', collectionId, addresses]);
    if (!run.checks.has(key)) run.checks.set(key, this.readCount(collectionId, addresses, run));
    return run.checks.get(key);
  }

  private async readCount(collectionId: string, addresses: string[], context: NftCheckContext): Promise<bigint> {
    if (addresses.length === 1) {
      context.ordinalSummaries ||= new Map();
      const wallet = addresses[0];
      if (!context.ordinalSummaries.has(wallet)) context.ordinalSummaries.set(wallet, this.readSummary(wallet));
      try {
        return (await context.ordinalSummaries.get(wallet)).get(collectionId) || 0n;
      } catch (error) {
        if (!(error instanceof XverseSummaryError)) throw error;
        // Xverse returns 500 for some empty-wallet summaries. Require a complete
        // collection-specific response before deciding the wallet owns zero.
      }
    }
    // A count alone cannot deduplicate an inscription transferred between stacked wallets.
    context.ordinalIds ||= new Map();
    const ids = new Set<string>();
    for (const wallet of addresses) {
      const key = JSON.stringify([wallet, collectionId]);
      if (!context.ordinalIds.has(key)) context.ordinalIds.set(key, this.readIds(wallet, collectionId));
      for (const id of await context.ordinalIds.get(key)) ids.add(id);
    }
    return BigInt(ids.size);
  }

  private async readSummary(wallet: string): Promise<Map<string, bigint>> {
    const counts = new Map<string, bigint>();
    let total: number | undefined;
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request(`/v1/ordinals/address/${wallet}/collections?limit=${PAGE_LIMIT}&offset=${offset}`, false, true);
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

  private async readIds(wallet: string, collectionId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    let total: number | undefined;
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.request(`/v1/ordinals/address/${wallet}/inscriptions/collection/${encodeURIComponent(collectionId)}?limit=${PAGE_LIMIT}&offset=${offset}`);
      const currentTotal = this.integer(data.total);
      if (total !== undefined && total !== currentTotal) throw new Error(UNAVAILABLE);
      total = currentTotal;
      const limit = this.integer(data.limit);
      if (data.collectionId !== collectionId || !limit || limit > PAGE_LIMIT || data.offset !== offset
        || !Array.isArray(data.inscriptions) || data.inscriptions.length !== Math.min(limit, total - offset)) throw new Error(UNAVAILABLE);
      for (const item of data.inscriptions) {
        if (!/^[0-9a-f]{64}i\d+$/.test(item.id) || ids.has(item.id)
          || !/^[0-9a-f]{64}:\d+:\d+$/.test(item.currentLocation)) throw new Error(UNAVAILABLE);
        ids.add(item.id);
      }
      offset += data.inscriptions.length;
      if (offset === total && ids.size === total) return ids;
    }
    throw new Error(UNAVAILABLE);
  }

  private async getCollection(id: string): Promise<{ id: string; name: string }> {
    const cached = this.collections.get(id);
    if (cached && cached.expires > Date.now()) return cached.data;
    const data = await this.request(`/v1/ordinals/collections/${encodeURIComponent(id)}`, true);
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

  private request(path: string, setup = false, summary = false): Promise<any> {
    if (!EnvironmentConfig.XVERSE_API_KEY) {
      return Promise.reject(new Error('Ordinals verification is not configured. Set XVERSE_API_KEY on the backend.'));
    }
    const queuedAt = Date.now();
    const result = this.requestTail.then(async () => {
      if (Date.now() - queuedAt > 45000) throw new Error(UNAVAILABLE);
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
    // Serialize provider calls, including concurrent rules, below the trial's 100 requests/minute.
    this.requestTail = result.catch(() => undefined).then(() => new Promise(resolve => setTimeout(resolve, 650)));
    return result;
  }
}
