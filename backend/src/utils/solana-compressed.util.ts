/** Provider-backed compressed NFT fields. Ownership and relationships trust DAS
 * indexing; independent Merkle/tree verification is an optional future feature.
 */
import { normalizeSolanaAddress } from "./solana.util";

export const compressedUnavailable = (): never => {
  throw new Error(
    "Compressed Solana NFT data is unavailable. Existing roles are preserved.",
  );
};
function compressedVersion(asset: any): 1 | 2 {
  if (asset?.compression?.compressed !== true) compressedUnavailable();
  if (asset.interface === "MplBubblegumV2") return 2;
  if (asset.interface === "V1_NFT") return 1;
  return compressedUnavailable();
}
export function validateCompressedAsset(asset: any) {
  compressedVersion(asset);
  normalizeSolanaAddress(asset.id);
  if (typeof asset.burnt !== "boolean") compressedUnavailable();
  if (!asset.burnt) {
    if (asset.ownership?.ownership_model !== "single") compressedUnavailable();
    normalizeSolanaAddress(asset.ownership.owner);
  }
  return asset;
}
export function compressedCreators(
  asset: any,
): Array<{ address: string; verified: boolean }> {
  const inherited =
    compressedVersion(asset) === 2 &&
    (asset.royalty?.inherited === true ||
      asset.royalty?.basis_points_raw === 65535 ||
      asset.royalty?.basis_points === 65535);
  // Resolved collection royalty recipients are not verified asset creators.
  const creators = asset.creators_raw ?? (inherited ? [] : asset.creators);
  if (!Array.isArray(creators)) compressedUnavailable();
  return creators.map((creator) => {
    if (typeof creator?.verified !== "boolean") compressedUnavailable();
    return {
      address: normalizeSolanaAddress(creator.address),
      verified: creator.verified,
    };
  });
}
export function compressedCollection(
  asset: any,
): { address: string; verified: boolean } | null {
  compressedVersion(asset);
  if (!Array.isArray(asset.grouping)) compressedUnavailable();
  const groups = asset.grouping.filter(
    (group: any) => group?.group_key === "collection",
  );
  if (groups.length > 1) compressedUnavailable();
  if (!groups.length) return null;
  const group = groups[0];
  if (typeof group.verified !== "boolean") compressedUnavailable();
  return {
    address: normalizeSolanaAddress(group.group_value),
    verified: group.verified,
  };
}
