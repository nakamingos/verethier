import { DynamicRoleService } from './dynamic-role.service';
import { tokenRuleCriteria } from '@/utils/erc20-rule.util';
import { nftRuleLabel } from '@/utils/nft-rule.util';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { NonceService }  from './nonce.service';
import { DiscordVerificationService, RoleSyncContext } from './discord-verification.service';
import { BulkVerificationResult } from './verification-engine.service';
import { VerifierRole } from '@/models/verifier-role.interface';
import { DataService }   from './data.service';
import { DbService }     from './db.service';
import { VerificationService } from './verification.service';
import { DecodedData }   from '@/models/app.interface';
import { matchRule }   from './utils/match-rule.util';
import { NftCheckContext } from './nft-ownership.service';
import { OrdinalsRequestScheduler } from './ordinals-request-scheduler.service';

/**
 * VerifyService
 * 
 * Core verification service that handles the complete wallet signature verification flow.
 * 
 * Flow:
 * 1. Verifies wallet signature using viem/ethers
 * 2. Validates and invalidates nonce to prevent replay attacks
 * 3. Checks asset ownership against verification rules
 * 4. Assigns Discord roles based on matching criteria
 */
@Injectable()
export class VerifyService {
  constructor(
    private readonly walletSvc: WalletService,
    private readonly nonceSvc: NonceService,
    private readonly discordVerificationSvc: DiscordVerificationService,
    private readonly dataSvc: DataService,
    private readonly dbSvc: DbService,
    private readonly verificationSvc: VerificationService,
    @Optional() private readonly ordinalRequests?: OrdinalsRequestScheduler,
    @Optional() private readonly earnedRoles?: DynamicRoleService,
  ) {}

  /**
   * Main verification flow that handles wallet signature verification and role assignment.
   * 
   * @param payload - Decoded JWT payload containing user and server information
   * @param signature - Wallet signature to verify
   * @returns Promise<{message: string, address: string}> - Verification result
   * @throws Error if verification fails at any step
   */
  async verifySignatureFlow(
    payload: DecodedData & { address?: string },
    signature: string
  ) {
    // Verify the wallet signature and extract the signing address
    const startedAt = Date.now();
    const walletVerification = await this.timed(payload.userId, 'wallet signature', () => this.walletSvc.verifySignature(payload, signature));
    const finish = this.ordinalRequests?.beginVerification();
    try {
      const result = await this.completeVerification(payload, walletVerification);
      if (walletVerification.activity) {
        try { await this.dbSvc.recordWalletVerification(payload.userId, walletVerification.address, walletVerification.activity); }
        catch { Logger.warn('Successful verification activity could not be saved.'); }
      }
      return result;
    } finally {
      finish?.();
      Logger.log(`Verification total: user=${payload.userId}; ${Date.now() - startedAt}ms`);
    }
  }

  private async completeVerification(
    payload: DecodedData & { address?: string },
    walletVerification: Awaited<ReturnType<WalletService['verifySignature']>>,
  ) {
    const { address, walletOwnershipTransferred } = walletVerification;
    const ownershipContext: NftCheckContext = { checks: new Map(), provenAddresses: new Map([[payload.userId, address]]) };
    
    // Get the message data associated with the nonce for message-based verification
    const { channelId } = walletVerification.nonceContext
      || await this.nonceSvc.getNonceData(payload.userId, payload.nonce);
    
    // Invalidate the nonce after retrieving the data to prevent replay attacks
    await this.nonceSvc.invalidateNonce(payload.nonce);
    Logger.debug(`Nonce deleted: ${payload.nonce} for userId: ${payload.userId}`);

    // --- Channel-based verification (simplified approach) ---
    // Get all rules for the channel where the verification button was clicked
    if (channelId) {
      Logger.debug(`Channel-based verification for channelId: ${channelId}`);
      
      // Get ALL rules that apply to this channel
      const rules = await this.timed(payload.userId, 'rules', () => this.verificationSvc.getRulesForChannel(
        payload.discordId, channelId
      ));
      
      if (!rules || rules.length === 0) {
        Logger.warn(`No rules found for channelId: ${channelId}`);
        const errorMsg = 'No verification rules found for this channel';
        await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
        throw new Error(errorMsg);
      }

      Logger.debug(`Found ${rules.length} rules for channelId: ${channelId}`);
      
      // Use the unified verification engine to verify the user against all rules
      const ruleIds = rules.map(rule => rule.id);
      ownershipContext.ordinalNeedsNumbers = rules.some(rule => rule.asset_type === 'ordinal' && rule.inscription_criteria?.kind === 'numbers');
      const verificationResult = await this.timed(payload.userId, 'eligibility', () =>
        this.verificationSvc.verifyUserBulk(payload.userId, ruleIds, address, ownershipContext, rules));
      const { validRules } = verificationResult;
      
      const roleResults = await this.assignVerifiedRoles(payload, verificationResult);
      await this.reconcileEarned(payload, ownershipContext);
      const hasMatchingAssets = validRules.length > 0;

      if (!hasMatchingAssets) {
        if (verificationResult.results?.some(result => result.status === 'unavailable' || result.error)) {
          const errorMsg = 'Collection verification is temporarily unavailable. Please try again.';
          await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
          throw new Error(errorMsg);
        }
        const errorMsg = rules[0]?.asset_type === 'erc20'
          ? `Wallet balance does not meet the token rule: ${tokenRuleCriteria(rules[0])}`
          : rules[0]?.asset_type === 'nft'
          ? `Address does not own the required assets for collection: ${nftRuleLabel(rules[0])}`
          : rules[0]?.slug
          ? `Address does not own the required assets for collection: ${rules[0].slug}`
          : 'Address does not own any assets in the collection';
        await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
        throw new Error(errorMsg);
      }
      
      // Send verification complete message with role assignment details
      try {
        await this.timed(payload.userId, 'completion and recommendations', () => this.discordVerificationSvc.sendVerificationComplete(
          payload.discordId,
          payload.nonce,
          roleResults,
          address,
          ownershipContext // Reuse ownership reads for role recommendations.
        ));
      } catch (error) {
        Logger.error('Failed to send verification complete message:', error);
        // Log the error but don't fail the verification process
      }
      
      const totalAssigned = new Set(roleResults.map(result => result.roleId)).size;
      const newlyAssigned = new Set(roleResults.filter(r => !r.wasAlreadyAssigned).map(result => result.roleId)).size;
      
      Logger.log(`Verification completed (${newlyAssigned} new roles, ${totalAssigned - newlyAssigned} existing roles)`);
      return { 
        message: `Verification successful (message-based) - ${newlyAssigned} new roles assigned, ${totalAssigned - newlyAssigned} existing roles`, 
        address,
        walletOwnershipTransferred,
        assignedRoles: [...new Set(roleResults.map(r => r.roleId))]
      };
    }

    // --- Unified verification path ---
    // This path handles all cases and applies appropriate logic
    Logger.debug(`Unified verification path for address: ${address}`);
    
    // Get all rules for the current guild using the unified verification service
    const rules = await this.timed(payload.userId, 'rules', () => this.verificationSvc.getAllRulesForServer(payload.discordId));
    
    if (!rules || rules.length === 0) {
      const errorMsg = 'No verification rules found for this server';
      await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
      throw new Error(errorMsg);
    }
    
    // Use unified verification engine to check all rules
    const ruleIds = rules.map(rule => rule.id);
    ownershipContext.ordinalNeedsNumbers = rules.some(rule => rule.asset_type === 'ordinal' && rule.inscription_criteria?.kind === 'numbers');
    const verificationResult = await this.timed(payload.userId, 'eligibility', () =>
      this.verificationSvc.verifyUserBulk(payload.userId, ruleIds, address, ownershipContext, rules));
    const { validRules } = verificationResult;
    
    if (validRules.length === 0) {
      await this.reconcileEarned(payload, ownershipContext);
      const errorMsg = verificationResult.results?.some(result => result.status === 'unavailable' || result.error)
        ? 'Collection verification is temporarily unavailable. Please try again.'
        : 'Address does not meet any verification requirements';
      await this.discordVerificationSvc.throwError(payload.nonce, errorMsg);
      throw new Error(errorMsg);
    }

    const roleResults = await this.assignVerifiedRoles(payload, verificationResult);
    await this.reconcileEarned(payload, ownershipContext);

    // Send verification complete message with role assignment details
    try {
      await this.timed(payload.userId, 'completion and recommendations', () => this.discordVerificationSvc.sendVerificationComplete(
        payload.discordId,
        payload.nonce,
        roleResults,
        address,
        ownershipContext // Reuse ownership reads for role recommendations.
      ));
    } catch (error) {
      Logger.error('Failed to send verification complete message:', error);
      // Log the error but don't fail the verification process
    }
    
    const totalAssigned = new Set(roleResults.map(result => result.roleId)).size;
    const newlyAssigned = new Set(roleResults.filter(r => !r.wasAlreadyAssigned).map(result => result.roleId)).size;
    
    Logger.log(`Verification completed (${newlyAssigned} new roles, ${totalAssigned - newlyAssigned} existing roles)`);
    return { 
      message: `Verification successful - ${newlyAssigned} new roles assigned, ${totalAssigned - newlyAssigned} existing roles`, 
      address,
      walletOwnershipTransferred,
      assignedRoles: [...new Set(roleResults.map(r => r.roleId))]
    };
  }

  private async reconcileEarned(payload: DecodedData, context: NftCheckContext): Promise<void> {
    // A fresh manual proof also checks earned roles. Shared ownership reads avoid
    // repeating provider work; alternative rules and all saved wallets still apply.
    try { await this.earnedRoles?.reverifyUserInServer(payload.userId, payload.discordId, context); }
    catch { Logger.warn('Earned-role reconciliation unavailable; existing roles retained for retry.'); }
  }

  private async assignVerifiedRoles(payload: DecodedData, result: BulkVerificationResult) {
    return this.timed(payload.userId, 'role assignment and tracking', async () => {
      const groups = new Map<string, VerifierRole[]>();
      for (const rule of result.validRules) {
        if (!rule.role_id) continue;
        if (!groups.has(rule.role_id)) groups.set(rule.role_id, []);
        groups.get(rule.role_id).push(rule);
      }
      const roleResults = [];
      const members: RoleSyncContext = new Map();
      for (const [roleId, matches] of groups) {
        try {
          const roleResult = await this.discordVerificationSvc.addUserRole(
            payload.userId, roleId, payload.discordId, payload.nonce, matches[0].id.toString(),
            {
              last_check_status: 'passed',
              matched_rule_ids: matches.map(rule => rule.id),
              rule_checks: (result.results || []).filter(check => check.rule?.role_id === roleId),
            }, members
          );
          if (!roleResult) continue;
          // Preserve every matching rule in the existing success-message layout.
          // The assignment and its database record are each updated only once.
          for (const rule of matches) roleResults.push({
            ...roleResult,
            ruleId: rule.id.toString(),
            matchingCount: result.matchingAssetCounts.get(rule.id.toString()) || 0,
          });
        } catch (error) {
          Logger.error(`Failed to assign role ${roleId}:`, error.message);
        }
      }
      return roleResults;
    });
  }

  private async timed<T>(userId: string, stage: string, work: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try { return await work(); }
    finally { Logger.log(`Verification ${stage}: user=${userId}; ${Date.now() - startedAt}ms`); }
  }
}
