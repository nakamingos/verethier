import { EvmSignatureService } from "../src/services/evm-signature.service";
import {
  decodeAbiParameters,
  hashTypedData,
  serializeErc6492Signature,
  universalSignatureValidatorByteCode,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const contract = ("0x" + "ab".repeat(20)) as `0x${string}`;
const data = (chainId = 8453) => ({
  domain: { name: "Bouncer", version: "1", chainId },
  types: { Verification: [{ name: "Nonce", type: "string" }] },
  primaryType: "Verification" as const,
  message: { Nonce: "fresh-proof" },
});

describe("EVM key, deployed and counterfactual contract proofs", () => {
  let service: EvmSignatureService, rpc: any, client: jest.SpyInstance;
  beforeEach(() => {
    service = new EvmSignatureService();
    rpc = {
      getChainId: jest.fn().mockResolvedValue(8453),
      getCode: jest.fn().mockResolvedValue("0x6000"),
      readContract: jest.fn().mockResolvedValue("0x1626ba7e"),
      call: jest.fn().mockResolvedValue({ data: "0x01" }),
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
  const wrap = (signature = "0x1234" as `0x${string}`) =>
    serializeErc6492Signature({
      address: ("0x" + "cd".repeat(20)) as `0x${string}`,
      data: "0x12345678",
      signature,
    });
  it("checks a canonical undeployed proof in a bounded read-only call and preserves its chain scope", async () => {
    rpc.getCode.mockResolvedValue("0x");
    const signature = wrap();
    expect(await service.verify(contract, data(), signature)).toEqual({
      chainId: 8453,
    });
    expect(rpc.readContract).not.toHaveBeenCalled();
    const request = rpc.call.mock.calls[0][0];
    expect(request).toMatchObject({ blockTag: "latest", gas: 10000000n });
    expect(request.to).toBeUndefined();
    expect(request.value).toBeUndefined();
    expect(request.data.startsWith(universalSignatureValidatorByteCode)).toBe(
      true,
    );
    const args = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "bytes" }],
      ("0x" +
        request.data.slice(
          universalSignatureValidatorByteCode.length,
        )) as `0x${string}`,
    );
    expect(args.map((x) => x.toLowerCase())).toEqual(
      [contract, hashTypedData(data()), signature].map((x) => x.toLowerCase()),
    );
  });
  it("uses current deployed authorization before considering factory preparation", async () => {
    const signature = wrap("0x11223344");
    expect(await service.verify(contract, data(), signature)).toEqual({
      chainId: 8453,
    });
    expect(rpc.readContract.mock.calls[0][0].args[1]).toBe("0x11223344");
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it("simulates required preparation when a deployed account rejects the inner signature", async () => {
    rpc.readContract.mockResolvedValue("0xffffffff");
    expect(await service.verify(contract, data(), wrap())).toEqual({
      chainId: 8453,
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });
  it("does not accept a valid inner EOA signature as global ownership", async () => {
    rpc.getCode.mockResolvedValue("0x");
    const signature = wrap(await owner.signTypedData(data()));
    expect(await service.verify(owner.address, data(), signature)).toEqual({
      chainId: 8453,
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "0x", "0x00", "0x0001", "0x02", true])(
    "rejects non-exact simulation results (%s)",
    async (result) => {
      rpc.getCode.mockResolvedValue("0x");
      rpc.call.mockResolvedValue({ data: result });
      await expect(service.verify(contract, data(), wrap())).rejects.toThrow(
        "Invalid wallet signature",
      );
    },
  );
  it("does not simulate on the wrong network and allows a clean provider retry", async () => {
    rpc.getCode.mockResolvedValue("0x");
    rpc.getChainId.mockResolvedValueOnce(1);
    await expect(service.verify(contract, data(), wrap())).rejects.toThrow(
      "Could not check",
    );
    expect(rpc.call).not.toHaveBeenCalled();
    rpc.call.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(service.verify(contract, data(), wrap())).rejects.toThrow(
      "Please try again",
    );
    expect(await service.verify(contract, data(), wrap())).toEqual({
      chainId: 8453,
    });
  });
  it("rejects noncanonical wrapper encodings before contacting the RPC", async () => {
    const signature = wrap();
    const noncanonical =
      signature.slice(0, -64) + "00".repeat(32) + signature.slice(-64);
    await expect(
      service.verify(contract, data(), noncanonical),
    ).rejects.toThrow("wrapper");
    expect(client).not.toHaveBeenCalled();
  });
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
