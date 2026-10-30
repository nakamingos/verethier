import { normalizeSolanaAddress } from './solana.util';
import { address as bitcoinAddress } from 'bitcoinjs-lib';

export type WalletType = 'evm' | 'bitcoin' | 'solana';

export function normalizeMainnetBitcoinAddress(value: string): string {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('Use a valid Bitcoin mainnet address.');
  try {
    bitcoinAddress.toOutputScript(value);
    if (/^bc1/i.test(value)) {
      const d = bitcoinAddress.fromBech32(value);
      if (d.prefix !== 'bc') throw new Error();
      return value.toLowerCase();
    }
    const d = bitcoinAddress.fromBase58Check(value);
    if (![0, 5].includes(d.version)) throw new Error();
    return value;
  } catch { throw new Error('Use a valid Bitcoin mainnet address.'); }
}

export function normalizeBitcoinProofAddress(value: string): string {
  const address = normalizeMainnetBitcoinAddress(value);
  if (/^bc1/i.test(address)) {
    const d = bitcoinAddress.fromBech32(address);
    if (!((d.version === 0 && d.data.length === 20) || (d.version === 1 && d.data.length === 32)))
      throw new Error('Use a single-key Bitcoin address: P2PKH, nested SegWit, native SegWit, or Taproot.');
  }
  return address;
}

export function isBitcoinAddress(value: string): boolean {
  try { normalizeMainnetBitcoinAddress(value); return true; } catch { return false; }
}

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
  return type === 'bitcoin' ? normalizeBitcoinProofAddress(value) : value.toLowerCase();
}
