import {
  matchEthscriptionTraits,
  IncompleteEthscriptionTraitsError,
} from "../src/utils/ethscription-traits.util";
import { AssetOwnershipService } from "../src/services/asset-ownership.service";
const c = (key: string, value: string) => ({ key, value });
const filter = (
  operator: "AND" | "OR",
  ...conditions: { key: string; value: string }[]
) => ({ operator, conditions });

describe("Ethscription metadata trait shapes", () => {
  it("matches each value in a list and resolves AND conditions on one item", () => {
    const values = {
      Type: "Pork People",
      Affiliation: ["Gold Bearer", "Pirate"],
      Mouth: ["Pipe", "Smile"],
      Rank: 7,
    };
    expect(
      matchEthscriptionTraits(
        values,
        filter("AND", c("Affiliation", "pirate"), c("Mouth", "Pipe")),
      ),
    ).toBe(true);
    expect(
      matchEthscriptionTraits(
        values,
        filter(
          "OR",
          c("Affiliation", "Gold Bearer"),
          c("Affiliation", "Pirate"),
        ),
      ),
    ).toBe(true);
    expect(
      matchEthscriptionTraits(
        values,
        filter("AND", c("Affiliation", "Unknown"), c("Mouth", "Pipe")),
      ),
    ).toBe(false);
  });
  it("does not reject an unrelated list or opaque metadata field", () => {
    expect(
      matchEthscriptionTraits(
        {
          Type: "Purr People",
          Affiliation: ["Pirate"],
          Auxiliary: { index: 1 },
        },
        filter("AND", c("Type", "Purr People")),
      ),
    ).toBe(true);
    expect(
      matchEthscriptionTraits(
        { Type: "Purr People", Auxiliary: { index: 1 } },
        filter("AND", c("Type", "Pepe People")),
      ),
    ).toBe(false);
  });
  it("preserves wildcards, numbers, booleans and case-insensitive matching", () => {
    const values = {
      Affiliation: ["Pirate", "Gold Bearer"],
      Rank: 0,
      Verified: false,
    };
    for (const condition of [
      c("ALL", "pirate"),
      c("Affiliation", "ALL"),
      c("rank", "0"),
      c("verified", "FALSE"),
    ])
      expect(matchEthscriptionTraits(values, filter("AND", condition))).toBe(
        true,
      );
  });
  it("treats empty lists and null fields as absent traits", () => {
    expect(
      matchEthscriptionTraits(
        { Mouth: [], Head: null },
        filter("OR", c("Mouth", "ALL"), c("Head", "Crown")),
      ),
    ).toBe(false);
  });
  it("does not pretend missing metadata or opaque queried values are known negatives", () => {
    for (const values of [
      null,
      undefined,
      [],
      "metadata",
      { Affiliation: { unrecognized: "Pirate" } },
      { Affiliation: [{ unrecognized: "Pirate" }] },
    ])
      expect(
        matchEthscriptionTraits(
          values,
          filter("AND", c("Affiliation", "Pirate")),
        ),
      ).toBe("unknown");
  });
  it("can prove OR with one known match and disprove AND with one known mismatch", () => {
    const values = {
      Type: "Purr People",
      Affiliation: { unrecognized: "Pirate" },
    };
    expect(
      matchEthscriptionTraits(
        values,
        filter("OR", c("Type", "Purr People"), c("Affiliation", "Pirate")),
      ),
    ).toBe(true);
    expect(
      matchEthscriptionTraits(
        values,
        filter("AND", c("Type", "Pepe People"), c("Affiliation", "Pirate")),
      ),
    ).toBe(false);
    expect(
      matchEthscriptionTraits(
        values,
        filter("AND", c("Type", "Purr People"), c("Affiliation", "Pirate")),
      ),
    ).toBe("unknown");
  });
  it("does not require traits for collection-only counts", () =>
    expect(matchEthscriptionTraits(null, null)).toBe(true));
});

describe("Incomplete trait evidence", () => {
  const rule: any = {
    asset_type: "ethscription",
    slug: "call-data-comrades",
    min_items: 2,
    trait_filter: filter(
      "OR",
      c("Type", "Purr People"),
      c("Type", "Pork People"),
    ),
  };
  function setup(ids: string[]) {
    const error = new IncompleteEthscriptionTraitsError(ids, 1),
      data = {
        matchingAssetIdsWithCriteria: jest.fn().mockRejectedValue(error),
      },
      service = new AssetOwnershipService(data as any, {} as any);
    return { service, error };
  }
  it("can establish eligibility using enough known matching items without counting unknown items", async () => {
    const { service } = setup(["a", "b"]);
    expect(await service.count(rule, ["wallet"])).toBe(2n);
  });
  it("preserves uncertainty below the minimum and for an incomplete exact asset list", async () => {
    const { service, error } = setup(["a"]);
    await expect(service.count(rule, ["wallet"])).rejects.toBe(error);
    await expect(
      service.matchingAssets(rule, ["wallet"], { checks: new Map() }),
    ).rejects.toBe(error);
  });
  it("requires complete metadata for a fresh export snapshot", async () => {
    const { service, error } = setup(["a", "b"]);
    await expect(
      service.count(rule, ["wallet"], { checks: new Map(), freshExport: true }),
    ).rejects.toBe(error);
  });
});
