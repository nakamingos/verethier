import vectorsFile from "./fixtures/solana-compressed-vectors.json";
import {
  bubblegumAssetId,
  bubblegumTreeConfig,
  compressedCollection,
  compressedCreators,
  compressedLeaf,
  compressedProof,
  compressedTree,
  compressedHash,
} from "../src/utils/solana-compressed.util";
import { solanaBase58 } from "../src/utils/solana.util";

const vectors = vectorsFile.vectors;
const copy = <T>(input: T): T => JSON.parse(JSON.stringify(input));
const active = vectors.filter((vector) => !vector.burned);

describe("Bubblegum proofs against independent Metaplex SDK vectors", () => {
  it.each(active)(
    "matches the official $name asset, leaf, proof and collection",
    (vector) => {
      const asset = vector.asset;
      expect(
        bubblegumAssetId(asset.compression.tree, asset.compression.leaf_id),
      ).toBe(asset.id);
      expect(solanaBase58(new Uint8Array(compressedLeaf(asset)))).toBe(
        vector.proof.leaf,
      );
      const proof = compressedProof(asset, vector.proof, 100);
      const tree = compressedTree(
        proof.tree,
        proof.version,
        vector.treeAccount,
        vector.configAccount,
      );
      expect(proof.root.equals(new Uint8Array(tree.root!))).toBe(true);
      expect(tree.depth).toBe(proof.depth);
      expect(compressedCollection(asset)).toEqual({
        address: vector.collection,
        verified: vector.name !== "v1-unverified-collection",
      });
      expect(bubblegumTreeConfig(proof.tree)).toBe(
        solanaBase58(
          new Uint8Array(
            Buffer.from(vector.treeAccount.data[0], "base64").subarray(10, 42),
          ),
        ),
      );
    },
  );
  it("does not mistake inherited royalty recipients for verified leaf creators", () => {
    const vector = vectors.find((v) => v.name === "v2-inherited-royalties")!;
    expect(vector.asset.creators[0].verified).toBe(true);
    expect(compressedCreators(vector.asset)).toEqual([]);
  });
  it("recognizes an authenticated empty leaf after burn", () => {
    const vector = vectors.find((v) => v.burned)!;
    const proof = compressedProof(vector.asset, vector.proof, 100);
    const tree = compressedTree(
      proof.tree,
      proof.version,
      vector.treeAccount,
      vector.configAccount,
    );
    expect(proof.absent).toBe(true);
    expect(proof.root.equals(new Uint8Array(tree.root!))).toBe(true);
    expect(() => compressedLeaf(vector.asset)).toThrow();
  });
  it.each([
    "owner",
    "delegate",
    "id",
    "nonce",
    "tree",
    "metadata",
    "creator",
    "flags",
  ])("rejects altered %s committed to the leaf", (field) => {
    const vector = copy(vectors.find((v) => v.version === 2 && !v.burned)!);
    const asset: any = vector.asset;
    if (field === "owner" || field === "delegate")
      asset.ownership[field] = vector.collection;
    if (field === "id") asset.id = vector.collection;
    if (field === "nonce") asset.compression.leaf_id++;
    if (field === "tree") asset.compression.tree = vector.collection;
    if (field === "metadata") asset.compression.data_hash = vector.collection;
    if (field === "creator") asset.compression.creator_hash = vector.collection;
    if (field === "flags") asset.compression.flags = 0;
    expect(() => compressedProof(asset, vector.proof, 100)).toThrow();
  });
  it.each(["collection", "verified", "name", "share", "creator-verified"])(
    "rejects forged %s relationship metadata",
    (field) => {
      const vector = copy(vectors[0]);
      const asset: any = vector.asset;
      if (field === "collection")
        asset.grouping[0].group_value = vector.creator;
      if (field === "verified") asset.grouping[0].verified = false;
      if (field === "name") asset.content.metadata.name = "Different metadata";
      if (field === "share") asset.creators[0].share = 99;
      if (field === "creator-verified") asset.creators[0].verified = false;
      expect(() => compressedCollection(asset)).toThrow();
    },
  );
  it("resolves a missing V1 grouping verification flag only by an exact metadata hash", () => {
    const asset: any = copy(vectors[0].asset);
    delete asset.grouping[0].verified;
    expect(compressedCollection(asset)?.verified).toBe(true);
    asset.compression.data_hash = vectors[0].creator;
    expect(() => compressedCollection(asset)).toThrow();
  });
  it.each(["collection_hash", "asset_data_hash", "flags"])(
    "rejects missing V2 %s",
    (field) => {
      const vector: any = copy(vectors.find((v) => v.version === 2)!);
      delete vector.asset.compression[field];
      expect(() => compressedProof(vector.asset, vector.proof, 100)).toThrow();
    },
  );
  it.each([
    "schema",
    "flags",
    "slot",
    "index",
    "sibling",
    "leaf",
    "root",
    "nonce",
  ])("rejects unsupported or malformed %s evidence", (field) => {
    const vector: any = copy(vectors.find((v) => v.version === 2)!);
    if (field === "schema") vector.asset.interface = "MplBubblegumV3";
    if (field === "flags") vector.asset.compression.flags = 8;
    if (field === "slot") vector.proof.last_indexed_slot = 99;
    if (field === "index") vector.proof.node_index = 16;
    if (field === "sibling") vector.proof.proof[0] = vector.collection;
    if (field === "leaf") vector.proof.leaf = vector.collection;
    if (field === "root") vector.proof.root = vector.collection;
    if (field === "nonce")
      vector.asset.compression.leaf_id = Number.MAX_SAFE_INTEGER + 1;
    expect(() => compressedProof(vector.asset, vector.proof, 100)).toThrow();
  });
  it.each([
    "program",
    "authority",
    "unregistered",
    "config-version",
    "active-index",
    "depth",
    "buffer",
    "header-version",
  ])("rejects invalid on-chain tree %s", (field) => {
    const vector: any = copy(vectors[0]);
    const bytes = Buffer.from(vector.treeAccount.data[0], "base64");
    const config = Buffer.from(vector.configAccount.data[0], "base64");
    if (field === "program") vector.treeAccount.owner = vector.creator;
    if (field === "authority") bytes[10] ^= 1;
    if (field === "unregistered") vector.configAccount = null;
    if (field === "config-version") config[90] = 1;
    if (field === "active-index") bytes.writeBigUInt64LE(8n, 64);
    if (field === "depth") bytes.writeUInt32LE(33, 6);
    if (field === "buffer") bytes.writeUInt32LE(0, 2);
    if (field === "header-version") bytes[1] = 1;
    vector.treeAccount.data[0] = bytes.toString("base64");
    if (vector.configAccount)
      vector.configAccount.data[0] = config.toString("base64");
    expect(() =>
      compressedTree(
        vector.asset.compression.tree,
        1,
        vector.treeAccount,
        vector.configAccount,
      ),
    ).toThrow();
  });
  it("distinguishes the current root from retained historical roots", () => {
    const vector = copy(vectors[0]);
    const bytes = Buffer.from(vector.treeAccount.data[0], "base64");
    bytes.writeBigUInt64LE(3n, 64);
    bytes.writeBigUInt64LE(4n, 72);
    bytes.set(
      compressedHash(new Uint8Array([1, 2, 3])),
      80 + 3 * (40 + 32 * 3),
    );
    vector.treeAccount.data[0] = bytes.toString("base64");
    const state = compressedTree(
      vector.asset.compression.tree,
      1,
      vector.treeAccount,
      vector.configAccount,
    );
    const proof = compressedProof(vector.asset, vector.proof, 100);
    expect(state.root!.equals(new Uint8Array(proof.root))).toBe(false);
  });
});
