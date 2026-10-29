import {
  NftCollectionService,
  openSeaCollectionSlug,
} from "../src/services/nft-collection.service";
import { EnvironmentConfig } from "../src/config/environment.config";

const address = "0x" + "ab".repeat(20),
  other = "0x" + "cd".repeat(20);
const contract = (chain = "ethereum", value = address) => ({
  chain,
  address: value,
});
const collection = (overrides = {}) => ({
  collection: "test-art",
  name: "Test Art",
  contracts: [contract()],
  ...overrides,
});
const metadata = (
  chain = "ethereum",
  value = address,
  standard = "erc721",
) => ({ chain, address: value, contract_standard: standard });
const token = (identifier = "1", overrides = {}) => ({
  identifier,
  contract: address,
  collection: "test-art",
  token_standard: "erc721",
  ...overrides,
});

describe("OpenSea NFT collection setup lookup", () => {
  let service: NftCollectionService, request: jest.SpyInstance;
  beforeEach(() => {
    jest.replaceProperty(
      EnvironmentConfig,
      "OPENSEA_API_KEY",
      "test-opensea-key",
    );
    service = new NftCollectionService();
    request = jest.spyOn(global, "fetch");
  });
  afterEach(() => jest.restoreAllMocks());
  function respond(value: unknown, status = 200) {
    request.mockResolvedValueOnce(
      new Response(JSON.stringify(value), { status }),
    );
  }
  function identify(overrides = {}, standard = "erc721") {
    respond(collection(overrides));
    respond(metadata("ethereum", address, standard));
  }

  it.each([
    "test-art",
    " TEST-ART ",
    "https://opensea.io/collection/test-art",
    "https://www.opensea.io/collection/test-art/?utm_source=test#items",
  ])("normalizes supported collection input %s", async (input) => {
    identify();
    expect(await service.lookup(input)).toMatchObject({
      source: "opensea",
      slug: "test-art",
      name: "Test Art",
      url: "https://opensea.io/collection/test-art",
      contracts: [
        expect.objectContaining({
          network: "ethereum",
          contract_address: address,
          supported: true,
          token_standard: "erc721",
        }),
      ],
    });
    expect(String(request.mock.calls[0][0])).toBe(
      "https://api.opensea.io/api/v2/collections/test-art",
    );
    expect(request.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { "x-api-key": "test-opensea-key" },
    });
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    "",
    "https://opensea.io.evil.test/collection/test-art",
    "http://opensea.io/collection/test-art",
    "https://user:pass@opensea.io/collection/test-art",
    "https://opensea.io:8080/collection/test-art",
    "https://opensea.io/assets/ethereum/0x123/1",
    "../test-art",
    "test%2fart",
    "test art",
    "x".repeat(101),
    ["test-art"],
    undefined,
  ])(
    "rejects invalid or ambiguous input before making a request: %s",
    async (input) => {
      await expect(
        Promise.resolve().then(() => service.lookup(input as any)),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("returns a useful missing-configuration error and keeps the API key server-side", async () => {
    jest.replaceProperty(EnvironmentConfig, "OPENSEA_API_KEY", undefined);
    await expect(service.lookup("test-art")).rejects.toThrow("not configured");
    expect(request).not.toHaveBeenCalled();
  });
  it("coalesces concurrent lookups, caches successful results, and isolates returned objects", async () => {
    identify();
    const results = await Promise.all([
      service.lookup("test-art"),
      service.lookup("test-art"),
    ]);
    results[0].contracts[0].contract_address = other;
    expect(
      (await service.lookup("test-art")).contracts[0].contract_address,
    ).toBe(address);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(results[1])).not.toContain("test-opensea-key");
  });
  it("expires lookup results and does not use a cached response after configuration is removed", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
    identify();
    await service.lookup("test-art");
    clock.mockReturnValue(301001);
    identify({ name: "Renamed Art" });
    expect((await service.lookup("test-art")).name).toBe("Renamed Art");
    jest.replaceProperty(EnvironmentConfig, "OPENSEA_API_KEY", undefined);
    await expect(service.lookup("test-art")).rejects.toThrow("not configured");
  });
  it("shows every declared contract and chain without silently selecting unsupported coverage", async () => {
    respond(
      collection({
        contracts: [
          contract(),
          contract("base"),
          contract("robinhood", other),
          contract("solana", other),
          contract(),
        ],
      }),
    );
    respond(metadata());
    respond(metadata("base"));
    respond(metadata("robinhood", other, "erc1155"));
    const result = await service.lookup("test-art");
    expect(result.contracts.map((c) => [c.chain, c.supported])).toEqual([
      ["ethereum", true],
      ["base", true],
      ["robinhood", true],
      ["solana", false],
    ]);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("preserves case-sensitive addresses on unsupported networks without treating them as EVM contracts", async () => {
    const solana = "So11111111111111111111111111111111111111112";
    respond(
      collection({ contracts: [contract(), contract("solana", solana)] }),
    );
    respond(metadata());
    const result = await service.lookup("test-art");
    expect(result.contracts[1]).toMatchObject({
      contract_address: solana,
      supported: false,
      network: null,
    });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("unsupported networks");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("refreshes collection counts after an incomplete snapshot instead of caching a partial list", async () => {
    identify({ unique_item_count: 2 });
    respond({ nfts: [token()] });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("incomplete collection");
    identify({ unique_item_count: 1 });
    respond({ nfts: [token()] });
    expect(
      (await service.collectionTokens("test-art", "ethereum", address))
        .token_ids,
    ).toEqual(["1"]);
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("marks unsupported contract standards as unavailable for automatic selection", async () => {
    identify({}, "erc20");
    expect((await service.lookup("test-art")).contracts[0]).toMatchObject({
      supported: false,
      token_standard: null,
    });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("supported contract");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    null,
    collection({ contracts: [] }),
    collection({ collection: "../wrong" }),
    collection({ name: "" }),
    collection({ unique_item_count: -1 }),
    collection({ contracts: [{ chain: "ethereum", address: "0x0" }] }),
    collection({ contracts: Array.from({ length: 11 }, () => contract()) }),
  ])("rejects malformed collection metadata", async (value) => {
    respond(value);
    await expect(service.lookup("test-art")).rejects.toThrow(
      "could not complete",
    );
  });
  it("rejects disabled collections and metadata for another contract or network", async () => {
    respond(collection({ is_disabled: true }));
    await expect(service.lookup("test-art")).rejects.toThrow(
      "unavailable on OpenSea",
    );
    identify();
    request.mockClear();
    // Clear the failed entry only: a fresh service must validate contract metadata.
    service = new NftCollectionService();
    request.mockReset();
    respond(collection());
    respond(metadata("base"));
    await expect(service.lookup("test-art")).rejects.toThrow(
      "could not complete",
    );
  });
  it.each([401, 403, 404, 429, 500])(
    "sanitizes upstream HTTP %s errors and permits retry",
    async (status) => {
      respond({ message: "private-provider-detail-test-opensea-key" }, status);
      let error: Error;
      try {
        await service.lookup("test-art");
      } catch (e) {
        error = e;
      }
      expect(error!.message).not.toMatch(/private-provider|test-opensea-key/);
      identify();
      expect((await service.lookup("test-art")).slug).toBe("test-art");
    },
  );
  it("sanitizes network errors, malformed JSON and oversized responses", async () => {
    request.mockRejectedValueOnce(
      new Error("https://secret.test/?key=test-opensea-key"),
    );
    await expect(service.lookup("test-art")).rejects.toThrow(
      "could not complete",
    );
    request.mockResolvedValueOnce(new Response("not-json"));
    await expect(service.lookup("test-art")).rejects.toThrow(
      "could not complete",
    );
    request.mockResolvedValueOnce(new Response("x".repeat(2_000_001)));
    await expect(service.lookup("test-art")).rejects.toThrow(
      "could not complete",
    );
  });
  it("discovers every page, preserves exact large IDs, compacts ranges and caches a fixed snapshot", async () => {
    identify({ unique_item_count: 3 }, "erc1155");
    const large = ((1n << 255n) + 5n).toString();
    respond({
      nfts: [
        token("2", { token_standard: "erc1155" }),
        token("0x01", { token_standard: "erc1155" }),
      ],
      next: "opaque+/cursor?=value",
    });
    respond({
      nfts: [token(large, { token_standard: "erc1155" })],
      next: null,
    });
    const result = await service.collectionTokens(
      "test-art",
      "ethereum",
      address.toUpperCase().replace("0X", "0x"),
    );
    expect(result).toMatchObject({
      network: "ethereum",
      token_standard: "erc1155",
      token_ids: ["1", "2", large],
      token_ids_input: "1-2," + large,
    });
    expect(
      new URL(String(request.mock.calls[3][0])).searchParams.get("next"),
    ).toBe("opaque+/cursor?=value");
    expect(
      await service.collectionTokens("test-art", "ethereum", address),
    ).toEqual(result);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("keeps multi-contract collection token selections separate", async () => {
    respond(
      collection({
        contracts: [contract(), contract("ethereum", other)],
        unique_item_count: 2,
      }),
    );
    respond(metadata());
    respond(metadata("ethereum", other));
    respond({ nfts: [token(), token("9", { contract: other })] });
    expect(
      (await service.collectionTokens("test-art", "ethereum", other)).token_ids,
    ).toEqual(["9"]);
  });
  it("disambiguates the same address on different chains using the asset URL", async () => {
    respond(
      collection({
        contracts: [contract(), contract("base")],
        unique_item_count: 2,
      }),
    );
    respond(metadata());
    respond(metadata("base"));
    respond({
      nfts: [
        token("1", {
          opensea_url: `https://opensea.io/assets/ethereum/${address}/1`,
        }),
        token("2", {
          opensea_url: `https://opensea.io/assets/base/${address}/2`,
        }),
      ],
    });
    expect(
      (await service.collectionTokens("test-art", "base", address)).token_ids,
    ).toEqual(["2"]);
  });
  it("rejects ambiguous chain identity instead of borrowing another network’s tokens", async () => {
    respond(collection({ contracts: [contract(), contract("base")] }));
    respond(metadata());
    respond(metadata("base"));
    respond({ nfts: [token()] });
    await expect(
      service.collectionTokens("test-art", "base", address),
    ).rejects.toThrow("identify the network");
  });
  it.each([
    { nfts: [token()], next: "repeat" },
    { nfts: [] },
    { nfts: [token("1"), token("1")] },
    { nfts: [token("1", { collection: "different" })] },
    { nfts: [token("1", { contract: other })] },
    { nfts: [token("1", { token_standard: "erc1155" })] },
    { nfts: [token("-1")] },
    { nfts: [token((1n << 256n).toString())] },
    { nfts: [token("1")], next: {} },
  ])(
    "rejects partial, overlapping or mismatched inventory without returning any selection",
    async (value) => {
      identify({ unique_item_count: 2 });
      respond(value);
      respond({ nfts: [token()], next: "repeat" });
      await expect(
        service.collectionTokens("test-art", "ethereum", address),
      ).rejects.toThrow();
    },
  );
  it("never substitutes ERC-1155’s default IDs when the collection is empty", async () => {
    identify({ unique_item_count: 0 }, "erc1155");
    respond({ nfts: [] });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("No collection tokens");
  });
  it("allows exactly 1,000 IDs but never truncates a larger collection", async () => {
    identify({ unique_item_count: 1000 });
    for (let i = 0; i < 5; i++)
      respond({
        nfts: Array.from({ length: 200 }, (_, j) => token(String(i * 200 + j))),
        next: i === 4 ? null : String(i),
      });
    expect(
      (await service.collectionTokens("test-art", "ethereum", address))
        .token_ids_input,
    ).toBe("0-999");
    service = new NftCollectionService();
    identify({ unique_item_count: 1001 });
    for (let i = 0; i < 5; i++)
      respond({
        nfts: Array.from({ length: 200 }, (_, j) => token(String(i * 200 + j))),
        next: String(i),
      });
    respond({ nfts: [token("1000")] });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("too large");
  });
  it("rejects oversized token text and a collection exceeding bounded discovery", async () => {
    identify({ unique_item_count: 100 });
    respond({
      nfts: Array.from({ length: 100 }, (_, i) =>
        token(((1n << 250n) + BigInt(i * 2)).toString()),
      ),
    });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("6,000-character");
    service = new NftCollectionService();
    identify({ unique_item_count: 10000 });
    await expect(
      service.collectionTokens("test-art", "ethereum", address),
    ).rejects.toThrow("too large");
  });
  it("does not discover tokens for a contract outside the selected collection", async () => {
    identify();
    await expect(
      service.collectionTokens("test-art", "ethereum", other),
    ).rejects.toThrow("supported contract");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
