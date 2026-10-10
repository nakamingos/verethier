export interface OrdinalCollectionItem {
  owner: string | null;
  traits: Array<{ type: string; value: string }> | null;
}

export interface OrdinalCollectionSnapshot {
  slug: string;
  items: Map<string, OrdinalCollectionItem>;
}
