import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { PortalService } from '../src/portal/portal.service';

describe('Member lookup by proven wallet address', () => {
  const server = '111111111111111111';
  const currentId = '555555555555555555',
    previousId = '888888888888888888';
  const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bitcoin = bitcoinAddress.toBech32(new Uint8Array(32).fill(1), 1, 'bc');
  const session = { user: { id: '222222222222222222' } } as any;
  function setup(current = [currentId], historical: string[] = []) {
    const currentQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: current.map((user_id) => ({ user_id })),
        error: null,
      }),
    };
    const historyQuery: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: historical.map((user_id, id) => ({ user_id, id })),
        error: null,
      }),
    };
    const db: any = {
      from: jest.fn((table) =>
        table === 'user_wallets' ? currentQuery : historyQuery,
      ),
    };
    const member = (id: string) => ({
      id,
      displayName:
        id === currentId ? 'Current collector' : 'Previous collector',
      user: { username: 'collector-' + id },
      displayAvatarURL: () => '/avatar',
    });
    const members = new Map([
      [currentId, member(currentId)],
      [previousId, member(previousId)],
    ]);
    const guild: any = {
      members: {
        search: jest.fn().mockResolvedValue(new Map()),
        fetch: jest.fn(async ({ user }) => {
          if (!members.has(user))
            throw Object.assign(new Error('Unknown member'), { code: 10007 });
          return members.get(user);
        }),
      },
    };
    const service = new PortalService(
      db,
      {} as any,
      {} as any,
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
    (service as any).privacy = { isOperator: () => true };
    const access = jest.spyOn(service, 'access').mockResolvedValue(guild);
    jest.spyOn(service, 'readAccess').mockResolvedValue(guild);
    return { service, db, currentQuery, historyQuery, guild, members, access };
  }
  it('normalizes an exact EVM address and confirms live membership before exposing a current match', async () => {
    const { service, currentQuery, guild } = setup();
    const result = await service.memberSuggestions(
      session,
      server,
      ' 0x' + 'A'.repeat(40) + ' ',
    );
    expect(result.members).toEqual([
      expect.objectContaining({ id: currentId, wallet_match: 'current' }),
    ]);
    expect(currentQuery.eq).toHaveBeenCalledWith('address', address);
    expect(guild.members.fetch).toHaveBeenCalledWith({
      user: currentId,
      force: true,
    });
    expect(guild.members.search).not.toHaveBeenCalled();
  });
  it('includes removed/transferred history, deduplicates events, and asks for a choice when ambiguous', async () => {
    const { service, guild } = setup(
      [currentId],
      [previousId, previousId, currentId],
    );
    const result = await service.memberSuggestions(session, server, address);
    expect(result.members.map((item) => [item.id, item.wallet_match])).toEqual([
      [currentId, 'current'],
      [previousId, 'history'],
    ]);
    expect(guild.members.fetch).toHaveBeenCalledTimes(2);
    await expect(
      (service as any).resolveMember(guild, address, session),
    ).rejects.toThrow('several server members');
  });
  it('can resolve a unique historical address without a current saved link', async () => {
    const { service, guild } = setup([], [previousId]);
    expect((await (service as any).resolveMember(guild, address, session)).id).toBe(
      previousId,
    );
  });
  it('never returns an account outside the selected server, even if it is the current owner', async () => {
    const { service, guild } = setup(['999999999999999999']);
    expect(await service.memberSuggestions(session, server, address)).toEqual({
      members: [],
    });
    await expect(
      (service as any).resolveMember(guild, address, session),
    ).rejects.toThrow('No current server member');
  });
  it.each([bitcoin, bitcoin.toUpperCase()])(
    'accepts checksum-valid Bitcoin address casing: %s',
    async (input) => {
      const { service, currentQuery } = setup();
      expect(
        (await service.memberSuggestions(session, server, input)).members[0].id,
      ).toBe(currentId);
      expect(currentQuery.eq).toHaveBeenCalledWith('address', bitcoin);
    },
  );
  it('rejects mixed-case Bitcoin before lowercasing or reading wallet associations', async () => {
    const { service, db, guild } = setup();
    const input = bitcoin.replace('q', 'Q');
    expect(await service.memberSuggestions(session, server, input)).toEqual({
      members: [],
    });
    await expect((service as any).resolveMember(guild, input)).rejects.toThrow(
      'valid Bitcoin',
    );
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(['0x1234', 'bc1p-partial'])(
    'does not run wallet-address prefix searches for %s',
    async (input) => {
      const { service, db, guild } = setup();
      expect(await service.memberSuggestions(session, server, input)).toEqual({
        members: [],
      });
      expect(db.from).not.toHaveBeenCalled();
      await expect(
        (service as any).resolveMember(guild, input),
      ).rejects.toThrow();
    },
  );
  it('checks current administrator access before either wallet lookup route reads identities', async () => {
    const { service, access, db } = setup();
    access.mockRejectedValue(new Error('Not an administrator'));
    (service.readAccess as jest.Mock).mockImplementation((s,server) => service.access(s,server));
    await expect(
      service.memberSuggestions(session, server, address),
    ).rejects.toThrow('administrator');
    await expect(
      service.member(session, server, address, false),
    ).rejects.toThrow('administrator');
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(['0xcollector', 'bc1fan'])(
    'preserves ordinary name lookup for %s',
    async (name) => {
      const { service, guild, db } = setup();
      guild.members.search.mockResolvedValue(
        new Map([
          [
            currentId,
            {
              id: currentId,
              displayName: name,
              user: { username: name },
              displayAvatarURL: () => '/avatar',
            },
          ],
        ]),
      );
      expect(
        (await service.memberSuggestions(session, server, name)).members[0].id,
      ).toBe(currentId);
      expect((await (service as any).resolveMember(guild, name)).id).toBe(
        currentId,
      );
      expect(db.from).not.toHaveBeenCalled();
    },
  );
  it('fails rather than returning an incomplete result when history or membership is unavailable', async () => {
    const { service, historyQuery, guild } = setup();
    historyQuery.range.mockResolvedValueOnce({ data: null, error: {} });
    await expect(
      service.memberSuggestions(session, server, address),
    ).rejects.toThrow('dashboard data');
    guild.members.fetch.mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(
      service.memberSuggestions(session, server, address),
    ).rejects.toThrow('confirm wallet matches');
  });
  it('reads all history pages, including a later unique account', async () => {
    const { service, historyQuery } = setup([], []);
    historyQuery.range
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, id) => ({
          id,
          user_id: previousId,
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'later', user_id: currentId }],
        error: null,
      });
    expect(
      (await service.memberSuggestions(session, server, address)).members.map(
        (item) => item.id,
      ),
    ).toEqual([previousId, currentId]);
    expect(historyQuery.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});
