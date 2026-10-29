import { SolanaSignatureService } from './solana-signature.service';
import { PrivacyService, privacyProof } from '@/portal/privacy.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EvmSignatureService } from './evm-signature.service';

import { DynamicRoleService } from '@/services/dynamic-role.service';
import { NonceService } from '@/services/nonce.service';
import { UserAddressService } from '@/services/user-address.service';
import { DiscordService } from '@/services/discord.service';
import { DecodedData } from '@/models/app.interface';
import { BitcoinSignatureService } from './bitcoin-signature.service';
import { WalletBlockService } from './wallet-block.service';
import { randomUUID } from 'crypto';
import { WalletVerificationActivity } from '@/models/wallet-activity.interface';

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
    private readonly walletBlocks: WalletBlockService,
    @Optional() private readonly bitcoinSvc?: BitcoinSignatureService,
    @Optional() private readonly privacy?: PrivacyService,
    @Optional() private readonly evmSignatures: EvmSignatureService = new EvmSignatureService(),
    @Optional() private readonly solanaSvc?: SolanaSignatureService
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
  ): Promise<{ address: string; walletOwnershipTransferred: boolean; nonceContext?: { channelId?: string; messageId?: string }; activity?: WalletVerificationActivity }> {
    if (data.walletType === 'solana') return this.verifySolanaSignature(data, signature);
    if (data.walletType === 'bitcoin') return this.verifyBitcoinSignature(data, signature);
    if (data.walletType && data.walletType !== 'evm') throw new Error('Invalid wallet type.');

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

    if (data.chainId !== undefined) {
      types.Verification.push({ name: 'WalletAddress', type: 'address' });
      (message as any).WalletAddress = data.address;
    }
    if (data.privacy !== undefined) {
      types.Verification.push({ name: 'Privacy', type: 'string' });
      (message as any).Privacy = privacyProof(data.privacy);
    }
    const typedData = {
      types,
      domain: {
        name: 'Bouncer',
        version: '1',
        chainId: data.chainId ?? 1,
      },
      message,
    };


    let proof: { chainId?: number } | undefined;
    let failure: Error | undefined;
    for (const name of data.chainId === undefined ? ['Bouncer', 'verethier'] : ['Bouncer']) {
      try {
        proof = await this.evmSignatures.verify(data.address, {
          ...typedData, domain: { ...typedData.domain, name }, primaryType: 'Verification',
        }, signature);
        break;
      } catch (error) { failure = error; }
    }
    if (!proof) throw failure || new Error('Invalid wallet signature.');
    const address = data.address.toLowerCase();
    // Check before saving or transferring the wallet link. Keep this outside
    // the optional address-storage catch so a blocked wallet cannot proceed.
    await this.walletBlocks.assertAllowed(data.discordId, address);
    // Reserve the fresh proof before any link/transfer or ownership work, just
    // as the Bitcoin path does. Concurrent tabs cannot submit the same proof.
    const context = await this.nonceSvc.consumeNonce(data.userId, data.discordId, data.nonce);
    await this.privacy?.assertActive(data.userId);
    if (data.privacy !== undefined) {
      if (!this.privacy) throw new Error('Privacy controls are unavailable.');
      await this.privacy.choose(data.discordId,data.userId,data.privacy);
    }
    const activity: WalletVerificationActivity = {
      id: randomUUID(),
      source: context.memberPortal ? 'portal' : 'discord',
      serverId: data.discordId,
      channelId: context.channelId,
      walletType: 'evm',
      ...(proof.chainId ? { evmChainId: proof.chainId } : {}),
      provenAt: new Date().toISOString(),
    };
    
    let walletOwnershipTransferred = false;

    // Store the verified address in user_wallets table
    // Wait for this to complete before returning to prevent race condition
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

      const result = await this.userAddressService.addUserAddress(data.userId, address, userName, 'evm', activity);
      if (!result.success) {
        throw new Error('Could not save wallet proof.');
      } else {
        walletOwnershipTransferred = result.wasTransferred === true;
        Logger.debug(`Successfully ${result.isNewAddress ? 'added new' : 'updated existing'} address for user ${data.userId}${userName ? ` (${userName})` : ''}`);

        if (walletOwnershipTransferred && result.previousUserId && !result.reconciliationQueued) {
          Logger.log(
            'Wallet transfer saved; checking the previous account’s roles.'
          );
          this.schedulePreviousOwnerReverification(result.previousUserId, data.userId, address);
        }
      }
    } catch (error) {
      Logger.error('Could not save wallet proof; verification stopped.');
      throw new Error('Could not save wallet proof. Request a new verification link and retry.');
    }
    
    return {
      address,
      walletOwnershipTransferred,
      activity,
      ...(context.channelId || context.messageId ? {
        nonceContext: { channelId: context.channelId, messageId: context.messageId },
      } : {}),
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
          `Completed post-transfer role check: ${verified} verified, ${revoked} revoked`
        );
      })
      .catch((error) => {
        Logger.error(
          'Post-transfer role check failed:',
          error
        );
      });
  }

  private async verifySolanaSignature(data: DecodedData, signature: string) {
    if (!this.solanaSvc) throw new Error('Solana verification is not configured.');
    const { address, context } = await this.solanaSvc.verify(data, signature);
    await this.walletBlocks.assertAllowed(data.discordId, address);
    await this.privacy?.assertActive(data.userId);
    if (data.privacy !== undefined) {
      if (!this.privacy) throw new Error('Privacy controls are unavailable.');
      await this.privacy.choose(data.discordId,data.userId,data.privacy);
    }
    let userName: string | null = null;
    try {
      const user = await this.discordService.getUser(data.userId);
      userName = user?.globalName || user?.username || null;
    } catch { /* Username is optional display information. */ }
    const activity: WalletVerificationActivity = {
      id: randomUUID(),
      source: context.memberPortal ? 'portal' : 'discord',
      serverId: data.discordId,
      channelId: context.channelId,
      walletType: 'solana',
      provenAt: new Date().toISOString(),
    };
    const result = await this.userAddressService.addUserAddress(data.userId, address, userName, 'solana', activity);
    if (!result.success) throw new Error('Could not save the Solana wallet verification. Please try again from Discord.');
    if (result.wasTransferred && result.previousUserId && !result.reconciliationQueued) {
      this.schedulePreviousOwnerReverification(result.previousUserId, data.userId, address);
    }
    return {
      address, walletOwnershipTransferred: result.wasTransferred === true, activity,
      nonceContext: { channelId: context.channelId, messageId: context.messageId },
    };
  }

  private async verifyBitcoinSignature(data: DecodedData, signature: string) {
    if (!this.bitcoinSvc) throw new Error('Bitcoin verification is not configured.');
    const { address, context } = await this.bitcoinSvc.verify(data, signature);
    await this.walletBlocks.assertAllowed(data.discordId, address);
    await this.privacy?.assertActive(data.userId);
    if (data.privacy !== undefined) {
      if (!this.privacy) throw new Error('Privacy controls are unavailable.');
      await this.privacy.choose(data.discordId,data.userId,data.privacy);
    }
    let userName: string | null = null;
    try {
      const user = await this.discordService.getUser(data.userId);
      userName = user?.globalName || user?.username || null;
    } catch { /* Username is optional display information. */ }
    const activity: WalletVerificationActivity = {
      id: randomUUID(),
      source: context.memberPortal ? 'portal' : 'discord',
      serverId: data.discordId,
      channelId: context.channelId,
      walletType: 'bitcoin',
      provenAt: new Date().toISOString(),
    };
    const result = await this.userAddressService.addUserAddress(data.userId, address, userName, 'bitcoin', activity);
    if (!result.success) throw new Error('Could not save the Bitcoin wallet verification. Please try again from Discord.');
    if (result.wasTransferred && result.previousUserId && !result.reconciliationQueued) {
      this.schedulePreviousOwnerReverification(result.previousUserId, data.userId, address);
    }
    return {
      address, walletOwnershipTransferred: result.wasTransferred === true, activity,
      nonceContext: { channelId: context.channelId, messageId: context.messageId },
    };
  }
}
