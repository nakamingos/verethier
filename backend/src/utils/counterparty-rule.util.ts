import { NftRuleFields } from '@/models/verifier-role.interface';
import { normalizeMainnetBitcoinAddress } from './wallet-address.util';

/**
 * Counterparty rule scopes. `asset` uses a token-style minimum balance
 * (`min_balance` in raw units, `token_decimals` 0 or 8); the collectible
 * scopes count copies of indivisible assets against `min_items`.
 */
export type CounterpartyCriteria =
  | { asset: string }
  | { assets: string[] }
  | { issuer: string }
  | { parent: string };

/** XCP, named assets (4–12 letters, not starting with A) and numeric assets. */
export const COUNTERPARTY_ASSET = /^(?:XCP|[B-Z][A-Z]{3,11}|A[0-9]{12,20})$/;
const NAMED_ASSET = /^[B-Z][A-Z]{3,11}$/;
const KEYS = ['asset', 'assets', 'issuer', 'parent'];
const MESSAGE = 'Choose one Counterparty scope: an asset, a list of assets, an issuer address or a parent asset.';

/** Counterparty quantities are signed 64-bit integers. */
export const COUNTERPARTY_MAX_QUANTITY = (1n << 63n) - 1n;

export function counterpartyCriteria(input: unknown): CounterpartyCriteria {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(MESSAGE);
  const c = input as Record<string, unknown>;
  const keys = Object.keys(c);
  if (keys.length !== 1 || !KEYS.includes(keys[0])) throw new Error(MESSAGE);
  if ('asset' in c) {
    if (typeof c.asset !== 'string' || !COUNTERPARTY_ASSET.test(c.asset)) throw new Error('Enter a Counterparty asset name, such as PEPECASH.');
    return { asset: c.asset };
  }
  if ('assets' in c) {
    if (!Array.isArray(c.assets) || !c.assets.length || c.assets.length > 100
      || c.assets.some(asset => typeof asset !== 'string' || !COUNTERPARTY_ASSET.test(asset)))
      throw new Error('Enter 1–100 Counterparty asset names.');
    return { assets: [...new Set(c.assets as string[])].sort() };
  }
  if ('issuer' in c) {
    if (typeof c.issuer !== 'string') throw new Error('Enter the issuer’s Bitcoin address.');
    return { issuer: normalizeMainnetBitcoinAddress(c.issuer) };
  }
  if (typeof c.parent !== 'string' || !NAMED_ASSET.test(c.parent)) throw new Error('Enter a named parent asset, such as PEPE.');
  return { parent: c.parent };
}

/** Single-asset rules compare a token balance; the other scopes count collectible copies. */
export function isCounterpartyAmountRule(rule: Pick<NftRuleFields, 'asset_type' | 'counterparty_criteria'>): boolean {
  return rule.asset_type === 'counterparty' && !!rule.counterparty_criteria && 'asset' in rule.counterparty_criteria;
}

/** Rules whose requirement is a token amount rather than a count of items. */
export function isTokenAmountRule(rule: Pick<NftRuleFields, 'asset_type' | 'counterparty_criteria'>): boolean {
  return ['erc20', 'solana_token'].includes(rule.asset_type ?? '') || isCounterpartyAmountRule(rule);
}

export function counterpartyRuleLabel(rule: Pick<NftRuleFields, 'counterparty_criteria' | 'token_symbol'>): string {
  const c = counterpartyCriteria(rule.counterparty_criteria);
  if ('asset' in c) return `Counterparty: ${rule.token_symbol || c.asset}`;
  if ('assets' in c) return `Counterparty: ${c.assets.length > 3 ? c.assets.length + ' assets' : c.assets.join(', ')}`;
  if ('issuer' in c) return `Counterparty: assets issued by ${c.issuer}`;
  return `Counterparty: ${c.parent}.* subassets`;
}
