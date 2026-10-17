/** Normalize collection identifiers only; never use this for traits, roles, or asset IDs. */
export function normalizeCollectionSlug(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/gu, '-');
}

/** ALL is a reserved input option; preserve every other value's internal spacing/punctuation. */
export function normalizeCriteriaOption(value?: string | null): string {
  const trimmed = value?.trim() || 'ALL';
  return trimmed.toLowerCase() === 'all' ? 'ALL' : trimmed;
}

export function matchCaseInsensitive(values: string[], input: string): string | undefined {
  return values.find(value => value === input)
    ?? values.find(value => value.toLowerCase() === input.toLowerCase());
}
