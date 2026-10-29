import { Injectable } from "@nestjs/common";
import {
  Address,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ExecutionRevertedError,
  Hex,
  PublicClient,
  createPublicClient,
  encodeDeployData,
  hashTypedData,
  http,
  parseErc6492Signature,
  parseAbi,
  recoverTypedDataAddress,
  serializeErc6492Signature,
  universalSignatureValidatorAbi,
  universalSignatureValidatorByteCode,
} from "viem";
import { EnvironmentConfig } from "@/config/environment.config";
import { getNftNetwork } from "@/utils/nft-network.util";

const ABI = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
const COUNTERFACTUAL_SUFFIX = "6492".repeat(16);

/** A recovered key proves an EOA globally; contract authorization is chain-specific. */
@Injectable()
export class EvmSignatureService {
  private readonly clients = new Map<
    number,
    Pick<PublicClient, "getChainId" | "getCode" | "readContract" | "call">
  >();

  private client(chainId: number) {
    const network = getNftNetwork(chainId);
    const url = EnvironmentConfig[network.rpcVariable];
    if (!url)
      throw new Error(
        `${network.name} smart-wallet verification is not configured. Set ${network.rpcVariable} on the backend.`,
      );
    if (!this.clients.has(chainId))
      this.clients.set(
        chainId,
        createPublicClient({
          chain: network.chain,
          transport: http(url, { timeout: 10000, retryCount: 0 }),
        }),
      );
    return this.clients.get(chainId);
  }

  async verify(
    address: string,
    typedData: any,
    signature: string,
  ): Promise<{ chainId?: number }> {
    if (
      !/^0x[\da-f]{40}$/i.test(address) ||
      !/^0x(?:[\da-f]{2})*$/i.test(signature) ||
      signature.length > 32770
    )
      throw new Error("Invalid wallet signature.");
    const chainId = typedData.domain?.chainId;
    if (!Number.isSafeInteger(chainId))
      throw new Error("Invalid wallet network.");
    getNftNetwork(chainId);
    const wrapped = signature.toLowerCase().endsWith(COUNTERFACTUAL_SUFFIX);
    let innerSignature = signature as Hex;
    if (wrapped) {
      // Recognize wrappers before recovery. A factory is never a wallet identity,
      // and the inner EOA signature cannot establish a global wallet link.
      try {
        const parsed = parseErc6492Signature(signature.toLowerCase() as Hex);
        if (
          !parsed.address ||
          serializeErc6492Signature({
            address: parsed.address,
            data: parsed.data,
            signature: parsed.signature,
          }).toLowerCase() !== signature.toLowerCase()
        )
          throw new Error();
        innerSignature = parsed.signature;
      } catch {
        throw new Error("Invalid smart-wallet signature wrapper.");
      }
    }
    if (!wrapped) {
      try {
        const recovered = await recoverTypedDataAddress({
          ...typedData,
          signature,
        });
        if (recovered.toLowerCase() === address.toLowerCase()) return {};
      } catch {
        /* Contract signatures need not have ECDSA's length or format. */
      }
    }

    const client = this.client(chainId);
    let code: string | undefined;
    try {
      if ((await client.getChainId()) !== chainId)
        throw new Error("Wrong network");
      code = await client.getCode({
        address: address as Address,
        blockTag: "latest",
      });
    } catch {
      throw new Error(
        "Could not check the smart wallet on its network. Please try again.",
      );
    }
    if ((!code || code === "0x") && !wrapped)
      throw new Error(
        "Invalid wallet signature or smart wallet is not deployed on this network.",
      );
    if (code && code !== "0x") {
      try {
        const result = await client.readContract({
          address: address as Address,
          abi: ABI,
          functionName: "isValidSignature",
          args: [hashTypedData(typedData), innerSignature],
          blockTag: "latest",
        });
        if (result === "0x1626ba7e") return { chainId };
      } catch (error) {
        // Reverts/malformed returns reject the proof; provider failures stay retryable.
        if (
          !(
            error instanceof BaseError &&
            error.walk(
              (cause) =>
                cause instanceof ContractFunctionRevertedError ||
                cause instanceof ContractFunctionZeroDataError,
            )
          )
        )
          throw new Error(
            "Could not check the smart-wallet signature. Please try again.",
          );
      }
    }
    if (wrapped) {
      // The library's validator runs deployment/preparation and ERC-1271 in one
      // eth_call. No transaction is signed or broadcast; all simulated writes
      // disappear. Never call the supplied factory directly through a signer.
      try {
        const result = await client.call({
          data: encodeDeployData({
            abi: universalSignatureValidatorAbi,
            bytecode: universalSignatureValidatorByteCode,
            args: [
              address as Address,
              hashTypedData(typedData),
              signature as Hex,
            ],
          }),
          blockTag: "latest",
          gas: 10_000_000n,
        });
        // The validator constructor returns a single byte, not arbitrary truthy data.
        if (result.data === "0x01") return { chainId };
      } catch (error) {
        if (
          !(
            error instanceof BaseError &&
            error.walk((cause) => cause instanceof ExecutionRevertedError)
          )
        )
          throw new Error(
            "Could not check the smart-wallet signature. Please try again.",
          );
      }
    }
    throw new Error("Invalid wallet signature.");
  }
}
