import { EnvironmentConfig } from "../src/config/environment.config";
import { SolanaOwnershipService } from "../src/services/solana-ownership.service";
import { SOLANA_MAINNET, solanaBase58 } from "../src/utils/solana.util";
import { solanaCriteria, solanaRuleLabel } from "../src/utils/solana-rule.util";
import { prepareRuleCriteria } from "../src/services/rule-create.util";

const key = (n: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(n);
  return solanaBase58(new Uint8Array(bytes));
};
const owner = key(1),
  other = key(2),
  collection = key(3),
  creator = key(4),
  id = key(5);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const base = {
  id: 1,
  server_id: "server",
  channel_id: "channel",
  role_id: "role",
  asset_type: "solana_nft",
  min_items: 1,
} as any;
function asset(version = 1, assetId = id): any {
  return {
    id: assetId,
    interface: version === 1 ? "V1_NFT" : "MplBubblegumV2",
    burnt: false,
    ownership: { owner, ownership_model: "single" },
    compression: { compressed: true },
    grouping: [
      { group_key: "collection", group_value: collection, verified: true },
    ],
    creators: [{ address: creator, verified: true }],
    content: {
      metadata: {
        attributes: [
          { trait_type: "Color", value: "Blue" },
          { trait_type: "Hat", value: "Cap" },
        ],
      },
    },
  };
}
function rule(
  kind = "collection",
  addresses = [collection],
  formats = ["compressed"],
): any {
  return { ...base, solana_criteria: { kind, addresses, formats } };
}
function traits(scoped = rule(), operator = "AND") {
  return {
    ...scoped,
    trait_filter: {
      operator,
      conditions: [
        { key: "color", value: "blue" },
        { key: "Hat", value: "Cap" },
      ],
    },
  };
}
describe("Provider-backed compressed NFT ownership", () => {
  let service: SolanaOwnershipService,
    request: jest.SpyInstance,
    indexed: any[],
    current: any[];
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", true);
    indexed = [asset()];
    current = clone(indexed);
    service = new SolanaOwnershipService();
    request = jest
      .spyOn(service as any, "request")
      .mockImplementation(async (_url, method, params: any) => {
        if (method === "getGenesisHash") return SOLANA_MAINNET;
        if (method === "getSlot") return 100;
        if (method === "getAssetsByOwner") {
          const items = indexed.slice(
            (params.page - 1) * 500,
            params.page * 500,
          );
          return {
            last_indexed_slot: 100,
            total: items.length,
            page: params.page,
            limit: 500,
            items,
          };
        }
        if (method === "getAsset")
          return current.find((item) => item.id === params.id);
        if (method === "getAssetBatch")
          return current
            .filter((item) => params.ids.includes(item.id))
            .reverse();
        // Proof requests and tree/account reads must never occur for compressed-only rules.
        throw new Error("Unexpected RPC method: " + method);
      });
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([1, 2])(
    "checks V%i owner/collection/ID data without requiring proof or tree fields",
    async (version) => {
      indexed = [asset(version)];
      current = clone(indexed);
      const context = { checks: new Map() };
      expect(await service.count(rule(), [owner], context)).toBe(1n);
      expect(
        await service.count(rule("asset_ids", [id]), [owner, owner], context),
      ).toBe(1n);
      expect(
        request.mock.calls.filter((call) => call[1] === "getAsset"),
      ).toHaveLength(1);
      expect(
        request.mock.calls.every((call) =>
          [
            "getGenesisHash",
            "getSlot",
            "getAssetsByOwner",
            "getAsset",
          ].includes(call[1]),
        ),
      ).toBe(true);
    },
  );
  it("checks verified creators and same-asset AND/OR traits", async () => {
    const creatorRule = rule("verified_creator", [creator]);
    expect(await service.count(creatorRule, [owner])).toBe(1n);
    const scoped = traits(creatorRule);
    expect(await service.count(scoped, [owner])).toBe(1n);
    scoped.trait_filter.conditions[1].value = "Missing";
    expect(await service.count(scoped, [owner])).toBe(0n);
    scoped.trait_filter.operator = "OR";
    expect(await service.count(scoped, [owner])).toBe(1n);
    delete current[0].content.metadata.attributes;
    await expect(service.count(scoped, [owner])).rejects.toThrow(
      "trait metadata",
    );
  });
  it("uses the asset owner rather than its delegate", async () => {
    current[0].ownership = {
      owner: other,
      delegate: owner,
      delegated: true,
      ownership_model: "single",
    };
    expect(await service.count(rule(), [owner])).toBe(0n);
  });
  it("excludes an asset whose fresh lookup reports another owner", async () => {
    current[0].ownership.owner = other;
    expect(await service.count(rule(), [owner])).toBe(0n);
  });
  it("excludes a provider-reported burn without requesting a burn proof", async () => {
    current[0].burnt = true;
    delete current[0].ownership;
    expect(await service.count(rule(), [owner])).toBe(0n);
    expect(
      request.mock.calls.filter((call) => call[1] === "getAsset"),
    ).toHaveLength(1);
  });
  it("does not include burned entries from the indexed inventory", async () => {
    indexed[0].burnt = true;
    expect(await service.count(rule(), [owner])).toBe(0n);
    expect(request.mock.calls.some((call) => call[1] === "getAsset")).toBe(
      false,
    );
  });
  it.each(["unverified", "different", "none"])(
    "excludes a %s collection in the fresh asset lookup",
    async (change) => {
      if (change === "unverified") current[0].grouping[0].verified = false;
      if (change === "different") current[0].grouping[0].group_value = other;
      if (change === "none") current[0].grouping = [];
      expect(await service.count(rule(), [owner])).toBe(0n);
    },
  );
  it("does not count an unverified creator or collection", async () => {
    current[0].creators[0].verified = false;
    expect(
      await service.count(rule("verified_creator", [creator]), [owner]),
    ).toBe(0n);
    indexed[0].grouping[0].verified = false;
    expect(await service.count(rule(), [owner])).toBe(0n);
  });
  it.each([false, true])(
    "does not use V2 inherited royalty recipients as creators (raw=%s)",
    async (raw) => {
      indexed = [asset(2)];
      current = clone(indexed);
      for (const item of [...indexed, ...current]) {
        item.royalty = { inherited: true, basis_points_raw: 65535 };
        if (raw) item.creators_raw = [];
      }
      expect(
        await service.count(rule("verified_creator", [creator]), [owner]),
      ).toBe(0n);
      expect(await service.count(rule(), [owner])).toBe(1n);
      for (const item of [...indexed, ...current])
        item.creators_raw = [{ address: creator, verified: true }];
      expect(
        await service.count(rule("verified_creator", [creator]), [owner]),
      ).toBe(1n);
    },
  );
  it.each([
    "missing-asset",
    "wrong-id",
    "missing-owner",
    "missing-burn-state",
    "unknown-format",
    "not-compressed",
    "missing-grouping",
    "unknown-verification",
    "duplicate-collection",
  ])("preserves uncertainty for %s data", async (failure) => {
    const original = request.getMockImplementation();
    if (failure === "missing-asset") current = [];
    if (failure === "missing-owner") delete current[0].ownership.owner;
    if (failure === "missing-burn-state") delete current[0].burnt;
    if (failure === "unknown-format") current[0].interface = "Unknown";
    if (failure === "not-compressed") current[0].compression.compressed = false;
    if (failure === "missing-grouping") delete current[0].grouping;
    if (failure === "unknown-verification")
      delete current[0].grouping[0].verified;
    if (failure === "duplicate-collection")
      current[0].grouping.push(current[0].grouping[0]);
    if (failure === "wrong-id")
      request.mockImplementation(async (...args) =>
        args[1] === "getAsset" ? asset(1, other) : original(...args),
      );
    await expect(service.count(rule(), [owner])).rejects.toThrow();
  });
  it("rejects malformed verified-creator data", async () => {
    delete current[0].creators[0].verified;
    await expect(
      service.count(rule("verified_creator", [creator]), [owner]),
    ).rejects.toThrow();
  });
  it.each(["provider-error", "stale-inventory"])(
    "preserves uncertainty for %s",
    async (failure) => {
      const original = request.getMockImplementation();
      request.mockImplementation(async (...args) => {
        if (failure === "provider-error" && args[1] === "getAsset")
          throw new Error("Unavailable provider");
        const result = await original(...args);
        if (failure === "stale-inventory" && args[1] === "getAssetsByOwner")
          result.last_indexed_slot = 99;
        return result;
      });
      await expect(service.count(rule(), [owner])).rejects.toThrow();
    },
  );
  it("batches and reuses asset details without proof or tree requests", async () => {
    indexed = Array.from({ length: 201 }, (_, n) => asset(1, key(100 + n)));
    current = clone(indexed);
    const context = { checks: new Map() };
    expect(await service.count(rule(), [owner], context)).toBe(201n);
    expect(
      await service.count(
        rule("verified_creator", [creator]),
        [owner],
        context,
      ),
    ).toBe(201n);
    expect(
      request.mock.calls
        .filter((call) => call[1] === "getAssetBatch")
        .map((call) => call[2].ids.length),
    ).toEqual([100, 100, 1]);
    expect(
      request.mock.calls.every((call) =>
        [
          "getGenesisHash",
          "getSlot",
          "getAssetsByOwner",
          "getAssetBatch",
        ].includes(call[1]),
      ),
    ).toBe(true);
  });
  it.each(["missing", "duplicate", "unexpected", "extra"])(
    "rejects %s batch entries",
    async (failure) => {
      indexed = [asset(), asset(2, key(6))];
      current = clone(indexed);
      if (failure === "missing") current.pop();
      if (failure === "duplicate") current[1] = current[0];
      const original = request.getMockImplementation();
      request.mockImplementation(async (...args) => {
        if (args[1] === "getAssetBatch" && failure === "unexpected")
          return [current[0], asset(1, other)];
        if (args[1] === "getAssetBatch" && failure === "extra")
          return [...current, asset(1, other)];
        if (args[1] === "getAssetBatch" && failure === "duplicate")
          return current;
        return original(...args);
      });
      await expect(service.count(rule(), [owner])).rejects.toThrow();
    },
  );
  it("bounds selected asset lookups without returning partial counts", async () => {
    indexed = Array.from({ length: 1001 }, (_, n) => asset(1, key(100 + n)));
    current = clone(indexed);
    await expect(service.count(rule(), [owner])).rejects.toThrow(
      "complete-check limit",
    );
    expect(request.mock.calls.some((call) => call[1] === "getAssetBatch")).toBe(
      false,
    );
  });
  it("keeps existing metadata/Core rule scopes unchanged", async () => {
    expect(
      await service.count(
        rule("collection", [collection], ["metadata", "core"]),
        [owner],
      ),
    ).toBe(0n);
    expect(request.mock.calls.some((call) => call[1] === "getAsset")).toBe(
      false,
    );
  });
  it("preserves uncertainty when Solana is paused", async () => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", false);
    await expect(service.count(rule(), [owner])).rejects.toThrow("not enabled");
    await expect(service.checkSetupHealth()).rejects.toThrow("not enabled");
    expect(request).not.toHaveBeenCalled();
  });
  it("normalizes explicit formats and gates rule creation", async () => {
    const criteria = solanaCriteria({
      kind: "collection",
      addresses: [collection],
      formats: ["metadata", "compressed", "core"],
    });
    expect(criteria).toEqual({
      kind: "collection",
      addresses: [collection],
      formats: ["compressed", "core", "metadata"],
    });
    const input = { ...rule(), solana_criteria: criteria },
      providers = { solana: service } as any;
    expect(
      (await prepareRuleCriteria(input, providers)).assetFields.solana_criteria,
    ).toEqual(criteria);
    expect(solanaRuleLabel(input)).toContain("includes compressed NFTs");
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", false);
    await expect(prepareRuleCriteria(input, providers)).rejects.toThrow(
      "not enabled",
    );
  });
});
