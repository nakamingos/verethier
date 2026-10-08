import { address as bitcoinAddress } from 'bitcoinjs-lib';

export type WalletType = 'evm' | 'bitcoin';

export function normalizeBitcoinAddress(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !/^(bc1p|BC1P)/.test(value)) {
    throw new Error('Use your Xverse Bitcoin mainnet Ordinals address (bc1p…).');
  }
  try {
    const decoded = bitcoinAddress.fromBech32(value);
    if (decoded.prefix !== 'bc' || decoded.version !== 1 || decoded.data.length !== 32) throw new Error();
    return value.toLowerCase();
  } catch {
    throw new Error('Use a valid Xverse Bitcoin mainnet Ordinals address (bc1p…).');
  }
}

export function normalizeWalletAddress(value: string, type: WalletType = 'evm'): string {
  return type === 'bitcoin' ? normalizeBitcoinAddress(value) : value.toLowerCase();
}
