import { PortalService, portalRule } from '../src/portal/portal.service';
import { PermissionFlagsBits } from 'discord.js';
import { PortalController } from '../src/portal/portal.controller';

describe('Portal server boundaries', () => {
  const server = '111111111111111111',
    user = '222222222222222222';
  let service: PortalService, guild: any, db: any, rules: any;
  const session = {
    user: { id: user },
    guilds: [],
    csrf: 'test',
    hash: 'hash',
  } as any;
  beforeEach(() => {
    guild = {
      id: server,
      ownerId: '333333333333333333',
      members: { fetch: jest.fn(), search: jest.fn() },
      channels: { fetch: jest.fn() },
    };
    const discord = {
      getBotClient: () => ({ guilds: { cache: new Map([[server, guild]]) } }),
    };
    db = { from: jest.fn() };
    rules = { getEarnedRoleAssignments: jest.fn() };
    service = new PortalService(
      db,
      discord as any,
      rules as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });
  it('does not trust OAuth guild snapshots for server administration', async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: { has: () => false },
    });
    await expect(
      service.access(
        { ...session, guilds: [{ id: server, owner: true, permissions: '8' }] },
        server,
      ),
    ).rejects.toThrow('Administrator');
    expect(guild.members.fetch).toHaveBeenCalledWith({ user, force: true });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('checks live owner/admin permissions and rejects another server', async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: {
        has: (flag) => flag === PermissionFlagsBits.Administrator,
      },
    });
    expect(await service.access(session, server)).toBe(guild);
    await expect(service.access(session, '444444444444444444')).rejects.toThrow(
      'not installed',
    );
  });
  it.each(['roles', 'changes', 'jobs'])(
    'sorts %s activity by date and ID before pagination',
    async (kind) => {
      guild.members.fetch.mockResolvedValue({
        id: user,
        permissions: { has: () => true },
      });
      const query = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest
          .fn()
          .mockResolvedValue({ data: [], error: null, count: 45 }),
      };
      db.from.mockReturnValue(query);
      for (const limit of [10, 20, 50, 100]) {
        for (const sort of ['asc', 'desc'] as const) {
          query.order.mockClear();
          const result = await service.activity(
            session,
            server,
            2,
            kind,
            sort,
            limit,
          );
          expect(query.order.mock.calls).toEqual([
            [
              kind === 'changes' ? 'created_at' : 'updated_at',
              { ascending: sort === 'asc' },
            ],
            ['id', { ascending: sort === 'asc' }],
          ]);
          expect(query.range).toHaveBeenLastCalledWith(limit, limit * 2 - 1);
          expect(query.order.mock.invocationCallOrder[1]).toBeLessThan(
            query.range.mock.invocationCallOrder.at(-1),
          );
          expect(result).toEqual({
            items: [],
            total: 45,
            page: 2,
            pages: Math.ceil(45 / limit),
            page_size: limit,
          });
        }
      }
    },
  );
  it('does not reveal wallet information for nonmembers', async () => {
    guild.members.fetch
      .mockResolvedValueOnce({ id: user, permissions: { has: () => true } })
      .mockRejectedValueOnce(
        Object.assign(new Error('Unknown member'), { code: 10007 }),
      );
    await expect(
      service.member(session, server, '555555555555555555', false),
    ).rejects.toThrow('not in this server');
    expect(db.from).not.toHaveBeenCalled();
    expect(rules.getEarnedRoleAssignments).not.toHaveBeenCalled();
  });
  it('returns removed wallet history only after current admin/member checks, keeping current wallets separate', async () => {
    const target = '555555555555555555';
    guild.members.fetch
      .mockResolvedValueOnce({ id: user, permissions: { has: () => true } })
      .mockResolvedValueOnce({
        id: target,
        displayName: 'Collector',
        user: { username: 'collector' },
        displayAvatarURL: () => null,
        roles: { cache: new Map() },
      });
    const current = {
      address: '0xcurrent',
      wallet_type: 'evm',
      last_verified_at: '2026-10-18T12:00:00Z',
    };
    const history = [
      {
        address: '0xremoved',
        wallet_type: 'evm',
        kind: 'wallet_remove',
        last_proven_at: '2026-10-17T12:00:00Z',
        created_at: '2026-10-18T12:00:00Z',
      },
      {
        address: '0xcurrent',
        wallet_type: 'evm',
        kind: 'wallet_remove',
        created_at: '2026-10-17T12:00:00Z',
      },
      {
        address: '0xremoved',
        wallet_type: 'evm',
        kind: 'wallet_remove',
        created_at: '2026-10-16T12:00:00Z',
      },
      {
        address: 'bc1p-moved',
        wallet_type: 'bitcoin',
        kind: 'wallet_transfer_out',
        last_proven_at: null,
        created_at: '2026-10-15T12:00:00Z',
      },
    ];
    const walletQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [current], error: null }),
    };
    const removedQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: history, error: null }),
    };
    const block = {
      address: '0xremoved',
      reason: 'Repeated abuse',
      blocked_at: '2026-10-18T13:00:00Z',
    };
    const blockQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [block], error: null }),
    };
    db.from.mockImplementation((table) =>
      table === 'user_wallets'
        ? walletQuery
        : table === 'verifier_wallet_blocks'
          ? blockQuery
          : removedQuery,
    );
    rules.getEarnedRoleAssignments.mockResolvedValue([]);
    const result = await service.member(session, server, target, false);
    expect(result.wallets).toEqual([
      { ...current, blocked: false, block: null },
    ]);
    expect(result.removed_wallets).toEqual([
      {
        address: '0xremoved',
        wallet_type: 'evm',
        last_verified_at: '2026-10-17T12:00:00Z',
        removed_at: '2026-10-18T12:00:00Z',
        transferred: false,
        blocked: true,
        block,
      },
      {
        address: 'bc1p-moved',
        wallet_type: 'bitcoin',
        last_verified_at: null,
        removed_at: '2026-10-15T12:00:00Z',
        transferred: true,
        blocked: false,
        block: null,
      },
    ]);
    expect(walletQuery.eq).toHaveBeenCalledWith('user_id', target);
    expect(blockQuery.eq).toHaveBeenCalledWith('server_id', server);
    expect(blockQuery.in).toHaveBeenCalledWith('address', [
      '0xcurrent',
      '0xremoved',
      'bc1p-moved',
    ]);
    expect(removedQuery.eq).toHaveBeenCalledWith('user_id', target);
    expect(removedQuery.in).toHaveBeenCalledWith('kind', [
      'wallet_remove',
      'wallet_transfer_out',
    ]);
    expect(removedQuery.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });
  it('restricts wallet actions to the selected member’s recorded addresses and authenticated server admin', async () => {
    const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const view = jest.spyOn(service, 'member').mockResolvedValue({
      wallets: [],
      removed_wallets: [{ address }],
    } as any);
    db.rpc = jest.fn().mockResolvedValue({
      data: { address, blocked: true, jobs: 1 },
      error: null,
    });
    const dto = {
      address: address.toUpperCase().replace('0X', '0x'),
      blocked: true,
      reason: '  Abuse  ',
      request_id: 'request',
    };
    expect(await service.walletBlock(session, server, 'member', dto)).toEqual({
      address,
      blocked: true,
      jobs: 1,
    });
    expect(view).toHaveBeenCalledWith(session, server, 'member', false);
    expect(db.rpc).toHaveBeenCalledWith('verifier_portal_wallet_block', {
      p_server: server,
      p_actor: user,
      p_address: address,
      p_blocked: true,
      p_reason: 'Abuse',
      p_request: 'request',
    });
    db.rpc.mockClear();
    await expect(
      service.walletBlock(session, server, 'member', {
        ...dto,
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).rejects.toThrow('not in the selected');
    expect(db.rpc).not.toHaveBeenCalled();
    view.mockRejectedValueOnce(new Error('Not an administrator'));
    await expect(
      service.walletBlock(session, server, 'member', dto),
    ).rejects.toThrow('Not an administrator');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('renders wallet restrictions as non-rule audit entries', () => {
    const action = {
      id: 'action',
      kind: 'wallet_block',
      actor_id: user,
      after_rule: { address: '0xabc', reason: 'Abuse' },
    };
    expect((service as any).safeAction(action)).toEqual(
      expect.objectContaining({
        kind: 'wallet_block',
        wallet: action.after_rule,
        before_rule: null,
        after_rule: null,
      }),
    );
  });
  it('audits with a complete live member list and preserves the requested member scope', async () => {
    jest.spyOn(service, 'access').mockResolvedValue(guild);
    jest.spyOn(service as any, 'resolveMember').mockResolvedValue({ id: user });
    guild.members.list = jest
      .fn()
      .mockResolvedValue(new Map([[user, { displayName: 'Current member' }]]));
    db.rpc = jest.fn().mockResolvedValue({
      data: {
        total: 1,
        items: [{ address: '0xabc', accounts: [{ user_id: user }] }],
      },
      error: null,
    });
    const result = await service.walletAudit(session, server, {
      member_id: user,
    });
    expect(db.rpc).toHaveBeenCalledWith('verifier_portal_wallet_audit', {
      p_server: server,
      p_users: [user],
      p_member: user,
      p_after: null,
      p_limit: 20,
      p_address: null,
      p_account_after: null,
    });
    expect(result.items[0].accounts[0]).toEqual({
      user_id: user,
      name: 'Current member',
      in_server: true,
    });
  });
  it('does not report a partial audit if Discord member enumeration fails', async () => {
    jest.spyOn(service, 'access').mockResolvedValue(guild);
    guild.members.list = jest.fn().mockRejectedValue(new Error('Forbidden'));
    db.rpc = jest.fn();
    await expect(service.walletAudit(session, server, {})).rejects.toThrow(
      'No partial audit',
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('checks admin access before reading wallet-audit identities or changing role actions', async () => {
    jest.spyOn(service, 'access').mockRejectedValue(new Error('Not admin'));
    guild.members.list = jest.fn();
    db.rpc = jest.fn();
    await expect(service.walletAudit(session, server, {})).rejects.toThrow(
      'Not admin',
    );
    await expect(
      service.roleAction(session, server, {
        trigger_role_id: user,
        request_id: 'id',
      }),
    ).rejects.toThrow('Not admin');
    expect(guild.members.list).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects unmanageable, cross-server and self-removing role actions', async () => {
    jest.spyOn(service, 'access').mockResolvedValue(guild);
    guild.members.me = { permissions: { has: () => true } };
    guild.roles = {
      fetch: jest
        .fn()
        .mockResolvedValue(new Map([[user, { id: user, editable: true }]])),
    };
    db.rpc = jest.fn();
    await expect(
      service.roleAction(session, server, {
        trigger_role_id: user,
        remove_role_ids: [user],
        request_id: 'id',
      }),
    ).rejects.toThrow('itself');
    await expect(
      service.roleAction(session, server, {
        trigger_role_id: user,
        remove_role_ids: ['missing'],
        request_id: 'id',
      }),
    ).rejects.toThrow('existing roles');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects channels from another guild', async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: { has: () => true },
    });
    guild.channels.fetch.mockResolvedValue({
      type: 0,
      guild: { id: '444444444444444444' },
    });
    await expect(
      service.saveSettings(session, server, {
        background_checks_enabled: false,
        verification_channel_id: '555555555555555555',
      }),
    ).rejects.toThrow('this server');
    expect(db.from).not.toHaveBeenCalled();
  });
  it('normalizes member autocomplete and returns only suggestion fields', async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: { has: () => true },
    });
    guild.members.search.mockResolvedValue(
      new Map([
        [
          'member',
          {
            id: '555555555555555555',
            displayName: 'Collector',
            user: { username: 'collector' },
            displayAvatarURL: () => '/avatar',
            private: 'hidden',
          },
        ],
      ]),
    );
    expect(
      await service.memberSuggestions(session, server, ' @CoLLeCtOr '),
    ).toEqual({
      members: [
        {
          id: '555555555555555555',
          name: 'Collector',
          username: 'collector',
          avatar: '/avatar',
        },
      ],
    });
    expect(guild.members.search).toHaveBeenCalledWith({
      query: 'collector',
      limit: 25,
      cache: false,
    });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('checks administration before searching names', async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: { has: () => false },
    });
    await expect(
      service.memberSuggestions(session, server, 'collector'),
    ).rejects.toThrow('Administrator');
    expect(guild.members.search).not.toHaveBeenCalled();
  });
  it('resolves an exact case-insensitive name and confirms membership by ID', async () => {
    const target = {
      id: '555555555555555555',
      user: { username: 'collector' },
      nickname: 'Collector',
    };
    guild.members.search.mockResolvedValue(new Map([[target.id, target]]));
    guild.members.fetch.mockResolvedValue(target);
    expect(await (service as any).resolveMember(guild, 'COLLECTOR')).toBe(
      target,
    );
    expect(guild.members.fetch).toHaveBeenCalledWith({
      user: target.id,
      force: true,
    });
  });
  it('rejects ambiguous nicknames before loading private member data', async () => {
    guild.members.fetch.mockResolvedValue({
      id: user,
      permissions: { has: () => true },
    });
    guild.members.search.mockResolvedValue(
      new Map(
        ['1', '2'].map((id) => [
          id,
          { id, user: { username: 'user' + id }, nickname: 'Collector' },
        ]),
      ),
    );
    await expect(
      service.member(session, server, 'COLLECTOR', false),
    ).rejects.toThrow('Several members');
    expect(db.from).not.toHaveBeenCalled();
  });
  it('keeps direct ID lookup available when name search is down', async () => {
    guild.members.search.mockRejectedValue(new Error('network'));
    const member = { id: '555555555555555555' };
    guild.members.fetch.mockResolvedValue(member);
    expect(await (service as any).resolveMember(guild, member.id)).toBe(member);
    expect(guild.members.search).not.toHaveBeenCalled();
    guild.members.fetch.mockRejectedValue(new Error('network'));
    await expect(
      (service as any).resolveMember(guild, member.id),
    ).rejects.toThrow('Could not confirm');
  });
  it('omits collection trait inventories from dashboard rule payloads', () => {
    const rule = {
      id: 1,
      asset_type: 'ordinal',
      slug: 'pizza-comrades',
      attribute_key: 'Category',
      attribute_value: 'Gold',
      min_items: 1,
      ordinal_trait_snapshot: { inscription_ids: ['private-large-inventory'] },
    } as any;
    expect(JSON.stringify(portalRule(rule))).not.toContain(
      'private-large-inventory',
    );
    expect(portalRule(rule).fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'trait_filter', value: JSON.stringify({operator:'AND',conditions:[{key:'Category',value:'Gold'}]}) }),
      ]),
    );
  });
});

describe('Portal activity sort parameters', () => {
  const session = { user: { id: 'admin' } };
  const auth = { session: jest.fn().mockResolvedValue(session) };
  const portal = { activity: jest.fn().mockResolvedValue({ items: [] }) };
  const controller = new PortalController(auth as any, portal as any);
  beforeEach(() => jest.clearAllMocks());
  it('preserves newest-first ordering when sort is omitted', async () => {
    await controller.activity({} as any, 'server');
    expect(portal.activity).toHaveBeenCalledWith(
      session,
      'server',
      1,
      'roles',
      'desc',
      20,
    );
  });
  it('forwards the chosen sort and page', async () => {
    await controller.activity({} as any, 'server', '3', 'jobs', 'asc', '50');
    expect(portal.activity).toHaveBeenCalledWith(
      session,
      'server',
      3,
      'jobs',
      'asc',
      50,
    );
  });

  it.each(['0', '21', '1000', 'NaN'])(
    'rejects unsupported page size %s',
    async (limit) => {
      await expect(
        controller.activity({} as any, 'server', '1', 'roles', 'desc', limit),
      ).rejects.toThrow();
      expect(portal.activity).not.toHaveBeenCalled();
    },
  );
  it('rejects an unsupported sort before reading activity', async () => {
    await expect(
      controller.activity({} as any, 'server', '1', 'roles', 'invalid'),
    ).rejects.toThrow();
    expect(auth.session).not.toHaveBeenCalled();
    expect(portal.activity).not.toHaveBeenCalled();
  });
});

describe('Portal wallet block mutations', () => {
  it.each(['roleAction', 'walletAudit'])(
    'requires CSRF for %s before dispatch',
    async (method) => {
      const auth = {
        session: jest.fn().mockResolvedValue({ user: { id: 'admin' } }),
        assertMutation: jest.fn(() => {
          throw new Error('Unconfirmed request');
        }),
      };
      const portal = { [method]: jest.fn() };
      const controller = new PortalController(auth as any, portal as any);
      await expect(
        controller[method]({} as any, 'server', {} as any),
      ).rejects.toThrow('Unconfirmed');
      expect(portal[method]).not.toHaveBeenCalled();
    },
  );
  it('requires CSRF before dispatching an authenticated block request', async () => {
    const session = { user: { id: 'admin' } };
    const auth = {
      session: jest.fn().mockResolvedValue(session),
      assertMutation: jest.fn(() => {
        throw new Error('Unconfirmed request');
      }),
    };
    const portal = { walletBlock: jest.fn() };
    const controller = new PortalController(auth as any, portal as any);
    await expect(
      controller.walletBlock({} as any, 'server', 'member', {} as any),
    ).rejects.toThrow('Unconfirmed request');
    expect(portal.walletBlock).not.toHaveBeenCalled();
  });
});
