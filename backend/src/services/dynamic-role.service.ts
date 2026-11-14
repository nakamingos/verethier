import { ruleMatchesWalletScope } from '@/utils/check-priority.util';
import { ordnetCompatible } from '@/utils/ordinal-rule.util';
import { ruleRoles } from '@/utils/rule-roles.util';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from './db.service';
import { VerificationEngine } from './verification-engine.service';
import { DiscordVerificationService, RoleSyncContext } from './discord-verification.service';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftCheckContext } from './nft-ownership.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';

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
/** `left` counts members skipped because Discord confirms they left the server. */
type ReconcileCounts = { verified: number; revoked: number; left: number; errors: number };

class OwnershipCheckUnavailableError extends Error {
  constructor() { super('Ownership check unavailable; retaining existing role.'); }
}

@Injectable()
export class DynamicRoleService {
  private scheduledRunning = false;
  constructor(
    private readonly dbSvc: DbService,
    private readonly verificationEngine: VerificationEngine,
    private readonly discordVerificationSvc: DiscordVerificationService,
    @Optional() private readonly ordinalsSvc?: OrdinalsOwnershipService,
  ) {
    Logger.log(`🔄 DynamicRoleService initialized with CRON schedule: ${EnvironmentConfig.DYNAMIC_ROLE_CRON}`);
  }

  /**
   * Main scheduled task - runs based on DYNAMIC_ROLE_CRON environment variable
   * Re-verifies previously earned role assignments
   */
  @Cron(EnvironmentConfig.DYNAMIC_ROLE_CRON)
  async performScheduledReverification() {
    if (this.scheduledRunning) return;
    this.scheduledRunning = true;
    Logger.log('🔄 Starting scheduled role re-verification');
    
    try {
      const disabled = await this.dbSvc.getDisabledBackgroundServers();
      const earnedAssignments = (await this.getEarnedRoleAssignments()).filter(assignment => assignment && !disabled.has(assignment.server_id));
      Logger.log(`Found ${earnedAssignments.length} previously earned role assignments to verify`);
      
      let verifiedCount = 0;
      let revokedCount = 0;
      let leftCount = 0;
      let errorCount = 0;
      const context: NftCheckContext = { checks: new Map(), ordinalMode: 'scheduled' };
      const discordContext: RoleSyncContext = new Map();

      try { await this.ordinalsSvc?.refreshScheduledCatalogs(context); }
      catch { Logger.warn('Scheduled Ordinals catalog refresh unavailable; using existing complete catalogs.'); }

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
            const outcome = await this.reconcileAssignment(assignment, context, discordContext);
            if (outcome === 'verified') {
              verifiedCount++;
              Logger.debug(`✅ User ${assignment.user_id} still qualifies for role ${assignment.role_id}`);
            } else if (outcome === 'revoked') {
              revokedCount++;
              Logger.log(`🚫 Revoked role ${assignment.role_name || assignment.role_id} from user ${assignment.user_name || assignment.user_id}`);
            } else leftCount++;
          } catch (error) {
            if (!(error instanceof OwnershipCheckUnavailableError)) Logger.error(`Error verifying assignment ${assignment.id}:`, error.message);
            errorCount++;
          }
        }
        
        // Rate limiting: small delay between batches
        if (i + batchSize < earnedAssignments.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      await this.verificationEngine.finishWalletChecks?.(context);
      Logger.log(`🏁 Re-verification complete: ${verifiedCount} verified, ${revokedCount} revoked, ${errorCount} errors, ${leftCount} skipped (no longer in server)`);
      
    } catch (error) {
      Logger.error('Failed to perform scheduled re-verification:', error);
    } finally {
      this.scheduledRunning = false;
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
  async reverifyUserInServer(userId: string, serverId: string, context?: NftCheckContext): Promise<ReconcileCounts> {
    let assignments = await this.dbSvc.getEarnedRoleAssignments({ userId, serverId });
    if (context?.verificationCheckFamilies) {
      const rules = await this.dbSvc.getRoleMappings(serverId);
      assignments = assignments.filter(assignment => {
        const definitions = rules.filter(rule => ruleRoles(rule).some(role => role.id === assignment.role_id));
        // An incomplete cross-family check cannot prove this role should be removed.
        return definitions.length > 0 && definitions.every(rule => ruleMatchesWalletScope(rule, context.verificationCheckFamilies));
      });
    }
    return this.reverifyAssignments(assignments, undefined, context);
  }

  /** Role-action edits affect only the prior/new removal targets, never every earned role. */
  async reverifyUserRolesInServer(userId: string, serverId: string, roleIds: string[]): Promise<ReconcileCounts> {
    const roles = new Set(roleIds);
    if (!roles.size) return { verified: 0, revoked: 0, left: 0, errors: 0 };
    const assignments = (await this.dbSvc.getEarnedRoleAssignments({ userId, serverId }))
      .filter(assignment => roles.has(assignment.role_id));
    return this.reverifyAssignments(assignments, 'scheduled');
  }

  async reverifyRoleInServer(serverId: string, roleId: string, context?: NftCheckContext): Promise<ReconcileCounts & { skipped?: string }> {
    if (!await this.automaticRoleAllowed(serverId, roleId, context))
      return { verified: 0, revoked: 0, left: 0, errors: 0, skipped: 'Automatic Ordinals recheck requires ord.net-compatible rules. Run an explicit role check instead.' };
    // An assignment's rule_id is only its representative rule. Recheck every
    // previous holder of this role, including holders who matched another rule.
    const assignments = await this.dbSvc.getEarnedRoleAssignments({ serverId, roleId });
    const result=await this.reverifyAssignments(assignments, 'scheduled', context);
    if(context)await this.verificationEngine.finishWalletChecks?.(context);
    return result;
  }

  /** An explicit admin role change may move earlier qualifiers to a new role. */
  async reverifyRoleChangeInServer(serverId: string, roleId: string, ruleId: string, memberIds: string[], suppliedContext?: NftCheckContext): Promise<ReconcileCounts & { skipped?: string }> {
    if (!await this.automaticRoleAllowed(serverId, roleId, suppliedContext))
      return { verified: 0, revoked: 0, left: 0, errors: 0, skipped: 'Automatic Ordinals recheck requires ord.net-compatible rules. Run an explicit role check instead.' };
    const canonical = await this.dbSvc.getRuleForServer(ruleId, serverId);
    const target = canonical && ruleRoles(canonical).find(r => r.id === roleId);
    const rule = target ? { ...canonical, role_id: target.id, role_name: target.name, additional_roles: [] } : null;
    // A newer edit carries this audience forward in its own durable job.
    if (!rule || rule.role_id !== roleId) return { verified: 0, revoked: 0, left: 0, errors: 0 };
    const rules = await this.dbSvc.getRoleMappings(serverId);
    const context: NftCheckContext = suppliedContext || { checks: new Map(), ordinalMode: 'scheduled',
      ordinalNeedsNumbers: rules.some(candidate => candidate.asset_type === 'ordinal' && candidate.inscription_criteria?.kind === 'numbers' && !candidate.inscription_criteria.collection_slug) };
    const existing = await this.dbSvc.getEarnedRoleAssignments({ serverId, roleId });
    const result = await this.reverifyAssignments(existing, 'scheduled', context);
    const alreadyChecked = new Set(existing.map(assignment => assignment.user_id));
    const discordContext: RoleSyncContext = new Map();
    for (const userId of new Set(memberIds)) {
      if (alreadyChecked.has(userId)) continue;
      try {
        // A member who left cannot receive the role; skip ownership reads and
        // never record a new entitlement for them.
        if (!await this.discordVerificationSvc.isMember(userId, serverId, discordContext)) { result.left++; continue; }
        const checked = await this.verificationEngine.evaluateRuleGroup(userId, rule, context);
        if (checked.status === 'unavailable') { result.errors++; continue; }
        if (checked.status !== 'passed') continue;
        const history = await this.dbSvc.getEarnedRoleAssignments({ serverId, userId });
        const matched = checked.results.find(item => item.isValid);
        // Persist the earned entitlement first. If Discord fails, the durable
        // retry and ordinary earned-role repair can both finish this grant.
        await this.dbSvc.trackRoleAssignment({ userId, serverId, roleId,
          ruleId: String(matched?.ruleId || rule.id), roleName: rule.role_name || '', serverName: rule.server_name,
          userName: history.find(item => item.user_name)?.user_name || '',
          verificationData: { role_change_rule_id: rule.id, last_check_status: 'passed',
            matching_asset_count: matched?.matchingAssetCount } });
        const granted = await this.discordVerificationSvc.addUserRoleDynamic(userId, serverId, roleId, discordContext);
        if (!granted) throw new Error('Role move pending Discord retry.');
        if (granted === 'suppressed') {
          const saved = await this.dbSvc.getEarnedRoleAssignments({ serverId, userId, roleId });
          for (const assignment of saved) await this.dbSvc.updateRoleAssignmentStatus(assignment.id, 'revoked');
          continue;
        }
        result.verified++;
      } catch { result.errors++; Logger.warn(`Role move for rule ${ruleId} is pending retry.`); }
    }
    await this.verificationEngine.finishWalletChecks?.(context);
    return result;
  }

  private async automaticRoleAllowed(serverId: string, roleId: string, context?: NftCheckContext): Promise<boolean> {
    if (context?.ordinalProviderPolicy !== 'ordnet-only') return true;
    const rules = await this.dbSvc.getRoleMappings(serverId);
    return rules.filter(rule => rule.server_id === serverId && ruleRoles(rule).some(role => role.id === roleId)).every(ordnetCompatible);
  }

  private async reverifyAssignments(assignments: any[], ordinalMode?: 'scheduled', sharedContext?: NftCheckContext): Promise<ReconcileCounts> {
    let verified = 0;
    let revoked = 0;
    let left = 0;
    let errors = 0;
    let unavailable = 0;
    const context: NftCheckContext = sharedContext || { checks: new Map(), ...(ordinalMode ? { ordinalMode } : {}) };
    const discordContext: RoleSyncContext = new Map();

    for (const assignment of assignments) {
      try {
        const outcome = await this.reconcileAssignment(assignment, context, discordContext);
        if (outcome === 'verified') verified++;
        else if (outcome === 'revoked') revoked++;
        else left++;
      } catch (error) {
        errors++;
        if (error instanceof OwnershipCheckUnavailableError) unavailable++;
        else Logger.error('Role reconciliation failed:', error.message);
      }
    }

    if (unavailable) Logger.warn(`Role reconciliation incomplete: ${unavailable} assignment(s) unavailable; existing roles retained.`);
    if(!sharedContext)await this.verificationEngine.finishWalletChecks?.(context);
    return { verified, revoked, left, errors };
  }

  /**
   * Recheck one earned assignment. A member who has left the server is skipped
   * before any ownership read: Discord already removed their roles, and the
   * earned record is kept so a later check restores the role if they rejoin.
   */
  private async reconcileAssignment(assignment: any, context: NftCheckContext, discordContext: RoleSyncContext): Promise<'verified' | 'revoked' | 'left'> {
    if (!await this.discordVerificationSvc.isMember(assignment.user_id, assignment.server_id, discordContext)) return 'left';
    if (await this.verifyUserStillQualifies(assignment, context)) {
      await this.restoreRole(assignment, discordContext);
      return 'verified';
    }
    await this.revokeRole(assignment, discordContext);
    return 'revoked';
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
        if (await this.reconcileAssignment(assignment, context, discordContext) === 'revoked')
          Logger.log(`Revoked role from user ${assignment.user_id} due to rule change`);
      } catch (error) {
        if (!(error instanceof OwnershipCheckUnavailableError)) Logger.error(`Error re-verifying rule assignment:`, error.message);
      }
    }
    await this.verificationEngine.finishWalletChecks?.(context);
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
    if (result.status === 'unavailable') throw new OwnershipCheckUnavailableError();
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
    if (restored === 'suppressed') {
      if (assignment.status !== 'revoked') await this.dbSvc.updateRoleAssignmentStatus(assignment.id, 'revoked');
      await this.updateLastVerified(assignment.id);
      return;
    }
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
