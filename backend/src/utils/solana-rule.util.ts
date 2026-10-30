import { normalizeSolanaAddress } from "./solana.util";
export type SolanaCriteria =
  | { kind: "token"; mint: string; program: string }
  | {
      kind: "collection" | "verified_creator" | "asset_ids" | "master_edition";
      addresses: string[];
      formats: Array<"metadata" | "core" | "compressed">;
    };

export function solanaCriteria(input: unknown): SolanaCriteria {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Select Solana rule criteria.");
  const value = input as any;
  if (value.kind === "token") {
    if (
      Object.keys(value).some((k) => !["kind", "mint", "program"].includes(k))
    )
      throw new Error("Invalid token criteria.");
    return {
      kind: "token",
      mint: normalizeSolanaAddress(value.mint),
      program: normalizeSolanaAddress(value.program),
    };
  }
  if (
    !["collection", "verified_creator", "asset_ids", "master_edition"].includes(
      value.kind,
    ) ||
    Object.keys(value).some(
      (k) => !["kind", "addresses", "formats"].includes(k),
    ) ||
    !Array.isArray(value.addresses) ||
    !value.addresses.length ||
    value.addresses.length > (value.kind === "asset_ids" ? 1000 : 20) ||
    !Array.isArray(value.formats) ||
    !value.formats.length ||
    value.formats.length > 3 ||
    value.formats.some((f) => !["metadata", "core", "compressed"].includes(f))
  )
    throw new Error("Invalid Solana NFT scope.");
  if (
    value.kind === "master_edition" &&
    (value.formats.length !== 1 || value.formats[0] !== "metadata")
  )
    throw new Error("Printed editions use Token Metadata only.");
  return {
    kind: value.kind,
    addresses: [
      ...new Set<string>(value.addresses.map(normalizeSolanaAddress)),
    ].sort(),
    formats: [
      ...new Set<"metadata" | "core" | "compressed">(value.formats),
    ].sort(),
  };
}

export function isSolanaRule(rule: { asset_type?: string }) {
  return rule.asset_type === "solana_nft" || rule.asset_type === "solana_token";
}

export function solanaRuleLabel(rule: {
  solana_criteria?: SolanaCriteria | null;
}): string {
  const c = solanaCriteria(rule.solana_criteria);
  if (c.kind === "token") return c.mint;
  const label =
    c.kind === "collection"
      ? "collection"
      : c.kind === "verified_creator"
        ? "verified creator"
        : c.kind === "master_edition"
          ? "prints of master edition"
          : "asset";
  const formats = c.formats.includes("compressed")
    ? c.formats.length === 1
      ? " · compressed NFTs"
      : " · includes compressed NFTs"
    : "";
  return `Solana ${label}${c.addresses.length > 1 ? "s" : ""}: ${c.addresses.length > 2 ? `${c.addresses.length} selected` : c.addresses.join(", ")}${formats}`;
}
