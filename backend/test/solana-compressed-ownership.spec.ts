import vectorsFile from "./fixtures/solana-compressed-vectors.json";
import { EnvironmentConfig } from "../src/config/environment.config";
import { SolanaOwnershipService } from "../src/services/solana-ownership.service";
import { SOLANA_MAINNET } from "../src/utils/solana.util";
import { compressedHash } from "../src/utils/solana-compressed.util";
import { solanaCriteria, solanaRuleLabel } from "../src/utils/solana-rule.util";
import { prepareRuleCriteria } from "../src/services/rule-create.util";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const vectors = vectorsFile.vectors;
const base = {
  id: 1,
  server_id: "test-server",
  channel_id: "test-channel",
  role_id: "test-role",
  asset_type: "solana_nft",
  min_items: 1,
} as any;

describe("Compressed NFTs in Solana ownership and rule creation", () => {
  let service: SolanaOwnershipService,
    request: jest.SpyInstance,
    current: any,
    indexed: any[];
  function rule(
    kind = "collection",
    addresses = [current.collection],
    formats = ["compressed"],
  ) {
    return { ...base, solana_criteria: { kind, addresses, formats } };
  }
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", true);
    jest.replaceProperty(EnvironmentConfig, "SOLANA_COMPRESSED_ENABLED", true);
    current = clone(vectors[0]);
    indexed = [clone(current.asset)];
    service = new SolanaOwnershipService();
    request = jest
      .spyOn(service as any, "request")
      .mockImplementation(async (_url, method, params) => {
        if (method === "getGenesisHash") return SOLANA_MAINNET;
        if (method === "getSlot") return 100;
        if (method === "getAssetsByOwner")
          return {
            last_indexed_slot: 100,
            total: indexed.length,
            page: 1,
            limit: 500,
            items: indexed,
          };
        if (method === "getAsset") return current.asset;
        if (method === "getAssetProof") return current.proof;
        if (method === "getMultipleAccounts") {
          const head = clone(current.treeAccount);
          head.data[0] = Buffer.from(head.data[0], "base64")
            .subarray(0, 96)
            .toString("base64");
          return {
            context: { slot: 100 },
            value: [head, current.configAccount],
          };
        }
        if (method === "getAccountInfo")
          return { context: { slot: 100 }, value: current.treeAccount };
        throw new Error("Unexpected RPC method");
      });
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([0, 2, 3])(
    "checks V1/V2 collections and explicit IDs (fixture %i)",
    async (index) => {
      current = clone(vectors[index]);
      indexed = [clone(current.asset)];
      const context = { checks: new Map() };
      expect(
        await service.count(rule(), [current.asset.ownership.owner], context),
      ).toBe(1n);
      expect(
        await service.count(
          rule("asset_ids", [current.asset.id]),
          [current.asset.ownership.owner],
          context,
        ),
      ).toBe(1n);
      expect(
        request.mock.calls.filter((call) => call[1] === "getAssetProof"),
      ).toHaveLength(1);
    },
  );
  it("does not count an unverified collection or inherited royalty recipient", async () => {
    current = clone(vectors[1]);
    indexed = [clone(current.asset)];
    expect(await service.count(rule(), [current.asset.ownership.owner])).toBe(
      0n,
    );
    current = clone(vectors[3]);
    indexed = [clone(current.asset)];
    expect(
      await service.count(rule("verified_creator", [current.creator]), [
        current.asset.ownership.owner,
      ]),
    ).toBe(0n);
    expect(request.mock.calls.some((call) => call[1] === "getAssetProof")).toBe(
      false,
    );
  });
  it("checks verified creators and same-asset AND/OR traits", async () => {
    const owner = current.asset.ownership.owner;
    const creator = rule("verified_creator", [current.creator]);
    expect(await service.count(creator, [owner])).toBe(1n);
    const scoped = {
      ...creator,
      trait_filter: {
        operator: "AND",
        conditions: [
          { key: "color", value: "blue" },
          { key: "Hat", value: "Cap" },
        ],
      },
    };
    expect(await service.count(scoped, [owner])).toBe(1n);
    scoped.trait_filter.conditions[1].value = "Missing";
    expect(await service.count(scoped, [owner])).toBe(0n);
    scoped.trait_filter.operator = "OR";
    expect(await service.count(scoped, [owner])).toBe(1n);
    delete current.asset.content.metadata.attributes;
    await expect(
      service.count(creatorWithTraits(creator), [owner]),
    ).rejects.toThrow("trait metadata");
  });
  function creatorWithTraits(rule: any) {
    return {
      ...rule,
      trait_filter: {
        operator: "AND",
        conditions: [{ key: "Color", value: "Blue" }],
      },
    };
  }
  it("excludes a transferred asset using the authenticated current owner", async () => {
    const previousOwner = current.asset.ownership.owner;
    current = clone(vectors.find((v) => v.transferred)!);
    expect(await service.count(rule(), [previousOwner])).toBe(0n);
  });
  it("excludes a burned leaf only after its empty proof matches the current tree", async () => {
    const owner = current.asset.ownership.owner;
    current = clone(vectors.find((v) => v.burned)!);
    expect(await service.count(rule(), [owner])).toBe(0n);
  });
  it("does not expand existing metadata/Core rules to compressed NFTs", async () => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_COMPRESSED_ENABLED", false);
    expect(
      await service.count(
        rule("collection", [current.collection], ["metadata", "core"]),
        [current.asset.ownership.owner],
      ),
    ).toBe(0n);
    expect(request.mock.calls.some((call) => call[1] === "getAssetProof")).toBe(
      false,
    );
  });
  it("preserves uncertainty when a compressed rule is paused", async () => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_COMPRESSED_ENABLED", false);
    await expect(
      service.count(rule(), [current.asset.ownership.owner]),
    ).rejects.toThrow("not enabled");
    await expect(service.checkSetupHealth(true)).rejects.toThrow("not enabled");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    "stale-slot",
    "historical-root",
    "root-race",
    "missing-tree-config",
    "provider-error",
    "missing-traits",
  ])(
    "rejects incomplete %s evidence instead of returning a partial zero",
    async (failure) => {
      const original = request.getMockImplementation();
      if (failure === "stale-slot") current.proof.last_indexed_slot = 99;
      if (failure === "historical-root") {
        const bytes = Buffer.from(current.treeAccount.data[0], "base64");
        bytes.writeBigUInt64LE(3n, 64);
        bytes.writeBigUInt64LE(4n, 72);
        bytes.set(compressedHash(new Uint8Array([7])), 80 + 3 * (40 + 32 * 3));
        current.treeAccount.data[0] = bytes.toString("base64");
      }
      if (failure === "missing-tree-config") current.configAccount = null;
      if (failure === "missing-traits")
        delete current.asset.content.metadata.attributes;
      request.mockImplementation(async (url, method, params, run) => {
        if (failure === "provider-error" && method === "getAssetProof")
          throw new Error("Unavailable provider");
        const result = await original(url, method, params, run);
        if (failure === "root-race" && method === "getAccountInfo") {
          const bytes = Buffer.from(result.value.data[0], "base64");
          bytes.writeBigUInt64LE(3n, 64);
          bytes.writeBigUInt64LE(4n, 72);
          bytes.set(
            compressedHash(new Uint8Array([7])),
            80 + 3 * (40 + 32 * 3),
          );
          result.value.data[0] = bytes.toString("base64");
        }
        return result;
      });
      await expect(
        service.count(
          failure === "missing-traits" ? creatorWithTraits(rule()) : rule(),
          [indexed[0].ownership.owner],
        ),
      ).rejects.toThrow();
    },
  );
  it("batches multiple assets and shares one authenticated current tree", async () => {
    const batch = clone(vectorsFile.batch);
    current = batch[0];
    indexed = batch.map((vector) => vector.asset);
    const original = request.getMockImplementation();
    request.mockImplementation(async (url, method, params, run) => {
      if (method === "getAssetBatch")
        return batch.map((vector) => vector.asset).reverse();
      if (method === "getAssetProofBatch")
        return Object.fromEntries(
          batch.map((vector) => [vector.asset.id, vector.proof]),
        );
      return original(url, method, params, run);
    });
    expect(await service.count(rule(), [current.asset.ownership.owner])).toBe(
      2n,
    );
    expect(
      request.mock.calls.filter((call) => call[1] === "getAssetBatch"),
    ).toHaveLength(1);
    expect(
      request.mock.calls.filter((call) => call[1] === "getMultipleAccounts"),
    ).toHaveLength(1);
    expect(
      request.mock.calls.some(
        (call) => call[1] === "getAsset" || call[1] === "getAssetProof",
      ),
    ).toBe(false);
  });
  it.each(["missing-asset", "duplicate-asset", "missing-proof", "extra-proof"])(
    "rejects incomplete %s batch results",
    async (failure) => {
      const batch = clone(vectorsFile.batch);
      current = batch[0];
      indexed = batch.map((vector) => vector.asset);
      const original = request.getMockImplementation();
      request.mockImplementation(async (url, method, params, run) => {
        if (method === "getAssetBatch")
          return failure === "missing-asset"
            ? [batch[0].asset]
            : failure === "duplicate-asset"
              ? [batch[0].asset, batch[0].asset]
              : batch.map((vector) => vector.asset);
        if (method === "getAssetProofBatch") {
          const result = Object.fromEntries(
            batch.map((vector) => [vector.asset.id, vector.proof]),
          );
          if (failure === "missing-proof") delete result[batch[1].asset.id];
          if (failure === "extra-proof")
            result[current.creator] = batch[0].proof;
          return result;
        }
        return original(url, method, params, run);
      });
      await expect(
        service.count(rule(), [current.asset.ownership.owner]),
      ).rejects.toThrow();
    },
  );
  it("normalizes explicit format choices without changing their address case", () => {
    const criteria = solanaCriteria({
      kind: "asset_ids",
      addresses: [current.asset.id],
      formats: ["metadata", "compressed", "core"],
    });
    expect(criteria).toEqual({
      kind: "asset_ids",
      addresses: [current.asset.id],
      formats: ["compressed", "core", "metadata"],
    });
    expect(() =>
      solanaCriteria({
        kind: "asset_ids",
        addresses: [current.asset.id],
        formats: ["metadata", "compressed", "core", "core"],
      }),
    ).toThrow();
  });
  it("requires the capability to create a compressed rule and labels its scope", async () => {
    const input = {
      ...rule(),
      solana_criteria: solanaCriteria(rule().solana_criteria),
    };
    const providers = { solana: service } as any;
    expect(
      (await prepareRuleCriteria(input, providers)).assetFields.solana_criteria,
    ).toEqual(input.solana_criteria);
    expect(solanaRuleLabel(input)).toContain("compressed NFTs");
    jest.replaceProperty(EnvironmentConfig, "SOLANA_COMPRESSED_ENABLED", false);
    await expect(prepareRuleCriteria(input, providers)).rejects.toThrow(
      "not enabled",
    );
  });
});
