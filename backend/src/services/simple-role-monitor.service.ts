import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { DiscordVerificationService } from './discord-verification.service';
import { VerificationEngine } from './verification-engine.service';
import { UserAddressService } from './user-address.service';

/**
 * SimpleRoleMonitorService
 * 
 * A lightweight approach to dynamic role management that integrates with existing systems.
 * Provides manual re-verification capabilities and basic monitoring without complex scheduling.
 * 
 * Key Features:
 * - **Manual Re-verification**: Triggered via Discord commands or admin interfaces
 * - **Lightweight Design**: No automatic scheduling, runs on-demand
 * - **Existing System Integration**: Works with current verification infrastructure
 * - **Role Cleanup**: Removes roles when holdings no longer meet criteria
 * - **Detailed Reporting**: Provides comprehensive results for verification actions
 * 
 * Use Cases:
 * - Admin-triggered re-verification campaigns
 * - User-requested role updates
 * - Periodic manual audits of role assignments
 * - Testing verification rules before automating
 * 
 * @example
 * ```typescript
 * // Manual re-verification
 * const result = await service.reverifyUser('123456789', 'server_abc');
 * console.log(`Verified: ${result.verified.length}, Revoked: ${result.revoked.length}`);
 * 
 * // Server-wide role audit
 * const serverResult = await service.reverifyServer('server_abc');
 * ```
 */
@Injectable()
export class SimpleRoleMonitorService {
  constructor(
    private readonly dbSvc: DbService,
    private readonly discordVerificationSvc: DiscordVerificationService,
    private readonly verificationEngine: VerificationEngine,
    private readonly userAddressService: UserAddressService,
  ) {}

  /**
   * Manual re-verification for a specific user across all applicable rules
   * 
   * Performs comprehensive verification of a user's current holdings against
   * all verification rules for a specific Discord server. This method:
   * 
   * 1. Retrieves user's current role assignments and verification history
   * 2. Gets all active verification rules for the server
   * 3. Looks up user's current wallet address from verification records
   * 4. Verifies holdings against each rule's requirements
   * 5. Updates role assignments based on current holdings
   * 6. Provides detailed report of actions taken
   * 
   * @param userId - Discord user ID to re-verify
   * @param serverId - Discord server ID containing the rules
   * @returns Promise<ReverificationResult> - Detailed results of the re-verification process
   * 
   * @example
   * ```typescript
   * const result = await service.reverifyUser('123456789', 'server_abc123');
   * 
   * // Process results
   * if (result.verified.length > 0) {
   *   console.log(`Granted roles: ${result.verified.join(', ')}`);
   * }
   * if (result.revoked.length > 0) {
   *   console.log(`Removed roles: ${result.revoked.join(', ')}`);
   * }
   * if (result.errors.length > 0) {
   *   console.warn(`Errors occurred: ${result.errors.join(', ')}`);
   * }
   * ```
   */
  async reverifyUser(userId: string, serverId: string): Promise<{
    verified: string[],
    revoked: string[],
    errors: string[]
  }> {
    Logger.log(`🔍 Re-verifying user ${userId} in server ${serverId}`);
    
    const result = {
      verified: [] as string[],
      revoked: [] as string[],
      errors: [] as string[]
    };

    try {
      // Get user's current role assignments and rules in parallel for better performance
      const [userRoles, rules] = await Promise.all([
        this.dbSvc.getUserRoleHistory(userId, serverId),
        this.dbSvc.getRoleMappings(serverId)
      ]);
      
      // Get ALL user's verified addresses for wallet stacking
      const userAddresses = await this.userAddressService.getUserAddresses(userId);
      if (userAddresses.length === 0) {
        result.errors.push('No addresses found for user');
        return result;
      }
      
      Logger.log(`🔍 Re-verifying ${userAddresses.length} wallet(s) for user ${userId}`);

      // Evaluate each Discord role once, with OR semantics across its rules.
      const checked = await this.verificationEngine.verifyUserBulk(userId, rules.map(rule => rule.id), userAddresses[0], rules);
      const roleIds = [...new Set([...rules.map(rule => rule.role_id), ...userRoles.filter(role => role.status === 'active').map(role => role.role_id)])];
      for (const roleId of roleIds) {
        try {
          const checks = checked.results.filter(check => check.rule?.role_id === roleId || rules.some(rule => rule.role_id === roleId && rule.id === check.ruleId));
          const passing = checks.find(check => check.isValid);
          const unavailable = checks.some(check => check.status === 'unavailable' || check.error);
          const checkDetails = {
            last_check_status: passing ? 'passed' : unavailable ? 'unavailable' : 'failed',
            matched_rule_ids: checks.filter(check => check.isValid).map(check => check.ruleId),
            rule_checks: checks,
          };
          const assignments = userRoles.filter(role => role.role_id === roleId && role.status === 'active');
          for (const assignment of assignments) {
            await this.dbSvc.saveRoleCheckDetails(assignment.id, {
              ...(assignment.verification_data || {}),
              ...checkDetails,
            });
          }
          if (!passing && unavailable) {
            result.errors.push(`Role ${roleId}: ownership check unavailable; retained existing role`);
            continue;
          }
          const hasRole = await this.checkUserHasRole(userId, serverId, roleId);
          const roleName = rules.find(rule => rule.role_id === roleId)?.role_name || roleId;
          if (passing) {
            if (!hasRole) await this.grantRole(userId, serverId, passing.rule, userAddresses[0], checkDetails);
            for (const assignment of assignments) await this.dbSvc.updateLastVerified(assignment.id);
            result.verified.push(roleName);
          } else if (hasRole) {
            await this.revokeRole(userId, serverId, roleId);
            result.revoked.push(roleName);
          }
        } catch (error) {
          result.errors.push(`Role ${roleId}: ${error.message}`);
        }
      }

      Logger.log(`Re-verification complete for user ${userId}: ${result.verified.length} verified, ${result.revoked.length} revoked, ${result.errors.length} errors`);
      return result;
      
    } catch (error) {
      Logger.error('Failed to re-verify user:', error);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Re-verify all users for a specific server (admin function)
   */
  async reverifyServer(serverId: string): Promise<{
    usersProcessed: number,
    totalVerified: number,
    totalRevoked: number,
    errors: string[]
  }> {
    Logger.log(`🔍 Re-verifying entire server ${serverId}`);
    
    const result = {
      usersProcessed: 0,
      totalVerified: 0,
      totalRevoked: 0,
      errors: [] as string[]
    };

    try {
      // Get all unique users who have had roles in this server
      const uniqueUsers = await this.getServerUniqueUsers(serverId);
      
      for (const userId of uniqueUsers) {
        result.usersProcessed++;
        try {
          const userResult = await this.reverifyUser(userId, serverId);
          result.totalVerified += userResult.verified.length;
          result.totalRevoked += userResult.revoked.length;
          result.errors.push(...userResult.errors);
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          Logger.error(`Error re-verifying user ${userId}:`, error.message);
          result.errors.push(`User ${userId}: ${error.message}`);
        }
      }

      Logger.log(`Server re-verification complete: ${result.usersProcessed} users processed`);
      return result;
      
    } catch (error) {
      Logger.error('Failed to re-verify server:', error);
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Get user's most recent verified address from user_wallets table
   */
  private async getUserLatestAddress(userId: string): Promise<string | null> {
    // Get all addresses for the user, they're returned in order of last_verified_at DESC
    const addresses = await this.userAddressService.getUserAddresses(userId);
    return addresses.length > 0 ? addresses[0] : null;
  }

  /**
   * Check if user currently has a specific role in Discord
   */
  private async checkUserHasRole(userId: string, serverId: string, roleId: string): Promise<boolean> {
    try {
      // You might need to add this method to DiscordVerificationService
      const member = await this.discordVerificationSvc.getGuildMember(serverId, userId);
      return member?.roles?.cache?.has(roleId) || false;
    } catch (error) {
      Logger.warn(`Could not check role for user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Grant a role to a user
   */
  private async grantRole(userId: string, serverId: string, rule: any, address: string, verificationData?: any): Promise<void> {
    try {
      const roleResult = await this.discordVerificationSvc.addUserRole(userId, rule.role_id, serverId, 'reverification', rule.id.toString(), verificationData);
      
      if (roleResult.wasAlreadyAssigned) {
        Logger.log(`✅ User ${userId} already had role ${rule.role_name || rule.role_id} (reverification)`);
      } else {
        Logger.log(`✅ Granted role ${rule.role_name || rule.role_id} to user ${userId} (reverification)`);
      }
    } catch (error) {
      Logger.error(`Failed to grant role ${rule.role_id} to user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Revoke a role from a user
   */
  private async revokeRole(userId: string, serverId: string, roleId: string): Promise<void> {
    try {
      // You'll need to add this method to DiscordVerificationService
      await this.discordVerificationSvc.removeUserRole(userId, serverId, roleId);
      Logger.log(`🚫 Revoked role ${roleId} from user ${userId}`);
    } catch (error) {
      Logger.error(`Failed to revoke role ${roleId} from user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all unique users who have had roles in a server
   */
  private async getServerUniqueUsers(serverId: string): Promise<string[]> {
    // You'll need to add this method to DbService
    return this.dbSvc.getServerUniqueUsers(serverId);
  }
}
