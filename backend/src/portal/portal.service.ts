import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ChannelType, Guild, PermissionFlagsBits } from 'discord.js';
import { DiscordService } from '@/services/discord.service';
import { DbService } from '@/services/db.service';
import { DiscordMessageService } from '@/services/discord-message.service';
import { RuleEditService } from '@/services/rule-edit.service';
import { VerificationEngine } from '@/services/verification-engine.service';
import { DataService } from '@/services/data.service';
import { NftOwnershipService } from '@/services/nft-ownership.service';
import { OrdinalsOwnershipService } from '@/services/ordinals-ownership.service';
import { EthscriptionsOwnershipService } from '@/services/ethscriptions-ownership.service';
import { NftMetadataService } from '@/services/nft-metadata.service';
import { getNftNetworkId } from '@/utils/nft-network.util';
import { normalizeCollectionSlug } from '@/utils/collection-input.util';
import { Erc20OwnershipService } from '@/services/erc20-ownership.service';
import { VerifierRole } from '@/models/verifier-role.interface';
import { ruleEditFields, ruleEditVersion } from '@/utils/rule-edit.util';
import { prepareRuleCriteria } from '@/services/rule-create.util';
import { normalizeRoleName } from '@/services/discord-commands/utils/role-management.util';
import { PortalSession } from './portal-auth.service';
import {
  PortalRuleDto,
  PortalEditDto,
  PortalSettingsDto,
  PortalMessageDto,
} from './portal.dto';

const snowflake = (s: string) => /^\d{17,22}$/.test(s || '');
export const portalRule = (rule: VerifierRole) => {
  const { ordinal_trait_snapshot, ...safe } = rule;
  return {
    ...safe,
    version: ruleEditVersion(rule),
    fields: ruleEditFields(rule),
  };
};
@Injectable()
export class PortalService {
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly discord: DiscordService,
    private readonly rules: DbService,
    private readonly messages: DiscordMessageService,
    private readonly edits: RuleEditService,
    private readonly engine: VerificationEngine,
    private readonly data: DataService,
    private readonly nfts: NftOwnershipService,
    private readonly ordinals: OrdinalsOwnershipService,
    private readonly ethscriptions: EthscriptionsOwnershipService,
    private readonly tokens: Erc20OwnershipService,
    private readonly metadata: NftMetadataService,
  ) {}

  client() {
    const client = this.discord.getBotClient();
    if (!client)
      throw new ServiceUnavailableException(
        'Bouncer is reconnecting to Discord. Please try again shortly.',
      );
    return client;
  }
  async access(session: PortalSession, server: string): Promise<Guild> {
    if (!snowflake(server)) throw new BadRequestException('Invalid server ID.');
    const guild = this.client().guilds.cache.get(server);
    if (!guild)
      throw new NotFoundException('Bouncer is not installed in this server.');
    let member;
    try {
      member = await guild.members.fetch({
        user: session.user.id,
        force: true,
      });
    } catch {
      throw new ForbiddenException(
        'Could not confirm your membership in this server.',
      );
    }
    if (
      guild.ownerId !== member.id &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      throw new ForbiddenException(
        'You need Administrator permission to manage this server.',
      );
    }
    return guild;
  }
  servers(session: PortalSession) {
    const client = this.client();
    const id = client.user.id;
    const invite = new URL('https://discord.com/oauth2/authorize');
    invite.search = new URLSearchParams({
      client_id: id,
      scope: 'bot applications.commands',
      permissions: '268520464',
      response_type: 'code',
      redirect_uri: `${process.env.BASE_URL?.replace(/\/$/, '')}/api/portal/auth/callback`,
    }).toString();
    // Installation does not request an OAuth code. Sign-in handles identity separately.
    invite.searchParams.delete('response_type');
    invite.searchParams.delete('redirect_uri');
    return {
      servers: session.guilds
        .filter((g) => {
          try {
            return g.owner || (BigInt(g.permissions) & 8n) !== 0n;
          } catch {
            return false;
          }
        })
        .map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon
            ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
            : null,
          installed: client.guilds.cache.has(g.id),
          invite: `${invite}&guild_id=${g.id}&disable_guild_select=true`,
        })),
      invite: invite.toString(),
    };
  }
  async overview(session: PortalSession, server: string) {
    const guild = await this.access(session, server);
    const [channels, roles, rules, settings] = await Promise.all([
      guild.channels.fetch(),
      guild.roles.fetch(),
      this.rules.getRoleMappings(server),
      this.settings(server),
    ]);
    return {
      server: { id: guild.id, name: guild.name, icon: guild.iconURL() },
      rules: rules.map(portalRule),
      settings,
      channels: [...channels.values()]
        .filter((c) => c?.type === ChannelType.GuildText)
        .map((c) => ({ id: c.id, name: c.name })),
      roles: [...roles.values()]
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, manageable: r.editable })),
      diagnostics: this.diagnostics(guild, rules),
    };
  }
  private diagnostics(guild: Guild, rules: VerifierRole[]) {
    const issues: string[] = [];
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles))
      issues.push('Enable Manage Roles for Bouncer.');
    for (const rule of rules) {
      const role = guild.roles.cache.get(rule.role_id);
      const channel = guild.channels.cache.get(rule.channel_id);
      if (!role)
        issues.push(
          `Rule ${rule.id}: Discord role was deleted. Remove this rule and recreate it with an existing role.`,
        );
      else if (!role.editable)
        issues.push(
          `Rule ${rule.id}: move Bouncer above ${role.name} in the role hierarchy.`,
        );
      if (!channel || channel.type !== ChannelType.GuildText)
        issues.push(`Rule ${rule.id}: verification channel is missing.`);
      else if (
        !channel
          .permissionsFor(guild.members.me)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
          ])
      )
        issues.push(
          `Rule ${rule.id}: allow Bouncer to view, send messages, embed links, and read history in #${channel.name}.`,
        );
    }
    return [...new Set(issues)];
  }
  async suggestions(
    session: PortalSession,
    server: string,
    asset: string,
    field: string,
    slug: string,
    key: string,
    contract: string,
    network: string,
  ) {
    await this.access(session, server);
    if (
      !['ethscription', 'ordinal', 'nft'].includes(asset) ||
      !['slug', 'attribute_key', 'attribute_value'].includes(field) ||
      [slug, key, contract, network].some(
        (v) => typeof v !== 'string' || v.length > 4000,
      )
    )
      throw new BadRequestException('Invalid suggestions request.');
    slug = normalizeCollectionSlug(slug);
    let values: string[] = [];
    if (field === 'slug')
      values =
        asset === 'ordinal'
          ? await this.rules.getKnownOrdinalCollectionSlugs()
          : asset === 'ethscription'
            ? await this.data.getAllSlugs()
            : [];
    else if (field === 'attribute_value' && !key) return { values: [] };
    else if (asset === 'ordinal' && slug)
      values = await this.ordinals.suggestions(
        slug,
        field === 'attribute_value' ? key : undefined,
      );
    else if (asset === 'ethscription' && slug)
      values =
        field === 'attribute_key'
          ? await this.data.getAttributeKeys(slug)
          : await this.data.getAllAttributeValues(key, slug);
    else if (asset === 'nft' && /^0x[0-9a-fA-F]{40}$/.test(contract))
      values = await this.metadata.suggestions(
        {
          contract_address: contract.toLowerCase(),
          chain_id: getNftNetworkId(network || 'ethereum'),
        },
        field === 'attribute_value' ? key : undefined,
      );
    return { values: values.slice(0, 2000) };
  }
  async settings(server: string) {
    const { data, error } = await this.db
      .from('verifier_server_settings')
      .select('verification_channel_id,background_checks_enabled')
      .eq('server_id', server)
      .maybeSingle();
    this.dbError(error);
    return (
      data || { verification_channel_id: null, background_checks_enabled: true }
    );
  }
  private async channel(guild: Guild, id: string) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (
      !channel ||
      channel.type !== ChannelType.GuildText ||
      channel.guild.id !== guild.id
    )
      throw new BadRequestException('Choose a text channel in this server.');
    return channel;
  }
  async saveSettings(
    session: PortalSession,
    server: string,
    input: PortalSettingsDto,
  ) {
    const guild = await this.access(session, server);
    if (input.verification_channel_id)
      await this.channel(guild, input.verification_channel_id);
    const { error } = await this.db.from('verifier_server_settings').upsert({
      server_id: server,
      ...input,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    });
    this.dbError(error);
    return this.settings(server);
  }
  async message(
    session: PortalSession,
    server: string,
    input: PortalMessageDto,
  ) {
    const guild = await this.access(session, server);
    const channel = await this.channel(guild, input.channel_id);
    if (!(await this.rules.getRulesByChannel(server, channel.id)).length)
      throw new BadRequestException('Add a rule for this channel first.');
    const existing =
      input.action === 'new'
        ? null
        : await this.messages.getExistingVerificationMessage(channel);
    const id =
      input.action === 'refresh'
        ? existing
          ? await this.messages.refreshVerificationMessage(channel)
          : null
        : existing?.id ||
          (await this.messages.createVerificationMessage(channel));
    if (!id)
      throw new BadRequestException(
        'No message found. Choose Recover missing to create one.',
      );
    return {
      url: `https://discord.com/channels/${server}/${channel.id}/${id}`,
    };
  }
  async create(session: PortalSession, server: string, input: PortalRuleDto) {
    let guild = await this.access(session, server);
    const previous = await this.replay(session, server, input.request_id);
    if (previous) return previous;
    const prepared = await prepareRuleCriteria(input, {
      data: this.data,
      nfts: this.nfts,
      ordinals: this.ordinals,
      ethscriptions: this.ethscriptions,
      tokens: this.tokens,
    });
    // Provider preparation can be slow. Recheck the actor before changing Discord or the database.
    guild = await this.access(session, server);
    const channel = await this.channel(guild, input.channel_id);
    await guild.roles.fetch();
    if (!!input.role_id === !!input.role_name?.trim())
      throw new BadRequestException('Choose a role or enter a new role name.');
    const name = normalizeRoleName(input.role_name?.trim() || '');
    let role = input.role_id
      ? guild.roles.cache.get(input.role_id)
      : guild.roles.cache.find(
          (r) => r.name.toLowerCase() === name.toLowerCase(),
        );
    if (input.role_id && !role)
      throw new BadRequestException('This role no longer exists.');
    if (!role) {
      if (!name || name.length > 100)
        throw new BadRequestException('Enter a role name of 1–100 characters.');
      role = await guild.roles.create({
        name,
        color: 'Blue',
        reason: `Bouncer dashboard: ${session.user.id}`,
      });
    }
    if (!role.editable || role.managed || role.id === guild.id)
      throw new BadRequestException(
        'Bouncer must be above the selected role and have Manage Roles.',
      );
    const candidate = {
      server_id: server,
      server_name: guild.name,
      channel_id: channel.id,
      channel_name: channel.name,
      role_id: role.id,
      role_name: role.name,
      slug: prepared.slug,
      attribute_key: prepared.attributeKey,
      attribute_value: prepared.attributeValue,
      min_items: prepared.minItems,
      chain_id: 1,
      ...prepared.assetFields,
    } as VerifierRole;
    if (
      this.edits.duplicates(candidate, await this.rules.getRoleMappings(server))
        .exact
    )
      throw new ConflictException('This exact rule already exists.');
    return this.mutate(session, server, input.request_id, null, candidate);
  }
  async edit(
    session: PortalSession,
    server: string,
    id: string,
    input: PortalEditDto,
  ) {
    await this.access(session, server);
    const replay = await this.replay(session, server, input.request_id);
    if (replay) return replay;
    if (
      !input.inputs ||
      Object.keys(input.inputs).length > 8 ||
      Object.values(input.inputs).some(
        (v) => typeof v !== 'string' || v.length > 8000,
      )
    )
      throw new BadRequestException('Invalid rule fields.');
    const before = await this.rule(server, id, input.version);
    const after = await this.edits.prepare(before, input.inputs);
    await this.access(session, server);
    return this.mutate(session, server, input.request_id, before, after);
  }
  async remove(
    session: PortalSession,
    server: string,
    id: string,
    version: string,
    request: string,
  ) {
    await this.access(session, server);
    const replay = await this.replay(session, server, request);
    if (replay) return replay;
    return this.mutate(
      session,
      server,
      request,
      await this.rule(server, id, version),
      null,
    );
  }
  async reverse(
    session: PortalSession,
    server: string,
    id: string,
    request: string,
  ) {
    await this.access(session, server);
    const replay = await this.replay(session, server, request);
    if (replay) return replay;
    const { data, error } = await this.db
      .from('verifier_portal_actions')
      .select('*')
      .eq('server_id', server)
      .eq('id', id)
      .maybeSingle();
    this.dbError(error);
    if (!data) throw new NotFoundException('Action not found.');
    if (!['create', 'edit', 'delete', 'reverse'].includes(data.kind))
      throw new BadRequestException('This action cannot be reversed.');
    return this.mutate(
      session,
      server,
      request,
      data.after_rule,
      data.before_rule,
      id,
    );
  }
  private async rule(server: string, id: string, version: string) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid rule ID.');
    const rule = await this.rules.getRuleForServer(id, server);
    if (!rule) throw new NotFoundException('Rule not found.');
    if (ruleEditVersion(rule) !== version)
      throw new ConflictException(
        'This rule changed. Reload it before saving.',
      );
    return rule;
  }
  private async replay(
    session: PortalSession,
    server: string,
    request: string,
  ) {
    const { data, error } = await this.db
      .from('verifier_portal_actions')
      .select('*')
      .eq('request_id', request)
      .maybeSingle();
    this.dbError(error);
    if (
      data &&
      (data.server_id !== server || data.actor_id !== session.user.id)
    )
      throw new ConflictException('Request conflict.');
    return data ? this.safeAction(data) : null;
  }
  private async mutate(
    session: PortalSession,
    server: string,
    request: string,
    before: any,
    after: any,
    reverts: string = null,
  ) {
    const { data, error } = await this.db.rpc('verifier_portal_mutate_rule', {
      p_server: server,
      p_actor: session.user.id,
      p_request: request,
      p_before: before,
      p_after: after,
      p_reverts: reverts,
    });
    if (error?.code === '40001' || error?.code === '23505')
      throw new ConflictException(
        'This rule or action already changed. Reload before trying again.',
      );
    this.dbError(error);
    return this.safeAction(data);
  }
  private safeAction(a: any) {
    return {
      id: a.id,
      kind: a.kind,
      created_at: a.created_at,
      actor_id: a.actor_id,
      before_rule: a.before_rule ? portalRule(a.before_rule) : null,
      after_rule: a.after_rule ? portalRule(a.after_rule) : null,
      reverts: a.reverts,
    };
  }
  async activity(
    session: PortalSession,
    server: string,
    page: number,
    kind: string,
  ) {
    await this.access(session, server);
    const table =
      kind === 'changes'
        ? 'verifier_portal_actions'
        : kind === 'jobs'
          ? 'verifier_reconciliation_jobs'
          : 'verifier_user_roles';
    const fields =
      kind === 'changes'
        ? '*'
        : kind === 'jobs'
          ? 'id,server_id,role_id,user_id,status,attempts,result,created_at,updated_at'
          : 'id,user_id,user_name,role_id,role_name,status,verified_at,last_checked,updated_at';
    const { data, error, count } = await this.db
      .from(table)
      .select(fields, { count: 'exact' })
      .eq('server_id', server)
      .order(kind === 'changes' ? 'created_at' : 'updated_at', {
        ascending: false,
      })
      .order('id', { ascending: false })
      .range((page - 1) * 20, page * 20 - 1);
    this.dbError(error);
    let items: any[] = data || [];
    if (kind === 'changes') {
      const ids = items.map((a) => a.id);
      const reversed = ids.length
        ? await this.db
            .from('verifier_portal_actions')
            .select('reverts')
            .in('reverts', ids)
        : { data: [], error: null };
      this.dbError(reversed.error);
      const used = new Set(reversed.data.map((a) => a.reverts));
      items = items.map((a) => ({
        ...this.safeAction(a),
        reversible: !used.has(a.id),
      }));
    }
    return {
      items,
      total: count || 0,
      page,
      pages: Math.max(1, Math.ceil((count || 0) / 20)),
    };
  }
  async member(
    session: PortalSession,
    server: string,
    id: string,
    check: boolean,
  ) {
    const guild = await this.access(session, server);
    if (!snowflake(id))
      throw new BadRequestException('Enter a Discord user ID.');
    const member = await guild.members
      .fetch({ user: id, force: true })
      .catch(() => null);
    if (!member)
      throw new NotFoundException('This member is not in this server.');
    const assignments = await this.rules.getEarnedRoleAssignments({
      userId: id,
      serverId: server,
    });
    const { data: wallets, error } = await this.db
      .from('user_wallets')
      .select('address,wallet_type,last_verified_at')
      .eq('user_id', id);
    this.dbError(error);
    const roles = [];
    const serverRules = check ? await this.rules.getRoleMappings(server) : [];
    const context = {
      checks: new Map(),
      ordinalNeedsNumbers: serverRules.some(
        (rule) =>
          rule.asset_type === 'ordinal' &&
          rule.inscription_criteria?.kind === 'numbers',
      ),
    };
    for (const roleId of [...new Set(assignments.map((a) => a.role_id))]) {
      const records = assignments.filter((a) => a.role_id === roleId);
      const eligibility = check
        ? await this.engine.evaluateRole(id, server, roleId, context)
        : null;
      roles.push({
        id: roleId,
        name:
          guild.roles.cache.get(roleId)?.name || records[0].role_name || roleId,
        held: member.roles.cache.has(roleId),
        status: eligibility?.status || 'not_checked',
        last_checked: records[0].last_checked,
        reason:
          eligibility?.status === 'unavailable'
            ? 'Provider unavailable; existing roles are retained.'
            : undefined,
      });
    }
    return {
      id,
      name: member.displayName,
      avatar: member.displayAvatarURL(),
      wallets: wallets || [],
      roles,
    };
  }
  async fix(
    session: PortalSession,
    server: string,
    id: string,
    request: string,
  ) {
    await this.member(session, server, id, false);
    const { data, error } = await this.db
      .from('verifier_reconciliation_jobs')
      .insert({ id: request, server_id: server, user_id: id })
      .select('id,status')
      .single();
    if (error?.code === '23505') {
      const prior = await this.db
        .from('verifier_reconciliation_jobs')
        .select('id,status')
        .eq('id', request)
        .eq('server_id', server)
        .eq('user_id', id)
        .maybeSingle();
      this.dbError(prior.error);
      if (!prior.data) throw new ConflictException('Request conflict.');
      return prior.data;
    }
    this.dbError(error);
    return data;
  }

  async retryJob(
    session: PortalSession,
    server: string,
    id: string,
    request: string,
  ) {
    await this.access(session, server);
    const prior = await this.db
      .from('verifier_reconciliation_jobs')
      .select('role_id,user_id,status')
      .eq('server_id', server)
      .eq('id', id)
      .maybeSingle();
    this.dbError(prior.error);
    if (!prior.data || prior.data.status !== 'failed')
      throw new BadRequestException('Only failed checks can be retried.');
    const { data, error } = await this.db
      .from('verifier_reconciliation_jobs')
      .insert({
        id: request,
        server_id: server,
        role_id: prior.data.role_id,
        user_id: prior.data.user_id,
      })
      .select('id,status')
      .single();
    if (error?.code === '23505')
      throw new ConflictException(
        'This retry was already requested. Refresh role checks.',
      );
    this.dbError(error);
    return data;
  }
  private dbError(error: any) {
    if (error)
      throw new ServiceUnavailableException(
        'Could not save or load dashboard data. Please try again.',
      );
  }
}
