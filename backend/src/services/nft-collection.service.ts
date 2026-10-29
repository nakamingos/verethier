import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { EnvironmentConfig } from "@/config/environment.config";
import { NFT_NETWORKS } from "@/utils/nft-network.util";
import { NFT_MAX_IDS, parseTokenIds } from "@/utils/nft-rule.util";
import { compactTokenIds } from "@/utils/rule-edit.util";

type Standard = "erc721" | "erc1155";
export interface CollectionContract {
  chain: string;
  network: string | null;
  network_name: string;
  contract_address: string;
  token_standard: Standard | null;
  supported: boolean;
}
export interface NftCollectionLookup {
  source: "opensea";
  slug: string;
  name: string;
  url: string;
  unique_item_count: number | null;
  contracts: CollectionContract[];
  resolved_at: string;
}
export interface NftCollectionTokens {
  collection: string;
  collection_name: string;
  contract_address: string;
  network: string;
  token_standard: Standard;
  token_ids: string[];
  token_ids_input: string;
  resolved_at: string;
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UNAVAILABLE =
  "OpenSea could not complete the lookup. Please try again, or enter a contract address.";
const MAX_PAGES = 25;
const PAGE_SIZE = 200;
const TTL = 5 * 60 * 1000;

export function openSeaCollectionSlug(input: string): string {
  if (typeof input !== "string" || input.length > 512)
    throw new BadRequestException("Enter an OpenSea collection URL or slug.");
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        !["opensea.io", "www.opensea.io"].includes(url.hostname) ||
        url.port ||
        url.username ||
        url.password
      )
        throw new Error();
      const match = url.pathname.match(/^\/collection\/([^/]+)\/?$/);
      if (!match) throw new Error();
      value = match[1];
    } catch {
      throw new BadRequestException(
        "Use an https://opensea.io/collection/… URL or its collection slug.",
      );
    }
  }
  value = value.toLowerCase();
  if (!SLUG.test(value))
    throw new BadRequestException(
      "Enter a valid OpenSea collection slug, up to 100 characters.",
    );
  return value;
}

/** Resolves setup inputs only. Saved rules and ownership checks never depend on a slug. */
@Injectable()
export class NftCollectionService {
  private readonly collections = new Map<
    string,
    { expires: number; result: Promise<NftCollectionLookup> }
  >();
  private readonly tokens = new Map<
    string,
    { expires: number; result: Promise<NftCollectionTokens> }
  >();
  private requests = 0;

  private configured() {
    if (!EnvironmentConfig.OPENSEA_API_KEY?.trim())
      throw new ServiceUnavailableException(
        "OpenSea lookup is not configured. You can still enter a contract address.",
      );
  }
  private async cached<T>(
    cache: Map<string, { expires: number; result: Promise<T> }>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    this.configured();
    let entry = cache.get(key);
    if (!entry || entry.expires <= Date.now()) {
      if (cache.size >= 50) cache.delete(cache.keys().next().value);
      entry = { expires: Date.now() + TTL, result: load() };
      cache.set(key, entry);
      const current = entry;
      entry.result.catch(() => {
        if (cache.get(key) === current) cache.delete(key);
      });
    }
    return structuredClone(await entry.result);
  }
  lookup(input: string): Promise<NftCollectionLookup> {
    const slug = openSeaCollectionSlug(input);
    return this.cached(this.collections, slug, () => this.readCollection(slug));
  }
  private standard(value: unknown): Standard | null {
    const standard =
      typeof value === "string" ? value.toLowerCase().replace("-", "") : "";
    return standard === "erc721" || standard === "erc1155" ? standard : null;
  }
  private async readCollection(slug: string): Promise<NftCollectionLookup> {
    const deadline = Date.now() + 30000;
    const data = await this.request(
      `collections/${encodeURIComponent(slug)}`,
      deadline,
      true,
    );
    if (
      !data ||
      typeof data.collection !== "string" ||
      !SLUG.test(data.collection) ||
      typeof data.name !== "string" ||
      !data.name.trim() ||
      !Array.isArray(data.contracts) ||
      !data.contracts.length ||
      data.contracts.length > 10
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    if (data.is_disabled === true)
      throw new BadRequestException(
        "This collection is unavailable on OpenSea. Enter a contract address to define a rule manually.",
      );
    if (
      data.unique_item_count !== undefined &&
      data.unique_item_count !== null &&
      (!Number.isSafeInteger(data.unique_item_count) ||
        data.unique_item_count < 0)
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    const contracts: CollectionContract[] = [];
    for (const contract of data.contracts) {
      if (
        typeof contract?.chain !== "string" ||
        !/^[a-z0-9_-]{1,40}$/.test(contract.chain) ||
        typeof contract.address !== "string" ||
        !contract.address.trim() ||
        contract.address.length > 200 ||
        /\s/.test(contract.address) ||
        /^0x0{40}$/i.test(contract.address)
      )
        throw new ServiceUnavailableException(UNAVAILABLE);
      const network = NFT_NETWORKS.find((n) => n.value === contract.chain);
      if (network && !ADDRESS.test(contract.address))
        throw new ServiceUnavailableException(UNAVAILABLE);
      const address = ADDRESS.test(contract.address)
        ? contract.address.toLowerCase()
        : contract.address;
      if (
        contracts.some(
          (c) => c.chain === contract.chain && c.contract_address === address,
        )
      )
        continue;
      let standard: Standard | null = null;
      if (network) {
        const metadata = await this.request(
          `chain/${contract.chain}/contract/${address}`,
          deadline,
        );
        if (
          typeof metadata?.address !== "string" ||
          metadata.address.toLowerCase() !== address ||
          metadata.chain !== contract.chain
        )
          throw new ServiceUnavailableException(UNAVAILABLE);
        standard = this.standard(metadata.contract_standard);
      }
      contracts.push({
        chain: contract.chain,
        network: network?.value || null,
        network_name: network?.name || contract.chain,
        contract_address: address,
        token_standard: standard,
        supported: !!network && !!standard,
      });
    }
    return {
      source: "opensea",
      slug: data.collection,
      name: data.name.trim().slice(0, 100),
      url: `https://opensea.io/collection/${data.collection}`,
      unique_item_count: data.unique_item_count ?? null,
      contracts,
      resolved_at: new Date().toISOString(),
    };
  }
  async collectionTokens(
    input: string,
    network: string,
    address: string,
  ): Promise<NftCollectionTokens> {
    if (
      typeof network !== "string" ||
      typeof address !== "string" ||
      !ADDRESS.test(address)
    )
      throw new BadRequestException(
        "Choose a contract from the collection lookup.",
      );
    const collection = await this.lookup(input);
    const candidate = collection.contracts.find(
      (c) =>
        c.network === network &&
        c.contract_address === address.toLowerCase() &&
        c.supported,
    );
    if (!candidate)
      throw new BadRequestException(
        "Choose a supported contract from this collection.",
      );
    return this.cached(
      this.tokens,
      `${collection.slug}:${network}:${candidate.contract_address}`,
      () => this.readTokens(collection, candidate),
    ).catch((error) => {
      // Refresh stale catalog counts on the next attempt; never cache partial IDs.
      this.collections.delete(openSeaCollectionSlug(input));
      throw error;
    });
  }
  private tokenId(value: unknown): string {
    if (
      typeof value !== "string" ||
      !/^(?:\d{1,78}|0x[0-9a-fA-F]{1,64})$/.test(value)
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    const id = BigInt(value);
    if (id >= 1n << 256n) throw new ServiceUnavailableException(UNAVAILABLE);
    return id.toString();
  }
  private tokenContract(
    token: any,
    collection: NftCollectionLookup,
  ): CollectionContract {
    if (
      typeof token?.contract !== "string" ||
      !ADDRESS.test(token.contract) ||
      token.collection !== collection.slug
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    const candidates = collection.contracts.filter(
      (c) => c.contract_address === token.contract.toLowerCase(),
    );
    let chain = token.chain;
    if (chain !== undefined && typeof chain !== "string")
      throw new ServiceUnavailableException(UNAVAILABLE);
    // OpenSea's collection inventory need not include a chain field. A contract
    // can only disambiguate it when that address occurs on one collection chain.
    if (!chain && candidates.length > 1) {
      try {
        const url = new URL(token.opensea_url);
        const parts = url.pathname.split("/");
        if (
          url.protocol !== "https:" ||
          !["opensea.io", "www.opensea.io"].includes(url.hostname) ||
          parts.length !== 5 ||
          parts[1] !== "assets" ||
          parts[3].toLowerCase() !== token.contract.toLowerCase() ||
          this.tokenId(parts[4]) !== this.tokenId(token.identifier)
        )
          throw new Error();
        chain = parts[2];
      } catch {
        throw new ServiceUnavailableException(
          "OpenSea did not identify the network for this token. Use explicit contract and token IDs.",
        );
      }
    }
    const candidate = chain
      ? candidates.find((c) => c.chain === chain)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (
      !candidate ||
      (candidate.token_standard &&
        this.standard(token.token_standard) !== candidate.token_standard)
    )
      throw new ServiceUnavailableException(UNAVAILABLE);
    return candidate;
  }
  private async readTokens(
    collection: NftCollectionLookup,
    selected: CollectionContract,
  ): Promise<NftCollectionTokens> {
    if (collection.contracts.some((c) => !ADDRESS.test(c.contract_address)))
      throw new BadRequestException(
        "This collection includes token inventories on unsupported networks. Use an explicit contract and token selection.",
      );
    const tooLarge = () =>
      new BadRequestException(
        "This collection is too large for a fixed token-ID lookup. Use an entire ERC-721 contract only if that is the scope you want, or enter a smaller token-ID selection manually.",
      );
    if (
      collection.unique_item_count !== null &&
      collection.unique_item_count > MAX_PAGES * PAGE_SIZE
    )
      throw tooLarge();
    const deadline = Date.now() + 30000,
      seen = new Set<string>(),
      cursors = new Set<string>(),
      ids = new Set<string>();
    let next: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        ...(next ? { next } : {}),
      });
      const data = await this.request(
        `collection/${collection.slug}/nfts?${query}`,
        deadline,
      );
      if (
        !Array.isArray(data?.nfts) ||
        data.nfts.length > PAGE_SIZE ||
        (data.next !== undefined &&
          data.next !== null &&
          (typeof data.next !== "string" || data.next.length > 2000)) ||
        (data.next && !data.nfts.length)
      )
        throw new ServiceUnavailableException(UNAVAILABLE);
      for (const token of data.nfts) {
        const contract = this.tokenContract(token, collection),
          id = this.tokenId(token.identifier);
        const identity = `${contract.chain}:${contract.contract_address}:${id}`;
        if (seen.has(identity))
          throw new ServiceUnavailableException(
            "OpenSea returned overlapping token pages. Please try the lookup again.",
          );
        seen.add(identity);
        if (
          contract.chain === selected.chain &&
          contract.contract_address === selected.contract_address
        )
          ids.add(id);
        if (ids.size > NFT_MAX_IDS) throw tooLarge();
      }
      if (!data.next) {
        if (
          collection.unique_item_count !== null &&
          seen.size !== collection.unique_item_count
        )
          throw new ServiceUnavailableException(
            "OpenSea returned an incomplete collection. Please try the lookup again.",
          );
        if (!ids.size)
          throw new BadRequestException(
            "No collection tokens were found for this contract. Enter an explicit selection manually.",
          );
        const ordered = parseTokenIds([...ids].join(",")),
          input = compactTokenIds(ordered);
        if (input.length > 6000)
          throw new BadRequestException(
            "These token IDs exceed the rule editor’s 6,000-character limit. Enter a smaller selection manually.",
          );
        return {
          collection: collection.slug,
          collection_name: collection.name,
          contract_address: selected.contract_address,
          network: selected.network,
          token_standard: selected.token_standard,
          token_ids: ordered,
          token_ids_input: input,
          resolved_at: new Date().toISOString(),
        };
      }
      if (cursors.has(data.next))
        throw new ServiceUnavailableException(
          "OpenSea returned repeated token pages. Please try the lookup again.",
        );
      cursors.add(data.next);
      next = data.next;
    }
    throw tooLarge();
  }
  private async request(
    path: string,
    deadline: number,
    collection = false,
  ): Promise<any> {
    this.configured();
    if (this.requests >= 4)
      throw new ServiceUnavailableException(
        "Collection lookup is busy. Please try again shortly.",
      );
    if (deadline <= Date.now())
      throw new ServiceUnavailableException(UNAVAILABLE);
    this.requests++;
    try {
      const response = await fetch(`https://api.opensea.io/api/v2/${path}`, {
        headers: {
          Accept: "application/json",
          "x-api-key": EnvironmentConfig.OPENSEA_API_KEY.trim(),
        },
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(10000, deadline - Date.now())),
        ),
        redirect: "error",
      });
      if (response.status === 404 && collection)
        throw new NotFoundException(
          "Collection not found on OpenSea. Check its collection URL or slug.",
        );
      if (response.status === 401 || response.status === 403)
        throw new ServiceUnavailableException(
          "OpenSea lookup is unavailable. Ask the Bouncer operator to check API access, or enter a contract address.",
        );
      if (response.status === 429)
        throw new ServiceUnavailableException(
          "OpenSea is busy. Please try the lookup again shortly.",
        );
      if (!response.ok || !response.body)
        throw new ServiceUnavailableException(UNAVAILABLE);
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 2_000_000) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(UNAVAILABLE);
    } finally {
      this.requests--;
    }
  }
}
