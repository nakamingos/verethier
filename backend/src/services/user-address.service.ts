import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWalletAddress, WalletType } from '@/utils/wallet-address.util';
import { WalletVerificationActivity } from '@/models/wallet-activity.interface';
import { walletOnChain } from '@/utils/wallet-scope.util';
import { randomUUID } from 'crypto';

interface UserWallet {
  id: number;
  user_id: string;
  address: string;
  wallet_type?: WalletType;
  evm_chain_ids?: number[] | null;
  user_name: string | null;
  created_at: string;
  last_verified_at: string;
}

interface AddAddressResult {
  success: boolean;
  wallet?: UserWallet;
  error?: string;
  isNewAddress?: boolean;
  wasTransferred?: boolean;
  previousUserId?: string;
  previousUserName?: string | null;
  reconciliationQueued?: boolean;
}

@Injectable()
export class UserAddressService {
  private readonly logger = new Logger(UserAddressService.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
  ) {}

  /**
   * Get all addresses for a specific user
   */
  async getUserAddresses(userId: string, walletType?: WalletType, chainId?: number): Promise<string[]> {
    try {
      // Log sensitive operations only in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Getting addresses for user: ${userId}`);
      }
      
      let query = this.supabase
        .from('user_wallets')
        .select('address,wallet_type,evm_chain_ids')
        .eq('user_id', userId);
      if (walletType) query = query.eq('wallet_type', walletType);
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        this.logger.error(`Error fetching addresses for user ${userId}:`, error);
        throw error;
      }

      const addresses = (data || []).filter(row => chainId === undefined || (chainId === 0 ? row.wallet_type === 'bitcoin' : walletOnChain(row, chainId))).map(row => row.address);
      this.logger.debug(`Found ${addresses.length} addresses for user ${userId}`);
      
      return addresses;
    } catch (error) {
      this.logger.error(`Exception getting addresses for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Add or claim an address for a user after successful verification.
   *
   * If the address is already linked to a different user, ownership is moved
   * to the newly verified user instead of being rejected. The link, any
   * transfer and the audit record are written in one database transaction.
   */
  async addUserAddress(userId: string, address: string, userName: string | null | undefined, walletType: WalletType, activity: WalletVerificationActivity): Promise<AddAddressResult> {
    try {
      const { data, error } = await this.supabase.rpc('verifier_link_verified_wallet', {
        p_user: userId,
        p_address: normalizeWalletAddress(address, walletType),
        p_type: walletType,
        p_name: userName || null,
        p_request: randomUUID(),
        p_source: activity.source,
        p_server: activity.serverId,
        p_channel: activity.channelId || null,
        p_chain: activity.evmChainId ?? null,
      });
      if (error || !data?.success) return { success: false, error: 'Could not save wallet verification.' };
      return data;
    } catch (error) {
      this.logger.error(`Exception adding address for user ${userId}:`, error);
      return { success: false, error: 'Could not save wallet verification.' };
    }
  }
}
