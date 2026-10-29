import { UserAddressService } from "../src/services/user-address.service";
import { VerificationEngine } from "../src/services/verification-engine.service";
import { walletOnChain } from "../src/utils/wallet-scope.util";

const smart = "0x" + "a".repeat(40),
  eoa = "0x" + "b".repeat(40);
describe("Saved smart-wallet network boundaries", () => {
  let rows: any[],
    addresses: UserAddressService,
    engine: VerificationEngine,
    ownership: any;
  beforeEach(() => {
    rows = [
      { address: smart, wallet_type: "evm", evm_chain_ids: [8453] },
      { address: eoa, wallet_type: "evm", evm_chain_ids: null },
      { address: "bc1ptest", wallet_type: "bitcoin", evm_chain_ids: null },
    ];
    const q: any = {};
    for (const method of ["select", "eq"]) q[method] = () => q;
    q.order = async () => ({ data: rows, error: null });
    addresses = new UserAddressService({ from: () => q } as any);
    ownership = {
      count: jest
        .fn()
        .mockImplementation(async (_rule, wallets) => BigInt(wallets.length)),
      matchingAssets: jest
        .fn()
        .mockImplementation(
          async (_rule, wallets) => new Map(wallets.map((w) => [w, 1n])),
        ),
    };
    engine = new VerificationEngine({} as any, ownership, addresses, {
      allowedAddresses: async (_server, wallets) => wallets,
    } as any);
  });
  it.each([1, 8453, 4663])(
    "includes EOAs on chain %s and contract wallets only when proven there",
    async (chain) => {
      expect(
        await addresses.getUserAddresses("member", undefined, chain),
      ).toEqual(chain === 8453 ? [smart, eoa] : [eoa]);
    },
  );
  it("separates Bitcoin, and keeps the overview list complete", async () => {
    expect(await addresses.getUserAddresses("member", undefined, 0)).toEqual([
      "bc1ptest",
    ]);
    expect(await addresses.getUserAddresses("member")).toEqual([
      smart,
      eoa,
      "bc1ptest",
    ]);
  });
  it("does not broaden a contract proof just because its address is supplied to verification", async () => {
    rows = rows.slice(0, 1);
    for (const chain_id of [1, 8453, 4663]) {
      const result = await engine.verifyUser(
        "member",
        chain_id,
        smart,
        undefined,
        {
          id: chain_id,
          server_id: "server",
          role_id: "role",
          channel_id: "channel",
          asset_type: "nft",
          chain_id,
          min_items: 1,
        } as any,
      );
      expect(result.isValid).toBe(chain_id === 8453);
    }
    expect(ownership.count).toHaveBeenCalledTimes(1);
    expect(ownership.count.mock.calls[0][1]).toEqual([smart]);
  });
  it("does not reintroduce an unlinked claimed address when the saved list is empty", async () => {
    rows = [];
    const result = await engine.verifyUser("member", 1, smart, undefined, {
      id: 1,
      server_id: "server",
      asset_type: "nft",
      chain_id: 1,
      min_items: 1,
    } as any);
    expect(result.isValid).toBe(false);
    expect(ownership.count).not.toHaveBeenCalled();
  });
  it("filters combined-count reads as well as individual checks", async () => {
    rows = rows.slice(0, 1);
    const rules = [1, 2].map((id) => ({
      id,
      server_id: "server",
      role_id: "role",
      channel_id: "channel",
      asset_type: "nft",
      chain_id: 1,
      contract_address: "collection",
      min_items: 2,
    }));
    const result = await engine.verifyUserBulk(
      "member",
      [1, 2],
      smart,
      rules as any,
    );
    expect(result.validRules).toEqual([]);
    expect(ownership.count).not.toHaveBeenCalled();
    for (const call of ownership.matchingAssets.mock.calls)
      expect(call[1]).toEqual([]);
  });
  it("does not treat Bitcoin proof as an EVM proof", () =>
    expect(walletOnChain({ wallet_type: "bitcoin" }, 1)).toBe(false));
});
