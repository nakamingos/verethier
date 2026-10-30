import { Injectable } from '@nestjs/common';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { stampCriteria } from '@/utils/stamp-rule.util';
import { isBitcoinAddress, normalizeMainnetBitcoinAddress, normalizeBitcoinProofAddress } from '@/utils/wallet-address.util';
import { NftCheckContext } from './nft-ownership.service';

const UNAVAILABLE = 'Bitcoin Stamps ownership is temporarily unavailable. Please try again.';
const LIMIT = 100;
const MAX_PAGES = 100;
interface Stamp { id: string; asset: string; creator: string; divisible: boolean }
export interface StampHoldings { balances: Map<string, bigint>; divisible: Map<string, boolean>; height: number; outputs: Set<string> }

@Injectable()
export class StampsOwnershipService {
  // Per-process request cap; pending work is bounded and expires instead of flooding public APIs.
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  async prepareRule(input: unknown): Promise<NftRuleFields> {
    const criteria = stampCriteria(input);
    const context: NftCheckContext = { checks: new Map() };
    await this.checkSetupHealth();
    if (criteria.stamp_ids) {
      for (const id of criteria.stamp_ids) {
        const stamp = await this.detail(id, context);
        if (!stamp || stamp.id !== id) throw new Error(`Stamp #${id} was not found.`);
        if (stamp.divisible) throw new Error('Stamps rules currently support indivisible stamps, not divisible tokens.');
        if (criteria.creator && stamp.creator !== criteria.creator) throw new Error(`Stamp #${id} does not match this creator address.`);
      }
    }
    return { asset_type: 'stamp', chain_id: null, stamp_criteria: criteria };
  }

  async checkSetupHealth(): Promise<void> {
    const data = await this.request('xcp', '/');
    if (data?.result?.network !== 'mainnet' || data.result.server_ready !== true) throw new Error(UNAVAILABLE);
    const health = await this.request('stamps', '/health');
    if (health?.status !== 'OK' || health.services?.indexer !== true || health.services?.database !== true
      || health.services?.blockSync?.isSynced !== true) throw new Error(UNAVAILABLE);
  }

  async count(rule: NftRuleFields, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    let total = 0n;
    for (const copies of (await this.matchingAssets(rule, wallets, context || { checks: new Map() })).values()) total += copies;
    return total;
  }

  async matchingAssets(rule: NftRuleFields, wallets: string[], context: NftCheckContext): Promise<Map<string, bigint>> {
    const criteria = stampCriteria(rule.stamp_criteria);
    if (rule.trait_filter || rule.inscription_criteria || rule.solana_criteria) throw new Error('Invalid Stamps rule.');
    const addresses = [...new Set(wallets.filter(isBitcoinAddress).map(normalizeBitcoinProofAddress))].sort();
    const owned = new Map<string, bigint>();
    if (!addresses.length) return owned;
    context.stampHealth ||= this.checkSetupHealth();
    await context.stampHealth;
    const selected: Stamp[] | undefined = criteria.stamp_ids ? [] : undefined;
    if (selected) for (const id of criteria.stamp_ids) {
      const stamp = await this.detail(id, context);
      if (!stamp || stamp.id !== id || stamp.divisible || (criteria.creator && stamp.creator !== criteria.creator)) throw new Error(UNAVAILABLE);
      selected.push(stamp);
    }
    let height: number | undefined;
    const outputs = new Set<string>();
    for (const wallet of addresses) {
      context.stampBalances ||= new Map();
      if (!context.stampBalances.has(wallet)) context.stampBalances.set(wallet, this.balances(wallet));
      const holdings = await context.stampBalances.get(wallet);
      if (height !== undefined && height !== holdings.height) throw new Error(UNAVAILABLE);
      height = holdings.height;
      for (const output of holdings.outputs) {
        if (outputs.has(output)) throw new Error(UNAVAILABLE);
        outputs.add(output);
      }
      const stamps = selected || await this.catalog(wallet, context, holdings);
      const assets = new Set<string>();
      for (const stamp of stamps) {
        if (stamp.id.startsWith('-') || stamp.divisible || assets.has(stamp.asset) || (criteria.creator && stamp.creator !== criteria.creator)) continue;
        assets.add(stamp.asset);
        const quantity = holdings.balances.get(stamp.asset) || 0n;
        if (quantity && holdings.divisible.get(stamp.asset) !== false) throw new Error(UNAVAILABLE);
        if (quantity) owned.set(stamp.asset, (owned.get(stamp.asset) || 0n) + quantity);
      }
    }
    return owned;
  }

  private parseStamp(value: any): Stamp {
    if (!value || !Number.isSafeInteger(value.stamp) || typeof value.cpid !== 'string'
      || !/^(?:A[0-9]{1,20}|[A-Z][A-Z0-9.]{3,249})$/.test(value.cpid)
      || ![true, false, 0, 1].includes(value.divisible)) throw new Error(UNAVAILABLE);
    return { id: String(value.stamp), asset: value.cpid, creator: normalizeMainnetBitcoinAddress(value.creator), divisible: !!value.divisible };
  }

  private async detail(id: string, context: NftCheckContext): Promise<Stamp | null> {
    context.stampDetails ||= new Map();
    if (!context.stampDetails.has(id)) context.stampDetails.set(id, (async () => {
      const data = await this.request('stamps', '/stamps/' + encodeURIComponent(id), true);
      if (data === null) return null;
      return this.parseStamp(data?.data?.stamp);
    })());
    return context.stampDetails.get(id);
  }

  private async catalog(wallet: string, context: NftCheckContext, holdings: StampHoldings): Promise<Stamp[]> {
    context.stampCatalogs ||= new Map();
    if (!context.stampCatalogs.has(wallet)) context.stampCatalogs.set(wallet, this.readCatalog(wallet, holdings, context));
    return context.stampCatalogs.get(wallet);
  }

  private async readCatalog(wallet: string, holdings: StampHoldings, context: NftCheckContext): Promise<Stamp[]> {
    if (!holdings.balances.size) return [];
    const stamps: Stamp[] = [], seen = new Set<string>();
    let total: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.request('stamps', `/stamps/balance/${encodeURIComponent(wallet)}?limit=${LIMIT}&page=${page}&sortBy=ASC&enhanced=false`);
      if (!data || data.page !== page || data.limit !== LIMIT || !Number.isSafeInteger(data.total) || data.total < 0
        || (total !== undefined && total !== data.total) || !Array.isArray(data.data)
        || data.totalPages !== Math.ceil(data.total / LIMIT)
        || data.data.length !== Math.min(LIMIT, data.total - stamps.length)) throw new Error(UNAVAILABLE);
      total = data.total;
      for (const row of data.data) {
        const stamp = this.parseStamp(row);
        if (seen.has(stamp.id) || normalizeMainnetBitcoinAddress(row.address) !== wallet) throw new Error(UNAVAILABLE);
        seen.add(stamp.id); stamps.push(stamp);
      }
      if (stamps.length === total) {
        if (!total) {
          // The provider's catalog query can return zero on an internal SQL error.
          // Confirm every indivisible Counterparty asset before accepting an empty catalog.
          const candidates = [...holdings.balances.keys()].filter(asset => !holdings.divisible.get(asset));
          if (candidates.length > LIMIT) throw new Error(UNAVAILABLE);
          for (const asset of candidates) {
            const stamp = await this.detail(asset, context);
            if (stamp) { if (stamp.asset !== asset) throw new Error(UNAVAILABLE); stamps.push(stamp); }
          }
        }
        return stamps;
      }
    }
    throw new Error(UNAVAILABLE);
  }

  private async balances(wallet: string): Promise<StampHoldings> {
    const balances = new Map<string, bigint>(), divisible = new Map<string, boolean>();
    const rows = new Set<string>(), cursors = new Set<number>();
    let cursor: number | undefined, expected: number | undefined, height: number | undefined, count = 0;
    const outputs = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({type:'all',verbose:'true',limit:String(LIMIT),...(cursor === undefined ? {} : {cursor:String(cursor)})});
      const data = await this.request('xcp', `/addresses/${encodeURIComponent(wallet)}/balances?${params}`);
      if (!data || !Array.isArray(data.result) || data.result.length > LIMIT || !Number.isSafeInteger(data.result_count) || data.result_count < 0
        || (expected !== undefined && expected !== data.result_count)) throw new Error(UNAVAILABLE);
      expected = data.result_count;
      if (!Number.isSafeInteger(data.bouncer_height) || data.bouncer_height < 779652
        || (height !== undefined && height !== data.bouncer_height)) throw new Error(UNAVAILABLE);
      height = data.bouncer_height;
      for (const row of data.result) {
        const owner = row.utxo ? row.utxo_address : row.address;
        if (normalizeMainnetBitcoinAddress(owner) !== wallet || typeof row.asset !== 'string' || !/^[A-Z][A-Z0-9.]{0,249}$/.test(row.asset)
          || typeof row.asset_info?.divisible !== 'boolean') throw new Error(UNAVAILABLE);
        const amount = typeof row.quantity === 'number' && Number.isSafeInteger(row.quantity) ? String(row.quantity) : row.quantity;
        if (typeof amount !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(amount)) throw new Error(UNAVAILABLE);
        const key = JSON.stringify([row.asset, row.utxo || 'unbound']);
        if (rows.has(key) || (row.utxo && !/^[0-9a-f]{64}:[0-9]+$/.test(row.utxo))) throw new Error(UNAVAILABLE);
        rows.add(key); count++;
        if (row.utxo) outputs.add(row.utxo);
        if (divisible.has(row.asset) && divisible.get(row.asset) !== row.asset_info.divisible) throw new Error(UNAVAILABLE);
        divisible.set(row.asset, row.asset_info.divisible);
        // UTXO assets are keyed to their current owner, so each output occurs once per complete inventory.
        if (BigInt(amount)>0n) balances.set(row.asset, (balances.get(row.asset) || 0n) + BigInt(amount));
      }
      if (data.next_cursor === null) {
        if (count !== expected) throw new Error(UNAVAILABLE);
        return { balances, divisible, height, outputs };
      }
      if (!data.result.length || !Number.isSafeInteger(data.next_cursor) || data.next_cursor < 0 || cursors.has(data.next_cursor)) throw new Error(UNAVAILABLE);
      cursor = data.next_cursor; cursors.add(cursor);
    }
    throw new Error(UNAVAILABLE);
  }

  private request(provider: 'xcp' | 'stamps', path: string, missing = false): Promise<any> {
    if (this.pending >= 100) return Promise.reject(new Error(UNAVAILABLE));
    this.pending++;
    const queued = Date.now();
    const run = this.tail.catch(() => undefined).then(async () => {
      if (Date.now() - queued > 45000) throw new Error(UNAVAILABLE);
      const base = provider === 'xcp' ? EnvironmentConfig.COUNTERPARTY_API_URL : EnvironmentConfig.STAMPCHAIN_API_URL;
      let url: URL;
      try { url = new URL(base.replace(/\/$/, '') + path); if (url.protocol !== 'https:') throw new Error(); }
      catch { throw new Error('Configure HTTPS Stampchain and Counterparty API URLs on the backend.'); }
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { signal: controller.signal, redirect:'error', headers: {Accept:'application/json','Cache-Control':'no-cache'} });
        if (missing && response.status === 404) return null;
        if (!response.ok) throw new Error(UNAVAILABLE);
        let indexedHeight: number;
        if (provider === 'xcp') {
          const height = Number(response.headers.get('x-counterparty-height')), bitcoin = Number(response.headers.get('x-bitcoin-height'));
          if (response.headers.get('x-counterparty-ready')?.toLowerCase() !== 'true' || !Number.isSafeInteger(height) || height < 779652
            || !Number.isSafeInteger(bitcoin) || bitcoin < height || bitcoin - height > 2) throw new Error(UNAVAILABLE);
          indexedHeight = height;
        }
        const age = response.headers.get('age');
        if (age !== null && (!/^\d+$/.test(age) || Number(age) > 120)) throw new Error(UNAVAILABLE);
        const body = await response.json();
        return provider === 'xcp' ? {...body,bouncer_height:indexedHeight} : body;
      } catch { throw new Error(UNAVAILABLE); }
      finally { clearTimeout(timeout); }
    });
    this.tail = run.then(() => new Promise(r => setTimeout(r, 150)), () => new Promise(r => setTimeout(r, 150)));
    return run.finally(() => { this.pending--; });
  }
}
