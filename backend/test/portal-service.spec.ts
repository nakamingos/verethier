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
        expect.objectContaining({ key: 'attribute_value', value: 'Gold' }),
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
