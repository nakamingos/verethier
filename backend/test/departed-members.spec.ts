import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';

const assignment = { id: 'a1', user_id: 'member', server_id: 'server', role_id: 'role', status: 'active' };
const rule = { id: 7, server_id: 'server', role_id: 'role', role_name: 'Role', channel_id: 'channel', asset_type: 'nft', min_items: 1 };

function setup(isMember: jest.Mock) {
  const db: any = {
    getEarnedRoleAssignments: jest.fn().mockResolvedValue([assignment]),
    getRoleMappings: jest.fn().mockResolvedValue([rule]),
    getRuleForServer: jest.fn().mockResolvedValue(rule),
    saveRoleCheckDetails: jest.fn(),
    trackRoleAssignment: jest.fn(),
    updateRoleAssignmentStatus: jest.fn(),
    updateLastVerified: jest.fn(),
  };
  const engine: any = {
    evaluateRole: jest.fn().mockResolvedValue({ status: 'failed', results: [] }),
    evaluateRuleGroup: jest.fn().mockResolvedValue({ status: 'passed', results: [{ isValid: true, ruleId: 7 }] }),
    finishWalletChecks: jest.fn(),
  };
  const discord: any = { isMember, removeUserRole: jest.fn().mockResolvedValue(true), addUserRoleDynamic: jest.fn().mockResolvedValue(true) };
  return { db, engine, discord, roles: new DynamicRoleService(db, engine, discord) };
}

describe('Members who have left a server', () => {
  it('are skipped before any ownership read and are not counted as errors', async () => {
    const { roles, engine, discord, db } = setup(jest.fn().mockResolvedValue(false));
    expect(await roles.reverifyRoleInServer('server', 'role')).toEqual({ verified: 0, revoked: 0, left: 1, errors: 0 });
    expect(discord.isMember).toHaveBeenCalledWith('member', 'server', expect.any(Map));
    expect(engine.evaluateRole).not.toHaveBeenCalled();
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    // The earned record is kept, so a member who rejoins is restored later.
    expect(db.updateRoleAssignmentStatus).not.toHaveBeenCalled();
  });

  it('count a membership lookup outage as a retryable error without changing roles', async () => {
    const { roles, engine, discord } = setup(jest.fn().mockRejectedValue(new Error('Discord unavailable')));
    expect(await roles.reverifyRoleInServer('server', 'role')).toEqual({ verified: 0, revoked: 0, left: 0, errors: 1 });
    expect(engine.evaluateRole).not.toHaveBeenCalled();
    expect(discord.removeUserRole).not.toHaveBeenCalled();
  });

  it('are still rechecked normally while present', async () => {
    const { roles, engine, discord } = setup(jest.fn().mockResolvedValue(true));
    expect(await roles.reverifyRoleInServer('server', 'role')).toEqual({ verified: 0, revoked: 1, left: 0, errors: 0 });
    expect(engine.evaluateRole).toHaveBeenCalledTimes(1);
    expect(discord.removeUserRole).toHaveBeenCalledWith('member', 'server', 'role', expect.any(Map));
  });

  it('never receive a new entitlement from an administrator role move', async () => {
    const { roles, engine, discord, db } = setup(jest.fn().mockResolvedValue(false));
    db.getEarnedRoleAssignments.mockResolvedValue([]);
    expect(await roles.reverifyRoleChangeInServer('server', 'role', '7', ['member'])).toEqual({ verified: 0, revoked: 0, left: 1, errors: 0 });
    expect(engine.evaluateRuleGroup).not.toHaveBeenCalled();
    expect(db.trackRoleAssignment).not.toHaveBeenCalled();
    expect(discord.addUserRoleDynamic).not.toHaveBeenCalled();
  });
});

describe('DiscordVerificationService.isMember', () => {
  function service(fetch: jest.Mock) {
    const svc = new DiscordVerificationService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    svc.initialize({ guilds: { fetch: async () => ({ id: 'server', members: { fetch } }) } } as any);
    return svc;
  }

  it('reports a departure only when Discord confirms Unknown Member', async () => {
    expect(await service(jest.fn().mockRejectedValue({ code: 10007 })).isMember('member', 'server')).toBe(false);
    expect(await service(jest.fn().mockResolvedValue({ id: 'member' })).isMember('member', 'server')).toBe(true);
  });

  it('throws other Discord failures so the check is retried', async () => {
    await expect(service(jest.fn().mockRejectedValue({ code: 50013 })).isMember('member', 'server')).rejects.toEqual({ code: 50013 });
  });

  it('shares the member fetch with the following role change', async () => {
    const fetch = jest.fn().mockResolvedValue({ id: 'member' });
    const context = new Map();
    await service(fetch).isMember('member', 'server', context);
    expect(context.has('server:member')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
