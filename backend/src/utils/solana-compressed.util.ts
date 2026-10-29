/** Bubblegum byte layouts follow Metaplex mpl-bubblegum (Apache-2.0):
 * programs/bubblegum/program/src/{state/leaf_schema.rs,utils.rs} and
 * clients/{spl-ac-js,mpl-ac-js}/src/hooked/{concurrentMerkleTree,changeLog}.ts.
 * Ownership accepts only a proof matching the current finalized tree root.
 */
import { keccak256 } from "viem";
import {
  solanaBase58,
  solanaProgramAddress,
  solanaPublicKey,
} from "./solana.util";

export const BUBBLEGUM_PROGRAM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
export const SPL_COMPRESSION_PROGRAM =
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK";
export const MPL_COMPRESSION_PROGRAM =
  "mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW";
const UNAVAILABLE =
  "Compressed Solana NFT evidence is unavailable. Existing roles are preserved.";
export const compressedUnavailable = (): never => {
  throw new Error(UNAVAILABLE);
};
const concat = (...parts: Array<Uint8Array | Buffer>) =>
  Buffer.concat(parts.map((part) => new Uint8Array(part)));
export const compressedHash = (...parts: Array<Uint8Array | Buffer>) =>
  Buffer.from(keccak256(new Uint8Array(concat(...parts))).slice(2), "hex");
const byte = (n: number) => Buffer.from([n]);
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    compressedUnavailable();
  return value as number;
}
function u32(value: number) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}
function u16(value: number) {
  const result = Buffer.alloc(2);
  result.writeUInt16LE(value);
  return result;
}
function u64(value: number) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt(integer(value)));
  return result;
}
function flag(value: unknown) {
  if (typeof value !== "boolean") compressedUnavailable();
  return byte(value ? 1 : 0);
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || Buffer.byteLength(value) > max)
    compressedUnavailable();
  const data = Buffer.from(value as string, "utf8");
  return concat(u32(data.length), data);
}
function key(value: unknown): Buffer {
  if (typeof value !== "string") compressedUnavailable();
  return solanaPublicKey(value as string);
}
const same = (a: Buffer, b: Buffer) => a.equals(new Uint8Array(b));
export function compressedVersion(asset: any): 1 | 2 {
  if (asset?.compression?.compressed !== true) compressedUnavailable();
  if (asset.interface === "MplBubblegumV2") return 2;
  if (asset.interface === "V1_NFT") return 1;
  return compressedUnavailable();
}
export function bubblegumAssetId(tree: string, nonce: number): string {
  return solanaProgramAddress(BUBBLEGUM_PROGRAM, [
    new Uint8Array(Buffer.from("asset")),
    new Uint8Array(key(tree)),
    new Uint8Array(u64(nonce)),
  ]);
}
export function bubblegumTreeConfig(tree: string): string {
  return solanaProgramAddress(BUBBLEGUM_PROGRAM, [new Uint8Array(key(tree))]);
}
export function compressedLeaf(asset: any): Buffer {
  const version = compressedVersion(asset),
    c = asset.compression;
  if (asset.burnt !== false || asset.ownership?.ownership_model !== "single")
    compressedUnavailable();
  const nonce = integer(c.leaf_id);
  if (asset.id !== bubblegumAssetId(c.tree, nonce)) compressedUnavailable();
  const owner = key(asset.ownership.owner);
  if (asset.ownership.delegated === true && !asset.ownership.delegate)
    compressedUnavailable();
  const delegate = key(asset.ownership.delegate || asset.ownership.owner);
  const parts: Buffer[] = [
    byte(version),
    key(asset.id),
    owner,
    delegate,
    u64(nonce),
    key(c.data_hash),
    key(c.creator_hash),
  ];
  if (version === 2) {
    const flags = integer(c.flags, 7);
    parts.push(key(c.collection_hash), key(c.asset_data_hash), byte(flags));
  } else if (
    c.collection_hash !== undefined ||
    c.asset_data_hash !== undefined ||
    c.flags !== undefined
  )
    compressedUnavailable();
  const leaf = compressedHash(...parts);
  if (c.asset_hash !== undefined && !same(leaf, key(c.asset_hash)))
    compressedUnavailable();
  return leaf;
}
export interface CompressedCreator {
  address: string;
  verified: boolean;
  share: number;
}
function creatorsFor(asset: any): {
  creators: CompressedCreator[];
  bytes: Buffer;
  inherited: boolean;
} {
  const inherited =
    compressedVersion(asset) === 2 &&
    (asset.royalty?.inherited === true ||
      asset.royalty?.basis_points_raw === 65535 ||
      asset.royalty?.basis_points === 65535);
  const creators = asset.creators_raw ?? (inherited ? [] : asset.creators);
  if (!Array.isArray(creators) || creators.length > 5) compressedUnavailable();
  const bytes = concat(
    ...creators.map((creator) =>
      concat(
        key(creator?.address),
        flag(creator?.verified),
        byte(integer(creator?.share, 100)),
      ),
    ),
  );
  if (
    creators.length &&
    creators.reduce((sum, creator) => sum + creator.share, 0) !== 100
  )
    compressedUnavailable();
  if (!same(compressedHash(bytes), key(asset.compression.creator_hash)))
    compressedUnavailable();
  return { creators, bytes, inherited };
}
export function compressedCreators(asset: any): CompressedCreator[] {
  return creatorsFor(asset).creators;
}
/** Authenticate the collection witness against the metadata/collection hashes.
 * Off-chain names and grouping flags cannot establish collection membership.
 */
export function compressedCollection(
  asset: any,
): { address: string; verified: boolean } | null {
  const version = compressedVersion(asset),
    raw = creatorsFor(asset);
  if (!Array.isArray(asset.grouping)) compressedUnavailable();
  const groups = asset.grouping.filter(
    (group: any) => group.group_key === "collection",
  );
  if (groups.length > 1) compressedUnavailable();
  const group = groups[0];
  if (group) {
    key(group.group_value);
    if (group.verified !== undefined && typeof group.verified !== "boolean")
      compressedUnavailable();
  }
  if (version === 2) {
    if (group?.verified === false) compressedUnavailable();
    if (
      !same(
        compressedHash(group ? key(group.group_value) : Buffer.alloc(32)),
        key(asset.compression.collection_hash),
      )
    )
      compressedUnavailable();
  }
  const royalty = asset.royalty;
  const fee = integer(
    royalty?.basis_points_raw ??
      (raw.inherited ? 65535 : royalty?.basis_points),
    65535,
  );
  if (fee > 10000 && !(version === 2 && fee === 65535)) compressedUnavailable();
  const common = concat(
    text(asset.content?.metadata?.name, 32),
    text(asset.content?.metadata?.symbol ?? "", 10),
    text(asset.content?.json_uri, 200),
    u16(fee),
    flag(royalty?.primary_sale_happened),
    flag(asset.mutable),
  );
  const vector = concat(u32(raw.creators.length), raw.bytes);
  // Missing optional display fields are resolved only by an exact hash match.
  const standards = [byte(0), Buffer.from([1, 0])]; // None or NonFungible.
  const verified = group
    ? group.verified === undefined
      ? [false, true]
      : [group.verified]
    : [false];
  for (const standard of standards)
    for (const valid of verified) {
      const collection = group
        ? concat(
            byte(1),
            ...(version === 1 ? [flag(valid)] : []),
            key(group.group_value),
          )
        : byte(0);
      if (version === 2) {
        const metadata = concat(common, standard, vector, collection);
        if (
          same(
            compressedHash(compressedHash(metadata), u16(fee)),
            key(asset.compression.data_hash),
          )
        )
          return group ? { address: group.group_value, verified: true } : null;
      } else {
        const nonce = asset.supply?.edition_nonce;
        const edition =
          nonce == null ? byte(0) : concat(byte(1), byte(integer(nonce, 255)));
        for (const program of [0, 1]) {
          const metadata = concat(
            common,
            edition,
            standard,
            collection,
            byte(0),
            byte(program),
            vector,
          );
          if (
            same(
              compressedHash(compressedHash(metadata), u16(fee)),
              key(asset.compression.data_hash),
            )
          )
            return group
              ? { address: group.group_value, verified: valid }
              : null;
        }
      }
    }
  return compressedUnavailable();
}
export function compressedProof(asset: any, proof: any, minSlot: number) {
  const version = compressedVersion(asset);
  const nonce = integer(asset.compression.leaf_id);
  if (asset.id !== bubblegumAssetId(asset.compression.tree, nonce))
    compressedUnavailable();
  const leaf = key(proof?.leaf),
    absent = same(leaf, Buffer.alloc(32));
  if (!absent && !same(leaf, compressedLeaf(asset))) compressedUnavailable();
  if (
    integer(proof?.last_indexed_slot) < minSlot ||
    proof.tree_id !== asset.compression.tree ||
    !Array.isArray(proof.proof) ||
    proof.proof.length < 1 ||
    proof.proof.length > 32
  )
    compressedUnavailable();
  const depth = proof.proof.length,
    offset = 2 ** depth;
  let index = integer(proof.node_index) - offset;
  if (index < 0 || index >= offset || (absent && index !== nonce))
    compressedUnavailable();
  let root = leaf;
  for (const sibling of proof.proof) {
    root =
      index % 2
        ? compressedHash(key(sibling), root)
        : compressedHash(root, key(sibling));
    index = Math.floor(index / 2);
  }
  if (!same(root, key(proof.root))) compressedUnavailable();
  return { root, depth, version, tree: proof.tree_id as string, nonce, absent };
}

function binary(account: any, length: number): Buffer {
  if (
    !account ||
    account.executable !== false ||
    !Array.isArray(account.data) ||
    account.data[1] !== "base64" ||
    typeof account.data[0] !== "string"
  )
    compressedUnavailable();
  const bytes = Buffer.from(account.data[0], "base64");
  if (bytes.length < length || bytes.toString("base64") !== account.data[0])
    compressedUnavailable();
  return bytes;
}
export function compressedTree(
  tree: string,
  version: 1 | 2,
  account: any,
  config: any,
) {
  if (
    account?.owner !==
      (version === 1 ? SPL_COMPRESSION_PROGRAM : MPL_COMPRESSION_PROGRAM) ||
    config?.owner !== BUBBLEGUM_PROGRAM
  )
    compressedUnavailable();
  const bytes = binary(account, 80),
    authority = binary(config, 91);
  if (
    !authority
      .subarray(0, 8)
      .equals(new Uint8Array([122, 245, 175, 248, 171, 34, 0, 207])) ||
    authority[90] !== version - 1 ||
    bytes[0] !== 1 ||
    bytes[1] !== 0 ||
    solanaBase58(new Uint8Array(bytes.subarray(10, 42))) !==
      bubblegumTreeConfig(tree)
  )
    compressedUnavailable();
  const buffer = bytes.readUInt32LE(2),
    depth = bytes.readUInt32LE(6);
  if (
    buffer < 1 ||
    buffer > 2048 ||
    buffer & (buffer - 1) ||
    depth < 1 ||
    depth > 32
  )
    compressedUnavailable();
  const active = bytes.readBigUInt64LE(64),
    size = bytes.readBigUInt64LE(72);
  const minted = authority.readBigUInt64LE(80);
  if (
    active >= BigInt(buffer) ||
    size < 1n ||
    size > BigInt(buffer) ||
    minted > 1n << BigInt(depth) ||
    authority.readBigUInt64LE(72) !== 1n << BigInt(depth)
  )
    compressedUnavailable();
  const stride = 40 + 32 * depth,
    length = 80 + buffer * stride;
  return {
    depth,
    length,
    minted,
    root:
      bytes.length >= length
        ? bytes.subarray(
            80 + Number(active) * stride,
            112 + Number(active) * stride,
          )
        : undefined,
  };
}
