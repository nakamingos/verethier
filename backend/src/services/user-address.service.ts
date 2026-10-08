import { Injectable, Logger, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWalletAddress, WalletType } from '@/utils/wallet-address.util';

interface UserWallet {
  id: number;
  user_id: string;
  address: string;
  wallet_type?: WalletType;
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
}

interface UserAddressSummary {
  user_id: string;
  addresses: string[];
  total_addresses: number;
  last_verified_at?: string;
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
  async getUserAddresses(userId: string, walletType?: WalletType): Promise<string[]> {
    try {
      // Log sensitive operations only in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Getting addresses for user: ${userId}`);
      }
      
      let query = this.supabase
        .from('user_wallets')
        .select('address')
        .eq('user_id', userId);
      if (walletType) query = query.eq('wallet_type', walletType);
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        this.logger.error(`Error fetching addresses for user ${userId}:`, error);
        throw error;
      }

      const addresses = data?.map(row => row.address) || [];
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
   * to the newly verified user instead of being rejected.
   */
  async addUserAddress(userId: string, address: string, userName?: string | null, walletType: WalletType = 'evm'): Promise<AddAddressResult> {
    try {
      const normalizedAddress = normalizeWalletAddress(address, walletType);
      // Log user address operations only in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Adding address ${normalizedAddress} for user: ${userId}${userName ? ` (${userName})` : ''}`);
      }

      const existingWalletsResult = await this.findWalletsByAddress(normalizedAddress);
      if (!existingWalletsResult.success) {
        return existingWalletsResult;
      }

      const existingWallets = existingWalletsResult.wallets || [];
      const existingWalletForUser = existingWallets.find(wallet => wallet.user_id === userId);
      const existingWalletForOtherUser = existingWallets.find(wallet => wallet.user_id !== userId);

      if (existingWalletForUser) {
        return this.updateExistingWallet(existingWalletForUser, userName);
      }

      if (existingWalletForOtherUser) {
        return this.transferWallet(existingWalletForOtherUser, userId, userName);
      }

      // Insert new address
      const { data: newWallet, error: insertError } = await this.supabase
        .from('user_wallets')
        .insert({
          user_id: userId,
          address: normalizedAddress,
          wallet_type: walletType,
          user_name: userName || null,
          created_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        if (this.isUserWalletUniqueViolation(insertError)) {
          return this.resolveInsertConflict(userId, normalizedAddress, userName);
        }

        this.logger.error(`Error inserting new address:`, insertError);
        return { success: false, error: insertError.message };
      }

      this.logger.log(`Successfully added new address ${normalizedAddress} for user ${userId}`);
      return { 
        success: true, 
        wallet: newWallet, 
        isNewAddress: true 
      };

    } catch (error) {
      this.logger.error(`Exception adding address for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove an address from a user's wallet collection
   */
  async removeUserAddress(userId: string, address: string): Promise<boolean> {
    try {
      const normalizedAddress = address.toLowerCase();
      // Log address removal only in development  
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Removing address ${normalizedAddress} for user: ${userId}`);
      }

      const { error } = await this.supabase
        .from('user_wallets')
        .delete()
        .eq('user_id', userId)
        .eq('address', normalizedAddress);

      if (error) {
        this.logger.error(`Error removing address:`, error);
        return false;
      }

      this.logger.log(`Successfully removed address ${normalizedAddress} for user ${userId}`);
      return true;

    } catch (error) {
      this.logger.error(`Exception removing address for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get summary of all user addresses with counts
   */
  async getUserAddressSummary(userId: string): Promise<UserAddressSummary | null> {
    try {
      this.logger.debug(`Getting address summary for user: ${userId}`);

      const { data, error } = await this.supabase
        .from('user_wallets')
        .select('address, last_verified_at')
        .eq('user_id', userId)
        .order('last_verified_at', { ascending: false });

      if (error) {
        this.logger.error(`Error fetching address summary:`, error);
        return null;
      }

      if (!data || data.length === 0) {
        return {
          user_id: userId,
          addresses: [],
          total_addresses: 0
        };
      }

      return {
        user_id: userId,
        addresses: data.map(row => row.address),
        total_addresses: data.length,
        last_verified_at: data[0]?.last_verified_at
      };

    } catch (error) {
      this.logger.error(`Exception getting address summary for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Check if a user has any addresses
   */
  async userHasAddresses(userId: string): Promise<boolean> {
    try {
      const addresses = await this.getUserAddresses(userId);
      return addresses.length > 0;
    } catch (error) {
      this.logger.error(`Exception checking if user has addresses:`, error);
      return false;
    }
  }

  /**
   * Get all users who have a specific address
   */
  async getUsersWithAddress(address: string): Promise<string[]> {
    try {
      const normalizedAddress = address.toLowerCase();
      this.logger.debug(`Finding users with address: ${normalizedAddress}`);

      const { data, error } = await this.supabase
        .from('user_wallets')
        .select('user_id')
        .eq('address', normalizedAddress);

      if (error) {
        this.logger.error(`Error finding users with address:`, error);
        return [];
      }

      const userIds = data?.map(row => row.user_id) || [];
      this.logger.debug(`Found ${userIds.length} users with address ${normalizedAddress}`);
      
      return userIds;
    } catch (error) {
      this.logger.error(`Exception finding users with address:`, error);
      return [];
    }
  }

  private async findWalletsByAddress(address: string): Promise<AddAddressResult & { wallets?: UserWallet[] }> {
    const { data, error } = await this.supabase
      .from('user_wallets')
      .select('*')
      .eq('address', address)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Error checking wallet ownership for ${address}:`, error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      wallets: data || []
    };
  }

  private async updateExistingWallet(existingWallet: UserWallet, userName?: string | null): Promise<AddAddressResult> {
    const { data: updated, error: updateError } = await this.supabase
      .from('user_wallets')
      .update({
        last_verified_at: new Date().toISOString(),
        user_name: userName !== undefined ? userName : existingWallet.user_name
      })
      .eq('id', existingWallet.id)
      .select()
      .single();

    if (updateError) {
      this.logger.error(`Error updating existing address:`, updateError);
      return { success: false, error: updateError.message };
    }

    this.logger.debug(`Updated existing address verification time and username`);
    return {
      success: true,
      wallet: updated,
      isNewAddress: false
    };
  }

  private async transferWallet(
    existingWallet: UserWallet,
    newUserId: string,
    userName?: string | null
  ): Promise<AddAddressResult> {
    const { data: updated, error: updateError } = await this.supabase
      .from('user_wallets')
      .update({
        user_id: newUserId,
        user_name: userName !== undefined ? userName : existingWallet.user_name,
        last_verified_at: new Date().toISOString()
      })
      .eq('id', existingWallet.id)
      .select()
      .single();

    if (updateError) {
      this.logger.error(
        `Error transferring address ${existingWallet.address} from user ${existingWallet.user_id} to ${newUserId}:`,
        updateError
      );
      return { success: false, error: updateError.message };
    }

    this.logger.log(
      `Transferred wallet ${existingWallet.address} from user ${existingWallet.user_id} to user ${newUserId}`
    );

    return {
      success: true,
      wallet: updated,
      isNewAddress: false,
      wasTransferred: true,
      previousUserId: existingWallet.user_id,
      previousUserName: existingWallet.user_name,
    };
  }

  private async resolveInsertConflict(userId: string, address: string, userName?: string | null): Promise<AddAddressResult> {
    const existingWalletsResult = await this.findWalletsByAddress(address);
    if (!existingWalletsResult.success) {
      return existingWalletsResult;
    }

    const existingWallets = existingWalletsResult.wallets || [];
    const existingWalletForUser = existingWallets.find(wallet => wallet.user_id === userId);

    if (existingWalletForUser) {
      return this.updateExistingWallet(existingWalletForUser, userName);
    }

    if (existingWallets.length > 0) {
      return this.transferWallet(existingWallets[0], userId, userName);
    }

    this.logger.error(
      `Unique constraint conflict reported for address ${address}, ` +
      `but no wallet owner was found on re-read for attempted user=${userId}`
    );
    return {
      success: false,
      error: 'Failed to store wallet address due to a conflicting wallet record.'
    };
  }

  private isUserWalletUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
    const message = 'message' in error && typeof error.message === 'string' ? error.message : '';

    return code === '23505' || message.includes('duplicate key value violates unique constraint');
  }


}
