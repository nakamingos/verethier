import { MemberService } from '../src/portal/member.service';
import { MemberController } from '../src/portal/member.controller';
import { privateKeyToAccount } from 'viem/accounts';

describe('Member account boundaries and fresh wallet proofs', () => {
  const account = privateKeyToAccount(
    ('0x' + '11'.repeat(32)) as `0x${string}`,
  );
  const other = privateKeyToAccount(('0x' + '22'.repeat(32)) as `0x${string}`);
  const user = '111111111111111111',
    server = '222222222222222222',
    channel = '333333333333333333';
  const session = {
    user: { id: user, name: 'Collector' },
    guilds: [{ id: server }],
    csrf: 'csrf',
  } as any;
  let service: MemberService,
    db: any,
    nonces: any,
    bitcoin: any,
    rules: any,
    guild: any;
  beforeEach(() => {
    db = {
      from: jest.fn(),
      rpc: jest.fn().mockResolvedValue({ data: { linked: true }, error: null }),
    };
    nonces = {
      getActiveNonce: jest
        .fn()
        .mockResolvedValue({ expiry: Math.floor(Date.now() / 1000) + 600 }),
      createNonce: jest.fn().mockResolvedValue('nonce'),
      invalidateNonce: jest.fn(),
    };
    bitcoin = { verifyMessage: jest.fn() };
    rules = {
      getRoleMappings: jest.fn().mockResolvedValue([]),
      getEarnedRoleAssignments: jest.fn().mockResolvedValue([]),
      getRulesByChannel: jest.fn().mockResolvedValue([{ id: 1 }]),
    };
    guild = {
      id: server,
      name: 'Joined',
      iconURL: () => null,
      members: { fetch: jest.fn().mockResolvedValue({ id: user }) },
      channels: { fetch: jest.fn() },
      roles: { cache: new Map() },
    };
    service = new MemberService(
      db,
      {
        getBotClient: () => ({ guilds: { cache: new Map([[server, guild]]) } }),
      } as any,
      rules,
      nonces,
      bitcoin,
      { origin: 'https://bouncer.example' } as any,
    );
  });
  async function challenge(walletType = 'evm', address = account.address) {
    jest
      .spyOn(service as any, 'saveFlow')
      .mockImplementation(async (_: any, flow: any) => ({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        ...flow,
      }));
    const result = await service.linkChallenge(session, {
      walletType,
      address,
    } as any);
    jest.spyOn(service as any, 'flow').mockResolvedValue({
      ...result,
      user_id: user,
      purpose: 'wallet_link',
      wallet_type: walletType,
      expires_at: result.expiresAt,
    });
    return result;
  }
  it('rejects malformed EVM addresses before saving a challenge', async () => {
    for (const address of ['invalid', '0x123', ' 0x' + '1'.repeat(40)])
      await expect(
        service.linkChallenge(session, { walletType: 'evm', address }),
      ).rejects.toThrow('Use an EVM');
    expect(db.from).not.toHaveBeenCalled();
  });
  it('requires a new purpose-bound signature for the authenticated account', async () => {
    const flow = await challenge();
    expect(flow.challenge.primaryType).toBe('WalletLink');
    expect(flow.challenge.message).toEqual(
      expect.objectContaining({
        UserID: user,
        Domain: 'https://bouncer.example',
        Purpose: 'Link wallet to Bouncer',
      }),
    );
    const signature = await account.signTypedData(flow.challenge as any);
    await expect(
      service.link(session, { flow: flow.id, signature }),
    ).resolves.toEqual({ linked: true });
    expect(db.rpc).toHaveBeenCalledWith('verifier_member_link_wallet', {
      p_user: user,
      p_flow: flow.id,
      p_transfer: false,
    });
    expect(nonces.consumeNonce).toBeUndefined();
  });
  it('rejects another wallet and signatures for another user, domain or purpose', async () => {
    const flow = await challenge();
    const messages = [
      await other.signTypedData(flow.challenge as any),
      await account.signTypedData({
        ...flow.challenge,
        message: { ...flow.challenge.message, UserID: 'other' },
      } as any),
      await account.signTypedData({
        ...flow.challenge,
        message: { ...flow.challenge.message, Domain: 'https://evil.example' },
      } as any),
      await account.signTypedData({
        ...flow.challenge,
        message: { ...flow.challenge.message, Purpose: 'Verify roles' },
      } as any),
    ];
    for (const signature of messages)
      await expect(
        service.link(session, { flow: flow.id, signature }),
      ).rejects.toThrow('Invalid wallet signature');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { completed_at: 'now' },
    { expires_at: '2000-01-01' },
    { purpose: 'verify' },
    { id: 'other-flow' },
  ])('rejects a used, expired or substituted flow: %o', async (patch) => {
    const flow = await challenge();
    (service as any).flow.mockResolvedValue({
      ...flow,
      purpose: 'wallet_link',
      wallet_type: 'evm',
      expires_at: flow.expiresAt,
      ...patch,
    });
    await expect(
      service.link(session, {
        flow: flow.id,
        signature: await account.signTypedData(flow.challenge as any),
      }),
    ).rejects.toThrow('expired');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('does not allow two proof requests to mutate the account concurrently', async () => {
    const flow = await challenge();
    const signature = await account.signTypedData(flow.challenge as any);
    const results = await Promise.allSettled([
      service.link(session, { flow: flow.id, signature }),
      service.link(session, { flow: flow.id, signature }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('requires explicit transfer confirmation and never receives a claimed user ID', async () => {
    const flow = await challenge();
    db.rpc.mockResolvedValueOnce({
      data: { requiresTransfer: true },
      error: null,
    });
    const signature = await account.signTypedData(flow.challenge as any);
    expect(await service.link(session, { flow: flow.id, signature })).toEqual({
      requiresTransfer: true,
    });
    await service.link(session, { flow: flow.id, signature, transfer: true });
    expect(db.rpc).toHaveBeenLastCalledWith('verifier_member_link_wallet', {
      p_user: user,
      p_flow: flow.id,
      p_transfer: true,
    });
  });
  it('uses the existing Bitcoin verifier with a distinct account-link message', async () => {
    // Real address validation remains the shared Bitcoin utility's responsibility.
    const { normalizeWalletAddress } = await import(
      '../src/utils/wallet-address.util'
    );
    const address = 'bc1p' + 'q'.repeat(58);
    expect(() => normalizeWalletAddress(address, 'bitcoin')).toThrow();
    const flow = {
      id: 'flow',
      purpose: 'wallet_link',
      address: 'bitcoin-address',
      wallet_type: 'bitcoin',
      challenge: 'Bouncer saved-wallet link\nDiscord user: ' + user,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    jest.spyOn(service as any, 'flow').mockResolvedValue(flow);
    await service.link(session, { flow: 'flow', signature: 'proof' });
    expect(bitcoin.verifyMessage).toHaveBeenCalledWith(
      flow.address,
      flow.challenge,
      'proof',
    );
    expect(db.rpc).toHaveBeenCalledTimes(1);
    bitcoin.verifyMessage.mockImplementation(() => {
      throw new Error('bad proof');
    });
    await expect(
      service.link(session, { flow: 'flow', signature: 'proof' }),
    ).rejects.toThrow('Invalid wallet signature');
  });
  it('rechecks current membership and channel visibility before creating a verification', async () => {
    guild.members.fetch.mockRejectedValueOnce({ code: 10007 });
    await expect(service.verify(session, { server, channel })).rejects.toThrow(
      'member',
    );
    expect(nonces.createNonce).not.toHaveBeenCalled();
    guild.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      permissionsFor: () => ({ has: () => false }),
    });
    await expect(service.verify(session, { server, channel })).rejects.toThrow(
      'not available',
    );
    expect(nonces.createNonce).not.toHaveBeenCalled();
    guild.channels.fetch.mockResolvedValue({
      id: channel,
      isTextBased: () => true,
      permissionsFor: () => ({ has: () => true }),
    });
    jest.spyOn(service as any, 'saveFlow').mockResolvedValue({});
    expect(await service.verify(session, { server, channel })).toEqual({
      url: '/verify/nonce?from=member',
    });
    expect(nonces.createNonce).toHaveBeenCalledWith(
      user,
      server,
      undefined,
      channel,
      expect.any(Object),
      true,
    );
    expect(rules.getRulesByChannel).toHaveBeenCalledWith(server, channel);
  });
  it('resumes an invalid/expired verification with a fresh challenge', async () => {
    jest.spyOn(service as any, 'flow').mockResolvedValue({
      id: 'flow',
      purpose: 'verify',
      server_id: server,
      channel_id: channel,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      nonce: 'consumed',
    });
    nonces.getActiveNonce.mockRejectedValue(new Error('used'));
    const start = jest
      .spyOn(service, 'verify')
      .mockResolvedValue({ url: '/verify/fresh' });
    expect(await service.resume(session, 'flow')).toEqual({
      url: '/verify/fresh',
    });
    expect(start).toHaveBeenCalledWith(session, { server, channel });
    await expect(service.resume(session, 'different')).rejects.toThrow(
      'no longer available',
    );
  });
  it('only removes the authenticated member’s link through an atomic database operation', async () => {
    await service.remove(session, account.address, 'request');
    expect(db.rpc).toHaveBeenCalledWith('verifier_member_remove_wallet', {
      p_user: user,
      p_address: account.address,
      p_request: 'request',
    });
    db.rpc.mockResolvedValue({ error: { message: 'private database detail' } });
    await expect(
      service.remove(session, account.address, 'request'),
    ).rejects.toThrow('wallet link changed');
  });
  it('requires login and CSRF before every member mutation', async () => {
    const auth = {
      session: jest.fn().mockResolvedValue(session),
      assertMutation: jest.fn(() => {
        throw new Error('csrf');
      }),
    };
    const controller = new MemberController(auth as any, service);
    const link = jest.spyOn(service, 'link');
    const remove = jest.spyOn(service, 'remove');
    const verify = jest.spyOn(service, 'verify');
    await expect(controller.proof({} as any, {} as any)).rejects.toThrow(
      'csrf',
    );
    await expect(controller.remove({} as any, {} as any)).rejects.toThrow(
      'csrf',
    );
    await expect(controller.verify({} as any, {} as any)).rejects.toThrow(
      'csrf',
    );
    expect(link).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  function query(data: any) {
    const q: any = {};
    for (const method of [
      'select',
      'eq',
      'order',
      'limit',
      'in',
      'maybeSingle',
    ])
      q[method] = jest.fn().mockReturnValue(q);
    q.then = (resolve: any) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return q;
  }
  it('lists only joined communities, omits hidden channels, and reads account records without scanning ownership', async () => {
    const visible = {
      id: channel,
      name: 'verify',
      permissionsFor: () => ({ has: () => true }),
    };
    const hidden = {
      id: 'hidden',
      name: 'staff-only',
      permissionsFor: () => ({ has: () => false }),
    };
    guild.channels.fetch.mockResolvedValue(
      new Map([
        [channel, visible],
        ['hidden', hidden],
      ]),
    );
    rules.getRoleMappings.mockResolvedValue([
      {
        id: 1,
        channel_id: channel,
        role_id: 'holder',
        slug: 'nakamingos',
        min_items: 1,
      },
      { id: 2, channel_id: 'hidden', role_id: 'staff', slug: 'private' },
    ]);
    rules.getEarnedRoleAssignments.mockResolvedValue([
      { server_id: server, role_id: 'holder', status: 'active' },
      { server_id: 'not-joined', role_id: 'private-role', status: 'active' },
    ]);
    const walletQuery = query([
      { address: account.address, wallet_type: 'evm' },
    ]);
    db.from.mockImplementation((table) =>
      table === 'user_wallets'
        ? walletQuery
        : query(
            table === 'verifier_member_flows'
              ? null
              : table === 'verifier_server_settings'
                ? { verification_channel_id: channel }
                : [],
          ),
    );
    const result = await service.overview({
      ...session,
      guilds: [{ id: server }, { id: 'not-joined' }],
    });
    expect(result.counts).toEqual({ wallets: 1, communities: 1, roles: 1 });
    expect(result.communities[0].channels.map((c) => c.id)).toEqual([channel]);
    expect(JSON.stringify(result)).not.toContain('staff-only');
    expect(JSON.stringify(result)).not.toContain('private-role');
    expect(walletQuery.eq).toHaveBeenCalledWith('user_id', user);
    expect(rules.getEarnedRoleAssignments).toHaveBeenCalledWith({
      userId: user,
    });
    expect(guild.members.fetch).toHaveBeenCalledWith({ user, force: true });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('does not return a stale OAuth membership, and keeps wallets usable during a Discord outage', async () => {
    db.from.mockImplementation((table) =>
      query(
        table === 'user_wallets'
          ? [{ address: account.address }]
          : table === 'verifier_member_flows'
            ? null
            : [],
      ),
    );
    guild.members.fetch.mockRejectedValueOnce({ code: 10007 });
    const departed = await service.overview(session);
    expect(departed.communities).toEqual([]);
    expect(departed.communitiesUnavailable).toBe(false);
    expect(rules.getRoleMappings).not.toHaveBeenCalled();
    guild.members.fetch.mockRejectedValueOnce({ code: 500 });
    const unavailable = await service.overview(session);
    expect(unavailable.wallets).toHaveLength(1);
    expect(unavailable.communitiesUnavailable).toBe(true);
    jest.spyOn((service as any).discord, 'getBotClient').mockReturnValue(null);
    const reconnecting = await service.overview(session);
    expect(reconnecting.wallets).toHaveLength(1);
    expect(reconnecting.communitiesUnavailable).toBe(true);
  });
  it('keeps the previous account identity, communities and role results private after a transfer', async () => {
    const job = {
      id: 'job',
      member_action_id: 'action',
      server_id: 'private-server',
      user_id: 'previous-account',
      status: 'completed',
      result: { private: 'old roles' },
    };
    db.from.mockImplementation((table) =>
      query(
        table === 'verifier_member_actions'
          ? [{ id: 'action', kind: 'wallet_link', address: account.address }]
          : table === 'verifier_reconciliation_jobs'
            ? [job]
            : table === 'verifier_member_flows'
              ? null
              : [],
      ),
    );
    const result = await service.overview({ ...session, guilds: [] });
    expect(result.actions[0].jobs).toEqual([
      {
        id: 'job',
        status: 'completed',
        community: 'Previous account',
        result: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private-server');
    expect(JSON.stringify(result)).not.toContain('old roles');
  });
});
