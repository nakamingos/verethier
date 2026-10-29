import { normalizeSolanaAddress } from './solana.util';
import { address as bitcoinAddress } from 'bitcoinjs-lib';

export type WalletType = 'evm' | 'bitcoin' | 'solana';

export function normalizeBitcoinAddress(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !/^(bc1p|BC1P)/.test(value)) {
    throw new Error('Use your Bitcoin mainnet Taproot Ordinals address (bc1p…).');
  }
  try {
    const decoded = bitcoinAddress.fromBech32(value);
    if (decoded.prefix !== 'bc' || decoded.version !== 1 || decoded.data.length !== 32) throw new Error();
    return value.toLowerCase();
  } catch {
    throw new Error('Use a valid Bitcoin mainnet Taproot Ordinals address (bc1p…).');
  }
}

export function normalizeWalletAddress(value: string, type: WalletType = 'evm'): string {
  if (type === 'solana') return normalizeSolanaAddress(value);
  if (type !== 'evm' && type !== 'bitcoin') throw new Error('Invalid wallet type.');
  return type === 'bitcoin' ? normalizeBitcoinAddress(value) : value.toLowerCase();
}
