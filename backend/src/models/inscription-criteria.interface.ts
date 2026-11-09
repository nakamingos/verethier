export type InscriptionCriteria =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'numbers'; ranges: Array<[number, number]>; collection_slug?: string };
