import { createPublicKey, verify, createHash } from "crypto";
import { ed25519 } from "@noble/curves/ed25519";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SOLANA_MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export function solanaPublicKey(value: string): Buffer {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    throw new Error("Use a valid Solana public key.");
  let number = 0n;
  for (const char of value)
    number = number * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes: number[] = [];
  while (number) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  let zeros = 0;
  while (value[zeros] === "1") zeros++;
  const decoded = Buffer.from([...new Uint8Array(zeros), ...bytes]);
  if (decoded.length !== 32) throw new Error("Use a valid Solana public key.");
  return decoded;
}

export function normalizeSolanaAddress(value: string): string {
  solanaPublicKey(value);
  return value;
}

export function solanaBase58(bytes: Uint8Array): string {
  let number = BigInt("0x" + Buffer.from(bytes).toString("hex")),
    value = "";
  while (number) {
    value = ALPHABET[Number(number % 58n)] + value;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    value = "1" + value;
  }
  return value;
}

export const TOKEN_METADATA_PROGRAM =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export function solanaMetadataAddress(mint: string): string {
  const program = solanaPublicKey(TOKEN_METADATA_PROGRAM);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash("sha256")
      .update(
        new Uint8Array([
          ...Buffer.from("metadata"),
          ...program,
          ...solanaPublicKey(mint),
          bump,
          ...program,
          ...Buffer.from("ProgramDerivedAddress"),
        ]),
      )
      .digest();
    try {
      ed25519.ExtendedPoint.fromHex(new Uint8Array(hash));
    } catch {
      return solanaBase58(new Uint8Array(hash));
    }
  }
  throw new Error("Could not derive Solana metadata address.");
}

/** Decode the on-chain collection relationship; no off-chain JSON is trusted. */
export function solanaMetadataCollection(
  bytes: Buffer,
  mint: string,
): { address: string; verified: boolean } | null {
  let offset = 0;
  const take = (length: number) => {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset + length > bytes.length
    )
      throw new Error("Incomplete Solana metadata.");
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const byte = () => take(1)[0];
  const option = (read: () => any) => {
    const tag = byte();
    if (tag === 0) return null;
    if (tag !== 1) throw new Error("Invalid Solana metadata.");
    return read();
  };
  if (byte() !== 4) throw new Error("Invalid Solana metadata account.");
  take(32);
  if (solanaBase58(new Uint8Array(take(32))) !== mint)
    throw new Error("Solana metadata mint mismatch.");
  for (let i = 0; i < 3; i++) {
    const length = take(4).readUInt32LE(0);
    take(length);
  }
  take(2);
  option(() => {
    const count = take(4).readUInt32LE(0);
    if (count > 5) throw new Error("Invalid Solana creators.");
    take(count * 34);
  });
  take(2); // primary sale and mutability
  if (offset === bytes.length) return null;
  option(() => byte()); // edition nonce
  if (offset === bytes.length) return null;
  option(() => byte()); // token standard
  if (offset === bytes.length) return null;
  return option(() => {
    const verified = byte();
    if (verified > 1) throw new Error("Invalid collection verification.");
    return {
      verified: verified === 1,
      address: solanaBase58(new Uint8Array(take(32))),
    };
  });
}

/** Only an exact, server-issued UTF-8 message and canonical 64-byte signature. */
export function verifySolanaMessage(
  address: string,
  message: string,
  signature: string,
): void {
  try {
    if (
      typeof message !== "string" ||
      !message ||
      Buffer.byteLength(message) > 8192 ||
      typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature)
    )
      throw new Error();
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== signature)
      throw new Error();
    const point = ed25519.ExtendedPoint.fromHex(
      new Uint8Array(solanaPublicKey(address)),
    );
    if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error();
    const key = createPublicKey({
      key: Buffer.from([
        ...Buffer.from("302a300506032b6570032100", "hex"),
        ...solanaPublicKey(address),
      ]),
      format: "der",
      type: "spki",
    });
    if (
      !verify(
        null,
        new TextEncoder().encode(message),
        key,
        new Uint8Array(bytes),
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      "Invalid Solana signature. Sign again with the selected wallet.",
    );
  }
}

export function solanaMessage(input: {
  origin: string;
  purpose: "verification" | "wallet_link";
  address: string;
  userId: string;
  nonce: string;
  expiry: number;
  serverId?: string;
  channelId?: string;
  privacy?: string;
}): string {
  const url = new URL(input.origin);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid verification origin.");
  normalizeSolanaAddress(input.address);
  for (const value of [
    input.userId,
    input.nonce,
    input.serverId,
    input.channelId,
    input.privacy,
  ]) {
    if (
      value !== undefined &&
      (typeof value !== "string" || /[\r\n]/.test(value))
    )
      throw new Error("Invalid Solana challenge.");
  }
  if (!Number.isSafeInteger(input.expiry) || input.expiry * 1000 <= Date.now())
    throw new Error("Verification has expired.");
  return [
    "Bouncer Solana wallet proof",
    "",
    `Domain: ${url.origin}`,
    "Network: Solana mainnet",
    `Purpose: ${input.purpose}`,
    `Address: ${input.address}`,
    `Discord user: ${input.userId}`,
    ...(input.serverId ? [`Discord server: ${input.serverId}`] : []),
    ...(input.channelId ? [`Discord channel: ${input.channelId}`] : []),
    `Nonce: ${input.nonce}`,
    `Issued at: ${new Date().toISOString()}`,
    `Expires at: ${new Date(input.expiry * 1000).toISOString()}`,
    ...(input.privacy !== undefined ? [`Privacy: ${input.privacy}`] : []),
    "",
    input.purpose === "wallet_link"
      ? "Link this wallet to Bouncer. This does not verify community roles."
      : "Verify this wallet for eligible Discord roles.",
    "This message does not authorize transactions, transfers or spending.",
  ].join("\n");
}
