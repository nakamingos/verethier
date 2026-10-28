import { EvmSignatureService } from "../src/services/evm-signature.service";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const contract = ("0x" + "ab".repeat(20)) as `0x${string}`;
const data = (chainId = 8453) => ({
  domain: { name: "Bouncer", version: "1", chainId },
  types: { Verification: [{ name: "Nonce", type: "string" }] },
  primaryType: "Verification" as const,
  message: { Nonce: "fresh-proof" },
});

describe("EVM key and deployed contract proofs", () => {
  let service: EvmSignatureService, rpc: any, client: jest.SpyInstance;
  beforeEach(() => {
    service = new EvmSignatureService();
    rpc = {
      getChainId: jest.fn().mockResolvedValue(8453),
      getCode: jest.fn().mockResolvedValue("0x6000"),
      readContract: jest.fn().mockResolvedValue("0x1626ba7e"),
    };
    client = jest.spyOn(service as any, "client").mockReturnValue(rpc);
  });
  it.each([1, 8453, 4663])(
    "accepts a real EOA signature on chain %s without RPC",
    async (chainId) => {
      const typed = data(chainId),
        signature = await owner.signTypedData(typed);
      expect(
        await service.verify(owner.address.toLowerCase(), typed, signature),
      ).toEqual({});
      expect(client).not.toHaveBeenCalled();
    },
  );
  it("validates the full digest at the claimed contract on the signed chain", async () => {
    const typed = data(),
      signature = await owner.signTypedData(typed);
    expect(await service.verify(contract, typed, signature)).toEqual({
      chainId: 8453,
    });
    expect(client).toHaveBeenCalledWith(8453);
    expect(rpc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: contract,
        functionName: "isValidSignature",
        args: [hashTypedData(typed), signature],
        blockTag: "latest",
      }),
    );
  });
  it("accepts non-ECDSA contract signature bytes, including empty signatures", async () => {
    for (const signature of ["0x", "0x123456"])
      expect(await service.verify(contract, data(), signature)).toEqual({
        chainId: 8453,
      });
  });
  it("rejects a wrong RPC chain before reading code or validating a signature", async () => {
    rpc.getChainId.mockResolvedValue(1);
    await expect(service.verify(contract, data(), "0x11")).rejects.toThrow(
      "Could not check",
    );
    expect(rpc.getCode).not.toHaveBeenCalled();
    expect(rpc.readContract).not.toHaveBeenCalled();
  });
  it.each([undefined, "0x"])(
    "rejects a missing deployed contract (%s)",
    async (code) => {
      rpc.getCode.mockResolvedValue(code);
      await expect(service.verify(contract, data(), "0x11")).rejects.toThrow(
        "not deployed",
      );
      expect(rpc.readContract).not.toHaveBeenCalled();
    },
  );
  it.each(["0xffffffff", "0x00000000", "0x1626ba7e00", true, undefined])(
    "requires the exact ERC-1271 magic value (%s)",
    async (result) => {
      rpc.readContract.mockResolvedValue(result);
      await expect(service.verify(contract, data(), "0x11")).rejects.toThrow(
        "Invalid wallet signature",
      );
    },
  );
  it("fails closed and permits retry after provider failures", async () => {
    rpc.readContract.mockRejectedValueOnce(new Error("provider down"));
    await expect(service.verify(contract, data(), "0x11")).rejects.toThrow(
      "Please try again",
    );
    expect(await service.verify(contract, data(), "0x11")).toEqual({
      chainId: 8453,
    });
  });
  it.each([
    "bad",
    "0x1",
    "0xzz",
    "0x" + "11".repeat(16385),
    "0x" + "6492".repeat(16),
  ])(
    "rejects malformed, oversized and counterfactual signatures before RPC",
    async (signature) => {
      await expect(
        service.verify(contract, data(), signature),
      ).rejects.toThrow();
      expect(client).not.toHaveBeenCalled();
    },
  );
  it.each([137, 84532, "8453", NaN])(
    "rejects unsupported or ambiguous networks (%s)",
    async (chainId) => {
      await expect(
        service.verify(contract, data(chainId as number), "0x11"),
      ).rejects.toThrow();
      expect(client).not.toHaveBeenCalled();
    },
  );
});
