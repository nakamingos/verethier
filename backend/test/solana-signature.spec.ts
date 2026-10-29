import { generateKeyPairSync, sign } from "crypto";
import { NonceService } from "../src/services/nonce.service";
import { SolanaSignatureService } from "../src/services/solana-signature.service";
import { EnvironmentConfig } from "../src/config/environment.config";
import { solanaBase58, solanaMessage } from "../src/utils/solana.util";

describe("Solana nonce-bound verification", () => {
  let service: SolanaSignatureService, nonces: NonceService;
  const keys = generateKeyPairSync("ed25519");
  const address = solanaBase58(
    new Uint8Array(
      keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ),
  );
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", true);
    jest.replaceProperty(
      EnvironmentConfig,
      "BASE_URL",
      "https://bouncer.example",
    );
    const cache = new Map();
    nonces = new NonceService({
      get: async (k) => cache.get(k),
      set: async (k, v) => cache.set(k, v),
      del: async (k) => cache.delete(k),
    } as any);
    service = new SolanaSignatureService(nonces, {
      getRulesByChannel: async () => [{ asset_type: "solana_nft" }],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());
  async function challenge() {
    const nonce = await nonces.createNonce(
      "member",
      "server",
      undefined,
      "channel",
    );
    const proof = await service.createChallenge(
      "member",
      "server",
      nonce,
      address,
    );
    const data = {
      userId: "member",
      discordId: "server",
      nonce,
      address,
      expiry: proof.expiry,
      walletType: "solana",
    } as any;
    const signature = sign(
      null,
      new TextEncoder().encode(proof.message),
      keys.privateKey,
    ).toString("base64");
    return { data, signature, proof };
  }
  it("accepts an exact real signature once and consumes it before linking", async () => {
    const { data, signature } = await challenge();
    expect((await service.verify(data, signature)).address).toBe(address);
    await expect(service.verify(data, signature)).rejects.toThrow("nonce");
  });
  it("allows only one concurrent submission of the same signed proof", async () => {
    const { data, signature } = await challenge();
    const outcomes = await Promise.allSettled([
      service.verify(data, signature),
      service.verify(data, signature),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects mismatched member, server, account, expiry, chain and privacy without consuming the legitimate proof", async () => {
    const { data, signature } = await challenge();
    for (const altered of [
      { userId: "other" },
      { discordId: "other" },
      { address: "11111111111111111111111111111111" },
      { expiry: 1 },
      { chainId: 1 },
      { privacy: { share_wallets: true } },
    ]) {
      await expect(
        service.verify({ ...data, ...altered }, signature),
      ).rejects.toThrow();
    }
    expect((await service.verify(data, signature)).address).toBe(address);
  });
  it("rejects a wallet-link signature used for community verification", async () => {
    const { data } = await challenge();
    const message = solanaMessage({
      origin: EnvironmentConfig.BASE_URL,
      purpose: "wallet_link",
      userId: data.userId,
      address,
      nonce: data.nonce,
      expiry: data.expiry,
    });
    await expect(
      service.verify(
        data,
        sign(null, new TextEncoder().encode(message), keys.privateKey).toString(
          "base64",
        ),
      ),
    ).rejects.toThrow("Invalid Solana signature");
  });
  it("rejects disabled verification and non-Solana channels", async () => {
    const { data } = await challenge();
    const other = new SolanaSignatureService(nonces, {
      getRulesByChannel: async () => [{ asset_type: "nft" }],
    } as any);
    await expect(
      other.createChallenge(data.userId, data.discordId, data.nonce, address),
    ).rejects.toThrow("no Solana");
    jest.replaceProperty(EnvironmentConfig, "SOLANA_ENABLED", false);
    await expect(
      service.createChallenge(data.userId, data.discordId, data.nonce, address),
    ).rejects.toThrow("not enabled");
  });
});
