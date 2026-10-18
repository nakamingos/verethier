import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  ChannelType,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { createHash, randomUUID } from 'crypto';
import { DbService } from './db.service';
import { DiscordMessageService } from './discord-message.service';
import { SetupHealthService } from './setup-health.service';

const MESSAGE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
];
const channelName = (name: string) =>
  /^[a-z0-9][a-z0-9_-]{0,99}$/.test(name || '');
export interface SetupChannelsInput {
  admin_channel_id?: string | null;
  verification_channel_id?: string | null;
  admin_channel_name?: string;
  verification_channel_name?: string;
  request_id: string;
}
export interface SetupIssue {
  id: string;
  status: 'warning' | 'unavailable';
  message: string;
  remedy: string;
  rule_ids: number[];
  channel_id?: string;
  repairable?: boolean;
}

@Injectable()
export class ServerSetupService {
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly rules: DbService,
    private readonly messages: DiscordMessageService,
    private readonly health: SetupHealthService,
  ) {}

  private async settings(server: string) {
    const result = await this.db
      .from('verifier_server_settings')
      .select('admin_channel_id,verification_channel_id')
      .eq('server_id', server)
      .maybeSingle();
    if (result.error)
      throw new ServiceUnavailableException('Could not read channel settings.');
    return (
      result.data || { admin_channel_id: null, verification_channel_id: null }
    );
  }
  private async fresh(guild: Guild) {
    const [bot, channels, roles] = await Promise.all([
      guild.members.fetch({ user: guild.client.user.id, force: true }),
      guild.channels.fetch(),
      guild.roles.fetch(),
    ]);
    return { bot, channels, roles };
  }
  private text(
    channels: Awaited<ReturnType<Guild['channels']['fetch']>>,
    id: string,
  ): TextChannel {
    const channel = (channels as any).get(id);
    if (!channel || channel.type !== ChannelType.GuildText)
      throw new BadRequestException(
        'Choose an accessible text channel in this server.',
      );
    return channel;
  }
  private canPost(channel: TextChannel, bot: GuildMember) {
    if (!channel.permissionsFor(bot)?.has(MESSAGE_PERMISSIONS)) {
      throw new BadRequestException(
        `Allow Bouncer to view, send messages, read history and embed links in #${channel.name}.`,
      );
    }
  }

  async check(guild: Guild) {
    const [{ bot, channels, roles }, rules, settings] = await Promise.all([
      this.fresh(guild),
      this.rules.getRoleMappings(guild.id),
      this.settings(guild.id),
    ]);
    const issues: SetupIssue[] = [];
    if (!bot.permissions.has(PermissionFlagsBits.ManageRoles))
      issues.push({
        id: 'manage-roles',
        status: 'warning',
        message: 'Bouncer cannot manage roles.',
        remedy:
          'Enable Manage Roles, then place Bouncer above the roles it assigns.',
        rule_ids: rules.map((r) => r.id),
      });
    if (!rules.length)
      issues.push({
        id: 'no-rules',
        status: 'warning',
        message: 'No verification rules are configured.',
        remedy:
          'Add a rule in the Rules tab, then recover its verification message.',
        rule_ids: [],
      });
    const grouped = new Map<string, number[]>();
    for (const rule of rules) {
      const role = roles.get(rule.role_id);
      if (!role || !role.editable)
        issues.push({
          id: `role:${rule.id}`,
          status: 'warning',
          message: `Rule #${rule.id}: ${role ? 'role cannot be assigned.' : 'role was deleted.'}`,
          remedy: role
            ? 'Move Bouncer above the target role and check Manage Roles. Managed roles cannot be assigned.'
            : 'Edit the rule and select or create an existing manageable role.',
          rule_ids: [rule.id],
        });
      if (!grouped.has(rule.channel_id)) grouped.set(rule.channel_id, []);
      grouped.get(rule.channel_id).push(rule.id);
    }
    if (
      settings.verification_channel_id &&
      !grouped.has(settings.verification_channel_id)
    )
      grouped.set(settings.verification_channel_id, []);
    if (!settings.verification_channel_id)
      issues.push({
        id: 'default-channel',
        status: 'warning',
        message: 'No default verification channel is selected.',
        remedy:
          'Select a default in Bot Settings. Members can still choose configured verification channels.',
        rule_ids: [],
      });
    if (settings.admin_channel_id && !channels.has(settings.admin_channel_id))
      issues.push({
        id: 'admin-channel',
        status: 'warning',
        message: 'The saved admin channel is missing or inaccessible.',
        remedy: 'Review channel setup to select or create a replacement.',
        rule_ids: [],
      });
    const entries = [...grouped.entries()];
    const messageChecks: any[] = [];
    await Promise.all(
      Array.from({ length: Math.min(3, entries.length) }, async () => {
        while (entries.length) {
          const [id, ruleIds] = entries.shift();
          const channel = channels.get(id);
          const result = {
            channel_id: id,
            name: channel?.name || id,
            rule_ids: ruleIds,
            status: 'unavailable',
            message_id: null as string | null,
          };
          if (!channel || channel.type !== ChannelType.GuildText) {
            issues.push({
              id: `channel:${id}`,
              status: 'warning',
              message: 'A verification channel is missing or inaccessible.',
              remedy:
                'Restore Bouncer’s channel access, or explicitly recreate affected rules in another channel and update the default.',
              rule_ids: ruleIds,
              channel_id: id,
            });
          } else if (!channel.permissionsFor(bot)?.has(MESSAGE_PERMISSIONS)) {
            issues.push({
              id: `permissions:${id}`,
              status: 'warning',
              message: `Bouncer lacks verification permissions in #${channel.name}.`,
              remedy:
                'Allow View Channel, Send Messages, Read Message History and Embed Links. Existing permissions are never rewritten automatically.',
              rule_ids: ruleIds,
              channel_id: id,
            });
          } else if (!ruleIds.length) {
            result.status = 'no_rules';
            issues.push({
              id: `empty:${id}`,
              status: 'warning',
              message: `#${channel.name} has no verification rules.`,
              remedy:
                'Add a rule for this channel before posting a verification message.',
              rule_ids: [],
              channel_id: id,
            });
          } else {
            try {
              const message =
                await this.messages.getExistingVerificationMessage(
                  channel,
                  true,
                );
              result.status = message ? 'ready' : 'missing';
              result.message_id = message?.id || null;
              if (!message)
                issues.push({
                  id: `message:${id}`,
                  status: 'warning',
                  message: `Verification message missing in #${channel.name}.`,
                  remedy:
                    'Review recovery to post one message using this channel’s current rules.',
                  rule_ids: ruleIds,
                  channel_id: id,
                  repairable: true,
                });
            } catch {
              issues.push({
                id: `message:${id}`,
                status: 'unavailable',
                message: `Could not finish checking messages in #${channel.name}.`,
                remedy:
                  'Check message-history permissions and retry. For channels with more than 1,000 messages, pin an existing verification message. No missing-message repair is offered for an incomplete search.',
                rule_ids: ruleIds,
                channel_id: id,
              });
            }
          }
          messageChecks.push(result);
        }
      }),
    );
    const providers = await this.health.check(rules);
    return {
      checked_at: new Date().toISOString(),
      issues: issues.sort((a, b) => a.id.localeCompare(b.id)),
      channels: messageChecks.sort((a, b) =>
        a.channel_id.localeCompare(b.channel_id),
      ),
      providers,
    };
  }

  private async operation(
    step: string,
    server: string,
    actor: string,
    request: string,
    payload = {},
    worker?: string,
  ) {
    const result = await this.db.rpc('verifier_setup_request', {
      p_step: step,
      p_server: server,
      p_actor: actor,
      p_request: request,
      p_payload: payload,
      p_worker: worker || null,
    });
    if (result.error) {
      if (result.error.code === '40001' || result.error.code === '23505')
        throw new ConflictException(
          'Setup changed, expired or is already running. Retry this request, or refresh and review a new setup.',
        );
      throw new ServiceUnavailableException(
        'Could not save setup progress. Retry the same reviewed request.',
      );
    }
    return result.data;
  }
  private createPermissions(bot: GuildMember) {
    if (
      !bot.permissions.has([
        PermissionFlagsBits.ManageChannels,
        ...MESSAGE_PERMISSIONS,
      ])
    ) {
      throw new BadRequestException(
        'Channel creation needs Manage Channels, View Channel, Send Messages, Read Message History and Embed Links for Bouncer. Existing-channel setup does not need Manage Channels.',
      );
    }
  }
  async get(server: string, actor: string, request: string) {
    const result = await this.db
      .from('verifier_setup_requests')
      .select('*')
      .eq('server_id', server)
      .eq('actor_id', actor)
      .eq('request_id', request)
      .maybeSingle();
    if (result.error)
      throw new ServiceUnavailableException(
        'Could not read the reviewed setup.',
      );
    if (!result.data) throw new NotFoundException('Setup request not found.');
    return result.data;
  }
  async previewChannels(
    guild: Guild,
    actor: string,
    input: SetupChannelsInput,
  ) {
    const [{ bot, channels }, before] = await Promise.all([
      this.fresh(guild),
      this.settings(guild.id),
    ]);
    const plan: any = { kind: 'channels', before };
    for (const kind of ['admin', 'verification'] as const) {
      const id = input[`${kind}_channel_id`];
      if (id) {
        const channel = this.text(channels, id);
        this.canPost(channel, bot);
        plan[kind] = { id, name: channel.name, create: false };
      } else {
        this.createPermissions(bot);
        const name = input[`${kind}_channel_name`]?.trim();
        if (!channelName(name))
          throw new BadRequestException(
            'Use 1–100 lowercase letters, numbers, underscores or hyphens for new channel names.',
          );
        if ([...channels.values()].some((c) => c?.name === name))
          throw new ConflictException(
            `A channel named #${name} already exists. Select it explicitly or choose another name.`,
          );
        plan[kind] = { id: null, name, create: true };
      }
    }
    if (
      (plan.admin.id && plan.admin.id === plan.verification.id) ||
      (plan.admin.create &&
        plan.verification.create &&
        plan.admin.name === plan.verification.name)
    ) {
      throw new BadRequestException(
        'Choose separate admin and verification channels.',
      );
    }
    plan.recover_verification =
      !!plan.verification.id &&
      (await this.rules.getRulesByChannel(guild.id, plan.verification.id))
        .length > 0;
    return this.operation('preview', guild.id, actor, input.request_id, plan);
  }
  async previewRecovery(
    guild: Guild,
    actor: string,
    channelId: string,
    request: string,
  ) {
    const { bot, channels } = await this.fresh(guild);
    const channel = this.text(channels, channelId);
    this.canPost(channel, bot);
    if (!(await this.rules.getRulesByChannel(guild.id, channel.id)).length)
      throw new BadRequestException('Add a rule for this channel first.');
    const existing = await this.messages.getExistingVerificationMessage(
      channel,
      true,
    );
    return this.operation('preview', guild.id, actor, request, {
      kind: 'recover',
      channel: { id: channel.id, name: channel.name },
      existing_message_id: existing?.id || null,
    });
  }

  async apply(
    guild: Guild,
    actor: string,
    request: string,
    authorize: () => Promise<Guild>,
  ) {
    const worker = randomUUID();
    const operation = await this.operation(
      'claim',
      guild.id,
      actor,
      request,
      {},
      worker,
    );
    if (operation.status === 'completed') return operation;
    const plan = operation.plan;
    const progress = { ...operation.progress };
    const save = async (step = 'progress') =>
      this.operation(step, guild.id, actor, request, progress, worker);
    const guard = async () => {
      guild = await authorize();
      await save();
      return this.fresh(guild);
    };
    const external = async <T>(
      key: string,
      work: () => Promise<T>,
    ): Promise<T> => {
      if (progress[key])
        throw new ConflictException(
          'An earlier Discord request has an uncertain result. Check the channel, retry after it appears, or start a new review and explicitly select the existing channel.',
        );
      // Fence before sending: an expired worker may still have an in-flight
      // Discord request. A retry must find its resource, never blindly repeat it.
      progress[key] = true;
      await save();
      try {
        return await work();
      } catch (error) {
        if (
          error?.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        ) {
          progress[key] = false; // Discord definitively rejected the request.
          await save();
        }
        throw error;
      }
    };
    const nonce = (purpose: string) =>
      BigInt(
        '0x' +
          createHash('sha256')
            .update(`${request}:${purpose}`)
            .digest('hex')
            .slice(0, 16),
      ).toString();
    try {
      if (plan.kind === 'channels') {
        for (const kind of ['admin', 'verification'] as const) {
          const { bot, channels } = await guard();
          const savedId = progress[`${kind}_channel_id`] || plan[kind].id;
          let channel: TextChannel;
          if (savedId) channel = this.text(channels, savedId);
          else {
            this.createPermissions(bot);
            const marker = `Bouncer setup ${request} ${kind}`;
            const matches = [...channels.values()].filter(
              (c) => c?.type === ChannelType.GuildText && c.topic === marker,
            ) as TextChannel[];
            if (matches.length > 1)
              throw new ConflictException(
                'Multiple setup channels found. Select the intended channel in a new review.',
              );
            channel = matches[0];
            if (!channel) {
              if (
                [...channels.values()].some((c) => c?.name === plan[kind].name)
              )
                throw new ConflictException(
                  'A channel with the reviewed name now exists. Refresh and select it explicitly.',
                );
              channel = await external(`${kind}_creation_started`, () =>
                guild.channels.create({
                  name: plan[kind].name,
                  type: ChannelType.GuildText,
                  topic: marker,
                  permissionOverwrites: [
                    {
                      id: guild.id,
                      allow:
                        kind === 'admin'
                          ? []
                          : [
                              PermissionFlagsBits.ViewChannel,
                              PermissionFlagsBits.ReadMessageHistory,
                            ],
                      deny: [
                        kind === 'admin'
                          ? PermissionFlagsBits.ViewChannel
                          : PermissionFlagsBits.SendMessages,
                      ],
                    },
                    { id: bot.id, allow: MESSAGE_PERMISSIONS },
                  ],
                  reason: `Bouncer setup requested by ${actor}`,
                }),
              );
            }
          }
          if (
            kind === 'admin' &&
            plan.admin.create &&
            (channel
              .permissionsFor(guild.roles.everyone)
              ?.has(PermissionFlagsBits.ViewChannel) ||
              [...channel.permissionOverwrites.cache.keys()].some(
                (id) => id !== guild.id && id !== bot.id,
              ))
          ) {
            throw new ConflictException(
              'The new admin channel permissions changed. Review its privacy before continuing.',
            );
          }
          this.canPost(channel, bot);
          progress[`${kind}_channel_id`] = channel.id;
          await save();
        }
        if (!progress.admin_message_id) {
          const { bot, channels } = await guard();
          const channel = this.text(channels, progress.admin_channel_id);
          this.canPost(channel, bot);
          const existing =
            await this.messages.getExistingControlRoomMessage(channel);
          progress.admin_message_id =
            existing?.id ||
            (await external('admin_post_started', () =>
              this.messages.controlRoomMessage(channel, nonce('admin')),
            ));
          await save();
        }
      }
      if (plan.kind === 'recover' || plan.recover_verification) {
        const { bot, channels } = await guard();
        const id =
          plan.kind === 'recover'
            ? plan.channel.id
            : progress.verification_channel_id;
        const channel = this.text(channels, id);
        this.canPost(channel, bot);
        if (!(await this.rules.getRulesByChannel(guild.id, id)).length)
          throw new ConflictException(
            'This channel no longer has rules. Review setup again.',
          );
        const existing = await this.messages.getExistingVerificationMessage(
          channel,
          true,
        );
        // A failed search propagates. A concurrent successful recovery is reused.
        progress.verification_channel_id = id;
        progress.verification_message_id =
          existing?.id ||
          (await external('verification_post_started', () =>
            this.messages.createVerificationMessage(
              channel,
              nonce('verification'),
            ),
          ));
        await save();
      }
      await authorize();
      return await save('finish');
    } catch (error) {
      await this.operation(
        'release',
        guild.id,
        actor,
        request,
        {},
        worker,
      ).catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Setup could not finish. Check Discord permissions and retry this reviewed request; existing progress will be reused.',
      );
    }
  }
}
