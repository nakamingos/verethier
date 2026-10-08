import { VerifierRole } from '@/models/verifier-role.interface';

export function ordinalCollectionId(value: string): string {
  const id = value?.trim().toLowerCase();
  if (!id || id === 'all' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) {
    throw new Error('Enter one Ordinals collection slug, such as pizza-comrades.');
  }
  return id;
}

export function ordinalRuleScope(rule: Partial<VerifierRole>): string {
  return `${rule.collection_name || rule.slug || 'Ordinals collection'} · Bitcoin · Ordinals`;
}

export function ordinalRuleCriteria(rule: Partial<VerifierRole>): string {
  return `${ordinalRuleScope(rule)} · min ${rule.min_items || 1}`;
}
