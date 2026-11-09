import { VerifierRole } from '@/models/verifier-role.interface';

export const CHECK_PRIORITY = ['ethereum','robinhood','base','solana','ethscriptions','stamps','ordinals'] as const;
export function checkPriority(rule: Partial<VerifierRole>): number {
  if (rule.asset_type === 'ordinal') return 6;
  if (rule.asset_type === 'stamp') return 5;
  if (!rule.asset_type || rule.asset_type === 'ethscription') return 4;
  if (rule.asset_type === 'solana_nft' || rule.asset_type === 'solana_token') return 3;
  return rule.chain_id === 4663 ? 1 : rule.chain_id === 8453 ? 2 : 0;
}

export function checkFamily(rule: Partial<VerifierRole>): string {
  return CHECK_PRIORITY[checkPriority(rule)];
}
