import { Collection, ChannelType, PermissionFlagsBits } from 'discord.js';
import { ForbiddenException } from '@nestjs/common';
import { ServerSetupService } from '../src/services/server-setup.service';
import { DiscordMessageService } from '../src/services/discord-message.service';

const server = '111111111111111111',
  actor = '222222222222222222',
  botId = '333333333333333333';
const request = '11111111-1111-4111-8111-111111111111';
describe('Reviewed server setup', () => {
  let service: ServerSetupService,
    guild: any,
    db: any,
    rules: any,
    messages: any,
    health: any;
  let channels: Collection<string, any>,
    roles: Collection<string, any>,
    settings: any,
    operation: any,
    bot: any;
  const channel = (id: string, name: string, topic?: string) => ({
    id,
    name,
    topic,
    type: ChannelType.GuildText,
    permissionsFor: jest.fn((member) => ({ has: () => member.id === botId })),
    permissionOverwrites: {
      cache: new Collection([
        [server, {}],
        [botId, {}],
      ]),
    },
  });
  const preview = () =>
    service.previewChannels(guild, actor, {
      request_id: request,
      admin_channel_name: 'bouncer-admin',
      verification_channel_name: 'verify',
    });
  beforeEach(() => {
    channels = new Collection();
    roles = new Collection();
    settings = { admin_channel_id: null, verification_channel_id: null };
    operation = null;
    bot = { id: botId, permissions: { has: jest.fn(() => true) } };
    guild = {
      id: server,
      client: { user: { id: botId } },
      members: { fetch: jest.fn().mockResolvedValue(bot) },
      channels: {
        fetch: jest.fn(async () => new Collection(channels)),
        create: jest.fn(async (input) => {
          const created = channel(
            String(400000000000000000n + BigInt(channels.size)),
            input.name,
            input.topic,
          );
          channels.set(created.id, created);
          return created;
        }),
      },
      roles: {
        everyone: { id: server },
        fetch: jest.fn(async () => new Collection(roles)),
        cache: new Collection(),
      },
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: settings, error: null })),
    };
    db = {
      from: jest.fn(() => query),
      rpc: jest.fn(async (_name, input) => {
        if (input.p_step === 'preview')
          operation = {
            request_id: input.p_request,
            plan: input.p_payload,
            progress: {},
            status: 'preview',
          };
        else if (input.p_step === 'claim' && operation.status !== 'completed') {
          operation.status = 'applying';
          operation.started_at = '2026-10-18T12:00:00Z';
        } else if (input.p_step === 'progress')
          operation.progress = { ...operation.progress, ...input.p_payload };
        else if (input.p_step === 'finish') {
          operation.status = 'completed';
          operation.progress = { ...operation.progress, ...input.p_payload };
        } else if (input.p_step === 'release') operation.status = 'retry';
        return { data: structuredClone(operation), error: null };
      }),
    };
    rules = {
      getRoleMappings: jest.fn().mockResolvedValue([]),
      getRulesByChannel: jest.fn().mockResolvedValue([]),
    };
    messages = {
      getExistingControlRoomMessage: jest.fn().mockResolvedValue(null),
      getExistingVerificationMessage: jest.fn().mockResolvedValue(null),
      controlRoomMessage: jest.fn().mockResolvedValue('admin-message'),
      createVerificationMessage: jest
        .fn()
        .mockResolvedValue('verification-message'),
    };
    health = { check: jest.fn().mockResolvedValue([]) };
    service = new ServerSetupService(db, rules, messages, health);
  });
  it('previews names, permission policy and previous IDs without creating channels or messages', async () => {
    const result = await preview();
    expect(result.plan).toMatchObject({
      kind: 'channels',
      before: settings,
      admin: { name: 'bouncer-admin', create: true },
      verification: { name: 'verify', create: true },
    });
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(messages.controlRoomMessage).not.toHaveBeenCalled();
  });
  it('reuses explicitly selected channels without requiring Manage Channels or modifying permissions', async () => {
    channels.set('a', channel('a', 'admin'));
    channels.set('v', channel('v', 'verify'));
    bot.permissions.has.mockImplementation(
      (flags) =>
        !Array.isArray(flags) ||
        !flags.includes(PermissionFlagsBits.ManageChannels),
    );
    await service.previewChannels(guild, actor, {
      request_id: request,
      admin_channel_id: 'a',
      verification_channel_id: 'v',
    });
    await service.apply(guild, actor, request, async () => guild);
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(messages.controlRoomMessage).toHaveBeenCalledTimes(1);
  });
  it('requires operation-specific bot permissions for new channels', async () => {
    bot.permissions.has.mockReturnValue(false);
    await expect(preview()).rejects.toThrow('Manage Channels');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects ambiguous same-name channels and identical admin/verification channels', async () => {
    channels.set('a', channel('a', 'bouncer-admin'));
    await expect(preview()).rejects.toThrow('already exists');
    await expect(
      service.previewChannels(guild, actor, {
        request_id: request,
        admin_channel_id: 'a',
        verification_channel_id: 'a',
      }),
    ).rejects.toThrow('separate');
  });
  it('creates separate channels with private admin overwrites, saves progress and replays completion', async () => {
    await preview();
    const authorize = jest.fn(async () => guild);
    const result = await service.apply(guild, actor, request, authorize);
    expect(result.status).toBe('completed');
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
    expect(guild.channels.create.mock.calls[0][0].permissionOverwrites).toEqual(
      [
        { id: server, allow: [], deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: botId,
          allow: expect.arrayContaining([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
          ]),
        },
      ],
    );
    expect(authorize.mock.calls.length).toBeGreaterThanOrEqual(4);
    await service.apply(guild, actor, request, authorize);
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
    expect(messages.controlRoomMessage).toHaveBeenCalledTimes(1);
    expect(messages.createVerificationMessage).not.toHaveBeenCalled();
  });
  it('recovers a channel after Discord succeeds but saving its receipt fails', async () => {
    await preview();
    const rpc = db.rpc.getMockImplementation();
    let fail = true;
    db.rpc.mockImplementation(async (name, input) => {
      if (
        fail &&
        input.p_step === 'progress' &&
        input.p_payload.admin_channel_id
      ) {
        fail = false;
        return { error: { code: 'XX000' } };
      }
      return rpc(name, input);
    });
    await expect(
      service.apply(guild, actor, request, async () => guild),
    ).rejects.toThrow('save setup progress');
    expect(channels.size).toBe(1);
    const result = await service.apply(
      guild,
      actor,
      request,
      async () => guild,
    );
    expect(result.status).toBe('completed');
    expect(channels.size).toBe(2);
    expect(guild.channels.create).toHaveBeenCalledTimes(2);
  });
  it('stops before the next Discord mutation if live admin permission is lost', async () => {
    await preview();
    await expect(
      service.apply(guild, actor, request, async () => {
        throw new ForbiddenException('Administrator required');
      }),
    ).rejects.toThrow('Administrator required');
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect(messages.controlRoomMessage).not.toHaveBeenCalled();
  });
  it('does not resend an uncertain Discord channel creation when no resource can yet be confirmed', async () => {
    await preview();
    guild.channels.create.mockRejectedValue(new Error('connection lost'));
    await expect(
      service.apply(guild, actor, request, async () => guild),
    ).rejects.toThrow('could not finish');
    await expect(
      service.apply(guild, actor, request, async () => guild),
    ).rejects.toThrow('uncertain result');
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
  });
  it('allows retry after Discord definitively rejects creation', async () => {
    await preview();
    guild.channels.create.mockRejectedValueOnce(
      Object.assign(new Error('Missing permissions'), { status: 403 }),
    );
    await expect(
      service.apply(guild, actor, request, async () => guild),
    ).rejects.toThrow('could not finish');
    const result = await service.apply(
      guild,
      actor,
      request,
      async () => guild,
    );
    expect(result.status).toBe('completed');
    expect(channels.size).toBe(2);
  });
  it('does not adopt a public or altered admin channel from an unfinished setup', async () => {
    await preview();
    const changed = channel('a', 'admin', `Bouncer setup ${request} admin`);
    changed.permissionsFor.mockImplementation(() => ({ has: () => true }));
    channels.set('a', changed);
    await expect(
      service.apply(guild, actor, request, async () => guild),
    ).rejects.toThrow('permissions changed');
    expect(messages.controlRoomMessage).not.toHaveBeenCalled();
  });
  it('rechecks messages after preview and reuses a concurrent recovery', async () => {
    channels.set('v', channel('v', 'verify'));
    rules.getRulesByChannel.mockResolvedValue([{ id: 1 }]);
    await service.previewRecovery(guild, actor, 'v', request);
    messages.getExistingVerificationMessage.mockResolvedValue({
      id: 'already-posted',
    });
    const result = await service.apply(
      guild,
      actor,
      request,
      async () => guild,
    );
    expect(result.progress.verification_message_id).toBe('already-posted');
    expect(messages.createVerificationMessage).not.toHaveBeenCalled();
  });
  it('never recovers after a failed or incomplete history search', async () => {
    channels.set('v', channel('v', 'verify'));
    rules.getRulesByChannel.mockResolvedValue([{ id: 1 }]);
    await service.previewRecovery(guild, actor, 'v', request);
    messages.getExistingVerificationMessage.mockRejectedValue(
      new Error('history incomplete'),
    );
    await expect(
      service.apply(guild, actor, request, async () => guild),
    ).rejects.toThrow('could not finish');
    expect(messages.createVerificationMessage).not.toHaveBeenCalled();
  });
  it('uses fresh Discord collections and groups missing-message reports by channel', async () => {
    channels.set('v', channel('v', 'verify'));
    settings.verification_channel_id = 'v';
    rules.getRoleMappings.mockResolvedValue([
      { id: 1, role_id: 'deleted', channel_id: 'v' },
      { id: 2, role_id: 'r', channel_id: 'v' },
    ]);
    roles.set('r', { editable: true });
    guild.roles.cache.set('deleted', { editable: true });
    const report = await service.check(guild);
    expect(guild.members.fetch).toHaveBeenCalledWith({
      user: botId,
      force: true,
    });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'role:1', rule_ids: [1] }),
        expect.objectContaining({ repairable: true, rule_ids: [1, 2] }),
      ]),
    );
    expect(messages.getExistingVerificationMessage).toHaveBeenCalledTimes(1);
  });
  it.each(['permissions', 'history'])(
    'does not offer repairs when %s cannot be checked',
    async (failure) => {
      const c = channel('v', 'verify');
      channels.set('v', c);
      rules.getRoleMappings.mockResolvedValue([
        { id: 1, channel_id: 'v', role_id: 'r' },
      ]);
      roles.set('r', { editable: true });
      if (failure === 'permissions')
        c.permissionsFor.mockImplementation(() => ({ has: () => false }));
      else
        messages.getExistingVerificationMessage.mockRejectedValue(
          new Error('credentials must not leak'),
        );
      const report = await service.check(guild);
      expect(report.issues.some((issue) => issue.repairable)).toBe(false);
      expect(JSON.stringify(report)).not.toContain('credentials');
    },
  );
});

describe('Bounded setup message search', () => {
  it('does not mistake a full search window for proof of a missing message', async () => {
    const messages = new DiscordMessageService();
    messages.initialize({ user: { id: botId } } as any);
    let page = 0;
    const fetch = jest
      .fn(
        async () =>
          new Collection(
            Array.from({ length: 100 }, (_, index) => {
              const id = String(page * 100 + index);
              return [id, { id, author: { id: actor }, components: [] }] as any;
            }),
          ),
      )
      .mockImplementation(async () => {
        page++;
        return new Collection(
          Array.from({ length: 100 }, (_, index) => {
            const id = String(page * 100 + index);
            return [id, { id, author: { id: actor }, components: [] }] as any;
          }),
        );
      });
    await expect(
      messages.getExistingVerificationMessage(
        {
          messages: { fetch, fetchPinned: async () => new Collection() },
        } as any,
        true,
      ),
    ).rejects.toThrow('search limit');
    expect(fetch).toHaveBeenCalledTimes(10);
  });
});
