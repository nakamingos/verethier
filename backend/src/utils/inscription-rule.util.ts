import { escapeMarkdown } from 'discord.js';
import { VerifierRole } from '@/models/verifier-role.interface';
import { InscriptionCriteria } from '@/models/inscription-criteria.interface';

export const ETHSCRIPTION_ID = /^0x[0-9a-f]{64}$/;
const MAX_SELECTIONS = 1000;
const CANONICAL_ID = /^[0-9a-f]{64}i(0|[1-9]\d*)$/;

export function normalizeRuleLabel(value?: string | null): string | null {
  const label = value?.trim();
  if (!label) return null;
  if (label.length > 100 || /[\u0000-\u001f\u007f]/u.test(label)) throw new Error('Rule labels must be one line and at most 100 characters.');
  return label;
}

export function parseInscriptionCriteria(ids?: string | null, numbers?: string | null, assetType: 'ordinal' | 'ethscription' = 'ordinal'): InscriptionCriteria | null {
  if (ids == null && numbers == null) return null;
  if (ids != null && numbers != null) throw new Error('Use inscription_ids or inscription_numbers, not both.');
  const parts = (ids ?? numbers).split(',').map(part => part.trim());
  if (parts.length > MAX_SELECTIONS || parts.some(part => !part)) throw new Error('Enter 1–1,000 comma-separated inscription IDs or numbers.');
  if (ids != null) {
    const normalized = [...new Set(parts.map(id => id.toLowerCase()))].sort();
    if (normalized.some(id => !(assetType === 'ordinal' ? CANONICAL_ID : ETHSCRIPTION_ID).test(id))) throw new Error(assetType === 'ordinal' ? 'Enter full inscription IDs in transactionhashi0 format. Use inscription_numbers for numeric values or ranges.' : 'Enter full Ethscription transaction hashes in 0x format. Use inscription_numbers for numeric values or ranges.');
    return { kind: 'ids', ids: normalized };
  }
  const ranges: Array<[number, number]> = parts.map(part => {
    // Signed numbers also support historical cursed inscriptions, e.g. -10--1.
    const match = /^(-?\d+)(?:\s*-\s*(-?\d+))?$/.exec(part);
    if (!match) throw new Error('Enter inscription numbers or inclusive ranges, such as 12345,100000-100999.');
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || (assetType === 'ethscription' && start < 0)) throw new Error('Inscription ranges must use safe whole numbers with the start no greater than the end.');
    return [Object.is(start, -0) ? 0 : start, Object.is(end, -0) ? 0 : end];
  });
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && BigInt(range[0]) <= BigInt(previous[1]) + 1n) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return { kind: 'numbers', ranges: merged };
}

export function inscriptionCriteria(rule: Partial<VerifierRole>): InscriptionCriteria | null {
  const criteria = rule.inscription_criteria;
  if (criteria == null) return null;
  const idPattern = rule.asset_type === 'ordinal' ? CANONICAL_ID : ETHSCRIPTION_ID;
  const invalid = () => { throw new Error('Invalid specific-inscription verification rule.'); };
  if (typeof criteria !== 'object' || Array.isArray(criteria) || Object.keys(criteria).length !== 2) return invalid();
  if (criteria.kind === 'ids') {
    if (!Array.isArray(criteria.ids) || criteria.ids.length < 1 || criteria.ids.length > MAX_SELECTIONS
      || criteria.ids.some((id, index) => typeof id !== 'string' || !idPattern.test(id) || (index > 0 && criteria.ids[index - 1] >= id))) return invalid();
  } else if (criteria.kind === 'numbers') {
    if (!Array.isArray(criteria.ranges) || criteria.ranges.length < 1 || criteria.ranges.length > MAX_SELECTIONS
      || criteria.ranges.some((range, index) => !Array.isArray(range) || range.length !== 2
        || !range.every(Number.isSafeInteger) || range[0] > range[1] || (rule.asset_type !== 'ordinal' && range[0] < 0)
        || (index > 0 && BigInt(range[0]) <= BigInt(criteria.ranges[index - 1][1]) + 1n))) return invalid();
  } else return invalid();
  if (!['ordinal', 'ethscription'].includes(rule.asset_type ?? 'ethscription') || rule.slug != null
    || (rule.attribute_key ?? 'ALL') !== 'ALL' || (rule.attribute_value ?? 'ALL') !== 'ALL' || rule.ordinal_trait_snapshot != null) return invalid();
  return criteria;
}

export function inscriptionCriteriaCapacity(criteria: InscriptionCriteria): bigint {
  return criteria.kind === 'ids' ? BigInt(criteria.ids.length)
    : criteria.ranges.reduce((total, [start, end]) => total + BigInt(end) - BigInt(start) + 1n, 0n);
}

export function inscriptionRuleScope(rule: Partial<VerifierRole>, style: 'detail' | 'compact' = 'detail'): string {
  const criteria = inscriptionCriteria(rule);
  if (!criteria) throw new Error('Missing specific-inscription criteria.');
  const entries = criteria.kind === 'ids' ? criteria.ids : criteria.ranges.map(([start, end]) => start === end ? String(start) : `${start}–${end}`);
  const limit = criteria.kind === 'ids' ? 5 : 10;
  const selection = style === 'compact'
    ? `${entries.length} selected${criteria.kind === 'numbers' ? ` range${entries.length === 1 ? '' : 's'}` : ''}`
    : entries.slice(0, limit).map(entry => entry.length > 100 ? entry.slice(0, 99) + '…' : entry).join(', ')
      + (entries.length > limit ? ` (+${entries.length - limit} more)` : '');
  const label = rule.rule_label ? `Label: ${escapeMarkdown(rule.rule_label)} · ` : '';
  return `${label}${rule.asset_type === 'ordinal' ? 'Inscription' : 'Ethscription'} ${criteria.kind === 'ids' ? 'IDs' : 'numbers'}: ${selection} · ${rule.asset_type === 'ordinal' ? 'Bitcoin · Ordinals' : 'Ethereum · Ethscriptions'}`;
}
