import { RoleActionService } from '../src/services/role-action.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';

describe('Server role actions', () => {
  function setup() {
    const policy = { remove_role_ids: ['target'] };
    const reads: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      contains: jest.fn().mockImplementation((_key, roles) =>
        Promise.resolve({
          data: roles.includes('target')
            ? [{ trigger_role_id: 'trigger' }]
            : [],
          error: null,
        }),
      ),
      maybeSingle: jest.fn().mockResolvedValue({ data: policy, error: null }),
    };
    const writes: any = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resolve({ error: null })),
    };
    const db: any = {
      from: jest.fn((table) =>
        table === 'verifier_role_actions' ? reads : writes,
      ),
    };
    const guild: any = {
      id: 'server',
      members: { fetch: jest.fn() },
      roles: {
        fetch: jest.fn(),
        cache: new Map([['target', { id: 'target', editable: true }]]),
      },
    };
    const member: any = {
      guild,
      roles: {
        cache: new Map([
          ['trigger', {}],
          ['target', {}],
        ]),
        remove: jest.fn(),
      },
    };
    guild.members.fetch.mockResolvedValue(member);
    return {
      service: new RoleActionService(db),
      db,
      reads,
      writes,
      guild,
      member,
    };
  }
  it('suppresses grants only for an exclusion whose trigger is currently held, scoped to the server', async () => {
    const { service, reads, member } = setup();
    expect(await service.blockedBy(member, 'target')).toBe(true);
    expect(reads.eq).toHaveBeenCalledWith('server_id', 'server');
    expect(reads.contains).toHaveBeenCalledWith('remove_role_ids', ['target']);
    member.roles.cache.delete('trigger');
    expect(await service.blockedBy(member, 'target')).toBe(false);
    reads.contains.mockResolvedValueOnce({ data: null, error: {} });
    await expect(service.blockedBy(member, 'target')).rejects.toThrow(
      'Could not check',
    );
  });
  it('removes only the selected role and records revocation after Discord succeeds', async () => {
    const { service, guild, member, writes } = setup();
    expect(await service.enforce(guild, 'user', 'trigger')).toEqual({
      checked: 1,
      removed: 1,
      errors: 0,
    });
    expect(member.roles.remove).toHaveBeenCalledWith(
      guild.roles.cache.get('target'),
      expect.any(String),
    );
    expect(writes.eq.mock.calls).toEqual([
      ['server_id', 'server'],
      ['user_id', 'user'],
      ['role_id', 'target'],
    ]);
  });
  it('does not cascade removals from a trigger already excluded by a held role', async () => {
    const { service, guild, member, reads } = setup();
    member.roles.cache.set('higher', {});
    reads.contains.mockResolvedValue({
      data: [{ trigger_role_id: 'higher' }],
      error: null,
    });
    expect((await service.enforce(guild, 'user', 'trigger')).checked).toBe(0);
    expect(member.roles.remove).not.toHaveBeenCalled();
  });
  it('keeps failed removals retryable without falsely revoking the saved assignment', async () => {
    const { service, guild, member, writes } = setup();
    member.roles.remove.mockRejectedValue(new Error('Missing permissions'));
    expect((await service.enforce(guild, 'user', 'trigger')).errors).toBe(1);
    expect(writes.update).not.toHaveBeenCalled();
  });
  it('cancels pending removals when the trigger or policy is gone', async () => {
    const { service, guild, member, reads } = setup();
    member.roles.cache.delete('trigger');
    expect((await service.enforce(guild, 'user', 'trigger')).checked).toBe(0);
    reads.maybeSingle.mockResolvedValue({ data: null, error: null });
    await service.enforce(guild, 'user', 'trigger');
    expect(member.roles.remove).not.toHaveBeenCalled();
  });
  it('gates manual verification and dynamic restoration before granting an excluded role', async () => {
    const member: any = {
      roles: {
        cache: new Map([['target', {}]]),
        add: jest.fn(),
        remove: jest.fn(),
      },
    };
    const role = { id: 'target' };
    const guild: any = {
      roles: {
        cache: new Map([['target', role]]),
        fetch: jest.fn().mockResolvedValue(role),
      },
      members: { fetch: jest.fn().mockResolvedValue(member) },
    };
    const db: any = { trackRoleAssignment: jest.fn() };
    const service = new DiscordVerificationService(
      db,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { blockedBy: jest.fn().mockResolvedValue(true) } as any,
    );
    service.initialize({
      guilds: {
        cache: new Map([['server', guild]]),
        fetch: jest.fn().mockResolvedValue(guild),
      },
    } as any);
    await expect(
      service.addUserRole('user', 'target', 'server', 'nonce'),
    ).rejects.toThrow('excluded');
    expect(await service.addUserRoleDynamic('user', 'server', 'target')).toBe(
      'suppressed',
    );
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(member.roles.remove).toHaveBeenCalledTimes(1);
    expect(db.trackRoleAssignment).not.toHaveBeenCalled();
  });
  it('records an excluded earned role as revoked rather than reactivating it during reconciliation', async () => {
    const db: any = {
      updateRoleAssignmentStatus: jest.fn(),
      updateLastVerified: jest.fn(),
    };
    const service = new DynamicRoleService(
      db,
      {} as any,
      { addUserRoleDynamic: jest.fn().mockResolvedValue('suppressed') } as any,
    );
    await (service as any).restoreRole(
      {
        id: 'assignment',
        user_id: 'user',
        server_id: 'server',
        role_id: 'target',
        status: 'active',
      },
      new Map(),
    );
    expect(db.updateRoleAssignmentStatus).toHaveBeenCalledWith(
      'assignment',
      'revoked',
    );
    expect(db.updateRoleAssignmentStatus).not.toHaveBeenCalledWith(
      'assignment',
      'active',
    );
  });
});
