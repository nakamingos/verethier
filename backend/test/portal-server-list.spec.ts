import { PortalService } from '../src/portal/portal.service';
import { PortalSession } from '../src/portal/portal-auth.service';

describe('Portal server discovery', () => {
  const user = '111111111111111111';
  const installed = '222222222222222222';
  const admin = '333333333333333333';
  const owner = '444444444444444444';
  const botOnly = '555555555555555555';
  const bot = '666666666666666666';
  const session: PortalSession = {
    user: { id: user, name: 'Admin', avatar: null },
    guilds: [
      {
        id: installed,
        name: 'Installed admin server',
        icon: null,
        owner: false,
        permissions: '8',
      },
      {
        id: admin,
        name: 'Admin server without Bouncer',
        icon: null,
        owner: false,
        permissions: '8',
      },
      {
        id: owner,
        name: 'Owned server without Bouncer',
        icon: 'avatar',
        owner: true,
        permissions: '0',
      },
      {
        id: '777777777777777777',
        name: 'Member only',
        icon: null,
        owner: false,
        permissions: '32',
      },
      {
        id: '888888888888888888',
        name: 'Invalid permissions',
        icon: null,
        owner: false,
        permissions: 'invalid',
      },
    ],
    csrf: 'csrf',
    hash: 'hash',
  };

  function setup(operator: boolean) {
    const guild = {
      id: botOnly,
      name: 'Operator-visible bot server',
      icon: null,
      ownerId: '999999999999999999',
      members: {
        fetch: jest
          .fn()
          .mockResolvedValue({ id: user, permissions: { has: () => false } }),
      },
    };
    const client = {
      user: { id: bot },
      guilds: {
        cache: new Map([
          [
            installed,
            { ...guild, id: installed, name: 'Installed admin server' },
          ],
          [botOnly, guild],
        ]),
      },
    };
    const args = Array(12).fill({});
    args[1] = { getBotClient: () => client };
    const service = new PortalService(
      ...(args as [any, any, any, any, any, any, any, any, any, any, any, any]),
      undefined,
      { isOperator: () => operator } as any,
    );
    return { service, guild };
  }

  it.each([false, true])(
    'preserves admin and owner install choices with operator=%s',
    (operator) => {
      const { service } = setup(operator);
      const result = service.servers(session);
      expect(result.servers.map((g) => g.id)).toEqual([
        installed,
        admin,
        owner,
        ...(operator ? [botOnly] : []),
      ]);
      expect(result.servers.filter((g) => g.id === installed)).toHaveLength(1);
      expect(result.servers.find((g) => g.id === installed).installed).toBe(
        true,
      );
      for (const id of [admin, owner]) {
        const server = result.servers.find((g) => g.id === id);
        expect(server.installed).toBe(false);
        const invite = new URL(server.invite);
        expect(invite.searchParams.get('guild_id')).toBe(id);
        expect(invite.searchParams.get('client_id')).toBe(bot);
        expect(invite.searchParams.get('scope')).toBe(
          'bot applications.commands',
        );
        expect(invite.searchParams.get('disable_guild_select')).toBe('true');
      }
      expect(session.guilds).toHaveLength(5);
    },
  );

  it('keeps live admin authorization for changes to operator-visible servers', async () => {
    const { service, guild } = setup(true);
    expect(
      service.servers(session).servers.find((g) => g.id === botOnly).installed,
    ).toBe(true);
    await expect(service.access(session, botOnly)).rejects.toThrow(
      'Administrator',
    );
    expect(guild.members.fetch).toHaveBeenCalledWith({ user, force: true });
  });
});
