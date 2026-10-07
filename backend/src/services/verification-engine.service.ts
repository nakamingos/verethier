import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { AssetOwnershipService } from './asset-ownership.service';
import { NftCheckContext } from './nft-ownership.service';
import { nftRuleLabel, serializeAssetCount } from '@/utils/nft-rule.util';
import { UserAddressService } from './user-address.service';
import { AssetCount, VerifierRole } from '@/models/verifier-role.interface';

/**
 * VerificationEngine - Verification logic processor
 * 
 * This class handles all verification logic for checking user asset ownership
 * against verification rules.
 * 
 * Key Features:
 * - **Single Entry Point**: `verifyUser()` handles all verification
 * - **Unified Results**: Consistent result format for all verifications
 * - **Performance Optimized**: Efficient database queries
 * - **Comprehensive Logging**: Detailed verification flow tracking
 * - **Error Resilience**: Graceful handling of failure scenarios
 * 
 * @example
 * ```typescript
 * const result = await verificationEngine.verifyUser(
 *   'discord_user_123',
 *   'rule_456', 
 *   '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
 * );
 * 
 * if (result.isValid) {
 *   console.log(`User verified with ${result.matchingAssetCount} matching assets`);
 * }
 * ```
 */
@Injectable()
export class VerificationEngine {
  constructor(
    private readonly dbSvc: DbService,
    private readonly ownershipSvc: AssetOwnershipService,
    private readonly userAddressService: UserAddressService,
  ) {}

  /**
   * Main verification method - entry point for all verification
   * 
   * Verifies a user's asset ownership against a verification rule.
   * Now supports wallet stacking - aggregates holdings across ALL user's verified wallets.
   * 
   * Process Flow:
   * 1. Fetch and validate the rule exists
   * 2. Get ALL user's verified wallet addresses
   * 3. Query asset holdings across all wallets from marketplace
   * 4. Sum holdings and match against rule criteria
   * 5. Return detailed verification result
   * 
   * @param userId - Discord user ID requesting verification
   * @param ruleId - Rule ID to verify against (supports both string and number)
   * @param address - Ethereum wallet address to verify asset ownership for (also retrieves other user wallets)
   * @returns Promise<VerificationResult> - Comprehensive verification outcome
   */
  async verifyUser(
    userId: string, 
    ruleId: string | number, 
    address: string,
    context?: NftCheckContext,
    loadedRule?: VerifierRole
  ): Promise<VerificationResult> {
    try {
      Logger.debug(`VerificationEngine: Starting verification for user ${userId} with rule ${ruleId} and address ${address}`);
      
      // Fetch the rule details
      const rule = loadedRule || await this.getRuleById(ruleId);
      if (!rule) {
        return {
          isValid: false,
          error: `Rule ${ruleId} not found`,
          userId,
          ruleId,
          address
        };
      }

      // Get ALL wallet addresses for this user (for wallet stacking)
      const userAddresses = await this.userAddressService.getUserAddresses(userId);
      
      // Ensure the current address is included in the list (handles race condition)
      // If the user just verified with this address, it might not be in DB yet
      const addressesToCheck = userAddresses.includes(address.toLowerCase()) 
        ? userAddresses 
        : [...userAddresses, address.toLowerCase()];
      
      if (addressesToCheck.length !== userAddresses.length) {
        Logger.warn(`Address ${address} not found in getUserAddresses for user ${userId}, adding it manually to prevent race condition`);
      }
      
      Logger.debug(`VerificationEngine: Checking ${addressesToCheck.length} wallet(s) for user ${userId}: ${addressesToCheck.join(', ')}`);

      // Apply verification logic - now checks across ALL user's wallets
      Logger.debug(`VerificationEngine: Verifying rule ${ruleId} for user ${userId}`);
      
      const count = await this.ownershipSvc.count(rule, addressesToCheck, context);
      const assetCount = serializeAssetCount(count);

      const requiredCount = rule.min_items || 1;
      const isValid = count >= BigInt(requiredCount);
      
      Logger.debug(`VerificationEngine: Verification ${isValid ? 'PASSED' : 'FAILED'} - found ${assetCount} assets across ${addressesToCheck.length} wallet(s), needed ${requiredCount}`);
      
      return {
        isValid,
        status: isValid ? 'passed' : 'failed',
        userId,
        ruleId,
        address,
        rule,
        matchingAssetCount: assetCount,
        verificationDetails: {
          collection: rule.asset_type === 'nft' ? nftRuleLabel(rule) : rule.slug || 'ALL',
          attributeKey: rule.attribute_key || 'ALL',
          attributeValue: rule.attribute_value || 'ALL',
          minItems: requiredCount,
          foundAssets: assetCount
        }
      };

    } catch (error) {
      Logger.error(`VerificationEngine: Error verifying user ${userId} with rule ${ruleId}:`, error);
      return {
        isValid: false,
        status: 'unavailable',
        error: error.message || 'Unknown verification error',
        userId,
        ruleId,
        address
      };
    }
  }

  /**
   * Verify multiple rules for a user (bulk verification)
   * Optimized with parallel processing for better performance
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
    loadedRules?: VerifierRole[]
  ): Promise<BulkVerificationResult> {
    Logger.debug(`VerificationEngine: Starting bulk verification for user ${userId} with ${ruleIds.length} rules`);
    
    // Process all verifications in parallel for better performance
    const context: NftCheckContext = { checks: new Map() };
    const verificationPromises = ruleIds.map(ruleId =>
      this.verifyUser(userId, ruleId, address, context, loadedRules?.find(rule => rule.id.toString() === ruleId.toString()))
    );
    
    const results = await Promise.all(verificationPromises);
    
    const validRules: VerifierRole[] = [];
    const invalidRules: VerifierRole[] = [];
    const matchingAssetCounts = new Map<string, AssetCount>();

    results.forEach(result => {
      if (result.isValid && result.rule) {
        validRules.push(result.rule);
        if (result.matchingAssetCount) {
          matchingAssetCounts.set(result.ruleId.toString(), result.matchingAssetCount);
        }
      } else if (result.rule && result.status !== 'unavailable') {
        invalidRules.push(result.rule);
      }
    });

    return {
      userId,
      address,
      totalRules: ruleIds.length,
      validRules,
      invalidRules,
      matchingAssetCounts,
      results
    };
  }

  /**
   * Verify user against all rules for a specific server
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
    Logger.debug(`VerificationEngine: Starting server-wide verification for user ${userId} in server ${serverId}`);
    
    const rules = await this.dbSvc.getRoleMappings(serverId);
    const ruleIds = rules.map(rule => rule.id);
    
    return await this.verifyUserBulk(userId, ruleIds, address);
  }

  /**
   * Multi-Wallet Verification - Check user against rule using ALL user addresses
   * 
   * This is the key feature of the multi-wallet system. Instead of checking just one address,
   * it retrieves all addresses associated with the user and verifies against each one.
   * If ANY address passes the verification, the user is considered verified.
   * 
   * @param userId - Discord user ID
   * @param ruleId - Rule ID to verify against
   * @returns Promise<VerificationResult> - Result showing if any address passed
   */
  async verifyUserMultiWallet(
    userId: string, 
    ruleId: string | number
  ): Promise<VerificationResult> {
    try {
      Logger.debug(`VerificationEngine: Starting multi-wallet verification for user ${userId} with rule ${ruleId}`);
      
      // Get all addresses for this user
      const userAddresses = await this.userAddressService.getUserAddresses(userId);
      
      if (userAddresses.length === 0) {
        Logger.debug(`VerificationEngine: No addresses found for user ${userId}`);
        return {
          isValid: false,
          error: 'No verified addresses found for user',
          userId,
          ruleId,
          address: 'none',
          matchingAssetCount: 0
        };
      }

      Logger.debug(`VerificationEngine: Found ${userAddresses.length} addresses for user ${userId}: ${userAddresses.join(', ')}`);

      const result = await this.verifyUser(userId, ruleId, userAddresses[0]);
      return { ...result, verifiedAddress: result.isValid ? userAddresses[0] : undefined, totalAddressesChecked: userAddresses.length };

    } catch (error) {
      Logger.error(`VerificationEngine: Error in multi-wallet verification for user ${userId}:`, error);
      return {
        isValid: false,
        error: error.message || 'Multi-wallet verification error',
        userId,
        ruleId,
        address: 'error'
      };
    }
  }

  /**
   * Multi-Wallet Server Verification - Check user against ALL server rules using ALL addresses
   * Optimized with parallel processing for better performance
   * 
   * This combines multi-wallet verification with server-wide rule checking.
   * For each rule in the server, it checks all user addresses until one passes.
   * 
   * @param userId - Discord user ID
   * @param serverId - Discord server ID
   * @returns Promise<BulkVerificationResult> - Results for all server rules using all addresses
   */
  async verifyUserForServerMultiWallet(
    userId: string,
    serverId: string
  ): Promise<BulkVerificationResult> {
    Logger.debug(`VerificationEngine: Starting multi-wallet server verification for user ${userId} in server ${serverId}`);
    
    const rules = await this.dbSvc.getRoleMappings(serverId);
    const ruleIds = rules.map(rule => rule.id);
    
    Logger.debug(`VerificationEngine: Checking ${ruleIds.length} rules with multi-wallet verification`);
    
    // Process all multi-wallet verifications in parallel for better performance
    const addresses = await this.userAddressService.getUserAddresses(userId);
    if (addresses.length) return this.verifyUserBulk(userId, ruleIds, addresses[0]);
    const results = await Promise.all(ruleIds.map(ruleId => this.verifyUserMultiWallet(userId, ruleId)));
    
    const validRules: VerifierRole[] = [];
    const invalidRules: VerifierRole[] = [];
    const matchingAssetCounts = new Map<string, AssetCount>();

    results.forEach(result => {
      if (result.isValid && result.rule) {
        validRules.push(result.rule);
        if (result.matchingAssetCount) {
          matchingAssetCounts.set(result.ruleId.toString(), result.matchingAssetCount);
        }
      } else if (result.rule && result.status !== 'unavailable') {
        invalidRules.push(result.rule);
      }
    });

    return {
      userId,
      address: 'multi-wallet', // Indicates multi-wallet verification
      totalRules: ruleIds.length,
      validRules,
      invalidRules,
      matchingAssetCounts,
      results
    };
  }

  /**
   * Fetch rule by ID from database
   * 
   * @param ruleId - Rule ID (string or number)
   * @returns Promise<VerifierRole | null>
   */
  async evaluateRole(userId: string, serverId: string, roleId: string): Promise<{ status: 'passed' | 'failed' | 'unavailable'; results: VerificationResult[] }> {
    const rules = (await this.dbSvc.getRoleMappings(serverId)).filter(rule => rule.role_id === roleId);
    if (!rules.length) return { status: 'failed', results: [] };
    const addresses = await this.userAddressService.getUserAddresses(userId);
    if (!addresses.length) return { status: 'failed', results: [] };
    const checked = await this.verifyUserBulk(userId, rules.map(rule => rule.id), addresses[0], rules);
    return {
      status: checked.results.some(result => result.isValid) ? 'passed'
        : checked.results.some(result => result.status === 'unavailable' || result.error) ? 'unavailable' : 'failed',
      results: checked.results,
    };
  }

  private async getRuleById(ruleId: string | number): Promise<VerifierRole | null> {
    try {
      const ruleIdStr = typeof ruleId === 'number' ? ruleId.toString() : ruleId;
      return await this.dbSvc.getRuleById(ruleIdStr);
    } catch (error) {
      Logger.error(`VerificationEngine: Error fetching rule ${ruleId}:`, error);
      return null;
    }
  }
}

/**
 * VerificationResult - Comprehensive verification outcome
 * 
 * Unified result interface that provides consistent data structure
 * for all verification results.
 * 
 * @interface VerificationResult
 * @property isValid - Whether the verification passed or failed
 * @property userId - Discord user ID that was verified
 * @property ruleId - Rule ID that was applied (string or number)
 * @property address - Ethereum address that was verified
 * @property rule - Full rule object that was applied (optional)
 * @property matchingAssetCount - Number of assets that matched the rule criteria (optional)
 * @property error - Error message if verification failed (optional)
 * @property verificationDetails - Detailed breakdown of verification criteria and results (optional)
 */
export interface VerificationResult {
  isValid: boolean;
  status?: 'passed' | 'failed' | 'unavailable';
  userId: string;
  ruleId: string | number;
  address: string;
  rule?: VerifierRole;
  matchingAssetCount?: AssetCount;
  error?: string;
  verificationDetails?: {
    collection: string;
    attributeKey: string;
    attributeValue: string;
    minItems: number;
    foundAssets: AssetCount;
  };
  // Multi-wallet specific properties
  verifiedAddress?: string; // The specific address that passed verification
  totalAddressesChecked?: number; // Total number of addresses checked
}

/**
 * BulkVerificationResult - Results for verifying multiple rules at once
 * 
 * Provides comprehensive results when verifying a user against multiple
 * verification rules simultaneously. Useful for bulk operations and
 * determining all roles a user should have.
 * 
 * @interface BulkVerificationResult
 * @property userId - Discord user ID that was verified
 * @property address - Ethereum address that was verified
 * @property totalRules - Total number of rules that were checked
 * @property validRules - Array of rules that the user passed verification for
 * @property invalidRules - Array of rules that the user failed verification for
 * @property matchingAssetCounts - Map of rule IDs to number of matching assets
 * @property results - Array of individual VerificationResult objects for each rule
 */
export interface BulkVerificationResult {
  userId: string;
  address: string;
  totalRules: number;
  validRules: VerifierRole[];
  invalidRules: VerifierRole[];
  matchingAssetCounts: Map<string, AssetCount>;
  results: VerificationResult[];
}
