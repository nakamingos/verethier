import { Injectable } from '@nestjs/common';
import { EthscriptionOwnership } from '@/models/ethscription-ownership.interface';
import { InscriptionCriteria } from '@/models/inscription-criteria.interface';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { ETHSCRIPTION_ID, inscriptionCriteriaCapacity, parseInscriptionCriteria } from '@/utils/inscription-rule.util';
import { NftCheckContext } from './nft-ownership.service';

const API_URL = 'https://api.ethscriptions.com/v2';
const MARKET = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PAGE_SIZE = 50;
const MAX_ITEMS = 1000;
const UNAVAILABLE = 'Ethscriptions verification is temporarily unavailable. Please try again.';

/** Global ID/number rules use the protocol index, including uncollected assets. */
@Injectable()
export class EthscriptionsOwnershipService {
  private requestTail: Promise<unknown> = Promise.resolve();

  async prepareInscriptionRule(ids: string | null, numbers: string | null, minItems: number): Promise<NftRuleFields & { slug: null }> {
    const criteria = parseInscriptionCriteria(ids, numbers, 'ethscription');
    if (!criteria) throw new Error('Enter inscription_ids or inscription_numbers.');
    if (!Number.isSafeInteger(minItems) || minItems < 1 || BigInt(minItems) > inscriptionCriteriaCapacity(criteria)) {
      throw new Error('Minimum items cannot exceed the number of selected inscriptions.');
    }
    if (criteria.kind === 'ids') await this.selectionOwners(criteria.ids, { checks: new Map() });
    return { asset_type: 'ethscription', slug: null, chain_id: 1, collection_name: null,
      contract_address: null, token_standard: null, token_ids: null, inscription_criteria: criteria };
  }

  async countSelection(wallets: string[], criteria: InscriptionCriteria, context: NftCheckContext): Promise<bigint> {
    return BigInt((await this.matchingIds(wallets, criteria, context)).length);
  }

  async matchingIds(wallets: string[], criteria: InscriptionCriteria, context: NftCheckContext): Promise<string[]> {
    const addresses = [...new Set(wallets.map(wallet => wallet.toLowerCase()))].sort();
    if (addresses.some(wallet => !ADDRESS.test(wallet))) throw new Error(UNAVAILABLE);
    if (!addresses.length) return [];
    const linked = new Set(addresses);
    if (criteria.kind === 'ids') {
      const owners = await this.selectionOwners(criteria.ids, context);
      return [...owners].filter(([, record]) => this.owned(record, linked)).map(([id]) => id);
    }
    context.ethscriptionInventories ||= new Map();
    const selected = new Map<string, number>();
    for (const wallet of addresses) {
      if (!context.ethscriptionInventories.has(wallet)) context.ethscriptionInventories.set(wallet, this.readInventory(wallet));
      for (const [id, record] of await context.ethscriptionInventories.get(wallet)) {
        if (selected.has(id) && selected.get(id) !== record.number) throw new Error(UNAVAILABLE);
        selected.set(id, record.number);
      }
    }
    return [...selected].filter(([, number]) => criteria.ranges.some(([start, end]) => number >= start && number <= end)).map(([id]) => id);
  }

  private owned(record: EthscriptionOwnership, wallets: Set<string>): boolean {
    return wallets.has(record.owner) || (record.owner === MARKET && wallets.has(record.prevOwner));
  }

  private async selectionOwners(ids: string[], context: NftCheckContext): Promise<Map<string, EthscriptionOwnership>> {
    context.ethscriptionOwners ||= new Map();
    const missing = ids.filter(id => !context.ethscriptionOwners.has(id));
    let tail: Promise<unknown> = Promise.resolve();
    for (let start = 0; start < missing.length; start += PAGE_SIZE) {
      const chunk = missing.slice(start, start + PAGE_SIZE);
      const batch = tail.then(() => this.readOwners(chunk));
      tail = batch;
      for (const id of chunk) {
        const owner = batch.then(rows => rows.get(id));
        owner.catch(() => undefined);
        context.ethscriptionOwners.set(id, owner);
      }
    }
    return new Map(await Promise.all(ids.map(async id => [id, await context.ethscriptionOwners.get(id)] as const)));
  }

  private async readOwners(ids: string[]): Promise<Map<string, EthscriptionOwnership>> {
    const query = new URLSearchParams({ max_results: String(PAGE_SIZE) });
    for (const id of ids) query.append('transaction_hash[]', id);
    const data = await this.request('/ethscriptions?' + query);
    this.validatePage(data);
    if (data.pagination.has_more || data.result.length !== ids.length) throw new Error(UNAVAILABLE);
    const requested = new Set(ids);
    const owners = new Map<string, EthscriptionOwnership>();
    const numbers = new Set<number>();
    for (const item of data.result) {
      const [id, record] = this.record(item);
      if (!requested.has(id) || owners.has(id) || numbers.has(record.number)) throw new Error(UNAVAILABLE);
      owners.set(id, record);
      numbers.add(record.number);
    }
    return owners;
  }

  private async readInventory(wallet: string): Promise<Map<string, EthscriptionOwnership>> {
    const items = new Map<string, EthscriptionOwnership>();
    const numbers = new Set<number>();
    // Match existing marketplace ownership: assets in escrow still count for
    // their previous owner. Both filtered inventories must finish successfully.
    for (const escrow of [false, true]) {
      const query = new URLSearchParams({ current_owner: escrow ? MARKET : wallet, max_results: String(PAGE_SIZE) });
      if (escrow) query.set('previous_owner', wallet);
      const cursors = new Set<string>();
      let complete = false;
      for (let page = 0; page < MAX_ITEMS / PAGE_SIZE; page++) {
        const data = await this.request('/ethscriptions?' + query);
        this.validatePage(data);
        for (const item of data.result) {
          const [id, record] = this.record(item);
          if (items.has(id) || numbers.has(record.number) || record.owner !== (escrow ? MARKET : wallet)
            || (escrow && record.prevOwner !== wallet)) throw new Error(UNAVAILABLE);
          items.set(id, record);
          numbers.add(record.number);
        }
        if (items.size > MAX_ITEMS) throw new Error(UNAVAILABLE);
        if (!data.pagination.has_more) { complete = true; break; }
        const cursor = data.pagination.page_key;
        if (!data.result.length || typeof cursor !== 'string' || !cursor.length || cursor.length > 2000 || cursors.has(cursor)) throw new Error(UNAVAILABLE);
        cursors.add(cursor);
        query.set('page_key', cursor);
      }
      if (!complete) throw new Error(UNAVAILABLE);
    }
    return items;
  }

  private validatePage(data: any): void {
    if (!data || !Array.isArray(data.result) || data.result.length > PAGE_SIZE
      || typeof data.pagination?.has_more !== 'boolean') throw new Error(UNAVAILABLE);
  }

  private record(item: any): [string, EthscriptionOwnership] {
    const number = typeof item?.ethscription_number === 'string' && /^\d+$/.test(item.ethscription_number)
      ? Number(item.ethscription_number) : item?.ethscription_number;
    if (!item || typeof item.transaction_hash !== 'string' || !ETHSCRIPTION_ID.test(item.transaction_hash)
      || !Number.isSafeInteger(number) || number < 0 || typeof item.current_owner !== 'string' || !ADDRESS.test(item.current_owner)
      || (item.previous_owner != null && (typeof item.previous_owner !== 'string' || !ADDRESS.test(item.previous_owner)))
      || (item.current_owner.toLowerCase() === MARKET && item.previous_owner == null)) throw new Error(UNAVAILABLE);
    return [item.transaction_hash, { owner: item.current_owner.toLowerCase(), prevOwner: item.previous_owner?.toLowerCase() ?? null, number }];
  }

  private request(path: string): Promise<any> {
    const queuedAt = Date.now();
    const result = this.requestTail.then(async () => {
      if (Date.now() - queuedAt > 45000) throw new Error(UNAVAILABLE);
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let retryDelay = 1000 * (attempt + 1);
        try {
          const response = await fetch(API_URL + path, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
          if (response.ok) return await response.json();
          if (response.status !== 429 && response.status < 500) throw new Error(UNAVAILABLE);
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) retryDelay = Math.min(retryAfter * 1000, 3000);
        } catch (error) {
          if (error.message === UNAVAILABLE || attempt === 2) throw new Error(UNAVAILABLE);
        } finally { clearTimeout(timeout); }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      throw new Error(UNAVAILABLE);
    });
    this.requestTail = result.catch(() => undefined).then(() => new Promise(resolve => setTimeout(resolve, 200)));
    return result;
  }
}
