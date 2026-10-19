import { ruleTraits, singleTrait } from '@/utils/trait-filter.util';
import { tokenMinimum, tokenAmount, tokenRuleScope } from '@/utils/erc20-rule.util';
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { AssetOwnershipService, collectibleDomain } from './asset-ownership.service';
import { NftCheckContext } from './nft-ownership.service';
import { nftRuleLabel, serializeAssetCount } from '@/utils/nft-rule.util';
import { ordinalRuleScope } from '@/utils/ordinal-rule.util';
import { inscriptionRuleScope } from '@/utils/inscription-rule.util';
import { UserAddressService } from './user-address.service';
import { AssetCount, VerifierRole } from '@/models/verifier-role.interface';
import { OrdinalCheckDetails } from '@/models/ordinal-collection.interface';
import { WalletBlockService } from './wallet-block.service';

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
    private readonly walletBlocks: WalletBlockService,
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
    const run: NftCheckContext = context || { checks: new Map() };
    let checkedRule: VerifierRole | undefined;
    let checkedAddresses: string[] = [];
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
      checkedRule = rule;

      // Get ALL wallet addresses for this user (for wallet stacking)
      const userAddresses = await this.addressesForRun(userId, run);
      
      // Ensure the current address is included in the list (handles race condition)
      // If the user just verified with this address, it might not be in DB yet
      const addressesToCheck = userAddresses.includes(address.toLowerCase()) 
        ? userAddresses 
        : [...userAddresses, address.toLowerCase()];
      const allowedAddresses = await this.walletBlocks.allowedAddresses(rule.server_id, addressesToCheck, run);
      checkedAddresses = allowedAddresses;
      const blockedWallets = addressesToCheck.filter(address => !allowedAddresses.includes(address.toLowerCase()));
      
      if (addressesToCheck.length !== userAddresses.length) {
        Logger.warn(`Address ${address} not found in getUserAddresses for user ${userId}, adding it manually to prevent race condition`);
      }
      
      Logger.debug(`VerificationEngine: Checking ${addressesToCheck.length} wallet(s) for user ${userId}: ${addressesToCheck.join(', ')}`);

      // Apply verification logic - now checks across ALL user's wallets
      Logger.debug(`VerificationEngine: Verifying rule ${ruleId} for user ${userId}`);
      
      const count = allowedAddresses.length ? await this.ownershipSvc.count(rule, allowedAddresses, run) : 0n;
      const assetCount = rule.asset_type === 'erc20' ? tokenAmount(rule, count) : serializeAssetCount(count);

      const requiredCount = rule.asset_type === 'erc20' ? tokenMinimum(rule) : BigInt(rule.min_items || 1);
      const isValid = count >= requiredCount;
      const requiredDisplay = rule.asset_type === 'erc20' ? tokenAmount(rule, requiredCount) : Number(requiredCount);
      
      Logger.debug(`VerificationEngine: Verification ${isValid ? 'PASSED' : 'FAILED'} - found ${assetCount} assets across ${addressesToCheck.length} wallet(s), needed ${requiredDisplay}`);
      
      // Rule snapshots and selections belong on verifier_rules, not member check JSON.
      const { ordinal_trait_snapshot, inscription_criteria, ...resultRule } = rule;
      return {
        isValid,
        status: isValid ? 'passed' : 'failed',
        userId,
        ruleId,
        address,
        rule: resultRule,
        ownershipDetails: this.ownershipSvc.checkDetails?.(rule, allowedAddresses, run),
        matchingAssetCount: assetCount,
        verificationDetails: {
          collection: rule.asset_type === 'erc20' ? tokenRuleScope(rule) : rule.inscription_criteria ? inscriptionRuleScope(rule) : rule.asset_type === 'ordinal' ? ordinalRuleScope(rule) : rule.asset_type === 'nft' ? nftRuleLabel(rule) : rule.slug || 'ALL',
          attributeKey: singleTrait(rule).key,
          attributeValue: singleTrait(rule).value,
          ...((ruleTraits(rule)?.conditions.length || 0) > 1 ? {traitFilter: ruleTraits(rule)} : {}),
          minItems: requiredDisplay,
          foundAssets: assetCount,
          ...(blockedWallets.length ? { blockedWallets } : {}),
        }
      };

    } catch (error) {
      Logger.error(`VerificationEngine: Error verifying user ${userId} with rule ${ruleId}:`, error);
      let ownershipDetails: OrdinalCheckDetails | undefined;
      try {
        if (checkedRule) ownershipDetails = this.ownershipSvc.checkDetails?.(checkedRule, checkedAddresses, run);
      } catch { /* Invalid configuration must still return an unavailable check. */ }
      return {
        isValid: false,
        status: 'unavailable',
        rule: checkedRule ? (({ ordinal_trait_snapshot, inscription_criteria, ...rule }) => rule)(checkedRule) : undefined,
        ownershipDetails,
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
    loadedRules?: VerifierRole[],
    sharedContext?: NftCheckContext
  ): Promise<BulkVerificationResult> {
    Logger.debug(`VerificationEngine: Starting bulk verification for user ${userId} with ${ruleIds.length} rules`);
    
    // Process all verifications in parallel for better performance
    const context: NftCheckContext = sharedContext || { checks: new Map() };
    const ruleEntries = await Promise.all(ruleIds.map(async id => [id.toString(), loadedRules
      ? loadedRules.find(rule => rule.id.toString() === id.toString())
      : await this.getRuleById(id)] as const));
    const ruleMap = new Map(ruleEntries);
    const rules = ruleEntries.map(([, rule]) => rule).filter(Boolean);
    // Scheduled contexts span many members. A numeric role for one member must
    // not force every later member onto a numbered (potentially paid) lookup.
    if (context.ordinalMode !== 'scheduled'
      && rules.some(rule => rule.asset_type === 'ordinal' && rule.inscription_criteria?.kind === 'numbers')) context.ordinalNeedsNumbers = true;
    const timings = new Map<string, { startedAt: number; endedAt: number; rules: number }>();
    const verificationPromises = ruleIds.map(ruleId => {
      const rule = ruleMap.get(ruleId.toString());
      const type = rule?.asset_type || 'ethscription';
      if (!timings.has(type)) timings.set(type, { startedAt: Date.now(), endedAt: 0, rules: 0 });
      const timing = timings.get(type);
      timing.rules++;
      return this.verifyUser(userId, ruleId, address, context, rule).finally(() => { timing.endedAt = Date.now(); });
    });
    
    const results = await Promise.all(verificationPromises);
    if (context.ordinalMode !== 'scheduled') {
      for (const [type, timing] of timings) {
        Logger.log(`Verification ownership: user=${userId}; asset=${type}; ${timing.endedAt - timing.startedAt}ms; rules=${timing.rules}`);
      }
    }
    await this.combineCounts(userId, address, results, context, rules);
    
    const validRules: VerifierRole[] = [];
    const invalidRules: VerifierRole[] = [];
    const matchingAssetCounts = new Map<string, AssetCount>();

    results.forEach(result => {
      if (result.isValid && result.rule) {
        validRules.push(result.rule);
        if (result.combinedAssetCount || result.matchingAssetCount) {
          matchingAssetCounts.set(result.ruleId.toString(), result.combinedAssetCount ?? result.matchingAssetCount);
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

  private async combineCounts(userId: string, address: string, results: VerificationResult[], context: NftCheckContext, rules: VerifierRole[]): Promise<void> {
    const groups = new Map<string, VerificationResult[]>();
    for (const result of results) {
      const rule = result.rule;
      if (!rule || rule.asset_type === 'erc20') continue;
      const key = JSON.stringify([rule.server_id, rule.role_id, rule.min_items || 1]);
      groups.set(key, [...(groups.get(key) || []), result]);
    }
    for (const group of groups.values()) {
      if (group.length < 2 || group.some(result => result.isValid)) continue;
      const domains = new Map<string, VerificationResult[]>();
      for (const result of group) {
        const domain = collectibleDomain(result.rule);
        domains.set(domain, [...(domains.get(domain) || []), result]);
      }
      let total = 0n;
      let unavailable = false;
      for (const checks of domains.values()) {
        if (checks.length === 1) {
          const check = checks[0];
          if (check.status === 'unavailable' || check.error || check.ownershipDetails?.source === 'collection-upper-bound') unavailable = true;
          else total += BigInt(check.matchingAssetCount || 0);
          continue;
        }
        const owned = new Map<string, bigint>();
        const addresses = [...await this.addressesForRun(userId, context)];
        if (!addresses.includes(address.toLowerCase())) addresses.push(address.toLowerCase());
        for (const check of checks) {
          try {
            const allowed = await this.walletBlocks.allowedAddresses(check.rule.server_id, addresses, context);
            const assets = await this.ownershipSvc.matchingAssets(rules.find(rule => rule.id.toString() === check.ruleId.toString()) || check.rule, allowed, context);
            for (const [id, copies] of assets) {
              // ERC-1155 copies count, but overlapping rules must not add the same copies twice.
              if (copies > (owned.get(id) || 0n)) owned.set(id, copies);
            }
          } catch { unavailable = true; }
        }
        for (const count of owned.values()) total += count;
      }
      const passed = total >= BigInt(group[0].rule.min_items || 1);
      for (const result of group) {
        result.isValid = passed;
        result.status = passed ? 'passed' : unavailable ? 'unavailable' : 'failed';
        result.combinedAssetCount = serializeAssetCount(total);
        result.combinedRuleIds = group.map(check => check.ruleId);
        if (passed) delete result.error;
        else if (unavailable) result.error = 'Combined ownership check is temporarily unavailable.';
      }
    }
  }

  private addressesForRun(userId: string, context: NftCheckContext): Promise<string[]> {
    const reads = context.userAddresses ||= new Map();
    if (!reads.has(userId)) reads.set(userId, this.userAddressService.getUserAddresses(userId));
    return reads.get(userId);
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
        if (result.combinedAssetCount || result.matchingAssetCount) {
          matchingAssetCounts.set(result.ruleId.toString(), result.combinedAssetCount ?? result.matchingAssetCount);
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
  async evaluateRole(userId: string, serverId: string, roleId: string, context?: NftCheckContext): Promise<{ status: 'passed' | 'failed' | 'unavailable'; results: VerificationResult[] }> {
    const rules = (await this.dbSvc.getRoleMappings(serverId)).filter(rule => rule.role_id === roleId);
    return this.evaluateRoleRules(userId, rules, context);
  }

  /** Role moves grant through the changed channel/count group, not unrelated paths. */
  async evaluateRuleGroup(userId: string, rule: VerifierRole, context?: NftCheckContext): Promise<{ status: 'passed' | 'failed' | 'unavailable'; results: VerificationResult[] }> {
    const rules = rule.asset_type === 'erc20' ? [rule] : (await this.dbSvc.getRoleMappings(rule.server_id)).filter(candidate =>
      candidate.role_id === rule.role_id && candidate.channel_id === rule.channel_id && candidate.asset_type !== 'erc20'
      && (candidate.min_items || 1) === (rule.min_items || 1));
    return this.evaluateRoleRules(userId, rules, context);
  }

  private async evaluateRoleRules(userId: string, rules: VerifierRole[], context?: NftCheckContext): Promise<{ status: 'passed' | 'failed' | 'unavailable'; results: VerificationResult[] }> {
    if (!rules.length) return { status: 'failed', results: [] };
    const addresses = context ? await this.addressesForRun(userId, context) : await this.userAddressService.getUserAddresses(userId);
    const proven = context?.provenAddresses?.get(userId);
    if (!addresses.length && !proven) return { status: 'failed', results: [] };
    const checked = await this.verifyUserBulk(userId, rules.map(rule => rule.id), proven || addresses[0], rules, context);
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
  ownershipDetails?: OrdinalCheckDetails;
  isValid: boolean;
  status?: 'passed' | 'failed' | 'unavailable';
  userId: string;
  ruleId: string | number;
  address: string;
  rule?: VerifierRole;
  matchingAssetCount?: AssetCount;
  combinedAssetCount?: AssetCount;
  combinedRuleIds?: (string | number)[];
  error?: string;
  verificationDetails?: {
    collection: string;
    attributeKey: string;
    attributeValue: string;
    traitFilter?: ReturnType<typeof ruleTraits>;
    minItems: AssetCount;
    foundAssets: AssetCount;
    blockedWallets?: string[];
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
