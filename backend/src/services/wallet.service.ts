import { Injectable, Logger, Optional } from '@nestjs/common';
import { recoverTypedDataAddress } from 'viem';

import { DynamicRoleService } from '@/services/dynamic-role.service';
import { NonceService } from '@/services/nonce.service';
import { UserAddressService } from '@/services/user-address.service';
import { DiscordService } from '@/services/discord.service';
import { DecodedData } from '@/models/app.interface';
import { BitcoinSignatureService } from './bitcoin-signature.service';

/**
 * WalletService
 * 
 * Handles wallet signature verification using EIP-712 typed data signatures.
 * Verifies that a user controls a specific Ethereum address by validating
 * their signature against a structured message containing verification details.
 * 
 * Key responsibilities:
 * - Verify EIP-712 signatures using viem
 * - Validate nonces to prevent replay attacks
 * - Check signature expiry to ensure freshness
 * - Support unified verification message format (works for all rule types)
 */
@Injectable()
export class WalletService {

  constructor(
    private nonceSvc: NonceService,
    private userAddressService: UserAddressService,
    private discordService: DiscordService,
    private dynamicRoleService: DynamicRoleService,
    @Optional() private readonly bitcoinSvc?: BitcoinSignatureService
  ) {}
  
  /**
   * Verifies an EIP-712 wallet signature for the given verification data.
   * 
   * This method performs several validation steps:
   * 1. Validates the nonce to ensure the request is legitimate and not replayed
   * 2. Checks that the verification hasn't expired
   * 3. Reconstructs the typed data message using EIP-712 format
   * 4. Recovers the signing address from the signature
   * 5. Validates that the recovered address matches expectations
   * 
   * @param data - The decoded verification data containing user and server info
   * @param signature - The EIP-712 signature to verify
   * @returns Promise<{ address: string; walletOwnershipTransferred: boolean }> - The verified wallet result
   * @throws Error if nonce is invalid/expired, verification expired, or signature invalid
   */
  async verifySignature(
    data: DecodedData,
    signature: string
  ): Promise<{ address: string; walletOwnershipTransferred: boolean; nonceContext?: { channelId?: string; messageId?: string } }> {
    if (data.walletType === 'bitcoin') return this.verifyBitcoinSignature(data, signature);
    if (data.walletType && data.walletType !== 'evm') throw new Error('Invalid wallet type.');

    // Debug logging to investigate signature verification issues
    Logger.debug('=== WALLET SERVICE DEBUG ===');
    Logger.debug('Input data:', JSON.stringify(data, null, 2));
    Logger.debug('Input signature:', signature);

    // Fetch the nonce for the verification context
    const userNonce = await this.nonceSvc.validateNonce(data.userId, data.discordId, data.nonce);
    if (!userNonce) throw new Error('Invalid or expired nonce.');

    // Check if verification has expired
    const expiry = new Date(data.expiry * 1000).getTime();
    const expired = expiry < Date.now();
    if (expired) throw new Error('Verification has expired.');

    const types = {
      Verification: [
        { name: 'UserID', type: 'string' },
        { name: 'UserTag', type: 'string' },
        { name: 'ServerID', type: 'string' },
        { name: 'ServerName', type: 'string' },
        { name: 'Nonce', type: 'string' },
        { name: 'Expiry', type: 'uint256' },
      ]
    };

    const message = {
      UserID: data.userId,
      UserTag: data.userTag,
      ServerID: data.discordId,
      ServerName: data.discordName,
      Nonce: data.nonce,
      Expiry: data.expiry,
    };

    const typedData = {
      types,
      domain: {
        name: 'verethier',
        version: '1',
        chainId: 1,
      },
      message,
    };

    Logger.debug('EIP-712 typedData for verification:', JSON.stringify(typedData, null, 2));

    let address: string | null = null;

    try {
      const recoveredAddress = await recoverTypedDataAddress({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: 'Verification',
        message: typedData.message,
        signature: signature as `0x${string}`
      });

      Logger.debug('Recovered address:', recoveredAddress);

      if (recoveredAddress === data.address) {
        address = recoveredAddress;
      }
    } catch (error) {
      const recoveryError = error instanceof Error ? error : new Error('Signature recovery failed');
      Logger.debug('Signature recovery failed:', recoveryError.message);
      throw recoveryError;
    }

    Logger.debug('Expected address:', data.address);

    if (!address) throw new Error('Invalid signature.');
    
    let walletOwnershipTransferred = false;

    // Store the verified address in user_wallets table
    // CRITICAL: Wait for this to complete before returning to prevent race condition
    // where verification queries getUserAddresses() before INSERT completes
    try {
      // Get Discord username
      let userName: string | null = null;
      try {
        const user = await this.discordService.getUser(data.userId);
        if (user) {
          userName = user.globalName || user.username || null;
        }
      } catch (usernameError) {
        Logger.debug(`Could not fetch Discord username for ${data.userId}:`, usernameError.message);
        // Continue without username
      }

      const result = await this.userAddressService.addUserAddress(data.userId, address, userName);
      if (!result.success) {
        // Log warning but don't fail verification - address storage is supplementary
        Logger.warn(`Failed to store address for user ${data.userId}: ${result.error}`);
      } else {
        walletOwnershipTransferred = result.wasTransferred === true;
        Logger.debug(`Successfully ${result.isNewAddress ? 'added new' : 'updated existing'} address for user ${data.userId}${userName ? ` (${userName})` : ''}`);

        if (walletOwnershipTransferred && result.previousUserId) {
          Logger.log(
            `Wallet ${address} moved from Discord user ${result.previousUserId} to ${data.userId}`
          );
          this.schedulePreviousOwnerReverification(result.previousUserId, data.userId, address);
        }
      }
    } catch (error) {
      // Log error but don't fail verification - address storage is supplementary
      Logger.error(`Exception storing address for user ${data.userId}:`, error);
    }
    
    return {
      address,
      walletOwnershipTransferred,
    };
  }

  private schedulePreviousOwnerReverification(
    previousUserId: string,
    currentUserId: string,
    address: string
  ): void {
    void this.dynamicRoleService.reverifyUser(previousUserId)
      .then(({ verified, revoked }) => {
        Logger.log(
          `Completed post-transfer reverification for previous wallet owner ${previousUserId} ` +
          `after moving ${address} to ${currentUserId}: ${verified} verified, ${revoked} revoked`
        );
      })
      .catch((error) => {
        Logger.error(
          `Failed to reverify previous wallet owner ${previousUserId} after moving ${address} to ${currentUserId}:`,
          error
        );
      });
  }

  private async verifyBitcoinSignature(data: DecodedData, signature: string) {
    if (!this.bitcoinSvc) throw new Error('Bitcoin verification is not configured.');
    const { address, context } = await this.bitcoinSvc.verify(data, signature);
    let userName: string | null = null;
    try {
      const user = await this.discordService.getUser(data.userId);
      userName = user?.globalName || user?.username || null;
    } catch { /* Username is optional display information. */ }
    const result = await this.userAddressService.addUserAddress(data.userId, address, userName, 'bitcoin');
    if (!result.success) throw new Error('Could not save the Bitcoin wallet verification. Please try again from Discord.');
    if (result.wasTransferred && result.previousUserId) {
      this.schedulePreviousOwnerReverification(result.previousUserId, data.userId, address);
    }
    return {
      address, walletOwnershipTransferred: result.wasTransferred === true,
      nonceContext: { channelId: context.channelId, messageId: context.messageId },
    };
  }
}
