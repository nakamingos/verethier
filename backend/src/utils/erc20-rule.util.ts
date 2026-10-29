import { formatUnits } from 'viem';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { nftNetworkLabel } from './nft-network.util';

export const UINT256_MAX = (1n << 256n) - 1n;

export function parseTokenBalance(input: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token decimals.');
  const text = (input || '').trim();
  if (text.length > 360 || !/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Enter a positive token amount, such as 1000 or 0.5.');
  const [whole, fraction = ''] = text.split('.');
  const significantFraction = fraction.replace(/0+$/, '');
  if (significantFraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole + significantFraction.padEnd(decimals, '0'));
  if (amount <= 0n || amount > UINT256_MAX) throw new Error('Minimum balance must be positive and fit within the token balance limit.');
  return amount.toString();
}

export function tokenMinimum(rule: NftRuleFields): bigint {
  if (!Number.isInteger(rule.token_decimals) || rule.token_decimals < 0 || rule.token_decimals > 255
    || typeof rule.min_balance !== 'string' || !/^[1-9]\d{0,77}$/.test(rule.min_balance)
    || BigInt(rule.min_balance) > UINT256_MAX) throw new Error('Invalid ERC-20 minimum balance.');
  return BigInt(rule.min_balance);
}

export function tokenAmount(rule: NftRuleFields, amount: bigint): string {
  tokenMinimum(rule);
  return formatUnits(amount, rule.token_decimals);
}

export function tokenRuleLabel(rule: NftRuleFields): string {
  return rule.collection_name || rule.token_symbol || rule.contract_address || 'ERC-20 token';
}

export function tokenRuleScope(rule: NftRuleFields): string {
  if (rule.asset_type === 'solana_token') return `${rule.solana_criteria?.kind === 'token' ? rule.solana_criteria.mint : 'Token'} · Solana`;
  const symbol = rule.token_symbol && rule.token_symbol !== rule.collection_name ? ` (${rule.token_symbol})` : '';
  return `${tokenRuleLabel(rule)}${symbol} · ${nftNetworkLabel(rule.chain_id)} · ERC-20`;
}

export function tokenRuleCriteria(rule: NftRuleFields): string {
  return `${tokenRuleScope(rule)} · min ${tokenAmount(rule, tokenMinimum(rule))}`;
}
