import { TraitFilter } from "./trait-filter.util";

export type TraitMatch = true | false | "unknown";

/** A complete inventory can still contain items whose traits are not indexed yet. */
export class IncompleteEthscriptionTraitsError extends Error {
  readonly matchingAssets: Map<string, bigint>;
  constructor(
    ids: string[],
    readonly unknownItems: number,
  ) {
    super(
      `Ethscriptions trait metadata is unavailable for ${unknownItems} held item(s).`,
    );
    this.name = "IncompleteEthscriptionTraitsError";
    this.matchingAssets = new Map(ids.map((id) => [id, 1n]));
  }
}

/** Resolve only the queried traits; opaque unrelated fields cannot invalidate a match. */
export function matchEthscriptionTraits(
  values: unknown,
  filter: TraitFilter | null,
): TraitMatch {
  if (!filter) return true;
  if (!values || typeof values !== "object" || Array.isArray(values))
    return "unknown";
  const entries = Object.entries(values);
  const results = filter.conditions.map((condition) => {
    let uncertain = false;
    for (const [key, field] of entries) {
      if (
        condition.key !== "ALL" &&
        key.toLowerCase() !== condition.key.toLowerCase()
      )
        continue;
      for (const value of Array.isArray(field) ? field : [field]) {
        if (value == null) continue;
        if (
          !["string", "number", "boolean"].includes(typeof value) ||
          (typeof value === "number" && !Number.isFinite(value))
        ) {
          uncertain = true;
          continue;
        }
        if (
          condition.value === "ALL" ||
          String(value).toLowerCase() === condition.value.toLowerCase()
        )
          return true;
      }
    }
    return uncertain ? "unknown" : false;
  });
  if (filter.operator === "AND")
    return results.includes(false)
      ? false
      : results.includes("unknown")
        ? "unknown"
        : true;
  return results.includes(true)
    ? true
    : results.includes("unknown")
      ? "unknown"
      : false;
}
