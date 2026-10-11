import { VerifierRole } from '@/models/verifier-role.interface';
import { inscriptionCriteria, inscriptionRuleScope } from './inscription-rule.util';
import { createHash } from 'node:crypto';
import { OrdinalCollectionSnapshot, OrdinalTraitSnapshot } from '@/models/ordinal-collection.interface';

export const ORDINAL_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ORDINAL_INSCRIPTION_ID = /^[0-9a-f]{64}i\d+$/;

export function ordinalTrait(rule: Partial<VerifierRole>) {
  const key = (rule.attribute_key ?? 'ALL').trim();
  const value = (rule.attribute_value ?? 'ALL').trim();
  if (!key || !value || key.length > 100 || value.length > 100) throw new Error('Ordinals attribute keys and values must be 1–100 characters.');
  if (key === 'ALL' && value !== 'ALL') throw new Error('Select an attribute_key before setting attribute_value.');
  return { key, value, enabled: key !== 'ALL' };
}

export function ordinalTraitHash(rule: Partial<VerifierRole>): string {
  const trait = ordinalTrait(rule);
  return createHash('sha256').update(JSON.stringify([
    'ordinal-trait-v1', ordinalCollectionId(rule.slug), trait.enabled, trait.key.toLowerCase(),
    trait.value === 'ALL' ? null : trait.value.toLowerCase(),
  ])).digest('hex');
}

export function matchesOrdinalTrait(traits: Array<{ type: string; value: string }>, rule: Partial<VerifierRole>): boolean {
  const { key, value } = ordinalTrait(rule);
  return traits.some(trait => trait.type.trim().toLowerCase() === key.toLowerCase()
    && (value === 'ALL' || trait.value.trim().toLowerCase() === value.toLowerCase()));
}

export function buildOrdinalTraitSnapshot(rule: Partial<VerifierRole>, collection: OrdinalCollectionSnapshot): OrdinalTraitSnapshot {
  if (collection.slug !== ordinalCollectionId(rule.slug)) throw new Error('Ordinals verification is temporarily unavailable. Please try again.');
  const ids: string[] = [];
  for (const [id, item] of collection.items) {
    if (item.traits === null) throw new Error('Ordinals trait verification is temporarily unavailable. Please try again.');
    if (matchesOrdinalTrait(item.traits, rule)) ids.push(id);
  }
  return { inscription_ids: ids.sort(), criteria_hash: ordinalTraitHash(rule), fetched_at: collection.fetched_at };
}

export function usableOrdinalTraitSnapshot(rule: Partial<VerifierRole>, now = Date.now()): OrdinalTraitSnapshot | null {
  const snapshot = rule.ordinal_trait_snapshot;
  if (!snapshot || snapshot.criteria_hash !== ordinalTraitHash(rule)
    || typeof snapshot.fetched_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(snapshot.fetched_at)) return null;
  const fetched = Date.parse(snapshot.fetched_at);
  if (!Number.isFinite(fetched) || fetched > now || now - fetched >= ORDINAL_SNAPSHOT_MAX_AGE_MS
    || !Array.isArray(snapshot.inscription_ids) || snapshot.inscription_ids.length > 20000
    || snapshot.inscription_ids.some(id => typeof id !== 'string' || !ORDINAL_INSCRIPTION_ID.test(id))
    || new Set(snapshot.inscription_ids).size !== snapshot.inscription_ids.length) return null;
  return snapshot;
}

export function ordinalCollectionId(value: string): string {
  const id = value?.trim().toLowerCase();
  if (!id || id === 'all' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) {
    throw new Error('Enter one Ordinals collection slug, such as pizza-comrades.');
  }
  return id;
}

export function ordinalRuleScope(rule: Partial<VerifierRole>): string {
  if (inscriptionCriteria(rule)) return inscriptionRuleScope(rule);
  const trait = ordinalTrait(rule);
  const attribute = trait.enabled ? ` · ${trait.key}${trait.value === 'ALL' ? ' (any value)' : '=' + trait.value}` : '';
  return `${rule.collection_name || rule.slug || 'Ordinals collection'} · Bitcoin · Ordinals${attribute}`;
}

export function ordinalRuleCriteria(rule: Partial<VerifierRole>): string {
  return `${ordinalRuleScope(rule)} · min ${rule.min_items || 1}`;
}
