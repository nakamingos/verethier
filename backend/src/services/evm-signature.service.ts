import { Injectable } from "@nestjs/common";
import {
  Address,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  PublicClient,
  createPublicClient,
  hashTypedData,
  http,
  parseAbi,
  recoverTypedDataAddress,
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
    Pick<PublicClient, "getChainId" | "getCode" | "readContract">
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
    // Do not accept/deploy an ERC-6492 wrapper as an ordinary contract signature.
    if (signature.toLowerCase().endsWith(COUNTERFACTUAL_SUFFIX))
      throw new Error(
        "Undeployed smart-wallet signatures are not supported yet.",
      );
    try {
      const recovered = await recoverTypedDataAddress({
        ...typedData,
        signature,
      });
      if (recovered.toLowerCase() === address.toLowerCase()) return {};
    } catch {
      /* Contract signatures need not have ECDSA's length or format. */
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
    if (!code || code === "0x")
      throw new Error(
        "Invalid wallet signature or smart wallet is not deployed on this network.",
      );
    try {
      const result = await client.readContract({
        address: address as Address,
        abi: ABI,
        functionName: "isValidSignature",
        args: [hashTypedData(typedData), signature as `0x${string}`],
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
    throw new Error("Invalid wallet signature.");
  }
}
