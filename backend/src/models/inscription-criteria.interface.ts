export type InscriptionCriteria =
  | { kind: 'ids'; ids: string[]; collection_slug?: string }
  | { kind: 'numbers'; ranges: Array<[number, number]>; collection_slug?: string };
