import { prepareRuleCriteria } from "../src/services/rule-create.util";
import { PortalService } from "../src/portal/portal.service";
import { PortalController } from "../src/portal/portal.controller";

describe("Authenticated NFT collection lookup", () => {
  const server = "111111111111111111",
    user = "222222222222222222";
  const session = { user: { id: user } } as any;
  let service: PortalService, guild: any, collections: any, db: any;
  beforeEach(() => {
    guild = {
      id: server,
      members: {
        fetch: jest
          .fn()
          .mockResolvedValue({ id: user, permissions: { has: () => true } }),
      },
    };
    const discord = {
      getBotClient: () => ({ guilds: { cache: new Map([[server, guild]]) } }),
    };
    collections = {
      lookup: jest.fn().mockResolvedValue({ slug: "test" }),
      collectionTokens: jest.fn().mockResolvedValue({ token_ids: ["1"] }),
    };
    db = { from: jest.fn(), rpc: jest.fn() };
    service = new PortalService(
      db,
      discord as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      collections,
    );
  });
  it("checks current server access before and after a lookup without writing any rules", async () => {
    expect(await service.nftCollection(session, server, "test")).toEqual({
      slug: "test",
    });
    expect(guild.members.fetch).toHaveBeenCalledTimes(2);
    expect(collections.lookup).toHaveBeenCalledWith("test");
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("requires current permission even when the provider could return cached data", async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: { has: () => false },
    });
    await expect(
      service.nftCollection(session, server, "test"),
    ).rejects.toThrow("Administrator");
    expect(collections.lookup).not.toHaveBeenCalled();
  });
  it("rejects lost permission after a slow lookup and never mutates the database", async () => {
    guild.members.fetch
      .mockResolvedValueOnce({ id: user, permissions: { has: () => true } })
      .mockResolvedValueOnce({ id: user, permissions: { has: () => false } });
    await expect(
      service.nftCollection(session, server, "test"),
    ).rejects.toThrow("Administrator");
    expect(collections.lookup).toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("keeps inventory selection bound to its collection, contract and network", async () => {
    expect(
      await service.nftCollection(session, server, "test", "base", "0x123"),
    ).toEqual({ token_ids: ["1"] });
    expect(collections.collectionTokens).toHaveBeenCalledWith(
      "test",
      "base",
      "0x123",
    );
    expect(collections.lookup).not.toHaveBeenCalled();
  });
  it("the controller requires an authenticated session before requesting public metadata", async () => {
    const auth = { session: jest.fn().mockRejectedValue(new Error("Sign in")) };
    const controller = new PortalController(auth as any, service, {} as any);
    await expect(
      controller.nftCollection({} as any, server, "test"),
    ).rejects.toThrow("Sign in");
    expect(collections.lookup).not.toHaveBeenCalled();
  });
});

describe("Saving resolved NFT scopes", () => {
  const address = "0x" + "ab".repeat(20);
  const input = {
    asset_type: "nft",
    contract_address: address,
    network: "ethereum",
    expected_token_standard: "erc721" as const,
  };
  it("rejects a changed contract standard before an empty selection becomes ERC-1155 IDs 0–99", async () => {
    const nfts = {
      prepareRule: jest
        .fn()
        .mockResolvedValue({
          asset_type: "nft",
          contract_address: address,
          chain_id: 1,
          token_standard: "erc1155",
          token_ids: ["0", "1"],
        }),
      validateTraits: jest.fn(),
    };
    await expect(prepareRuleCriteria(input, { nfts } as any)).rejects.toThrow(
      "standard differs",
    );
    expect(nfts.validateTraits).not.toHaveBeenCalled();
  });
  it("uses canonical stored fields and does not retain a marketplace-dependent lookup", async () => {
    const nfts = {
      prepareRule: jest
        .fn()
        .mockResolvedValue({
          asset_type: "nft",
          contract_address: address,
          chain_id: 1,
          token_standard: "erc721",
          token_ids: ["100", "101"],
          collection_name: "Test Art",
        }),
      validateTraits: jest.fn().mockResolvedValue(undefined),
    };
    const prepared = await prepareRuleCriteria(
      { ...input, token_ids: "100-101", collection_name: "Test Art" },
      { nfts } as any,
    );
    expect(prepared.slug).toBeNull();
    expect(prepared.assetFields).toMatchObject({
      contract_address: address,
      token_ids: ["100", "101"],
      token_standard: "erc721",
    });
    expect(prepared.assetFields).not.toHaveProperty("expected_token_standard");
    expect(nfts.prepareRule).toHaveBeenCalledWith(
      address,
      "100-101",
      "Test Art",
      1,
    );
  });
});
