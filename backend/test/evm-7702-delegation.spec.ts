import { ContractFunctionRevertedError, hashTypedData } from "viem";
import { EvmSignatureService } from "../src/services/evm-signature.service";
import { privateKeyToAccount } from "viem/accounts";

// An EIP-7702 delegated EOA keeps its own key. On chains where it has a
// delegation, getCode returns the designator 0xef0100 followed by the
// address of the code it delegates to.
const owner = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);
const sessionKey = privateKeyToAccount(("0x" + "33".repeat(32)) as `0x${string}`);
const delegation = "0xef0100" + "cd".repeat(20);
const data = (chainId = 8453) => ({
  domain: { name: "Bouncer", version: "1", chainId },
  types: { Verification: [{ name: "Nonce", type: "string" }] },
  primaryType: "Verification" as const,
  message: { Nonce: "fresh-proof" },
});

describe("EIP-7702 delegated EOA proofs", () => {
  let service: EvmSignatureService, rpc: any, client: jest.SpyInstance;
  beforeEach(() => {
    service = new EvmSignatureService();
    rpc = {
      getChainId: jest.fn().mockResolvedValue(8453),
      getCode: jest.fn().mockResolvedValue(delegation),
      readContract: jest.fn().mockResolvedValue("0x1626ba7e"),
      call: jest.fn(),
    };
    client = jest.spyOn(service as any, "client").mockReturnValue(rpc);
  });

  it.each([1, 8453, 4663])(
    "treats a delegated account signing with its own key as a key proof on every network (chain %s)",
    async (chainId) => {
      const typed = data(chainId);
      const signature = await owner.signTypedData(typed);
      // No chain scope means the wallet link counts on all supported networks.
      expect(await service.verify(owner.address, typed, signature)).toEqual({});
      // The key alone settles it; the delegation is never consulted.
      expect(client).not.toHaveBeenCalled();
    },
  );

  it("limits a proof approved by the delegated code to the network it was signed on", async () => {
    const typed = data(8453);
    // A key other than the account's own, e.g. a session key the delegate accepts.
    const signature = await sessionKey.signTypedData(typed);
    expect(await service.verify(owner.address, typed, signature)).toEqual({ chainId: 8453 });
    expect(client).toHaveBeenCalledWith(8453);
    expect(rpc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: owner.address,
        functionName: "isValidSignature",
        args: [hashTypedData(typed), signature],
      }),
    );
  });

  it("refuses a non-key signature on a network where the account has no delegation", async () => {
    rpc.getCode.mockResolvedValue("0x");
    const typed = data(1);
    rpc.getChainId.mockResolvedValue(1);
    const signature = await sessionKey.signTypedData(typed);
    await expect(service.verify(owner.address, typed, signature)).rejects.toThrow("not deployed on this network");
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("refuses a non-key signature the delegated code rejects", async () => {
    rpc.readContract.mockRejectedValue(
      new ContractFunctionRevertedError({ abi: [], functionName: "isValidSignature" }),
    );
    const typed = data(8453);
    const signature = await sessionKey.signTypedData(typed);
    await expect(service.verify(owner.address, typed, signature)).rejects.toThrow("Invalid wallet signature.");
  });

  it("refuses when the delegated code returns anything but the ERC-1271 magic value", async () => {
    rpc.readContract.mockResolvedValue("0xffffffff");
    const typed = data(8453);
    const signature = await sessionKey.signTypedData(typed);
    await expect(service.verify(owner.address, typed, signature)).rejects.toThrow("Invalid wallet signature.");
  });
});
