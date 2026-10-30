import {
  compressedCollection,
  compressedCreators,
  validateCompressedAsset,
  compressedUnavailable,
} from "@/utils/solana-compressed.util";
import { Injectable } from "@nestjs/common";
import { EnvironmentConfig } from "@/config/environment.config";
import { VerifierRole } from "@/models/verifier-role.interface";
import {
  normalizeSolanaAddress,
  solanaBase58,
  SOLANA_MAINNET,
  SPL_TOKEN,
  TOKEN_2022,
  solanaMetadataAddress,
  solanaMetadataCollection,
  TOKEN_METADATA_PROGRAM,
} from "@/utils/solana.util";
import { solanaCriteria, SolanaCriteria } from "@/utils/solana-rule.util";
import { matchesTraits, ruleTraits } from "@/utils/trait-filter.util";
import { parseTokenBalance } from "@/utils/erc20-rule.util";
import { NftCheckContext } from "./nft-ownership.service";

// Smaller pages avoid slow provider responses while retaining the 25,000-entry cap.
const INVENTORY_PAGE_LIMIT = 500;
const MAX_INVENTORY_PAGES = 50;

const UNAVAILABLE =
  "Solana ownership is temporarily unavailable. Existing roles are preserved.";
const SAFE_EXTENSIONS = new Set([
  "immutableOwner",
  "metadataPointer",
  "tokenMetadata",
  "mintCloseAuthority",
  "transferFeeConfig",
  "transferFeeAmount",
  "permanentDelegate",
  "nonTransferable",
  "nonTransferableAccount",
  "defaultAccountState",
]);
type Run = {
  deadline: number;
  reads: Map<string, Promise<any>>;
  compressedReads?: number;
};

@Injectable()
export class SolanaOwnershipService {
  private readonly runs = new WeakMap<NftCheckContext, Run>();
  private active = 0;
  private nextRequest = 0;
  private readonly waiting: Array<() => void> = [];

  private run(context?: NftCheckContext): Run {
    if (!EnvironmentConfig.SOLANA_ENABLED)
      throw new Error("Solana verification is not enabled.");
    if (!context) return { deadline: Date.now() + 30000, reads: new Map() };
    if (!this.runs.has(context))
      this.runs.set(context, {
        deadline: Date.now() + 30000,
        reads: new Map(),
      });
    return { ...this.runs.get(context), deadline: Date.now() + 30000 };
  }
  private cache<T>(run: Run, key: string, load: () => Promise<T>): Promise<T> {
    if (!run.reads.has(key)) run.reads.set(key, load());
    return run.reads.get(key);
  }
  private async request(
    url: string,
    method: string,
    params: any,
    run: Run,
  ): Promise<any> {
    if (!url)
      throw new Error("Configure the backend Solana RPC and DAS endpoints.");
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new Error();
    } catch {
      throw new Error("Configure HTTPS Solana endpoints.");
    }
    if (this.active >= 2)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const wait = Math.max(0, this.nextRequest - Date.now());
      this.nextRequest = Math.max(Date.now(), this.nextRequest) + 500;
      if (Date.now() + wait >= run.deadline) throw new Error();
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (Date.now() >= run.deadline) throw new Error();
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(Math.min(10000, run.deadline - Date.now())),
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 4000000) {
            await reader.cancel();
            throw new Error();
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (
        data.jsonrpc !== "2.0" ||
        data.id !== 1 ||
        data.error ||
        data.result === undefined
      )
        throw new Error();
      return data.result;
    } catch {
      throw new Error(UNAVAILABLE);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  private async cluster(run: Run, das = false) {
    const url = das
      ? EnvironmentConfig.SOLANA_DAS_URL
      : EnvironmentConfig.SOLANA_RPC_URL;
    await this.cache(run, `cluster:${url}`, async () => {
      if (
        (await this.request(url, "getGenesisHash", [], run)) !== SOLANA_MAINNET
      )
        throw new Error("Solana provider is not mainnet.");
    });
  }
  private extensions(info: any) {
    if (info.extensions === undefined) return;
    if (
      !Array.isArray(info.extensions) ||
      info.extensions.some((e) => !e || !SAFE_EXTENSIONS.has(e.extension))
    )
      throw new Error(
        "This Token-2022 extension is not supported for balance verification.",
      );
  }
  private slot(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
      throw new Error(UNAVAILABLE);
    return value as number;
  }
  async checkSetupHealth(compressed = false): Promise<void> {
    if (compressed && !EnvironmentConfig.SOLANA_COMPRESSED_ENABLED)
      throw new Error("Compressed Solana NFT verification is not enabled.");
    const run = this.run();
    await this.cluster(run);
    await this.cluster(run, true);
    this.slot(
      await this.request(
        EnvironmentConfig.SOLANA_RPC_URL,
        "getSlot",
        [{ commitment: "finalized" }],
        run,
      ),
    );
  }
  private async mint(mint: string, run: Run) {
    normalizeSolanaAddress(mint);
    await this.cluster(run);
    return this.cache(run, `mint:${mint}`, async () => {
      const result = await this.request(
        EnvironmentConfig.SOLANA_RPC_URL,
        "getAccountInfo",
        [mint, { encoding: "jsonParsed", commitment: "finalized" }],
        run,
      );
      const account = result?.value,
        info = account?.data?.parsed?.info;
      if (
        !account ||
        account.executable !== false ||
        ![SPL_TOKEN, TOKEN_2022].includes(account.owner) ||
        account.data?.parsed?.type !== "mint" ||
        info?.isInitialized !== true ||
        !Number.isInteger(info.decimals) ||
        info.decimals < 0 ||
        info.decimals > 255
      )
        throw new Error("Use an initialized Solana token mint.");
      this.extensions(info);
      return {
        program: account.owner as string,
        decimals: info.decimals as number,
        slot: this.slot(result.context?.slot),
      };
    });
  }
  async prepareToken(mint: string, minimum: string) {
    const data = await this.mint(mint, this.run());
    const min_balance = parseTokenBalance(minimum, data.decimals);
    if (BigInt(min_balance) > (1n << 64n) - 1n)
      throw new Error("Minimum exceeds Solana token supply limits.");
    return {
      solana_criteria: {
        kind: "token",
        mint,
        program: data.program,
      } as SolanaCriteria,
      min_balance,
      token_decimals: data.decimals,
    };
  }
  async count(
    rule: VerifierRole,
    addresses: string[],
    context?: NftCheckContext,
  ): Promise<bigint> {
    if (rule.asset_type !== "solana_token")
      return BigInt((await this.matchingAssets(rule, addresses, context)).size);
    const criteria = solanaCriteria(rule.solana_criteria);
    if (criteria.kind !== "token")
      throw new Error("Invalid Solana token rule.");
    const run = this.run(context),
      mint = await this.mint(criteria.mint, run);
    if (
      mint.program !== criteria.program ||
      mint.decimals !== rule.token_decimals
    )
      throw new Error("Solana mint configuration changed.");
    let sum = 0n;
    const accountsSeen = new Set<string>();
    for (const owner of [...new Set(addresses)]) {
      normalizeSolanaAddress(owner);
      const balances = await this.cache<Map<string, bigint>>(
        run,
        `balance:${owner}:${criteria.mint}`,
        async () => {
          const response = await this.request(
            EnvironmentConfig.SOLANA_RPC_URL,
            "getTokenAccountsByOwner",
            [
              owner,
              { mint: criteria.mint },
              {
                encoding: "jsonParsed",
                commitment: "finalized",
                minContextSlot: mint.slot,
              },
            ],
            run,
          );
          if (
            this.slot(response?.context?.slot) < mint.slot ||
            !Array.isArray(response.value)
          )
            throw new Error(UNAVAILABLE);
          const amounts = new Map<string, bigint>();
          const seen = new Set<string>();
          for (const entry of response.value) {
            normalizeSolanaAddress(entry.pubkey);
            if (seen.has(entry.pubkey)) throw new Error(UNAVAILABLE);
            seen.add(entry.pubkey);
            const account = entry.account,
              info = account?.data?.parsed?.info;
            if (
              account?.owner !== mint.program ||
              account.executable !== false ||
              account.data?.parsed?.type !== "account" ||
              info?.owner !== owner ||
              info.mint !== criteria.mint ||
              !["initialized", "frozen"].includes(info.state) ||
              info.tokenAmount?.decimals !== mint.decimals ||
              !/^(0|[1-9]\d{0,19})$/.test(info.tokenAmount?.amount || "")
            )
              throw new Error(UNAVAILABLE);
            this.extensions(info);
            const balance = BigInt(info.tokenAmount.amount);
            if (balance >= 1n << 64n) throw new Error(UNAVAILABLE);
            amounts.set(entry.pubkey, balance);
          }
          return amounts;
        },
      );
      for (const [account, amount] of balances) {
        if (accountsSeen.has(account)) throw new Error(UNAVAILABLE);
        accountsSeen.add(account);
        sum += amount;
        if (sum >= 1n << 64n) throw new Error(UNAVAILABLE);
      }
    }
    return sum;
  }
  private async inventory(owner: string, run: Run): Promise<any[]> {
    normalizeSolanaAddress(owner);
    return this.cache(run, `assets:${owner}`, async () => {
      await this.cluster(run);
      await this.cluster(run, true);
      const slot = this.slot(
        await this.request(
          EnvironmentConfig.SOLANA_RPC_URL,
          "getSlot",
          [{ commitment: "finalized" }],
          run,
        ),
      );
      run.reads.set(`inventory-slot:${owner}`, Promise.resolve(slot));
      const items: any[] = [],
        seen = new Set<string>();
      for (let page = 1; page <= MAX_INVENTORY_PAGES; page++) {
        const data = await this.request(
          EnvironmentConfig.SOLANA_DAS_URL,
          "getAssetsByOwner",
          {
            ownerAddress: owner,
            page,
            limit: INVENTORY_PAGE_LIMIT,
            sortBy: { sortBy: "created", sortDirection: "asc" },
            displayOptions: {
              showCollectionMetadata: true,
              showUnverifiedCollections: true,
              showFungible: false,
              showZeroBalance: false,
            },
          },
          run,
        );
        if (
          this.slot(data?.last_indexed_slot) < slot ||
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          !Array.isArray(data.items) ||
          data.items.length > INVENTORY_PAGE_LIMIT ||
          data.page !== page ||
          data.limit !== INVENTORY_PAGE_LIMIT ||
          // DAS reports the number of items on this page, not a grand total.
          data.total !== data.items.length
        )
          throw new Error(UNAVAILABLE);
        for (const asset of data.items) {
          normalizeSolanaAddress(asset?.id);
          if (
            seen.has(asset.id) ||
            asset.ownership?.owner !== owner ||
            typeof asset.burnt !== "boolean"
          )
            throw new Error(UNAVAILABLE);
          seen.add(asset.id);
          items.push(asset);
        }
        if (data.items.length < INVENTORY_PAGE_LIMIT) return items;
      }
      throw new Error("Solana inventory exceeds the complete-check limit.");
    });
  }
  private async ownedNftMints(owner: string, run: Run, minSlot: number) {
    return this.cache<Set<string>>(run, `nft-mints:${owner}:${minSlot}`, async () => {
      const mints = new Set<string>();
      const seen = new Set<string>();
      for (const program of [SPL_TOKEN, TOKEN_2022]) {
        const response = await this.request(
          EnvironmentConfig.SOLANA_RPC_URL,
          "getTokenAccountsByOwner",
          [
            owner,
            { programId: program },
            {
              encoding: "base64",
              dataSlice: { offset: 0, length: 109 },
              commitment: "finalized",
              minContextSlot: minSlot,
            },
          ],
          run,
        );
        if (
          this.slot(response?.context?.slot) < minSlot ||
          !Array.isArray(response.value)
        )
          throw new Error(UNAVAILABLE);
        for (const entry of response.value) {
          normalizeSolanaAddress(entry.pubkey);
          if (seen.has(entry.pubkey)) throw new Error(UNAVAILABLE);
          seen.add(entry.pubkey);
          const account = entry.account;
          if (
            account?.owner !== program ||
            account.executable !== false ||
            !Array.isArray(account.data) ||
            account.data[1] !== "base64" ||
            typeof account.data[0] !== "string"
          )
            throw new Error(UNAVAILABLE);
          // The shared SPL/Token-2022 prefix is mint(32), owner(32), amount(8),
          // delegate(36), state(1). No mint-dependent JSON parser is needed.
          const bytes = Buffer.from(account.data[0], "base64");
          if (
            bytes.length !== 109 ||
            bytes.toString("base64") !== account.data[0] ||
            ![1, 2].includes(bytes[108]) ||
            solanaBase58(new Uint8Array(bytes.subarray(32, 64))) !== owner
          )
            throw new Error(UNAVAILABLE);
          if (bytes.readBigUInt64LE(64) > 0n)
            mints.add(solanaBase58(new Uint8Array(bytes.subarray(0, 32))));
        }
      }
      return mints;
    });
  }
  private async onchainAssets(
    assets: any[],
    run: Run,
    minSlot: number,
  ): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    for (let offset = 0; offset < assets.length; offset += 100) {
      const chunk = assets.slice(offset, offset + 100);
      const rows = await this.cache(
        run,
        `onchain:${minSlot}:${chunk.map((a) => a.id + ":" + a.ownership.owner).join(",")}`,
        async () => {
          const keys = chunk.map((a) =>
            a.interface === "MplCoreAsset" ? a.id : solanaMetadataAddress(a.id),
          );
          const response = await this.request(
            EnvironmentConfig.SOLANA_RPC_URL,
            "getMultipleAccounts",
            [
              keys,
              {
                encoding: "base64",
                commitment: "finalized",
                minContextSlot: minSlot,
              },
            ],
            run,
          );
          if (this.slot(response?.context?.slot) < minSlot)
            throw new Error(UNAVAILABLE);
          if (
            !Array.isArray(response.value) ||
            response.value.length !== chunk.length
          )
            throw new Error(UNAVAILABLE);
          return response.value.map((account, index) => {
            if (
              !account ||
              account.executable !== false ||
              !Array.isArray(account.data) ||
              account.data[1] !== "base64" ||
              typeof account.data[0] !== "string"
            )
              throw new Error(UNAVAILABLE);
            const bytes = Buffer.from(account.data[0], "base64");
            if (bytes.toString("base64") !== account.data[0])
              throw new Error(UNAVAILABLE);
            const asset = chunk[index];
            if (asset.interface === "MplCoreAsset") {
              if (
                account.owner !==
                  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" ||
                bytes.length < 34 ||
                bytes[0] !== 1 ||
                bytes[33] > 2
              )
                throw new Error(UNAVAILABLE);
              if (
                solanaBase58(new Uint8Array(bytes.subarray(1, 33))) !==
                asset.ownership.owner
              )
                throw new Error(UNAVAILABLE);
              if (bytes[33] !== 0 && bytes.length < 66)
                throw new Error(UNAVAILABLE);
              return {
                collection:
                  bytes[33] === 2
                    ? solanaBase58(new Uint8Array(bytes.subarray(34, 66)))
                    : null,
              };
            }
            if (account.owner !== TOKEN_METADATA_PROGRAM)
              throw new Error(UNAVAILABLE);
            return { collection: solanaMetadataCollection(bytes, asset.id) };
          });
        },
      );
      chunk.forEach((asset, index) => result.set(asset.id, rows[index]));
    }
    return result;
  }
  private async compressedAssets(assets: any[], run: Run, minSlot: number) {
    const cacheKey = (id: string) => `compressed:${id}:${minSlot}`;
    const pending = assets.filter(
      (asset) => !run.reads.has(cacheKey(asset.id)),
    );
    run.compressedReads = (run.compressedReads || 0) + pending.length;
    if (run.compressedReads > 1000)
      throw new Error(
        "Compressed NFT lookup exceeds the complete-check limit.",
      );
    for (let offset = 0; offset < pending.length; offset += 100) {
      const ids = pending.slice(offset, offset + 100).map((asset) => asset.id);
      const items =
        pending.length === 1
          ? [
              await this.request(
                EnvironmentConfig.SOLANA_DAS_URL,
                "getAsset",
                {
                  id: ids[0],
                  displayOptions: { showUnverifiedCollections: true },
                },
                run,
              ),
            ]
          : await this.request(
              EnvironmentConfig.SOLANA_DAS_URL,
              "getAssetBatch",
              {
                ids,
                displayOptions: { showUnverifiedCollections: true },
              },
              run,
            );
      if (!Array.isArray(items) || items.length !== ids.length)
        compressedUnavailable();
      const byId = new Map(items.map((asset) => [asset?.id, asset]));
      if (byId.size !== ids.length || ids.some((id) => !byId.has(id)))
        compressedUnavailable();
      for (const id of ids) {
        const asset = validateCompressedAsset(byId.get(id));
        run.reads.set(cacheKey(id), Promise.resolve(asset));
      }
    }
    return new Map(
      await Promise.all(
        assets.map(
          async (asset) =>
            [asset.id, await run.reads.get(cacheKey(asset.id))] as const,
        ),
      ),
    );
  }
  private compressedSelected(
    asset: any,
    criteria: Exclude<SolanaCriteria, { kind: "token" }>,
  ): boolean {
    if (criteria.kind === "asset_ids")
      return criteria.addresses.includes(asset.id);
    if (criteria.kind === "verified_creator")
      return compressedCreators(asset).some(
        (creator) =>
          creator.verified && criteria.addresses.includes(creator.address),
      );
    const collection = compressedCollection(asset);
    return (
      !!collection?.verified && criteria.addresses.includes(collection.address)
    );
  }
  async matchingAssets(
    rule: VerifierRole,
    addresses: string[],
    context?: NftCheckContext,
  ): Promise<Map<string, bigint>> {
    const criteria = solanaCriteria(rule.solana_criteria);
    if (rule.asset_type !== "solana_nft" || criteria.kind === "token")
      throw new Error("Invalid Solana NFT rule.");
    if (
      criteria.formats.includes("compressed") &&
      !EnvironmentConfig.SOLANA_COMPRESSED_ENABLED
    )
      throw new Error(
        "Compressed Solana NFT verification is not enabled. Existing roles are preserved.",
      );
    const run = this.run(context),
      matches = new Map<string, bigint>();
    for (const owner of [...new Set(addresses)]) {
      let inventory = await this.inventory(owner, run);
      const minSlot = await run.reads.get(`inventory-slot:${owner}`);
      const metadataAsset = (asset: any) =>
        !asset.burnt &&
        asset.compression?.compressed !== true &&
        ["V1_NFT", "ProgrammableNFT"].includes(asset.interface);
      if (
        criteria.formats.includes("metadata") &&
        inventory.some(metadataAsset)
      ) {
        // A fresh index watermark does not make every individual asset row current.
        // Confirm actual holdings before trusting indexed ownership or burned flags.
        const owned = await this.ownedNftMints(owner, run, minSlot);
        inventory = inventory.filter(
          (asset) => !metadataAsset(asset) || owned.has(asset.id),
        );
      }
      const needs = inventory.filter(
        (a) =>
          !a.burnt &&
          a.compression?.compressed !== true &&
          ((a.interface === "MplCoreAsset" &&
            criteria.formats.includes("core")) ||
            (criteria.kind === "collection" &&
              criteria.formats.includes("metadata") &&
              ["V1_NFT", "ProgrammableNFT"].includes(a.interface))),
      );
      const chain = await this.onchainAssets(needs, run, minSlot);
      let compressedDetails = new Map<string, any>();
      if (criteria.formats.includes("compressed")) {
        const candidates = inventory.filter(
          (asset) =>
            !asset.burnt &&
            asset.compression?.compressed === true &&
            this.compressedSelected(asset, criteria),
        );
        compressedDetails = await this.compressedAssets(candidates, run, minSlot);
      }
      for (let asset of inventory) {
        if (asset.burnt) continue;
        const compressed = asset.compression?.compressed === true;
        if (compressed) {
          if (
            !criteria.formats.includes("compressed") ||
            !this.compressedSelected(asset, criteria)
          )
            continue;
          asset = compressedDetails.get(asset.id);
          if (!asset) compressedUnavailable();
          if (asset.burnt || asset.ownership.owner !== owner) continue;
          if (!this.compressedSelected(asset, criteria)) continue;
        }
        const format = compressed
          ? "compressed"
          : ["V1_NFT", "ProgrammableNFT"].includes(asset.interface)
            ? "metadata"
            : asset.interface === "MplCoreAsset"
              ? "core"
              : null;
        if (!format || !criteria.formats.includes(format)) continue;
        if (
          format === "metadata" &&
          typeof asset.compression?.compressed !== "boolean"
        )
          throw new Error(UNAVAILABLE);
        if (asset.ownership.ownership_model !== "single")
          throw new Error(UNAVAILABLE);
        let selected = compressed;
        if (!compressed && criteria.kind === "asset_ids")
          selected = criteria.addresses.includes(asset.id);
        if (!compressed && criteria.kind === "collection") {
          const relation = chain.get(asset.id)?.collection;
          selected =
            format === "core"
              ? !!relation && criteria.addresses.includes(relation)
              : !!relation?.verified &&
                criteria.addresses.includes(relation.address);
        }
        if (!compressed && criteria.kind === "verified_creator") {
          if (!Array.isArray(asset.creators)) throw new Error(UNAVAILABLE);
          selected = asset.creators.some(
            (c) =>
              c.verified === true && criteria.addresses.includes(c.address),
          );
        }
        if (!selected) continue;
        if (ruleTraits(rule)) {
          const attributes = asset.content?.metadata?.attributes;
          if (
            !Array.isArray(attributes) ||
            attributes.some(
              (a) =>
                typeof a?.trait_type !== "string" ||
                !["string", "number", "boolean"].includes(typeof a.value),
            )
          )
            throw new Error("Solana trait metadata is unavailable.");
          if (
            !matchesTraits(
              attributes.map((a) => ({
                key: a.trait_type,
                value: String(a.value),
              })),
              rule,
            )
          )
            continue;
        }
        if (matches.has(asset.id)) throw new Error(UNAVAILABLE);
        matches.set(asset.id, 1n);
      }
    }
    return matches;
  }
}
