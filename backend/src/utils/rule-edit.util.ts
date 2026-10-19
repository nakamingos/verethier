import { VerifierRole } from '@/models/verifier-role.interface';
import { inscriptionCriteria } from './inscription-rule.util';
import { tokenAmount, tokenMinimum } from './erc20-rule.util';
import { ruleTraits, traitFilterKey, traitFilterLabel } from './trait-filter.util';

// Ignore provider display names and the trait snapshot, which scheduled checks can
// refresh while an administrator has the editor open.
export const RULE_EDIT_GUARD_FIELDS = ['server_id', 'channel_id', 'role_id', 'asset_type', 'chain_id', 'contract_address',
  'slug', 'trait_filter', 'min_items', 'token_standard', 'token_ids', 'collection_name',
  'inscription_criteria', 'rule_label', 'min_balance', 'token_decimals', 'token_symbol'] as const;
export const RULE_EDIT_MUTABLE_FIELDS = ['slug', 'trait_filter', 'min_items', 'token_ids',
  'inscription_criteria', 'rule_label', 'ordinal_trait_snapshot', 'min_balance', 'collection_name'] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value ?? null;
}
export function ruleEditVersion(rule: VerifierRole): string {
  return JSON.stringify(RULE_EDIT_GUARD_FIELDS.map(key => canonical(key === 'trait_filter' ? ruleTraits(rule) : rule[key])));
}
export function ruleCriteriaKey(rule: VerifierRole, includeRole = true): string {
  const fields = RULE_EDIT_GUARD_FIELDS.filter(key => !['collection_name', 'token_decimals', 'token_symbol', 'rule_label'].includes(key)
    && (includeRole || key !== 'role_id'));
  return JSON.stringify(fields.map(key => canonical(key === 'trait_filter' ? traitFilterKey(rule) : rule[key])));
}

export function compactTokenIds(ids: string[] | null | undefined): string {
  const ranges: string[] = [];
  for (let index = 0;index < (ids?.length || 0);index++) {
    const start = ids[index];
    let end = start;
    while (index + 1 < ids.length && BigInt(ids[index + 1]) === BigInt(end) + 1n) end = ids[++index];
    ranges.push(start === end ? start : `${start}-${end}`);
  }
  return ranges.join(',');
}

export interface RuleEditField {
  key: string;
  label: string;
  value: string;
  list?: boolean;
  required?: boolean;
  maxLength?: number;
}
export function ruleEditFields(rule: VerifierRole): RuleEditField[] {
  const criteria = inscriptionCriteria(rule);
  const minimum: RuleEditField = { key: 'min_items', label: 'Minimum items', value: String(rule.min_items || 1), required: true, maxLength: 16 };
  if (criteria) return [
    {
      key: 'selection', label: criteria.kind === 'ids' ? 'Inscription IDs' : 'Inscription numbers / ranges', list: true,
      value: criteria.kind === 'ids' ? criteria.ids.join(',') : criteria.ranges.map(([a, b]) => a === b ? String(a) : `${a}-${b}`).join(',')
    }, {key: 'label', label: 'Label (optional)', value: rule.rule_label || '', maxLength: 100}, minimum];
  if (rule.asset_type === 'erc20') return [{ key: 'min_balance', label: 'Minimum token balance', value: tokenAmount(rule, tokenMinimum(rule)), required: true, maxLength: 360 }];
  const traitLimit = ['nft', 'ordinal'].includes(rule.asset_type) ? 100 : 4000;
  const traits: RuleEditField[] = (ruleTraits(rule)?.conditions.length || 0) > 1 ? [
    { key: 'trait_filter', label: 'Trait conditions', value: JSON.stringify(ruleTraits(rule)), maxLength: 20000 }, minimum,
  ] : [
    { key: 'attribute_key', label: 'Attribute key (ALL for any)', value: rule.attribute_key || 'ALL', maxLength: traitLimit },
    { key: 'attribute_value', label: 'Attribute value (ALL for any)', value: rule.attribute_value || 'ALL', maxLength: traitLimit }, minimum];
  if (rule.asset_type === 'nft') return [{
    key: 'token_ids', label: rule.token_standard === 'erc1155' ? 'Token IDs (blank = 0-99)' : 'Token IDs (blank = any)',
    value: compactTokenIds(rule.token_ids), list: true
  }, ...traits];
  return [{
    key: 'slug', label: 'Collection slug', value: rule.slug || 'ALL',
    maxLength: rule.asset_type === 'ordinal' ? 100 : 4000
  }, ...traits];
}

/** Preserve complete selections across two modal inputs; never silently slice IDs. */
export function splitRuleEditList(value: string): [string, string] {
  if (value.length <= 4000) return [value, ''];
  const split = value.lastIndexOf(',', 4000);
  if (split < 0 || value.length - split - 1 > 4000) throw new Error('This list exceeds the editor’s two text fields. Use shorter ranges where possible. The rule has not changed.');
  return [value.slice(0, split), value.slice(split + 1)];
}

export function ruleEditSummary(rule: VerifierRole): string {
  return ruleEditFields(rule).map(field => `${field.label}: ${field.key === 'trait_filter' ? traitFilterLabel(rule) : field.value || 'Default'}`).join('\n');
}
