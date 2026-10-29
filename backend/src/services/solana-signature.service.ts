import { Injectable } from "@nestjs/common";
import { EnvironmentConfig } from "@/config/environment.config";
import { DecodedData } from "@/models/app.interface";
import { privacyChoice, privacyProof } from "@/portal/privacy.service";
import {
  solanaMessage,
  normalizeSolanaAddress,
  verifySolanaMessage,
} from "@/utils/solana.util";
import { NonceService } from "./nonce.service";
import { DbService } from "./db.service";

@Injectable()
export class SolanaSignatureService {
  constructor(
    private readonly nonces: NonceService,
    private readonly db: DbService,
  ) {}

  async createChallenge(
    userId: string,
    guildId: string,
    nonce: string,
    address: string,
    choice?: unknown,
  ) {
    if (!EnvironmentConfig.SOLANA_ENABLED)
      throw new Error("Solana verification is not enabled.");
    const context = await this.nonces.getActiveNonce(userId, guildId, nonce);
    const rules = context.channelId
      ? await this.db.getRulesByChannel(guildId, context.channelId)
      : await this.db.getRoleMappings(guildId);
    if (
      !rules.some(
        (rule) =>
          rule.asset_type === "solana_nft" ||
          rule.asset_type === "solana_token",
      )
    )
      throw new Error("This channel has no Solana rules.");
    const privacy = choice === undefined ? undefined : privacyChoice(choice);
    const normalized = normalizeSolanaAddress(address);
    const message = solanaMessage({
      origin: EnvironmentConfig.BASE_URL,
      purpose: "verification",
      address: normalized,
      userId: context.userId,
      serverId: context.guildId,
      channelId: context.channelId,
      nonce: context.nonce,
      expiry: context.expiry,
      ...(privacy !== undefined ? { privacy: privacyProof(privacy) } : {}),
    });
    await this.nonces.saveSolanaChallenge(userId, guildId, nonce, {
      address: normalized,
      message,
      ...(privacy !== undefined ? { privacy } : {}),
    });
    return { address: normalized, message, expiry: context.expiry };
  }

  async verify(data: DecodedData, signature: string) {
    if (!EnvironmentConfig.SOLANA_ENABLED)
      throw new Error("Solana verification is not enabled.");
    const context = await this.nonces.getActiveNonce(
      data.userId,
      data.discordId,
      data.nonce,
    );
    const address = normalizeSolanaAddress(data.address),
      challenge = context.solanaChallenge;
    if (
      !challenge ||
      challenge.address !== address ||
      context.expiry !== data.expiry ||
      data.chainId !== undefined ||
      JSON.stringify(challenge.privacy) !==
        JSON.stringify(
          data.privacy === undefined ? undefined : privacyChoice(data.privacy),
        )
    )
      throw new Error("Invalid Solana verification challenge.");
    verifySolanaMessage(address, challenge.message, signature);
    const consumed = await this.nonces.consumeNonce(
      data.userId,
      data.discordId,
      data.nonce,
    );
    if (
      consumed.solanaChallenge?.message !== challenge.message ||
      consumed.solanaChallenge.address !== address
    )
      throw new Error("Invalid Solana verification challenge.");
    return { address, context: consumed };
  }
}
