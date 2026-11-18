import { Logger } from '@nestjs/common';
import { CONSTANTS } from '@/constants';
import { VerifierRole } from '@/models/verifier-role.interface';
import { RoleExcludedError } from '@/utils/role-excluded-error.util';
import { DiscordVerificationService, RoleSyncContext } from '../discord-verification.service';
import { BulkVerificationResult } from '../verification-engine.service';

/**
 * Grants every role a verification result qualifies for, once per role, and
 * returns one entry per matching rule for the completion message.
 */
export async function assignVerifiedRoles(
  discord: DiscordVerificationService,
  request: { userId: string; guildId: string; nonce: string },
  result: BulkVerificationResult,
  members: RoleSyncContext = new Map(),
): Promise<any[]> {
  const groups = new Map<string, VerifierRole[]>();
  for (const rule of result.validRules) {
    if (!rule.role_id) continue;
    if (!groups.has(rule.role_id)) groups.set(rule.role_id, []);
    groups.get(rule.role_id)!.push(rule);
  }
  const roleResults: any[] = [];
  let excluded = 0;
  let failures = 0;
  for (const [roleId, matches] of groups) {
    try {
      const roleResult = await discord.addUserRole(
        request.userId, roleId, request.guildId, request.nonce, matches[0].id.toString(),
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
        matchingCount: (() => {
          const check = result.results?.find(r => String(r.ruleId) === String(rule.id) && r.rule?.role_id === roleId);
          return check?.combinedAssetCount ?? check?.matchingAssetCount ?? result.matchingAssetCounts.get(rule.id.toString()) ?? 0;
        })(),
      });
    } catch (error) {
      if (error instanceof RoleExcludedError) { excluded++; continue; }
      failures++;
      Logger.error(`Failed to assign role ${roleId}:`, error.message);
    }
  }
  if (excluded) Logger.log(`Verification skipped ${excluded} role(s) excluded by server role policies.`);
  if (failures && !roleResults.length) {
    const message = CONSTANTS.ERRORS.ROLE_ASSIGNMENT_FAILED;
    await discord.throwError(request.nonce, message);
    throw new Error(message);
  }
  return roleResults;
}
