import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from './db.service';
import { VerificationEngine } from './verification-engine.service';
import { DiscordVerificationService, RoleSyncContext } from './discord-verification.service';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftCheckContext } from './nft-ownership.service';

/**
 * DynamicRoleService
 * 
 * Handles continuous monitoring and automatic role management for token-gated Discord servers.
 * Provides both scheduled re-verification and on-demand role sync capabilities.
 * 
 * Key Features:
 * - Scheduled re-verification of previously earned role assignments
 * - Automatic role removal when holdings no longer meet criteria
 * - Configurable verification intervals per rule
 * - Graceful handling of Discord API rate limits
 * - Detailed logging and metrics for monitoring
 */
@Injectable()
export class DynamicRoleService {
  constructor(
    private readonly dbSvc: DbService,
    private readonly verificationEngine: VerificationEngine,
    private readonly discordVerificationSvc: DiscordVerificationService,
  ) {
    Logger.log(`🔄 DynamicRoleService initialized with CRON schedule: ${EnvironmentConfig.DYNAMIC_ROLE_CRON}`);
  }

  /**
   * Main scheduled task - runs based on DYNAMIC_ROLE_CRON environment variable
   * Re-verifies previously earned role assignments
   */
  @Cron(EnvironmentConfig.DYNAMIC_ROLE_CRON)
  async performScheduledReverification() {
    Logger.log('🔄 Starting scheduled role re-verification');
    
    try {
      const earnedAssignments = await this.getEarnedRoleAssignments();
      Logger.log(`Found ${earnedAssignments.length} previously earned role assignments to verify`);
      
      let verifiedCount = 0;
      let revokedCount = 0;
      let errorCount = 0;
      const context: NftCheckContext = { checks: new Map(), ordinalMode: 'scheduled' };
      const discordContext: RoleSyncContext = new Map();

      // Process in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < earnedAssignments.length; i += batchSize) {
        const batch = earnedAssignments.slice(i, i + batchSize);
        
        for (const assignment of batch) {
          // Skip null or undefined assignments
          if (!assignment) {
            Logger.debug('Skipping null or undefined assignment');
            continue;
          }
          
          try {
            const stillQualifies = await this.verifyUserStillQualifies(assignment, context);
            
            if (stillQualifies) {
              await this.restoreRole(assignment, discordContext);
              verifiedCount++;
              Logger.debug(`✅ User ${assignment.user_id} still qualifies for role ${assignment.role_id}`);
            } else {
              await this.revokeRole(assignment, discordContext);
              revokedCount++;
              Logger.log(`🚫 Revoked role ${assignment.role_name || assignment.role_id} from user ${assignment.user_name || assignment.user_id}`);
            }
          } catch (error) {
            Logger.error(`Error verifying assignment ${assignment.id}:`, error.message);
            errorCount++;
          }
        }
        
        // Rate limiting: small delay between batches
        if (i + batchSize < earnedAssignments.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      Logger.log(`🏁 Re-verification complete: ${verifiedCount} verified, ${revokedCount} revoked, ${errorCount} errors`);
      
    } catch (error) {
      Logger.error('Failed to perform scheduled re-verification:', error);
    }
  }

  /**
   * Manual re-verification for a specific user across all servers
   */
  async reverifyUser(userId: string): Promise<{verified: number, revoked: number}> {
    Logger.log(`🔍 Manual re-verification for user ${userId}`);
    
    const userAssignments = await this.getUserEarnedAssignments(userId);
    const { verified, revoked } = await this.reverifyAssignments(userAssignments);
    Logger.log(`Manual re-verification complete for user ${userId}: ${verified} verified, ${revoked} revoked`);
    return { verified, revoked };
  }

  /** Restriction changes only reconcile previously earned roles in the administrator's server. */
  async reverifyUserInServer(userId: string, serverId: string): Promise<{ verified: number; revoked: number; errors: number }> {
    const assignments = await this.dbSvc.getEarnedRoleAssignments({ userId, serverId });
    return this.reverifyAssignments(assignments);
  }

  private async reverifyAssignments(assignments: any[]): Promise<{ verified: number; revoked: number; errors: number }> {
    let verified = 0;
    let revoked = 0;
    let errors = 0;
    const context: NftCheckContext = { checks: new Map() };
    const discordContext: RoleSyncContext = new Map();

    for (const assignment of assignments) {
      try {
        const stillQualifies = await this.verifyUserStillQualifies(assignment, context);
        
        if (stillQualifies) {
          await this.restoreRole(assignment, discordContext);
          verified++;
        } else {
          await this.revokeRole(assignment, discordContext);
          revoked++;
        }
      } catch (error) {
        errors++;
        Logger.error(`Error during manual re-verification:`, error.message);
      }
    }

    return { verified, revoked, errors };
  }

  /**
   * Re-verify all users for a specific rule (when rule criteria changes)
   */
  async reverifyRule(ruleId: string): Promise<void> {
    Logger.log(`🔍 Re-verifying all assignments for rule ${ruleId}`);
    
    const ruleAssignments = await this.getRuleEarnedAssignments(ruleId);
    const context: NftCheckContext = { checks: new Map(), ordinalMode: 'scheduled' };
    const discordContext: RoleSyncContext = new Map();
    
    for (const assignment of ruleAssignments) {
      try {
        const stillQualifies = await this.verifyUserStillQualifies(assignment, context);
        
        if (stillQualifies) {
          await this.restoreRole(assignment, discordContext);
        } else {
          await this.revokeRole(assignment, discordContext);
          Logger.log(`Revoked role from user ${assignment.user_id} due to rule change`);
        }
      } catch (error) {
        Logger.error(`Error re-verifying rule assignment:`, error.message);
      }
    }
  }

  /**
   * Get previously earned role assignments that need verification
   */
  private async getEarnedRoleAssignments(): Promise<any[]> {
    return this.dbSvc.getEarnedRoleAssignments();
  }

  /**
   * Verify if a user still qualifies for their assigned role
   */
  private async verifyUserStillQualifies(assignment: any, context?: NftCheckContext): Promise<boolean> {
    const result = await this.verificationEngine.evaluateRole(assignment.user_id, assignment.server_id, assignment.role_id, context);
    await this.dbSvc.saveRoleCheckDetails(assignment.id, {
      ...(assignment.verification_data || {}),
      last_check_status: result.status,
      matched_rule_ids: result.results.filter(check => check.isValid).map(check => check.ruleId),
      rule_checks: result.results,
    });
    if (result.status === 'unavailable') throw new Error('Ownership check unavailable; retaining existing role.');
    return result.status === 'passed';
  }

  /**
   * Revoke a role from Discord and update database
   */
  private async revokeRole(assignment: any, context: RoleSyncContext): Promise<void> {
    const removed = await this.discordVerificationSvc.removeUserRole(
      assignment.user_id, assignment.server_id, assignment.role_id, context
    );
    if (!removed) throw new Error('Discord role removal failed; assignment retained for retry.');
    if (assignment.status !== 'revoked') {
      await this.dbSvc.updateRoleAssignmentStatus(assignment.id, 'revoked');
    }
    Logger.log(`Successfully revoked role ${assignment.role_id} from user ${assignment.user_id}`);
  }

  private async restoreRole(assignment: any, context: RoleSyncContext): Promise<void> {
    const restored = await this.discordVerificationSvc.addUserRoleDynamic(
      assignment.user_id, assignment.server_id, assignment.role_id, context
    );
    if (!restored) throw new Error('Discord role restoration failed; assignment retained for retry.');
    if (assignment.status !== 'active') {
      await this.dbSvc.updateRoleAssignmentStatus(assignment.id, 'active');
    }
    await this.updateLastVerified(assignment.id);
  }

  /**
   * Update last verified timestamp
   */
  private async updateLastVerified(assignmentId: string): Promise<void> {
    await this.dbSvc.updateLastVerified(assignmentId);
  }

  /**
   * Get previously earned assignments for a specific user
   */
  private async getUserEarnedAssignments(userId: string): Promise<any[]> {
    return this.dbSvc.getEarnedRoleAssignments({ userId });
  }

  /**
   * Get previously earned assignments for a specific rule
   */
  private async getRuleEarnedAssignments(ruleId: string): Promise<any[]> {
    return this.dbSvc.getEarnedRoleAssignments({ ruleId });
  }

  /**
   * Get comprehensive stats about role assignments
   */
  async getRoleAssignmentStats(): Promise<any> {
    return {
      totalActive: await this.dbSvc.countActiveAssignments(),
      totalRevoked: await this.dbSvc.countRevokedAssignments(),
      expiringSoon: await this.dbSvc.countExpiringSoonAssignments(),
      lastReverificationRun: await this.dbSvc.getLastReverificationTime(),
    };
  }


}
