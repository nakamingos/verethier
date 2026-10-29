import { generateKeyPairSync, sign } from "crypto";
import {
  normalizeSolanaAddress,
  solanaMessage,
  solanaPublicKey,
  verifySolanaMessage,
} from "../src/utils/solana.util";
import {
  normalizeBlockedWallet,
  WalletBlockService,
} from "../src/services/wallet-block.service";
import { normalizeWalletAddress } from "../src/utils/wallet-address.util";
import { walletOnChain } from "../src/utils/wallet-scope.util";

function encode(bytes: Buffer) {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + bytes.toString("hex")),
    value = "";
  while (n) {
    value = chars[Number(n % 58n)] + value;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    value = "1" + value;
  }
  return value;
}
describe("Solana proof boundary", () => {
  const keys = generateKeyPairSync("ed25519");
  const raw = keys.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const address = encode(raw);
  const input = {
    origin: "https://bouncer.example",
    purpose: "verification" as const,
    address,
    userId: "123",
    serverId: "456",
    channelId: "789",
    nonce: "fresh-nonce",
    expiry: Math.floor(Date.now() / 1000) + 300,
  };
  it("preserves the exact canonical public key and leading zero bytes", () => {
    expect(solanaPublicKey(address)).toEqual(raw);
    expect(normalizeSolanaAddress(address)).toBe(address);
    expect(solanaPublicKey("11111111111111111111111111111111")).toEqual(
      Buffer.alloc(32),
    );
  });
  it("does not mistake a Solana address beginning bc1p for Bitcoin or an EVM wallet", async () => {
    const collision = "bc1p111111111111111111111111111111111111111";
    expect(normalizeWalletAddress(collision, "solana")).toBe(collision);
    expect(normalizeBlockedWallet(collision)).toBe(collision);
    expect(walletOnChain({ wallet_type: "solana" }, 1)).toBe(false);
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ in: async () => ({ data: [], error: null }) }),
        }),
      }),
    };
    expect(
      await new WalletBlockService(client as any).allowedAddresses("server", [
        collision,
      ]),
    ).toEqual([collision]);
  });
  it.each([
    "",
    "1111111111111111111111111111111",
    "0".repeat(44),
    " " + address,
    address + " ",
    "z".repeat(44),
  ])("rejects malformed keys: %s", (value) => {
    expect(() => normalizeSolanaAddress(value)).toThrow();
  });
  it("verifies real Ed25519 signatures without a chain transaction", () => {
    const message = solanaMessage(input);
    const signature = sign(
      null,
      new TextEncoder().encode(message),
      keys.privateKey,
    ).toString("base64");
    expect(() =>
      verifySolanaMessage(address, message, signature),
    ).not.toThrow();
    for (const altered of [
      message + " ",
      message.replace("mainnet", "devnet"),
      solanaMessage({ ...input, purpose: "wallet_link" }),
      solanaMessage({ ...input, userId: "other" }),
      solanaMessage({ ...input, nonce: "other" }),
    ]) {
      expect(() => verifySolanaMessage(address, altered, signature)).toThrow(
        "Invalid Solana signature",
      );
    }
    const other = generateKeyPairSync("ed25519");
    expect(() =>
      verifySolanaMessage(
        address,
        message,
        sign(
          null,
          new TextEncoder().encode(message),
          other.privateKey,
        ).toString("base64"),
      ),
    ).toThrow();
  });
  it("rejects truncated, noncanonical and excessive signatures", () => {
    const message = solanaMessage(input);
    for (const signature of [
      "",
      "A".repeat(86) + "==",
      "A".repeat(88),
      Buffer.alloc(63).toString("base64"),
      "x".repeat(10000),
    ]) {
      expect(() => verifySolanaMessage(address, message, signature)).toThrow();
    }
  });
  it("binds privacy, origin and context and rejects line injection and expired messages", () => {
    expect(solanaMessage({ ...input, privacy: "consent" })).toContain(
      "Privacy: consent",
    );
    expect(() =>
      solanaMessage({ ...input, nonce: "nonce\nAddress: spoof" }),
    ).toThrow();
    expect(() =>
      solanaMessage({ ...input, origin: "ftp://bouncer.example" }),
    ).toThrow();
    expect(() => solanaMessage({ ...input, expiry: 1 })).toThrow();
  });
});
