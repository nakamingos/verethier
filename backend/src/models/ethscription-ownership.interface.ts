export interface EthscriptionOwnership {
  owner: string;
  prevOwner: string | null;
  number: number;
}

/** Market data held in memory only for the current verification. */
export interface EthscriptionAsset {
  hashId: string;
  slug: string | null;
  attributes_new: { values: Record<string, unknown> } | null;
}
