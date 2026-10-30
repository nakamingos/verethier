import { NftRuleFields } from '@/models/verifier-role.interface';
import { normalizeMainnetBitcoinAddress } from './wallet-address.util';

export interface StampCriteria { creator?: string; stamp_ids?: string[] }

/** Stamp IDs are the explorer's non-negative stamp numbers, not transaction IDs. */
export function stampCriteria(input: unknown): StampCriteria {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter a Stamps creator address, stamp numbers, or both.');
  const c = input as any;
  if (Object.keys(c).some(k => !['creator', 'stamp_ids'].includes(k))) throw new Error('Invalid Stamps criteria.');
  const result: StampCriteria = {};
  if (c.creator !== undefined) result.creator = normalizeMainnetBitcoinAddress(c.creator);
  if (c.stamp_ids !== undefined) {
    if (!Array.isArray(c.stamp_ids) || !c.stamp_ids.length || c.stamp_ids.length > 100
      || c.stamp_ids.some(id => typeof id !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(id) || !Number.isSafeInteger(Number(id))))
      throw new Error('Enter up to 100 whole, non-negative stamp numbers.');
    result.stamp_ids = [...new Set<string>(c.stamp_ids)].sort();
  }
  if (!result.creator && !result.stamp_ids) throw new Error('Enter a Stamps creator address, stamp numbers, or both.');
  return result;
}

export function stampRuleLabel(rule: Pick<NftRuleFields, 'stamp_criteria'>): string {
  const c = stampCriteria(rule.stamp_criteria);
  return `Bitcoin Stamps${c.stamp_ids ? ': ' + (c.stamp_ids.length > 3 ? c.stamp_ids.length + ' selected' : c.stamp_ids.map(id => '#' + id).join(', ')) : ''}${c.creator ? ' · creator: ' + c.creator : ''}`;
}
