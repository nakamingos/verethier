import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentConfig } from '@/config/environment.config';
import { OrdinalWalletInventory } from '@/models/ordinal-collection.interface';
import { ORDINAL_INSCRIPTION_ID } from '@/utils/ordinal-rule.util';
import { normalizeBitcoinAddress } from '@/utils/wallet-address.util';
import { DbService } from './db.service';
import { NftCheckContext } from './nft-ownership.service';
import { OrdinalRequestWork, OrdinalsRequestScheduler, ordinalRequestWork } from './ordinals-request-scheduler.service';

type Provider = OrdinalWalletInventory['provider'];
type PublicProvider = Exclude<Provider, 'xverse'>;
type NumberInventory = (wallet: string, work: OrdinalRequestWork) => Promise<Map<string, number>>;
const UNAVAILABLE = 'Ordinals verification is temporarily unavailable. Please try again.';

@Injectable()
export class OrdinalWalletInventoryService {
  private readonly cooldowns = new Map<Provider, number>();
  private readonly health = new Map<PublicProvider, { expires: number; work: OrdinalRequestWork; result: Promise<void> }>();

  constructor(private readonly requests: OrdinalsRequestScheduler, private readonly db: DbService) {}

  inventory(wallet: string, context: NftCheckContext, numbers: boolean, xverse: NumberInventory): Promise<OrdinalWalletInventory> {
    const needNumbers = numbers || context.ordinalNeedsNumbers === true;
    context.ordinalWalletInventories ||= new Map();
    const key = JSON.stringify([wallet, needNumbers]);
    const numbered = context.ordinalWalletInventories.get(JSON.stringify([wallet, true]));
    if (!needNumbers && numbered) return numbered;
    if (!context.ordinalWalletInventories.has(key)) context.ordinalWalletInventories.set(key,
      this.lookup(wallet, needNumbers, ordinalRequestWork(context), xverse));
    return context.ordinalWalletInventories.get(key);
  }

  private providers(): Provider[] {
    const providers = EnvironmentConfig.ORDINALS_OWNERSHIP_PROVIDERS.split(',').map(value => value.trim().toLowerCase());
    if (!providers.length || providers.some(value => !['ordiscan', 'subfrost', 'sandshrew', 'xverse'].includes(value))
      || new Set(providers).size !== providers.length) throw new Error('Invalid ORDINALS_OWNERSHIP_PROVIDERS configuration.');
    return providers as Provider[];
  }

  private async lookup(wallet: string, numbers: boolean, work: OrdinalRequestWork, xverse: NumberInventory): Promise<OrdinalWalletInventory> {
    normalizeBitcoinAddress(wallet);
    for (const provider of this.providers()) {
      if ((this.cooldowns.get(provider) || 0) > Date.now()) continue;
      if (provider === 'ordiscan' && !EnvironmentConfig.ORDISCAN_API_KEY
        || provider === 'sandshrew' && !EnvironmentConfig.SANDSHREW_API_KEY
        || provider === 'xverse' && !EnvironmentConfig.XVERSE_API_KEY) continue;
      // The public ord address response contains IDs only. Do not enrich every
      // inscription or build a permanent number index just to evaluate a range.
      if (numbers && (provider === 'subfrost' || provider === 'sandshrew')) continue;
      try {
        if (provider === 'xverse') {
          const inventory = await xverse(wallet, work);
          return { ids: new Set(inventory.keys()), numbers: inventory, provider };
        }
        if (provider === 'ordiscan') return await this.ordiscan(wallet, numbers, work);
        await this.checkHealth(provider, work);
        const result = await this.rpc(provider, 'ord_address', [wallet], work);
        if (!result || !Array.isArray(result.inscriptions)) throw new Error(UNAVAILABLE);
        return { ids: this.ids(result.inscriptions), provider };
      } catch {
        if ((this.cooldowns.get(provider) || 0) <= Date.now()) this.cooldowns.set(provider, Date.now() + 30000);
        Logger.warn(`Ordinals wallet lookup through ${provider} failed; trying the next configured provider.`);
      }
    }
    throw new Error(UNAVAILABLE);
  }

  private ids(values: unknown[]): Set<string> {
    if (values.length > 100000 || values.some(id => typeof id !== 'string' || !ORDINAL_INSCRIPTION_ID.test(id))) throw new Error(UNAVAILABLE);
    const ids = new Set(values as string[]);
    if (ids.size !== values.length) throw new Error(UNAVAILABLE);
    return ids;
  }

  private async ordiscan(wallet: string, numbers: boolean, work: OrdinalRequestWork): Promise<OrdinalWalletInventory> {
    const base = `https://api.ordiscan.com/v1/address/${wallet}`;
    const headers = { Authorization: `Bearer ${EnvironmentConfig.ORDISCAN_API_KEY}`, Accept: 'application/json' };
    if (!numbers) {
      const data = await this.http('ordiscan', base + '/inscription-ids', { headers }, work);
      if (!data || !Array.isArray(data.data)) throw new Error(UNAVAILABLE);
      return { ids: this.ids(data.data), provider: 'ordiscan' };
    }
    const inventory = new Map<string, number>();
    const seenNumbers = new Set<number>();
    for (let page = 1; page <= 1000; page++) {
      const data = await this.http('ordiscan', base + `/inscriptions?page=${page}`, { headers }, work);
      if (!data || !Array.isArray(data.data) || data.data.length > 100) throw new Error(UNAVAILABLE);
      for (const item of data.data) {
        if (!item || typeof item.inscription_id !== 'string' || !ORDINAL_INSCRIPTION_ID.test(item.inscription_id)
          || inventory.has(item.inscription_id) || !Number.isSafeInteger(item.inscription_number)
          || seenNumbers.has(item.inscription_number) || typeof item.owner_address !== 'string'
          || item.owner_address !== item.owner_address.trim() || normalizeBitcoinAddress(item.owner_address) !== wallet) throw new Error(UNAVAILABLE);
        inventory.set(item.inscription_id, item.inscription_number);
        seenNumbers.add(item.inscription_number);
      }
      if (data.data.length < 100) return { ids: new Set(inventory.keys()), numbers: inventory, provider: 'ordiscan' };
    }
    throw new Error(UNAVAILABLE);
  }

  private checkHealth(provider: 'subfrost' | 'sandshrew', work: OrdinalRequestWork): Promise<void> {
    let cached = this.health.get(provider);
    if (cached && cached.expires > Date.now()) {
      if (work.priority === 'interactive') this.requests.promote(cached.work);
      return cached.result;
    }
    const healthWork = { priority: work.priority };
    const result = Promise.all([
      this.rpc(provider, 'ord_blockheight', [], healthWork),
      this.rpc(provider, 'btc_getblockcount', [], healthWork),
    ]).then(([indexed, tip]) => {
      if (!Number.isSafeInteger(indexed) || !Number.isSafeInteger(tip) || indexed < 0 || tip < indexed || tip - indexed > 2) throw new Error(UNAVAILABLE);
    }).catch(() => {
      this.health.delete(provider);
      throw new Error(UNAVAILABLE);
    });
    cached = { expires: Date.now() + 30000, work: healthWork, result };
    this.health.set(provider, cached);
    return result;
  }

  private async rpc(provider: 'subfrost' | 'sandshrew', method: string, params: unknown[], work: OrdinalRequestWork): Promise<any> {
    const url = provider === 'subfrost' ? 'https://mainnet.subfrost.io/v4/jsonrpc'
      : `https://mainnet.sandshrew.io/v1/${EnvironmentConfig.SANDSHREW_API_KEY}`;
    const data = await this.http(provider, url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }, work);
    // Gateways preserve Bitcoin Core's JSON-RPC 1.0 envelope for btc_* methods.
    const validVersion = data?.jsonrpc === '2.0' || method.startsWith('btc_') && data?.jsonrpc === '1.0';
    if (!data || !validVersion || data.id !== 1 || data.error || !Object.prototype.hasOwnProperty.call(data, 'result')) throw new Error(UNAVAILABLE);
    return data.result;
  }

  private http(provider: PublicProvider, url: string, options: RequestInit, work: OrdinalRequestWork): Promise<any> {
    return this.requests.enqueue(provider, work, async queueWait => {
      if (queueWait > 45000 || (this.cooldowns.get(provider) || 0) > Date.now()) throw new Error(UNAVAILABLE);
      if (provider === 'ordiscan' && !await this.db.reserveOrdinalProviderRequest()) {
        const now = new Date();
        this.cooldowns.set(provider, Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        throw new Error(UNAVAILABLE);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
        if (!response.ok) {
          const header = response.headers.get('retry-after');
          const seconds = header == null ? NaN : Number(header);
          const until = Number.isFinite(seconds) ? Date.now() + Math.max(seconds, 1) * 1000 : Date.parse(header || '');
          const delay = Number.isFinite(until) ? Math.max(1000, until - Date.now()) : 60000;
          this.cooldowns.set(provider, Date.now() + Math.min(delay, 31 * 24 * 60 * 60 * 1000));
          throw new Error(UNAVAILABLE);
        }
        return await response.json();
      } finally { clearTimeout(timer); }
    });
  }
}
