import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { WalletBlock } from '@/models/wallet-block.interface';
import { normalizeSolanaAddress } from '@/utils/solana.util';
import { normalizeBitcoinAddress } from '@/utils/wallet-address.util';
import { NftCheckContext } from './nft-ownership.service';

const UNAVAILABLE = 'Could not check wallet restrictions. Please try again.';
export const WALLET_BLOCKED = 'This wallet has been blocked from verification in this server. Contact a server administrator.';

export function normalizeBlockedWallet(value: string): string {
  const address = value?.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return address.toLowerCase();
  if (address.length === 62 && /^bc1p/i.test(address)) return normalizeBitcoinAddress(address);
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return normalizeSolanaAddress(address);
  throw new Error('Enter a full Solana, EVM wallet address (0x…) or Bitcoin mainnet Ordinals address (bc1p…).');
}

@Injectable()
export class WalletBlockService {
  constructor(@Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient) {}

  async block(serverId: string, address: string, adminId: string, reason?: string | null): Promise<WalletBlock> {
    address = normalizeBlockedWallet(address);
    reason = reason?.trim() || null;
    if (reason && reason.length > 200) throw new Error('Block reasons must be 200 characters or fewer.');
    const { data, error } = await this.supabase.from('verifier_wallet_blocks').upsert({
      server_id: serverId, address, wallet_type: address.startsWith('0x') ? 'evm' : (address.length === 62 && /^bc1p/i.test(address)) ? 'bitcoin' : 'solana',
      blocked_by: adminId, blocked_at: new Date().toISOString(), reason,
    }, { onConflict: 'server_id,address' }).select().single();
    if (error || !data) throw new Error('Could not save the wallet block. Please try again.');
    return data;
  }

  async unblock(serverId: string, address: string): Promise<boolean> {
    address = normalizeBlockedWallet(address);
    const { data, error } = await this.supabase.from('verifier_wallet_blocks').delete()
      .eq('server_id', serverId).eq('address', address).select('address');
    if (error || !Array.isArray(data)) throw new Error('Could not remove the wallet block. Please try again.');
    return data.length > 0;
  }

  async list(serverId: string, page: number, pageSize: number): Promise<{ rows: WalletBlock[]; total: number }> {
    const { data, error, count } = await this.supabase.from('verifier_wallet_blocks').select('*', { count: 'exact' })
      .eq('server_id', serverId).order('blocked_at', { ascending: false }).order('address')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Could not list blocked wallets. Please try again.');
    }
    return { rows: data, total: count };
  }

  async linkedUsers(address: string): Promise<string[]> {
    // user_wallets has a global unique address constraint. Keep the link so a
    // server block survives unlinking, a new signature, or a Discord account change.
    const { data, error } = await this.supabase.from('user_wallets').select('user_id')
      .eq('address', normalizeBlockedWallet(address));
    if (error || !Array.isArray(data)) throw new Error('Could not find the linked member.');
    return [...new Set(data.map(row => row.user_id))];
  }

  async assertAllowed(serverId: string, address: string): Promise<void> {
    if (!(await this.allowedAddresses(serverId, [address])).length) throw new Error(WALLET_BLOCKED);
  }

  async allowedAddresses(serverId: string, addresses: string[], context?: NftCheckContext): Promise<string[]> {
    const wallets = [...new Set(addresses.map(address => (/^0x/i.test(address) || (address.length === 62 && /^bc1p/i.test(address))) ? address.toLowerCase() : address))];
    if (!wallets.length) return [];
    const key = JSON.stringify([serverId, wallets.slice().sort()]);
    // Share only within the current verification run; a new run always reads
    // the database so block/unblock changes take effect immediately.
    const reads = context ? (context.walletBlocks ||= new Map()) : new Map<string, Promise<Set<string>>>();
    if (!reads.has(key)) reads.set(key, this.readBlocked(serverId, wallets));
    const blocked = await reads.get(key);
    return wallets.filter(address => !blocked.has(address));
  }

  private async readBlocked(serverId: string, addresses: string[]): Promise<Set<string>> {
    const blocked = new Set<string>();
    for (let offset = 0; offset < addresses.length; offset += 100) {
      let result;
      try {
        result = await this.supabase.from('verifier_wallet_blocks').select('address')
          .eq('server_id', serverId).in('address', addresses.slice(offset, offset + 100));
      } catch { throw new Error(UNAVAILABLE); }
      if (result.error || !Array.isArray(result.data)) throw new Error(UNAVAILABLE);
      for (const row of result.data) {
        if (typeof row.address !== 'string' || !addresses.includes(row.address)) throw new Error(UNAVAILABLE);
        blocked.add(row.address);
      }
    }
    return blocked;
  }
}
