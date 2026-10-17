import { VerifierRole } from '../models/verifier-role.interface';
import { NftCheckContext } from '../services/nft-ownership.service';
import { BulkVerificationResult, VerificationResult } from '../services/verification-engine.service';

export type SavedOrdinalMember = { userId: string; address: string };
export type GrantMember = { name: string; roles: Set<string> };
export type OrdinalGrantDependencies = {
  member(userId: string): Promise<GrantMember | null>;
  verify(userId: string, address: string, rules: VerifierRole[], context: NftCheckContext): Promise<BulkVerificationResult>;
  add(userId: string, roleId: string): Promise<void>;
  track(userId: string, memberName: string, rule: VerifierRole, checks: VerificationResult[]): Promise<void>;
  record(event: Record<string, unknown>): void;
};

/** Match the channel scope of a fresh verification, including ALL-channel rules. */
export function ordinalGrantGroups(rules: VerifierRole[]): VerifierRole[][] {
  const channels = [...new Set(rules.map(rule => rule.channel_id).filter(id => id !== 'ALL'))];
  if (!channels.length) channels.push('ALL');
  return channels.map(channel => {
    const scoped = rules.filter(rule => rule.channel_id === channel || rule.channel_id === 'ALL');
    const groups = new Set(scoped.filter(rule => rule.asset_type === 'ordinal')
      .map(rule => JSON.stringify([rule.role_id, rule.min_items || 1])));
    // Include the other collectible rules contributing to the same minimum.
    return scoped.filter(rule => rule.asset_type !== 'erc20'
      && groups.has(JSON.stringify([rule.role_id, rule.min_items || 1])));
  }).filter(group => group.length);
}

/** This runner deliberately has no revoke, disconnect, or Discord messaging capability. */
export async function runOrdinalRoleGrants(
  members: SavedOrdinalMember[], rules: VerifierRole[], apply: boolean, deps: OrdinalGrantDependencies,
) {
  const groups = ordinalGrantGroups(rules);
  const summary = {
    users: 0, members: 0, absentMembers: 0, alreadyCovered: 0,
    eligibleGrants: 0, granted: 0, unavailableChecks: 0, errors: 0,
  };
  const targets = [...new Map(members.map(member => [member.userId, member])).values()];
  async function checkMember(saved: SavedOrdinalMember) {
    summary.users++;
    let member: GrantMember | null;
    let checks: VerificationResult[] = [];
    try {
      member = await deps.member(saved.userId);
      if (!member) { summary.absentMembers++; return; }
      summary.members++;
      deps.record({ event: 'member_before', userId: saved.userId, roles: [...member.roles] });
      const pending = groups.map(group => group.filter(rule => !member.roles.has(rule.role_id))).filter(group => group.length);
      if (!pending.length) { summary.alreadyCovered++; return; }
      // Live ownership is shared within this member's checks, never across members.
      const context: NftCheckContext = { checks: new Map(), ordinalWork: { priority: 'background' } };
      for (const group of pending) {
        checks.push(...(await deps.verify(saved.userId, saved.address, group, context)).results);
      }
    } catch {
      summary.errors++;
      deps.record({ event: 'member_check_failed', userId: saved.userId });
      return;
    }
    const unavailable = checks.filter(check => check.status === 'unavailable');
    summary.unavailableChecks += unavailable.length;
    if (unavailable.length) deps.record({ event: 'checks_unavailable', userId: saved.userId, ruleIds: unavailable.map(check => check.ruleId) });

    const eligible = new Map<string, VerificationResult>();
    for (const check of checks) {
      // A passing shared group must actually include confirmed Ordinals holdings.
      // An unrelated EVM qualification alone must not become a grant in this pass.
      if (check.isValid && check.status !== 'unavailable' && check.rule?.asset_type === 'ordinal'
        && BigInt(check.matchingAssetCount || 0) > 0n
        && check.ownershipDetails?.source !== 'collection-upper-bound') eligible.set(check.rule.role_id, check);
    }
    if (apply && eligible.size) {
      try { member = await deps.member(saved.userId); }
      catch {
        summary.errors++;
        deps.record({ event: 'member_refresh_failed', userId: saved.userId });
        return;
      }
      if (!member) return;
    }
    for (const [roleId, check] of eligible) {
      if (member.roles.has(roleId)) continue;
      summary.eligibleGrants++;
      const roleChecks = checks.filter(result => result.rule?.role_id === roleId);
      deps.record({ event: 'eligible', userId: saved.userId, roleId, ruleIds: roleChecks.filter(result => result.isValid).map(result => result.ruleId) });
      if (!apply) continue;
      try { await deps.add(saved.userId, roleId); }
      catch {
        summary.errors++;
        deps.record({ event: 'grant_failed', userId: saved.userId, roleId });
        continue;
      }
      summary.granted++;
      member.roles.add(roleId);
      deps.record({ event: 'granted', userId: saved.userId, roleId });
      try { await deps.track(saved.userId, member.name, check.rule, roleChecks); }
      catch {
        // Never remove a role to compensate for a database failure. Stop so the
        // journal can be used to repair tracking before any further grants.
        deps.record({ event: 'tracking_failed', userId: saved.userId, roleId, summary });
        throw new Error('Role granted but tracking failed. Repair the recorded assignment before continuing.');
      }
      deps.record({ event: 'tracked', userId: saved.userId, roleId });
    }
    deps.record({ event: 'member_checked', userId: saved.userId, summary: { ...summary } });
  }
  for (const target of targets) await checkMember(target);
  deps.record({ event: 'complete', apply, summary });
  return summary;
}
