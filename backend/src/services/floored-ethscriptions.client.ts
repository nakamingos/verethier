import { AsyncSemaphore } from '@/utils/async-semaphore.util';
import type { EthscriptionAsset } from '@/models/ethscription-ownership.interface';

const ORIGIN = 'https://api.floored.app/v1';
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const LEGACY_MARKET = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
const HASH = /^0x[0-9a-f]{64}$/i;
const reads = new AsyncSemaphore(4);
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const READ_BUDGET_MS = 20_000;
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Controlled diagnostics only: never include upstream messages or request URLs. */
export class FlooredReadError extends Error {
  constructor(reason: string) { super(reason); this.name = 'FlooredReadError'; }
}

/** Read-only v1 adapter. Never interprets failed/incomplete reads as empty wallets. */
export class FlooredEthscriptionsClient {
  private cooldownUntil = 0;
  private markets?: { expires: number; read: Promise<Set<string>> };

  constructor(private readonly apiKey?: string) {}

  supportsCollection(slug?: string): boolean {
    // Live comparisons found non-equivalent membership, not just renamed slugs.
    // Keep the existing definitions until an explicit rule migration is agreed.
    return !!this.apiKey && !!slug &&
      !['ALL', 'all-collections', 'comrades-otd', 'misprint-mingos'].includes(slug);
  }

  async inventory(wallets: string[], slug: string): Promise<EthscriptionAsset[]> {
    if (!this.supportsCollection(slug)) throw new FlooredReadError('unsupported_collection');
    if (!wallets.every(wallet => ADDRESS.test(wallet))) throw new FlooredReadError('invalid_wallet');
    const deadline = Date.now() + READ_BUDGET_MS;
    const result = new Map<string, EthscriptionAsset>();
    const inventories = await Promise.all([...new Set(wallets.map(wallet => wallet.toLowerCase()))]
      .map(wallet => this.walletInventory(wallet, slug, deadline)));
    for (const assets of inventories) for (const asset of assets) result.set(asset.hashId, asset);
    return [...result.values()];
  }

  private async walletInventory(wallet: string, slug: string, deadline: number): Promise<EthscriptionAsset[]> {
    const items = new Map<string, EthscriptionAsset>();
    let expectedTotal: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const params = new URLSearchParams({ collection: slug, limit: String(PAGE_SIZE), offset: String(offset) });
      const body = await this.request(`/accounts/${wallet}/ethscriptions?${params}`, deadline);
      const pagination = body.pagination;
      if (!Array.isArray(body.data) || body.data.length > PAGE_SIZE || !object(pagination) ||
        pagination.limit !== PAGE_SIZE || pagination.offset !== offset || typeof pagination.hasMore !== 'boolean')
        throw new FlooredReadError('invalid_pagination');
      if (pagination.total !== undefined) {
        if (!Number.isSafeInteger(pagination.total) || pagination.total < 0 ||
          (expectedTotal !== undefined && expectedTotal !== pagination.total))
          throw new FlooredReadError('inventory_changed');
        expectedTotal = pagination.total;
      }
      for (const row of body.data) {
        if (!object(row) || !HASH.test(row.transactionHash) || !ADDRESS.test(row.currentOwner) ||
          typeof row.isEscrowed !== 'boolean' || !object(row.collectionItem) ||
          row.collectionItem.collectionSlug !== slug)
          throw new FlooredReadError('invalid_asset');
        const id = row.transactionHash.toLowerCase();
        if (items.has(id)) throw new FlooredReadError('duplicate_asset');
        if (row.currentOwner.toLowerCase() !== wallet) {
          // A previous owner alone does not establish beneficial ownership.
          // The account endpoint currently reports isEscrowed=false for some
          // legacy-market rows. Preserve Bouncer's existing pinned-contract rule;
          // other markets require both the escrow flag and catalog membership.
          if (!ADDRESS.test(row.previousOwner) || row.previousOwner.toLowerCase() !== wallet ||
            !(row.currentOwner.toLowerCase() === LEGACY_MARKET ||
              (row.isEscrowed && (await this.marketAddresses(deadline)).has(row.currentOwner.toLowerCase()))))
            throw new FlooredReadError('ownership_mismatch');
        }
        const attributes = row.collectionItem.attributes;
        if (!object(attributes)) throw new FlooredReadError('missing_traits');
        items.set(id, { hashId: id, slug, attributes_new: { values: attributes } });
      }
      if (!pagination.hasMore) {
        if (expectedTotal !== undefined && items.size !== expectedTotal) throw new FlooredReadError('incomplete_inventory');
        return [...items.values()];
      }
      if (body.data.length !== PAGE_SIZE || (expectedTotal !== undefined && items.size >= expectedTotal))
        throw new FlooredReadError('incomplete_inventory');
    }
    throw new FlooredReadError('inventory_limit');
  }

  private async marketAddresses(deadline: number): Promise<Set<string>> {
    if (!this.markets || this.markets.expires <= Date.now()) {
      const read = this.request('/marketplaces', deadline).then(body => {
        if (!Array.isArray(body.data) || !body.data.length ||
          !body.data.every(row => object(row) && ADDRESS.test(row.address)))
          throw new FlooredReadError('invalid_marketplaces');
        return new Set<string>(body.data.map(row => row.address.toLowerCase()));
      });
      const entry = { expires: Date.now() + 300_000, read };
      this.markets = entry;
      read.catch(() => { if (this.markets === entry) this.markets = undefined; });
    }
    return this.markets.read;
  }

  private async request(path: string, deadline: number): Promise<Record<string, any>> {
    return reads.run(async () => {
      if (!this.apiKey || this.cooldownUntil > Date.now()) throw new FlooredReadError('provider_cooldown');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new FlooredReadError('read_deadline');
      let response: Response;
      try {
        response = await fetch(ORIGIN + path, {
          headers: { 'X-API-Key': this.apiKey },
          signal: AbortSignal.timeout(Math.min(10_000, remaining)),
          redirect: 'error',
        });
      } catch {
        this.cooldownUntil = Date.now() + 15_000;
        throw new FlooredReadError('request_failed');
      }
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 60;
        if (response.status === 429) this.cooldownUntil = Date.now() + Math.min(300, Math.max(1, seconds)) * 1000;
        else if ([401, 403].includes(response.status) || response.status >= 500) this.cooldownUntil = Date.now() + 60_000;
        const requestId = response.headers.get('x-request-id');
        const suffix = requestId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? `; request_id=${requestId}` : '';
        throw new FlooredReadError(`http_${response.status}${suffix}`);
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { throw new FlooredReadError('invalid_json'); }
      if (!object(body)) throw new FlooredReadError('invalid_response');
      return body;
    });
  }
}
