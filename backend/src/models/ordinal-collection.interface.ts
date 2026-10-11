export interface OrdinalCollectionItem {
  owner: string | null;
  traits: Array<{ type: string; value: string }> | null;
}

export interface OrdinalCollectionSnapshot {
  slug: string;
  items: Map<string, OrdinalCollectionItem>;
  fetched_at: string;
}

export interface OrdinalTraitSnapshot {
  inscription_ids: string[];
  criteria_hash: string;
  fetched_at: string;
}

export interface OrdinalCheckDetails {
  provider: 'ordnet' | 'xverse';
  source: 'live' | 'trait-snapshot' | 'collection-upper-bound';
  snapshot_fetched_at?: string;
}
