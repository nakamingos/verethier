export interface TraitCondition {
  key: string;
  value: string;
}
export interface TraitFilter {
  operator: 'AND' | 'OR';
  conditions: TraitCondition[];
}
/** Legacy fields are accepted only for command inputs and historical audit snapshots. */
export interface TraitRule {
  trait_filter?: TraitFilter | null;
  attribute_key?: string | null;
  attribute_value?: string | null;
}

/** Canonical ordering/deduplication makes condition order irrelevant. */
export function normalizeTraitFilter(input: unknown): TraitFilter | null {
  if (input == null) return null;
  if (
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !['operator', 'conditions'].includes(k))
  )
    throw new Error('Invalid trait filter.');
  const filter = input as TraitFilter;
  if (
    !['AND', 'OR'].includes(filter.operator) ||
    !Array.isArray(filter.conditions) ||
    filter.conditions.length > 10
  )
    throw new Error('Choose AND or OR and up to 10 trait conditions.');
  const conditions = new Map<string, TraitCondition>();
  for (const item of filter.conditions) {
    if (
      !item ||
      typeof item !== 'object' ||
      Object.keys(item).some((k) => !['key', 'value'].includes(k)) ||
      typeof item.key !== 'string' ||
      typeof item.value !== 'string'
    )
      throw new Error('Each trait condition needs a key and value.');
    const key = item.key.trim(),
      value = item.value.trim();
    if (
      !key ||
      !value ||
      key.length > 4000 ||
      value.length > 4000 ||
      (key === 'ALL' && value === 'ALL')
    )
      throw new Error(
        'Enter a trait key/value; remove conditions to match all traits.',
      );
    const identity = JSON.stringify([
      key === 'ALL' ? null : key.toLowerCase(),
      value === 'ALL' ? null : value.toLowerCase(),
    ]);
    if (!conditions.has(identity)) conditions.set(identity, { key, value });
  }
  if (!conditions.size) return null;
  const result: TraitFilter = {
    operator: conditions.size === 1 ? 'AND' : filter.operator,
    conditions: [...conditions]
      .sort(([a], [b]) =>
        Buffer.compare(
          new TextEncoder().encode(a),
          new TextEncoder().encode(b),
        ),
      )
      .map(([, item]) => item),
  };
  if (JSON.stringify(result).length > 20000)
    throw new Error('Trait filter is too large.');
  return result;
}
export function ruleTraits(rule: TraitRule): TraitFilter | null {
  if (rule.trait_filter !== undefined)
    return normalizeTraitFilter(rule.trait_filter);
  const key = rule.attribute_key?.trim() || 'ALL',
    value = rule.attribute_value?.trim() || 'ALL';
  return key === 'ALL' && value === 'ALL'
    ? null
    : normalizeTraitFilter({ operator: 'AND', conditions: [{ key, value }] });
}
/** Single-condition command/display adapter; never a second stored definition. */
export function singleTrait(rule: TraitRule): TraitCondition {
  return ruleTraits(rule)?.conditions[0] || {key:'ALL',value:'ALL'};
}
export function traitFilterKey(rule: TraitRule): string {
  const filter = ruleTraits(rule);
  return JSON.stringify(
    filter
      ? {
          operator: filter.operator,
          conditions: filter.conditions.map((c) => [
            c.key === 'ALL' ? null : c.key.toLowerCase(),
            c.value === 'ALL' ? null : c.value.toLowerCase(),
          ]),
        }
      : null,
  );
}
export function matchesTraits(
  attributes: Array<{ key: string; value: string }>,
  rule: TraitRule,
): boolean {
  const filter = ruleTraits(rule);
  if (!filter) return true;
  const match = (condition: TraitCondition) =>
    attributes.some(
      (attribute) =>
        (condition.key === 'ALL' ||
          attribute.key.toLowerCase() === condition.key.toLowerCase()) &&
        (condition.value === 'ALL' ||
          attribute.value.toLowerCase() === condition.value.toLowerCase()),
    );
  return filter.operator === 'AND'
    ? filter.conditions.every(match)
    : filter.conditions.some(match);
}
export function traitFilterLabel(rule: TraitRule): string {
  const filter = ruleTraits(rule);
  return filter
    ? filter.conditions
        .map((c) =>
          c.value === 'ALL'
            ? `${c.key} (any value)`
            : `${c.key === 'ALL' ? 'ANY_KEY' : c.key}=${c.value}`,
        )
        .join(` ${filter.operator} `)
    : 'All traits';
}
