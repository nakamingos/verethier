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
  provider: 'ordnet' | 'xverse' | 'ordiscan' | 'subfrost' | 'sandshrew' | 'mixed';
  source: 'live' | 'trait-snapshot' | 'collection-upper-bound' | 'collection-cache';
  snapshot_fetched_at?: string;
}

export interface OrdinalWalletInventory {
  ids: Set<string>;
  numbers?: Map<string, number>;
  provider: 'xverse' | 'ordiscan' | 'subfrost' | 'sandshrew';
}

export interface OrdinalAttributeRow {
  inscription_id: string;
  values: Record<string, string | string[]>;
}
