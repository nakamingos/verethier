// Optional fixture regeneration with the official SDK installed outside the app:
// node generate-solana-compressed-vectors.cjs /path/to/sdk/node_modules
const fs = require("node:fs"),
  path = require("node:path");
const dependencies = path.resolve(process.argv[2]);
const sdk = require(
  path.join(dependencies, "@metaplex-foundation/mpl-bubblegum"),
);
const umi = require(path.join(dependencies, "@metaplex-foundation/umi"));
const { createWeb3JsEddsa } = require(
  path.join(dependencies, "@metaplex-foundation/umi-eddsa-web3js"),
);
const context = {
  eddsa: createWeb3JsEddsa(),
  programs: { getPublicKey: (_name, fallback) => fallback },
};
const pub = (n) => umi.publicKey(new Uint8Array(32).fill(n));
const encode = (bytes) => umi.publicKey(new Uint8Array(bytes));
const tree = pub(1),
  owner = pub(2),
  delegate = pub(3),
  creator = pub(4),
  collection = pub(5);
const vectors = [];
for (const [version, verified, inherited, transferred, burned] of [
  [1, true, false],
  [1, false, false],
  [2, true, false],
  [2, true, true],
  [1, true, false, true],
  [1, true, false, false, true],
]) {
  const holder = transferred ? pub(6) : owner,
    leafDelegate = transferred ? holder : delegate;
  const creators = inherited
    ? []
    : [{ address: creator, verified: true, share: 100 }];
  const metadata = {
    name: "Bouncer fixture",
    symbol: "TEST",
    uri: "https://example.invalid/fixture.json",
    sellerFeeBasisPoints: inherited ? 65535 : 500,
    primarySaleHappened: false,
    isMutable: true,
    tokenStandard: umi.some(sdk.TokenStandard.NonFungible),
    creators,
    collection:
      version === 1
        ? umi.some({ key: collection, verified })
        : umi.some(collection),
  };
  const leafIndex = 1;
  const leaf = (version === 1 ? sdk.hashLeaf : sdk.hashLeafV2)(context, {
    merkleTree: tree,
    owner: holder,
    delegate: leafDelegate,
    leafIndex,
    metadata,
    ...(version === 2 ? { flags: 3 } : {}),
  });
  const dataHash = (
    version === 1 ? sdk.hashMetadataData : sdk.hashMetadataDataV2
  )(metadata);
  const creatorHash = sdk.hashMetadataCreators(creators);
  const id = sdk.findLeafAssetIdPda(context, {
    merkleTree: tree,
    leafIndex,
  })[0];
  const proof = Array.from({ length: 3 }, (_, i) =>
    sdk.hash(new Uint8Array(32).fill(i + 20)),
  );
  const proofLeaf = burned ? new Uint8Array(32) : leaf;
  let root = proofLeaf,
    index = leafIndex;
  for (const sibling of proof) {
    root = sdk.hash(index % 2 ? [sibling, root] : [root, sibling]);
    index = Math.floor(index / 2);
  }
  const asset = {
    id,
    interface: version === 1 ? "V1_NFT" : "MplBubblegumV2",
    burnt: !!burned,
    mutable: true,
    ownership: {
      owner: holder,
      delegate: leafDelegate,
      delegated: holder !== leafDelegate,
      ownership_model: "single",
    },
    grouping: [{ group_key: "collection", group_value: collection, verified }],
    creators: inherited
      ? [{ address: creator, verified: true, share: 100 }]
      : creators,
    ...(inherited ? { creators_raw: [] } : {}),
    royalty: {
      basis_points: 500,
      primary_sale_happened: false,
      ...(inherited ? { inherited: true, basis_points_raw: 65535 } : {}),
    },
    content: {
      json_uri: metadata.uri,
      metadata: {
        name: metadata.name,
        symbol: metadata.symbol,
        attributes: [
          { trait_type: "Color", value: "Blue" },
          { trait_type: "Hat", value: "Cap" },
        ],
      },
    },
    compression: {
      compressed: true,
      eligible: false,
      tree,
      leaf_id: leafIndex,
      data_hash: encode(dataHash),
      creator_hash: encode(creatorHash),
      asset_hash: encode(leaf),
      ...(version === 2
        ? {
            collection_hash: encode(sdk.hashCollection(collection)),
            asset_data_hash: encode(sdk.hashAssetData()),
            flags: 3,
          }
        : {}),
    },
  };
  const binary = Buffer.alloc(80 + 8 * (40 + 32 * 3));
  binary[0] = 1;
  binary.writeUInt32LE(8, 2);
  binary.writeUInt32LE(3, 6);
  const authority = sdk.findTreeConfigPda(context, { merkleTree: tree })[0];
  binary.set(umi.publicKeyBytes(authority), 10);
  binary.writeBigUInt64LE(2n, 56);
  binary.writeBigUInt64LE(2n, 64);
  binary.writeBigUInt64LE(3n, 72);
  binary.set(root, 80 + 2 * (40 + 32 * 3));
  const config = Buffer.alloc(96);
  config.set([122, 245, 175, 248, 171, 34, 0, 207]);
  config.writeBigUInt64LE(8n, 72);
  config.writeBigUInt64LE(2n, 80);
  config[90] = version - 1;
  vectors.push({
    name: burned
      ? "v1-burned"
      : transferred
        ? "v1-transferred-owner"
        : inherited
          ? "v2-inherited-royalties"
          : `v${version}-${verified ? "verified" : "unverified"}-collection`,
    version,
    creator,
    collection,
    burned: !!burned,
    transferred: !!transferred,
    asset,
    proof: {
      last_indexed_slot: 100,
      root: encode(root),
      proof: proof.map(encode),
      node_index: 9,
      leaf: encode(proofLeaf),
      tree_id: tree,
    },
    treeAccount: {
      owner:
        version === 1
          ? "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK"
          : "mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW",
      executable: false,
      data: [binary.toString("base64"), "base64"],
    },
    configAccount: {
      owner: sdk.MPL_BUBBLEGUM_PROGRAM_ID,
      executable: false,
      data: [config.toString("base64"), "base64"],
    },
  });
}
// A real two-leaf tree gives independent same-root proofs for batch validation.
const batch = [];
const metadata = {
  name: "Bouncer fixture",
  symbol: "TEST",
  uri: "https://example.invalid/fixture.json",
  sellerFeeBasisPoints: 500,
  primarySaleHappened: false,
  isMutable: true,
  tokenStandard: umi.some(sdk.TokenStandard.NonFungible),
  creators: [{ address: creator, verified: true, share: 100 }],
  collection: umi.some({ key: collection, verified: true }),
};
const leaves = Array.from({ length: 8 }, () => new Uint8Array(32));
for (const nonce of [0, 1])
  leaves[nonce] = sdk.hashLeaf(context, {
    merkleTree: tree,
    owner,
    delegate,
    leafIndex: nonce,
    metadata,
  });
const layers = [leaves];
while (layers.at(-1).length > 1) {
  const level = layers.at(-1),
    next = [];
  for (let i = 0; i < level.length; i += 2)
    next.push(sdk.hash([level[i], level[i + 1]]));
  layers.push(next);
}
for (const nonce of [0, 1]) {
  const vector = JSON.parse(JSON.stringify(vectors[0]));
  const id = sdk.findLeafAssetIdPda(context, {
    merkleTree: tree,
    leafIndex: nonce,
  })[0];
  vector.name = "batch-" + nonce;
  vector.asset.id = id;
  vector.asset.compression.leaf_id = nonce;
  vector.asset.compression.asset_hash = encode(leaves[nonce]);
  let position = nonce;
  const proof = [];
  for (const layer of layers.slice(0, -1)) {
    proof.push(encode(layer[position ^ 1]));
    position = Math.floor(position / 2);
  }
  vector.proof = {
    last_indexed_slot: 100,
    root: encode(layers.at(-1)[0]),
    proof,
    node_index: 8 + nonce,
    leaf: encode(leaves[nonce]),
    tree_id: tree,
  };
  const bytes = Buffer.from(vector.treeAccount.data[0], "base64");
  bytes.set(layers.at(-1)[0], 80 + 2 * (40 + 32 * 3));
  vector.treeAccount.data[0] = bytes.toString("base64");
  batch.push(vector);
}
const provenance = {
  sdk: JSON.parse(
    fs.readFileSync(
      path.join(
        dependencies,
        "@metaplex-foundation/mpl-bubblegum/package.json",
      ),
    ),
  ).version,
  description:
    "Synthetic independent official Metaplex SDK leaf, metadata, creator, asset-ID and Merkle vectors. No real wallets or RPC calls.",
};
fs.writeFileSync(
  path.join(__dirname, "solana-compressed-vectors.json"),
  JSON.stringify({ provenance, vectors, batch }, null, 2) + "\n",
);
console.log("Generated " + vectors.length + " independent Bubblegum fixtures.");
