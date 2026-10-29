import { SolanaOwnershipService } from "../src/services/solana-ownership.service";
import { EnvironmentConfig } from "../src/config/environment.config";
import {
  SOLANA_MAINNET,
  SPL_TOKEN,
  TOKEN_2022,
  solanaPublicKey,
  solanaBase58,
  TOKEN_METADATA_PROGRAM,
} from "../src/utils/solana.util";

const owner = "So11111111111111111111111111111111111111112";
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const id = "11111111111111111111111111111111";
const base = {
  id: 1,
  server_id: "server",
  channel_id: "channel",
  role_id: "role",
  min_items: 1,
} as any;
const nft = {
  ...base,
  asset_type: "solana_nft",
  solana_criteria: {
    kind: "asset_ids",
    addresses: [id],
    formats: ["metadata", "core"],
  },
};
const asset = () => ({
  id,
  interface: "V1_NFT",
  burnt: false,
  ownership: { owner, ownership_model: "single" },
  compression: { compressed: false },
  grouping: [],
  creators: [],
});
function nftAccounts(items: any[], program: string) {
  return {
    context: { slot: 100 },
    value: program !== SPL_TOKEN ? [] : items
      .filter((item) => ["V1_NFT", "ProgrammableNFT"].includes(item.interface))
      .map((item) => {
        const bytes = Buffer.alloc(109);
        bytes.set(solanaPublicKey(item.id), 0);
        bytes.set(solanaPublicKey(owner), 32);
        bytes.writeBigUInt64LE(1n, 64);
        bytes[108] = 2; // Frozen ownership still counts.
        return {
          pubkey: item.id,
          account: { owner: program, executable: false, data: [bytes.toString("base64"), "base64"] },
        };
      }),
  };
}
describe("Solana ownership adapter", () => {
  let service: SolanaOwnershipService, request: jest.SpyInstance;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", true);
    service = new SolanaOwnershipService();
    request = jest.spyOn(service as any, "request");
  });
  afterEach(() => jest.restoreAllMocks());
  function inventory(items: any[] = [], overrides = {}) {
    request.mockImplementation(async (_url, method, params) => {
      if (method === "getGenesisHash") return SOLANA_MAINNET;
      if (method === "getSlot") return 100;
      if (method === "getTokenAccountsByOwner") return nftAccounts(items, params[1].programId);
      if (method === "getAssetsByOwner")
        return {
          last_indexed_slot: 100,
          total: items.length,
          page: 1,
          limit: 500,
          items,
          ...overrides,
        };
      throw new Error("Unexpected RPC method");
    });
  }
  function token(program = SPL_TOKEN, extensions: any[] = []) {
    request.mockImplementation(async (_url, method) => {
      if (method === "getGenesisHash") return SOLANA_MAINNET;
      if (method === "getAccountInfo")
        return {
          context: { slot: 100 },
          value: {
            executable: false,
            owner: program,
            data: {
              parsed: {
                type: "mint",
                info: { decimals: 6, isInitialized: true, extensions },
              },
            },
          },
        };
      if (method === "getTokenAccountsByOwner")
        return {
          context: { slot: 100 },
          value: [
            {
              pubkey: id,
              account: {
                executable: false,
                owner: program,
                data: {
                  parsed: {
                    type: "account",
                    info: {
                      owner,
                      mint,
                      state: "initialized",
                      tokenAmount: { amount: "9007199254740993", decimals: 6 },
                    },
                  },
                },
              },
            },
          ],
        };
      throw new Error("Unexpected RPC method");
    });
  }
  it("adds directly held SPL balances without floating point conversion or repeated wallet counts", async () => {
    token();
    const prepared = await service.prepareToken(mint, "1.000001");
    expect(prepared.min_balance).toBe("1000001");
    expect(
      await service.count(
        { ...base, asset_type: "solana_token", ...prepared },
        [owner, owner],
      ),
    ).toBe(9007199254740993n);
  });
  it("supports explicit transparent Token-2022 extensions but rejects unknown economic/confidential semantics", async () => {
    token(TOKEN_2022, [{ extension: "metadataPointer" }]);
    expect(
      (await service.prepareToken(mint, "1")).solana_criteria,
    ).toMatchObject({ program: TOKEN_2022 });
    token(TOKEN_2022, [{ extension: "confidentialTransferMint" }]);
    await expect(service.prepareToken(mint, "1")).rejects.toThrow(
      "not supported",
    );
  });
  it("rejects an RPC provider on another cluster", async () => {
    request.mockResolvedValue("devnet");
    await expect(service.prepareToken(mint, "1")).rejects.toThrow(
      "not mainnet",
    );
  });
  it("requires mint/program/decimals continuity", async () => {
    token();
    await expect(
      service.count(
        {
          ...base,
          asset_type: "solana_token",
          token_decimals: 9,
          solana_criteria: { kind: "token", mint, program: SPL_TOKEN },
        },
        [owner],
      ),
    ).rejects.toThrow("configuration changed");
  });
  it("counts exact NFT asset IDs and ignores burned and explicitly excluded compressed assets", async () => {
    inventory([asset()]);
    expect(await service.count(nft, [owner])).toBe(1n);
    inventory([{ ...asset(), burnt: true }]);
    expect(await service.count(nft, [owner])).toBe(0n);
    inventory([{ ...asset(), compression: { compressed: true } }]);
    expect(await service.count(nft, [owner])).toBe(0n);
  });
  it("uses verified creators, never matching a forged unverified creator", async () => {
    const rule = {
      ...nft,
      solana_criteria: {
        kind: "verified_creator",
        addresses: [mint],
        formats: ["metadata"],
      },
    };
    inventory([{ ...asset(), creators: [{ address: mint, verified: false }] }]);
    expect(await service.count(rule, [owner])).toBe(0n);
    inventory([{ ...asset(), creators: [{ address: mint, verified: true }] }]);
    expect(await service.count(rule, [owner])).toBe(1n);
  });
  it("validates collection membership on-chain, including when the index omits the group", async () => {
    inventory([asset()]);
    const previous = request.getMockImplementation();
    let verified = 1;
    request.mockImplementation(async (url, method, params, run) => {
      if (method === "getMultipleAccounts") {
        const bytes = Buffer.from([
          4,
          ...new Uint8Array(32),
          ...solanaPublicKey(id),
          ...new Uint8Array(12),
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          1,
          verified,
          ...solanaPublicKey(mint),
        ]);
        return {
          context: { slot: 100 },
          value: [
            {
              owner: TOKEN_METADATA_PROGRAM,
              executable: false,
              data: [bytes.toString("base64"), "base64"],
            },
          ],
        };
      }
      return previous(url, method, params, run);
    });
    const rule = {
      ...nft,
      solana_criteria: {
        kind: "collection",
        addresses: [mint],
        formats: ["metadata"],
      },
    };
    expect(await service.count(rule, [owner])).toBe(1n);
    verified = 0;
    expect(await service.count(rule, [owner])).toBe(0n);
    expect(
      request.mock.calls.filter((c) => c[1] === "getMultipleAccounts"),
    ).toHaveLength(2);
  });
  it("checks Core program, owner and collection relationship instead of a claimed group name", async () => {
    inventory([
      {
        ...asset(),
        interface: "MplCoreAsset",
        grouping: [{ group_key: "collection", group_value: mint }],
      },
    ]);
    const previous = request.getMockImplementation();
    let program = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
    request.mockImplementation(async (url, method, params, run) => {
      if (method === "getMultipleAccounts")
        return {
          context: { slot: 100 },
          value: [
            {
              owner: program,
              executable: false,
              data: [
                Buffer.from([
                  1,
                  ...solanaPublicKey(owner),
                  2,
                  ...solanaPublicKey(mint),
                  ...new Uint8Array(9),
                ]).toString("base64"),
                "base64",
              ],
            },
          ],
        };
      return previous(url, method, params, run);
    });
    const rule = {
      ...nft,
      solana_criteria: {
        kind: "collection",
        addresses: [mint],
        formats: ["core"],
      },
    };
    expect(await service.count(rule, [owner])).toBe(1n);
    program = TOKEN_METADATA_PROGRAM;
    await expect(service.count(rule, [owner])).rejects.toThrow();
  });
  it("applies AND conditions to the same asset and refuses incomplete trait metadata", async () => {
    const rule = {
      ...nft,
      trait_filter: {
        operator: "AND",
        conditions: [
          { key: "Color", value: "Blue" },
          { key: "Hat", value: "Cap" },
        ],
      },
    } as any;
    inventory([
      {
        ...asset(),
        content: {
          metadata: {
            attributes: [
              { trait_type: "color", value: "blue" },
              { trait_type: "hat", value: "cap" },
            ],
          },
        },
      },
    ]);
    expect(await service.count(rule, [owner])).toBe(1n);
    inventory([asset()]);
    await expect(service.count(rule, [owner])).rejects.toThrow(
      "trait metadata",
    );
  });
  it.each([
    { last_indexed_slot: 99 },
    { last_indexed_slot: null },
    { total: 2 },
    { page: 2 },
    { items: [asset(), asset()], total: 2 },
    { items: [{ ...asset(), ownership: { owner: mint } }] },
  ])(
    "retains uncertainty for stale/incomplete/malformed evidence %j",
    async (overrides) => {
      inventory([asset()], overrides);
      await expect(service.count(nft, [owner])).rejects.toThrow();
    },
  );
  it("excludes closed or transferred NFTs even when the index still claims ownership", async () => {
    inventory([asset()]);
    const previous = request.getMockImplementation();
    request.mockImplementation(async (url, method, params, run) =>
      method === "getTokenAccountsByOwner"
        ? { context: { slot: 100 }, value: [] }
        : previous(url, method, params, run),
    );
    expect(await service.count(nft, [owner])).toBe(0n);
    expect(await service.count({
      ...nft,
      solana_criteria: { kind: "collection", addresses: [mint], formats: ["metadata"] },
    } as any, [owner])).toBe(0n);
    expect(request.mock.calls.some((call) => call[1] === "getMultipleAccounts")).toBe(false);
  });
  it.each(["stale", "wrong-owner", "truncated", "unavailable-program"])(
    "keeps NFT ownership uncertain for %s finalized account evidence",
    async (failure) => {
      inventory([asset()]);
      const previous = request.getMockImplementation();
      request.mockImplementation(async (url, method, params, run) => {
        if (method !== "getTokenAccountsByOwner") return previous(url, method, params, run);
        if (failure === "unavailable-program" && params[1].programId === TOKEN_2022)
          throw new Error("Unavailable token accounts");
        const result = nftAccounts([asset()], params[1].programId);
        if (failure === "stale") result.context.slot = 99;
        if (result.value.length) {
          const bytes = Buffer.from(result.value[0].account.data[0], "base64");
          if (failure === "wrong-owner") bytes.set(solanaPublicKey(mint), 32);
          result.value[0].account.data[0] = (failure === "truncated" ? bytes.subarray(0, 108) : bytes).toString("base64");
        }
        return result;
      });
      await expect(service.count(nft, [owner])).rejects.toThrow();
    },
  );
  it.each([2, 0])("reads every DAS page when the last page has %i items", async (lastCount) => {
    const first = Array.from({ length: 500 }, (_, index) => {
      const bytes = Buffer.alloc(32);
      bytes.writeUInt32BE(index + 1, 28);
      return { ...asset(), id: solanaBase58(new Uint8Array(bytes)) };
    });
    const tail = Array.from({ length: lastCount }, (_, index) => {
      const bytes = Buffer.alloc(32);
      bytes.writeUInt32BE(index + 501, 28);
      return { ...asset(), id: solanaBase58(new Uint8Array(bytes)) };
    });
    request.mockImplementation(async (_url, method, params) => {
      if (method === "getGenesisHash") return SOLANA_MAINNET;
      if (method === "getSlot") return 100;
      if (method === "getTokenAccountsByOwner") return nftAccounts([...first, ...tail], params[1].programId);
      if (method === "getAssetsByOwner") {
        const items = params.page === 1 ? first : tail;
        return { last_indexed_slot: 100, total: items.length, page: params.page, limit: 500, items };
      }
      throw new Error("Unexpected RPC method");
    });
    const rule = { ...nft, solana_criteria: { kind: "asset_ids", addresses: [first[0].id, ...(tail.length ? [tail[0].id] : [])], formats: ["metadata"] } } as any;
    expect(await service.count(rule, [owner])).toBe(lastCount ? 2n : 1n);
    expect(request.mock.calls.filter((call) => call[1] === "getAssetsByOwner").map((call) => call[2].page)).toEqual([1, 2]);
  });
  it("rejects a repeated asset across pages instead of returning a partial count", async () => {
    const first = Array.from({ length: 500 }, (_, index) => {
      const bytes = Buffer.alloc(32);
      bytes.writeUInt32BE(index + 1, 28);
      return { ...asset(), id: solanaBase58(new Uint8Array(bytes)) };
    });
    request.mockImplementation(async (_url, method, params) => {
      if (method === "getGenesisHash") return SOLANA_MAINNET;
      if (method === "getSlot") return 100;
      if (method === "getAssetsByOwner") {
        const items = params.page === 1 ? first : [first[0]];
        return { last_indexed_slot: 100, total: items.length, page: params.page, limit: 500, items };
      }
      throw new Error("Unexpected RPC method");
    });
    await expect(service.count(nft, [owner])).rejects.toThrow("temporarily unavailable");
  });
  it("reuses one complete inventory within a run and refreshes it in a new run", async () => {
    inventory([asset()]);
    const context = { checks: new Map() };
    await service.count(nft, [owner], context);
    await service.count(nft, [owner], context);
    expect(
      request.mock.calls.filter((c) => c[1] === "getAssetsByOwner"),
    ).toHaveLength(1);
    await service.count(nft, [owner], { checks: new Map() });
    expect(
      request.mock.calls.filter((c) => c[1] === "getAssetsByOwner"),
    ).toHaveLength(2);
  });
});
