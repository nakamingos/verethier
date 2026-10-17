import { PortalService, portalRule } from '../src/portal/portal.service';
import { PermissionFlagsBits } from 'discord.js';

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
      members: { fetch: jest.fn() },
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
  it('does not reveal wallet information for nonmembers', async () => {
    guild.members.fetch
      .mockResolvedValueOnce({ id: user, permissions: { has: () => true } })
      .mockRejectedValueOnce(new Error('Unknown member'));
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
