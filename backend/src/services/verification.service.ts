import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { DataService } from './data.service';
import { DiscordVerificationService } from './discord-verification.service';
import { VerificationEngine, VerificationResult, BulkVerificationResult } from './verification-engine.service';
import { AssetCount, VerifierRole } from '@/models/verifier-role.interface';
import { DecodedData } from '@/models/app.interface';
import { NftCheckContext } from './nft-ownership.service';

/**
 * VerificationService
 * 
 * Verification service that handles all verification logic using the VerificationEngine.
 * This service acts as a facade that delegates verification logic to the VerificationEngine
 * while providing additional orchestration and Discord integration.
 * 
 * Key responsibilities:
 * - Delegate verification logic to VerificationEngine
 * - Handle wallet verification and Discord integration
 * - Manage role assignments through the verifier_user_roles table
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly dbSvc: DbService,
    private readonly dataSvc: DataService,
    private readonly discordVerificationSvc: DiscordVerificationService,
    private readonly verificationEngine: VerificationEngine,
  ) {}

  /**
   * Verify a user's wallet address using the VerificationEngine
   * 
   * @param userId - Discord user ID
   * @param ruleId - Rule ID to verify against
   * @param address - Ethereum address to verify
   * @returns Promise<VerificationResult> with detailed verification result
   */
  async verifyUser(
    userId: string,
    ruleId: string | number,
    address: string
  ): Promise<VerificationResult> {
    return await this.verificationEngine.verifyUser(userId, ruleId, address);
  }

  /**
   * Verify a user against multiple rules using the VerificationEngine
   * 
   * @param userId - Discord user ID
   * @param ruleIds - Array of rule IDs to verify against
   * @param address - Ethereum address to verify
   * @returns Promise<BulkVerificationResult> with results for all rules
   */
  async verifyUserBulk(
    userId: string,
    ruleIds: (string | number)[],
    address: string,
    context?: NftCheckContext
  ): Promise<BulkVerificationResult> {
    if (context) return this.verificationEngine.verifyUserBulk(userId, ruleIds, address, undefined, context);
    return await this.verificationEngine.verifyUserBulk(userId, ruleIds, address);
  }

  /**
   * Verify a user against all rules for a specific server
   * 
   * @param userId - Discord user ID
   * @param serverId - Discord server ID
   * @param address - Ethereum address to verify
   * @returns Promise<BulkVerificationResult> with results for all server rules
   */
  async verifyUserForServer(
    userId: string,
    serverId: string,
    address: string
  ): Promise<BulkVerificationResult> {
    return await this.verificationEngine.verifyUserForServer(userId, serverId, address);
  }

  /**
   * Verify user for server using multi-wallet approach
   * 
   * This method checks ALL addresses associated with the user against ALL rules for the server.
   * If ANY address passes ANY rule, the user is considered verified for that rule.
   * 
   * @param userId - Discord user ID
   * @param serverId - Discord server ID 
   * @returns Promise<BulkVerificationResult> with results using multi-wallet verification
   */
  async verifyUserForServerMultiWallet(
    userId: string,
    serverId: string
  ): Promise<BulkVerificationResult> {
    return await this.verificationEngine.verifyUserForServerMultiWallet(userId, serverId);
  }

  /**
   * Verify a user's assets against a specific verification rule
   * @deprecated Use verifyUser() instead for better performance and unified result format
   */
  async verifyUserAgainstRule(
    address: string,
    rule: VerifierRole
  ): Promise<{ isValid: boolean; matchingAssetCount?: AssetCount }> {
    Logger.warn('verifyUserAgainstRule is deprecated. Use verifyUser() instead.');
    
    const result = await this.verificationEngine.verifyUser('unknown', rule.id, address);
    return {
      isValid: result.isValid,
      matchingAssetCount: result.matchingAssetCount
    };
  }

  /**
   * Verify a user against multiple rules
   * @deprecated Use verifyUserBulk() instead for better performance and unified result format
   */
  async verifyUserAgainstRules(
    address: string,
    rules: VerifierRole[]
  ): Promise<{ validRules: VerifierRole[]; invalidRules: VerifierRole[]; matchingAssetCounts: Map<string, AssetCount> }> {
    Logger.warn('verifyUserAgainstRules is deprecated. Use verifyUserBulk() instead.');
    
    const ruleIds = rules.map(rule => rule.id);
    const result = await this.verificationEngine.verifyUserBulk('unknown', ruleIds, address);
    
    return {
      validRules: result.validRules,
      invalidRules: result.invalidRules,
      matchingAssetCounts: result.matchingAssetCounts
    };
  }

  /**
   * Verify wallet using the VerificationEngine with address extraction from payload
   * 
   * @param data - Decoded verification data containing wallet address and other info
   * @returns Promise<BulkVerificationResult> with verification results for all server rules
   */
  async verifyWallet(data: DecodedData): Promise<BulkVerificationResult> {
    try {
      // Log verification start only in development
      if (process.env.NODE_ENV === 'development') {
        Logger.debug(`VerificationService: Starting wallet verification for user ${data.userId}`);
      }
      
      const address = data.address;
      if (!address) {
        throw new Error('No wallet address provided in verification data');
      }

      // Verify against all server rules using the server ID from discordId
      const serverId = data.discordId;
      if (!serverId) {
        throw new Error('No server ID provided in verification data');
      }

      return await this.verificationEngine.verifyUserForServer(data.userId, serverId, address);
    } catch (error) {
      Logger.error('VerificationService: Error in wallet verification:', error);
      throw error;
    }
  }

  /**
   * Get all rules for a server
   */
  async getAllRulesForServer(serverId: string): Promise<VerifierRole[]> {
    return await this.dbSvc.getRoleMappings(serverId);
  }

  /**
   * Get rules for a specific channel
   */
  async getRulesForChannel(serverId: string, channelId: string): Promise<VerifierRole[]> {
    return await this.dbSvc.getRulesByChannel(serverId, channelId);
  }

  /**
   * Get rules by message ID (deprecated - now uses channel-based lookup)
   * @deprecated Use getRulesForChannel instead
   */
  async getRulesByMessageId(serverId: string, channelId: string, messageId: string): Promise<VerifierRole[]> {
    // Simplified: just return all rules for the channel instead of message-specific rules
    return await this.dbSvc.getRulesByChannel(serverId, channelId);
  }

  /**
   * Assign role to user based on verification result
   */
  async assignRoleToUser(
    userId: string,
    serverId: string,
    roleId: string,
    address: string,
    ruleId?: string,
    metadata?: any
  ): Promise<void> {
    // Use the unified tracking method for consistency
    await this.dbSvc.trackRoleAssignment({
      userId,
      serverId,
      roleId,
      ruleId: ruleId || null, // Use null instead of 'unknown' for bigint field
      userName: metadata?.userName,
      serverName: metadata?.serverName,
      roleName: metadata?.roleName,
      expiresInHours: undefined // No expiration by default
    });

    // Log role assignment only in development
    if (process.env.NODE_ENV === 'development') {
      Logger.debug(`Role ${roleId} assigned to user ${userId} in server ${serverId} via unified tracking`);
    }
  }

  /**
   * Get user's current role assignments for a server
   */
  async getUserRoleAssignments(userId: string, serverId: string): Promise<any[]> {
    return await this.dbSvc.getUserRoleHistory(userId, serverId);
  }

  /**
   * Revoke a role assignment
   */
  async revokeRoleAssignment(assignmentId: string): Promise<void> {
    await this.dbSvc.updateRoleVerification(assignmentId, false);
  }

  /**
   * Get active role assignments that need re-verification
   */
  async getActiveRoleAssignments(): Promise<any[]> {
    return await this.dbSvc.getActiveRoleAssignments();
  }

  /**
   * Re-verify a specific role assignment
   */
  async reverifyRoleAssignment(assignment: any): Promise<{ stillValid: boolean; updatedAssignment?: any }> {
    try {
      const result = await this.verificationEngine.evaluateRole(assignment.user_id, assignment.server_id, assignment.role_id);
      await this.dbSvc.saveRoleCheckDetails(assignment.id, {
        ...(assignment.verification_data || {}), last_check_status: result.status,
        matched_rule_ids: result.results.filter(check => check.isValid).map(check => check.ruleId),
        rule_checks: result.results,
      });
      if (result.status === 'unavailable') return { stillValid: true };
      const stillValid = result.status === 'passed';
      const updatedAssignment = await this.dbSvc.updateRoleVerification(assignment.id, stillValid);
      return { stillValid, updatedAssignment };
    } catch (error) {
      Logger.error(`Error re-verifying assignment ${assignment.id}:`, error);
      return { stillValid: true };
    }
  }

  /**
   * Check if a rule exists for given criteria
   */
  async ruleExists(serverId: string, channelId: string, roleId: string, slug: string): Promise<boolean> {
    return await this.dbSvc.ruleExists(serverId, channelId, roleId, slug);
  }

  /**
   * Create a new verification rule
   */
  async createRule(ruleData: {
    serverId: string;
    serverName: string;
    channelId: string;
    channelName: string;
    roleId: string;
    roleName: string;
    slug: string;
    attributeKey?: string;
    attributeValue?: string;
    minItems?: number;
  }): Promise<any> {
    return await this.dbSvc.addRoleMapping(
      ruleData.serverId,
      ruleData.serverName,
      ruleData.channelId,
      ruleData.channelName,
      ruleData.slug,
      ruleData.roleId,
      ruleData.roleName,
      ruleData.attributeKey,
      ruleData.attributeValue,
      ruleData.minItems
    );
  }

  /**
   * Delete a verification rule
   */
  async deleteRule(ruleId: string, serverId: string): Promise<void> {
    return await this.dbSvc.deleteRoleMapping(ruleId, serverId);
  }

  /**
   * Find rule with message for a channel
   */
  async findRuleWithMessage(serverId: string, channelId: string): Promise<VerifierRole | null> {
    return await this.dbSvc.findRuleWithMessage(serverId, channelId);
  }

  /**
   * Update rule message ID
   */
  async updateRuleMessageId(ruleId: number, messageId: string): Promise<void> {
    return await this.dbSvc.updateRuleMessageId(ruleId, messageId);
  }

  /**
   * Check for duplicate rules
   */
  async checkForDuplicateRule(
    serverId: string,
    channelId: string,
    slug: string,
    attributeKey: string,
    attributeValue: string,
    minItems: number,
    excludeRoleId?: string
  ): Promise<any> {
    return await this.dbSvc.checkForDuplicateRule(
      serverId,
      channelId,
      slug,
      attributeKey,
      attributeValue,
      minItems,
      excludeRoleId
    );
  }
}
