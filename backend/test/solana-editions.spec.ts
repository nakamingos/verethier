import { SolanaOwnershipService } from "../src/services/solana-ownership.service";
import { EnvironmentConfig } from "../src/config/environment.config";
import {
  SOLANA_MAINNET,
  SPL_TOKEN,
  TOKEN_METADATA_PROGRAM,
  solanaBase58,
  solanaPublicKey,
  solanaEditionAddress,
  solanaMetadataAddress,
  solanaPrintParent,
} from "../src/utils/solana.util";
import { solanaCriteria, solanaRuleLabel } from "../src/utils/solana-rule.util";
import { prepareRuleCriteria } from "../src/services/rule-create.util";
const key = (n: number) => solanaBase58(new Uint8Array(32).fill(n));
const owner = key(1),
  master = key(2),
  child = key(3),
  other = key(4);
const base = {
  id: 1,
  server_id: "server",
  channel_id: "channel",
  role_id: "role",
  asset_type: "solana_nft",
  min_items: 1,
} as any;
const rule = (masters = [master]) => ({
  ...base,
  solana_criteria: {
    kind: "master_edition",
    addresses: masters,
    formats: ["metadata"],
  },
});
const asset = (id = child, interfaceName = "V1_PRINT") => ({
  id,
  interface: interfaceName,
  burnt: false,
  compression: { compressed: false },
  ownership: { owner, ownership_model: "single" },
  content: { metadata: { attributes: [{ trait_type: "Hat", value: "Cap" }] } },
});
function edition(parent = master, number = 1n) {
  const bytes = Buffer.alloc(42);
  bytes[0] = 1;
  bytes.set(solanaPublicKey(solanaEditionAddress(parent)), 1);
  bytes.writeBigUInt64LE(number, 33);
  return bytes;
}
function account(bytes: Buffer) {
  return {
    owner: TOKEN_METADATA_PROGRAM,
    executable: false,
    data: [bytes.toString("base64"), "base64"],
  };
}
describe("Solana printed editions", () => {
  let service: SolanaOwnershipService,
    request: jest.SpyInstance,
    items: any[],
    owned: Set<string>,
    records: Map<string, any>;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", true);
    service = new SolanaOwnershipService();
    items = [asset()];
    owned = new Set([child]);
    records = new Map([[solanaEditionAddress(child), account(edition())]]);
    request = jest
      .spyOn(service as any, "request")
      .mockImplementation(async (_url, method, params: any) => {
        if (method === "getGenesisHash") return SOLANA_MAINNET;
        if (method === "getSlot") return 100;
        if (method === "getAssetsByOwner")
          return {
            last_indexed_slot: 100,
            total: items.length,
            page: 1,
            limit: 500,
            items,
          };
        if (method === "getTokenAccountsByOwner")
          return {
            context: { slot: 100 },
            value:
              params[1].programId !== SPL_TOKEN
                ? []
                : [...owned].map((mint) => {
                    const bytes = Buffer.alloc(109);
                    bytes.set(solanaPublicKey(mint));
                    bytes.set(solanaPublicKey(owner), 32);
                    bytes.writeBigUInt64LE(1n, 64);
                    bytes[108] = 1;
                    return {
                      pubkey: mint,
                      account: {
                        owner: SPL_TOKEN,
                        executable: false,
                        data: [bytes.toString("base64"), "base64"],
                      },
                    };
                  }),
          };
        if (method === "getMultipleAccounts")
          return {
            context: { slot: 100 },
            value: params[0].map((address) => records.get(address) ?? null),
          };
        throw new Error("Unexpected request " + method);
      });
  });
  afterEach(() => jest.restoreAllMocks());
  it.each(["V1_PRINT", "V1_NFT", "ProgrammableNFT"])(
    "matches an owned %s print to its master mint",
    async (format) => {
      items = [asset(child, format)];
      expect(await service.count(rule(), [owner, owner])).toBe(1n);
      expect(
        request.mock.calls.find(
          (call) => call[1] === "getMultipleAccounts",
        )[2][0],
      ).toEqual([solanaEditionAddress(child)]);
    },
  );
  it("excludes the master NFT, unrelated prints and ordinary NFTs", async () => {
    items = [asset(master, "V1_NFT"), asset(), asset(other)];
    owned = new Set(items.map((a) => a.id));
    const root = Buffer.alloc(20);
    root[0] = 6;
    records.set(solanaEditionAddress(master), account(root));
    records.set(solanaEditionAddress(other), account(edition(other)));
    expect(await service.count(rule(), [owner])).toBe(1n);
    records.delete(solanaEditionAddress(child));
    expect(await service.count(rule(), [owner])).toBe(0n);
  });
  it("supports multiple masters, distinct print counts and same-print traits", async () => {
    items = [asset(), asset(other)];
    owned.add(other);
    records.set(solanaEditionAddress(other), account(edition(other, 2n)));
    expect(await service.count(rule([master, other]), [owner])).toBe(2n);
    const scoped = {
      ...rule([master, other]),
      trait_filter: {
        operator: "AND",
        conditions: [{ key: "hat", value: "cap" }],
      },
    };
    expect(await service.count(scoped, [owner])).toBe(2n);
    scoped.trait_filter.conditions[0].value = "missing";
    expect(await service.count(scoped, [owner])).toBe(0n);
  });
  it("does not count transferred, burned, compressed or Core assets", async () => {
    owned.clear();
    expect(await service.count(rule(), [owner])).toBe(0n);
    owned.add(child);
    items[0].burnt = true;
    expect(await service.count(rule(), [owner])).toBe(0n);
    items = [{ ...asset(), compression: { compressed: true } }];
    expect(await service.count(rule(), [owner])).toBe(0n);
    items = [asset(child, "MplCoreAsset")];
    expect(await service.count(rule(), [owner])).toBe(0n);
  });
  it("reuses edition relationships within a check while keeping metadata reads separate", async () => {
    const context = { checks: new Map() };
    expect(await service.count(rule(), [owner], context)).toBe(1n);
    expect(await service.count(rule([master, other]), [owner], context)).toBe(
      1n,
    );
    expect(
      request.mock.calls.filter((call) => call[1] === "getMultipleAccounts"),
    ).toHaveLength(1);
    expect(solanaEditionAddress(child)).not.toBe(solanaMetadataAddress(child));
  });
  it.each([
    "wrong-program",
    "truncated",
    "bad-key",
    "zero-edition",
    "missing-results",
    "stale-slot",
    "provider-error",
  ])("preserves uncertainty for %s", async (failure) => {
    const original = request.getMockImplementation(),
      record = records.get(solanaEditionAddress(child));
    if (failure === "wrong-program") record.owner = SPL_TOKEN;
    if (failure === "truncated")
      record.data[0] = Buffer.alloc(3).toString("base64");
    if (failure === "bad-key") {
      const data = edition();
      data[0] = 7;
      record.data[0] = data.toString("base64");
    }
    if (failure === "zero-edition")
      record.data[0] = edition(master, 0n).toString("base64");
    request.mockImplementation(async (...args) => {
      if (args[1] === "getMultipleAccounts" && failure === "provider-error")
        throw new Error("Provider unavailable");
      const response = await original(...args);
      if (args[1] === "getMultipleAccounts" && failure === "missing-results")
        response.value = [];
      if (args[1] === "getMultipleAccounts" && failure === "stale-slot")
        response.context.slot = 99;
      return response;
    });
    await expect(service.count(rule(), [owner])).rejects.toThrow();
  });
  it("uses the overall Solana switch for checking, creation and setup health", async () => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", false);
    await expect(service.count(rule(), [owner])).rejects.toThrow("not enabled");
    await expect(
      prepareRuleCriteria(rule() as any, { solana: service } as any),
    ).rejects.toThrow("not enabled");
    await expect(service.checkSetupHealth()).rejects.toThrow(
      "not enabled",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts only Metadata print scope and labels what counts", async () => {
    expect(solanaCriteria(rule().solana_criteria)).toEqual(
      rule().solana_criteria,
    );
    for (const formats of [["core"], ["compressed"], ["metadata", "core"]])
      expect(() =>
        solanaCriteria({ ...rule().solana_criteria, formats }),
      ).toThrow("Token Metadata");
    expect(solanaRuleLabel(rule() as any)).toContain(
      "prints of master edition",
    );
    expect(
      (await prepareRuleCriteria(rule() as any, { solana: service } as any))
        .assetFields.solana_criteria,
    ).toEqual(rule().solana_criteria);
    expect(solanaPrintParent(edition())).toBe(solanaEditionAddress(master));
  });
});
