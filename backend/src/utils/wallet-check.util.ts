import { VerifierRole } from '@/models/verifier-role.interface';
import { isBitcoinAddress } from './wallet-address.util';
export const WALLET_NETWORK_LABELS: Record<string,string> = { ethereum:'Ethereum',robinhood:'Robinhood',base:'Base',solana:'Solana',bitcoin:'Bitcoin' };
export function walletCheckNetwork(rule: Partial<VerifierRole>): string {
  if (rule.asset_type === 'ordinal' || rule.asset_type === 'stamp') return 'bitcoin';
  if (rule.asset_type === 'solana_nft' || rule.asset_type === 'solana_token') return 'solana';
  if (!rule.asset_type || rule.asset_type === 'ethscription') return 'ethereum';
  return rule.chain_id === 4663 ? 'robinhood' : rule.chain_id === 8453 ? 'base' : 'ethereum';
}
export function walletMatchesRule(rule: Partial<VerifierRole>,address: string): boolean {
  if (rule.asset_type === 'ordinal') return /^bc1p[0-9a-z]{58}$/.test(address);
  if (rule.asset_type === 'stamp') return isBitcoinAddress(address);
  if (rule.asset_type === 'solana_nft' || rule.asset_type === 'solana_token') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return /^0x[0-9a-f]{40}$/i.test(address);
}
