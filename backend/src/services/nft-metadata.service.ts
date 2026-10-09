import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { getNftNetwork } from '@/utils/nft-network.util';
import { NftAttributes, NftMetadataRow, nftTokenId, parseNftAttributes, parseInlineNftAttributes } from '@/utils/nft-trait.util';
import { DbService } from './db.service';

const UNAVAILABLE = 'NFT trait verification is temporarily unavailable. Please try again.';
const CACHE_TTL = 600000;
const PAGE_SIZE = 100;

@Injectable()
export class NftMetadataService {
  private readonly logger = new Logger(NftMetadataService.name);
  private readonly catalogs = new Map<string, { expires: number; data: Promise<NftAttributes> }>();

  constructor(private readonly dbSvc: DbService) {}

  private baseUrl(chainId: number): string {
    const network = getNftNetwork(chainId);
    const host = chainId === 1 ? 'eth-mainnet.g.alchemy.com' : 'robinhood-mainnet.g.alchemy.com';
    let key = EnvironmentConfig.ALCHEMY_API_KEY;
    if (!key) {
      try {
        const rpc = new URL(chainId === 1 ? EnvironmentConfig.RPC_URL : EnvironmentConfig.ROBINHOOD_RPC_URL);
        if (rpc.protocol === 'https:' && rpc.hostname === host && !rpc.username && !rpc.password) {
          key = rpc.pathname.match(/^\/v2\/([^/]+)$/)?.[1];
        }
      } catch { /* A separate Alchemy key can be used with other RPC providers. */ }
    }
    if (!key) throw new Error(`${network.name} NFT traits require an Alchemy RPC URL or ALCHEMY_API_KEY on the backend.`);
    return `https://${host}/nft/v3/${encodeURIComponent(key)}`;
  }

  async ownedIds(rule: NftRuleFields, owner: string): Promise<string[]> {
    const ids = new Set<string>();
    const pages = new Set<string>();
    let pageKey: string | undefined;
    let total: number | undefined;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ owner, 'contractAddresses[]': rule.contract_address, withMetadata: 'false', pageSize: String(PAGE_SIZE) });
      if (pageKey) query.set('pageKey', pageKey);
      const data = await this.request(rule.chain_id, `getNFTsForOwner?${query}`);
      if (!Array.isArray(data?.ownedNfts) || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0
        || (total !== undefined && total !== data.totalCount)) throw new Error(UNAVAILABLE);
      total = data.totalCount;
      for (const token of data.ownedNfts) {
        // withMetadata:false returns contractAddress/tokenId, without a tokenType.
        const contract = token?.contractAddress ?? token?.contract?.address;
        if (typeof contract !== 'string' || contract.toLowerCase() !== rule.contract_address) throw new Error(UNAVAILABLE);
        const id = nftTokenId(token.tokenId);
        if (ids.has(id)) throw new Error(UNAVAILABLE);
        ids.add(id);
      }
      if (!data.pageKey) {
        if (ids.size !== total) throw new Error(UNAVAILABLE);
        return [...ids];
      }
      if (typeof data.pageKey !== 'string' || pages.has(data.pageKey) || !data.ownedNfts.length) throw new Error(UNAVAILABLE);
      pages.add(data.pageKey);
      pageKey = data.pageKey;
    }
    throw new Error(UNAVAILABLE);
  }

  async attributes(rule: NftRuleFields, ids: string[], readUri?: (id: string) => Promise<string | null>): Promise<Map<string, NftAttributes>> {
    const result = new Map<string, NftAttributes>();
    const uniqueIds = [...new Set(ids.map(nftTokenId))];
    for (let offset = 0; offset < uniqueIds.length; offset += 50) {
      const batch = uniqueIds.slice(offset, offset + 50);
      const fresh: NftMetadataRow[] = [];
      if (readUri) {
        // Embedded traits can change on-chain; read them at the ownership block on every run.
        const inline = await Promise.all(batch.map(async id => {
          const uri = await readUri(id);
          try { return { id, attributes: parseInlineNftAttributes(uri) }; }
          catch { throw new Error(UNAVAILABLE); }
        }));
        for (const { id, attributes } of inline) {
          if (attributes === null) continue;
          result.set(id, attributes);
          fresh.push({ chain_id: rule.chain_id, contract_address: rule.contract_address, token_id: id, attributes, fetched_at: new Date().toISOString() });
        }
      }
      const hosted = batch.filter(id => !result.has(id));
      if (fresh.length) await this.dbSvc.cacheNftMetadata(fresh);
      if (!hosted.length) continue;
      const rows = await this.dbSvc.getCachedNftMetadata(rule.chain_id, rule.contract_address, hosted, new Date(Date.now() - CACHE_TTL).toISOString());
      for (const row of rows) {
        if (row.chain_id !== rule.chain_id || row.contract_address !== rule.contract_address || !hosted.includes(row.token_id)) continue;
        try { result.set(row.token_id, parseNftAttributes(row.attributes)); } catch { /* Refresh malformed cache entries. */ }
      }
      const missing = hosted.filter(id => !result.has(id));
      if (!missing.length) continue;
      const data = await this.request(rule.chain_id, 'getNFTMetadataBatch', {
        tokens: missing.map(tokenId => ({ contractAddress: rule.contract_address, tokenId, tokenType: rule.token_standard === 'erc721' ? 'ERC721' : 'ERC1155' })),
        tokenUriTimeoutInMs: 5000,
        refreshCache: true,
      });
      const tokens = Array.isArray(data) ? data : data?.nfts;
      if (!Array.isArray(tokens) || tokens.length !== missing.length) throw new Error(UNAVAILABLE);
      const providerRows: NftMetadataRow[] = [];
      for (const token of tokens) {
        this.checkToken(token, rule);
        const id = nftTokenId(token.tokenId);
        if (!missing.includes(id) || result.has(id) || token.raw?.error) throw new Error(UNAVAILABLE);
        let attributes: NftAttributes;
        try { attributes = parseNftAttributes(token.raw?.metadata?.attributes); }
        catch { throw new Error(UNAVAILABLE); }
        result.set(id, attributes);
        providerRows.push({ chain_id: rule.chain_id, contract_address: rule.contract_address, token_id: id, attributes, fetched_at: new Date().toISOString() });
      }
      await this.dbSvc.cacheNftMetadata(providerRows);
    }
    return result;
  }

  async suggestions(rule: NftRuleFields, attributeKey?: string): Promise<string[]> {
    const key = JSON.stringify([rule.chain_id, rule.contract_address]);
    let catalog = this.catalogs.get(key);
    if (!catalog || catalog.expires <= Date.now()) {
      if (this.catalogs.size >= 200) this.catalogs.clear();
      const data = this.readCatalog(rule).catch(error => { this.catalogs.delete(key); throw error; });
      catalog = { expires: Date.now() + CACHE_TTL, data };
      this.catalogs.set(key, catalog);
    }
    const attributes = await catalog.data;
    return [...new Set(attributes.filter(attribute => !attributeKey || attribute.trait_type.toLowerCase() === attributeKey.toLowerCase())
      .map(attribute => attributeKey ? attribute.value : attribute.trait_type))].filter(value => value.length > 0 && value.length <= 100).sort();
  }

  private async readCatalog(rule: NftRuleFields): Promise<NftAttributes> {
    const query = new URLSearchParams({ contractAddress: rule.contract_address, withMetadata: 'true', limit: String(PAGE_SIZE), tokenUriTimeoutInMs: '5000' });
    const data = await this.request(rule.chain_id, `getNFTsForContract?${query}`);
    if (!Array.isArray(data?.nfts)) throw new Error(UNAVAILABLE);
    const attributes: NftAttributes = [];
    // Suggestions sample the collection; admins may enter traits outside this sample.
    for (const token of data.nfts) {
      this.checkToken(token, rule);
      try { attributes.push(...parseNftAttributes(token.raw?.metadata?.attributes)); } catch { /* Missing metadata does not prevent manual entry. */ }
    }
    return attributes;
  }

  private checkToken(token: any, rule: NftRuleFields): void {
    if (typeof token?.contract?.address !== 'string' || token.contract.address.toLowerCase() !== rule.contract_address
      || !['ERC721', 'ERC1155'].includes(token.tokenType)
      || (rule.token_standard && token.tokenType !== (rule.token_standard === 'erc721' ? 'ERC721' : 'ERC1155'))) throw new Error(UNAVAILABLE);
  }

  private async request(chainId: number, path: string, body?: object): Promise<any> {
    const base = this.baseUrl(chainId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${base}/${path}`, {
          method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error',
        });
        if (response.ok) return await response.json();
        this.logger.warn(`NFT metadata API returned HTTP ${response.status} on chain ${chainId}.`);
        if (response.status !== 429 && response.status < 500) throw new Error(UNAVAILABLE);
      } catch (error) {
        if (error.message === UNAVAILABLE || attempt === 1) throw new Error(UNAVAILABLE);
      } finally { clearTimeout(timeout); }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(UNAVAILABLE);
  }
}
