import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { PortalService } from '../src/portal/portal.service';
import { Collection } from 'discord.js';
import { ruleEditFields, ruleEditVersion } from '../src/utils/rule-edit.util';

describe('Explicit administrator role moves', () => {
  const rule = {
    id: 7,
    server_id: 'server',
    role_id: 'new-role',
    role_name: 'New role',
    channel_id: 'channel',
    asset_type: 'ordinal',
    min_items: 10,
  };
  let db: any, engine: any, discord: any, service: DynamicRoleService;
  beforeEach(() => {
    db = {
      getRuleForServer: jest.fn().mockResolvedValue(rule),
      getRoleMappings: jest.fn().mockResolvedValue([rule]),
      getEarnedRoleAssignments: jest.fn().mockResolvedValue([]),
      trackRoleAssignment: jest.fn().mockResolvedValue(undefined),
    };
    engine = {
      evaluateRuleGroup: jest
        .fn()
        .mockResolvedValue({
          status: 'passed',
          results: [{ isValid: true, ruleId: 7, matchingAssetCount: 10 }],
        }),
    };
    discord = { addUserRoleDynamic: jest.fn().mockResolvedValue(true) };
    service = new DynamicRoleService(db, engine, discord);
  });
  it('freshly checks only affected holders and records entitlement before granting', async () => {
    const result = await service.reverifyRoleChangeInServer(
      'server',
      'new-role',
      '7',
      ['member', 'member'],
    );
    expect(result).toEqual({ verified: 1, revoked: 0, errors: 0 });
    expect(engine.evaluateRuleGroup).toHaveBeenCalledTimes(1);
    expect(db.trackRoleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'member',
        serverId: 'server',
        roleId: 'new-role',
        ruleId: '7',
      }),
    );
    expect(db.trackRoleAssignment.mock.invocationCallOrder[0]).toBeLessThan(
      discord.addUserRoleDynamic.mock.invocationCallOrder[0],
    );
  });
  it.each(['failed', 'unavailable'])(
    'does not grant when the fresh group check is %s',
    async (status) => {
      engine.evaluateRuleGroup.mockResolvedValue({ status, results: [] });
      expect(
        (
          await service.reverifyRoleChangeInServer('server', 'new-role', '7', [
            'member',
          ])
        ).errors,
      ).toBe(status === 'unavailable' ? 1 : 0);
      expect(discord.addUserRoleDynamic).not.toHaveBeenCalled();
      expect(db.trackRoleAssignment).not.toHaveBeenCalled();
    },
  );
  it('does not leave untracked Discord grants if persistence fails', async () => {
    db.trackRoleAssignment.mockRejectedValue(new Error('database'));
    expect(
      (
        await service.reverifyRoleChangeInServer('server', 'new-role', '7', [
          'member',
        ])
      ).errors,
    ).toBe(1);
    expect(discord.addUserRoleDynamic).not.toHaveBeenCalled();
  });
  it('retains a tracked entitlement for retry if Discord fails', async () => {
    discord.addUserRoleDynamic.mockResolvedValue(false);
    expect(
      (
        await service.reverifyRoleChangeInServer('server', 'new-role', '7', [
          'member',
        ])
      ).errors,
    ).toBe(1);
    expect(db.trackRoleAssignment).toHaveBeenCalledTimes(1);
  });
  it('skips an obsolete mapping after a newer edit', async () => {
    db.getRuleForServer.mockResolvedValue({ ...rule, role_id: 'latest-role' });
    expect(
      await service.reverifyRoleChangeInServer('server', 'new-role', '7', [
        'member',
      ]),
    ).toEqual({ verified: 0, revoked: 0, errors: 0 });
    expect(engine.evaluateRuleGroup).not.toHaveBeenCalled();
  });
  it('reconciles existing target-role holders through their full alternatives', async () => {
    db.getEarnedRoleAssignments.mockResolvedValue([{ user_id: 'member' }]);
    const reconcile = jest
      .spyOn(service as any, 'reverifyAssignments')
      .mockResolvedValue({ verified: 1, revoked: 0, errors: 0 });
    await service.reverifyRoleChangeInServer('server', 'new-role', '7', [
      'member',
    ]);
    expect(reconcile).toHaveBeenCalled();
    expect(engine.evaluateRuleGroup).not.toHaveBeenCalled();
  });
});

describe('Role-move eligibility scope', () => {
  it('includes same-channel/minimum collectible rules across protocols only', async () => {
    const base = {
      id: 1,
      server_id: 'server',
      role_id: 'role',
      channel_id: 'here',
      min_items: 10,
      asset_type: 'ordinal',
    };
    const rules = [
      base,
      { ...base, id: 2, asset_type: 'ethscription' },
      { ...base, id: 3, channel_id: 'elsewhere' },
      { ...base, id: 4, min_items: 1 },
      { ...base, id: 5, role_id: 'other' },
      { ...base, id: 6, asset_type: 'erc20' },
    ];
    const engine = new VerificationEngine(
      { getRoleMappings: async () => rules } as any,
      {} as any,
      { getUserAddresses: async () => ['wallet'] } as any,
      {} as any,
    );
    const bulk = jest
      .spyOn(engine, 'verifyUserBulk')
      .mockResolvedValue({
        results: [{ isValid: false, status: 'unavailable' }],
      } as any);
    expect((await engine.evaluateRuleGroup('member', base as any)).status).toBe(
      'unavailable',
    );
    expect(bulk).toHaveBeenCalledWith(
      'member',
      [1, 2],
      'wallet',
      rules.slice(0, 2),
      undefined,
    );
    await engine.evaluateRuleGroup('member', rules[5] as any);
    expect(bulk).toHaveBeenLastCalledWith(
      'member',
      [6],
      'wallet',
      [rules[5]],
      undefined,
    );
  });
});

describe('Dashboard role selection', () => {
  let service: PortalService, guild: any, edits: any, rules: any;
  const before: any = {
    id: 1,
    server_id: 'server',
    role_id: 'old',
    asset_type: 'ordinal',
    slug: 'pizza-comrades',
    attribute_key: 'ALL',
    attribute_value: 'ALL',
    min_items: 1,
  };
  beforeEach(() => {
    guild = {
      id: 'server',
      roles: {
        fetch: jest.fn(),
        cache: new Collection([
          [
            'new',
            { id: 'new', name: 'Collectors', editable: true, managed: false },
          ],
        ]),
        create: jest
          .fn()
          .mockResolvedValue({
            id: 'created',
            name: 'New collectors',
            editable: true,
          }),
      },
    };
    edits = { prepare: jest.fn(), duplicates: jest.fn().mockReturnValue({}) };
    rules = { getRoleMappings: jest.fn().mockResolvedValue([before]) };
    service = new PortalService(
      {} as any,
      {} as any,
      rules,
      {} as any,
      edits,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service, 'access').mockResolvedValue(guild);
    jest.spyOn(service as any, 'replay').mockResolvedValue(null);
    jest.spyOn(service as any, 'rule').mockResolvedValue(before);
    jest
      .spyOn(service as any, 'mutate')
      .mockImplementation(async (...args: any[]) => args[4]);
  });
  it('moves a role without calling collection providers when criteria are unchanged', async () => {
    const inputs = Object.fromEntries(
      ruleEditFields(before).map((field) => [field.key, field.value]),
    );
    const result = await service.edit(
      { user: { id: 'admin' } } as any,
      'server',
      '1',
      {
        inputs,
        role_id: 'new',
        version: ruleEditVersion(before),
        request_id: 'request',
      },
    );
    expect((result as any).role_id).toBe('new');
    expect(edits.prepare).not.toHaveBeenCalled();
    expect(service.access).toHaveBeenCalledTimes(2);
  });
  it('reuses an existing case-insensitive role name', async () => {
    expect(
      (
        await (service as any).targetRole(
          guild,
          undefined,
          'COLLECTORS',
          'admin',
        )
      ).id,
    ).toBe('new');
    expect(guild.roles.create).not.toHaveBeenCalled();
  });
  it('creates a missing role', async () => {
    expect(
      (
        await (service as any).targetRole(
          guild,
          undefined,
          'New collectors',
          'admin',
        )
      ).id,
    ).toBe('created');
    expect(guild.roles.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New collectors' }),
    );
  });
  it('rejects deleted, managed, and unmanageable roles', async () => {
    await expect(
      (service as any).targetRole(guild, 'foreign', undefined, 'admin'),
    ).rejects.toThrow('no longer exists');
    guild.roles.cache.get('new').managed = true;
    await expect(
      (service as any).targetRole(guild, 'new', undefined, 'admin'),
    ).rejects.toThrow('above');
    guild.roles.cache.get('new').managed = false;
    guild.roles.cache.get('new').editable = false;
    await expect(
      (service as any).targetRole(guild, 'new', undefined, 'admin'),
    ).rejects.toThrow('above');
  });
});
