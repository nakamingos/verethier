import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ChannelType, Guild, PermissionFlagsBits } from 'discord.js';
import { DiscordService } from '@/services/discord.service';
import { DbService } from '@/services/db.service';
import { DiscordMessageService } from '@/services/discord-message.service';
import { ServerSetupService } from '@/services/server-setup.service';
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
import { normalizeBlockedWallet } from '@/services/wallet-block.service';
import { ruleTraits } from '@/utils/trait-filter.util';
import {
  PortalRuleDto,
  PortalEditDto,
  PortalSettingsDto,
  PortalMessageDto,
  PortalWalletBlockDto,
  PortalRoleActionDto,
  PortalWalletAuditDto,
  PortalSetupChannelsDto,
  PortalSetupRecoveryDto,
} from './portal.dto';

const snowflake = (s: string) => /^\d{17,22}$/.test(s || '');
export const portalRule = (rule: VerifierRole) => {
  const { ordinal_trait_snapshot, ...safe } = rule;
  const fields = ruleEditFields(rule);
  if (!rule.inscription_criteria && rule.asset_type !== 'erc20') {
    const first = fields.findIndex(f => ['attribute_key', 'attribute_value', 'trait_filter'].includes(f.key));
    const clean = fields.filter(f => !['attribute_key', 'attribute_value', 'trait_filter'].includes(f.key));
    clean.splice(first, 0, { key: 'trait_filter', label: 'Trait conditions', value: JSON.stringify(ruleTraits(rule)), maxLength: 20000 });
    fields.splice(0, fields.length, ...clean);
  }
  return {
    ...safe,
    trait_filter: ruleTraits(rule),
    version: ruleEditVersion(rule),
    fields,
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
    @Optional() private readonly setup?: ServerSetupService,
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
    const [channels, roles, rules, settings, actions] = await Promise.all([
      guild.channels.fetch(),
      guild.roles.fetch(),
      this.rules.getRoleMappings(server),
      this.settings(server),
      this.db
        .from('verifier_role_actions')
        .select('*')
        .eq('server_id', server)
        .order('trigger_role_id'),
    ]);
    this.dbError(actions.error);
    return {
      server: { id: guild.id, name: guild.name, icon: guild.iconURL() },
      rules: rules.map(portalRule),
      capabilities: { multi_trait: true },
      settings,
      role_actions: actions.data || [],
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
      .select('admin_channel_id,verification_channel_id,background_checks_enabled')
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
      background_checks_enabled: input.background_checks_enabled,
      verification_channel_id: input.verification_channel_id ?? null,
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
  async checkSetup(session: PortalSession, server: string) {
    const report = await this.setup.check(await this.access(session, server));
    await this.access(session, server);
    return report;
  }
  async setupChannels(session: PortalSession, server: string, input: PortalSetupChannelsDto) {
    return this.setup.previewChannels(await this.access(session, server), session.user.id, input);
  }
  async setupRecovery(session: PortalSession, server: string, input: PortalSetupRecoveryDto) {
    return this.setup.previewRecovery(await this.access(session, server), session.user.id, input.channel_id, input.request_id);
  }
  async setupRequest(session: PortalSession, server: string, request: string, apply = false) {
    if (!/^[a-f0-9-]{36}$/i.test(request)) throw new BadRequestException('Invalid setup request.');
    const guild = await this.access(session, server);
    return apply ? this.setup.apply(guild, session.user.id, request, () => this.access(session, server))
      : this.setup.get(server, session.user.id, request);
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
    const role = await this.targetRole(
      guild,
      input.role_id,
      input.role_name,
      session.user.id,
    );
    const candidate = {
      server_id: server,
      server_name: guild.name,
      channel_id: channel.id,
      channel_name: channel.name,
      role_id: role.id,
      role_name: role.name,
      slug: prepared.slug,

      trait_filter: ruleTraits({...prepared.assetFields,attribute_key:prepared.attributeKey,attribute_value:prepared.attributeValue}),
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
      Object.entries(input.inputs).some(
        ([key, v]) => typeof v !== 'string' || v.length > (key === 'trait_filter' ? 20000 : 8000),
      )
    )
      throw new BadRequestException('Invalid rule fields.');
    const before = await this.rule(server, id, input.version);
    const fields = ruleEditFields(before);
    const sameCriteria = [fields, portalRule(before).fields].some(set =>
      set.every(field => input.inputs[field.key] === field.value) && Object.keys(input.inputs).every(key => set.some(field => field.key === key)));
    const after = sameCriteria
      ? { ...before }
      : await this.edits.prepare(before, input.inputs);
    const guild = await this.access(session, server);
    if (input.role_id !== undefined || input.role_name !== undefined) {
      const role = await this.targetRole(
        guild,
        input.role_id,
        input.role_name,
        session.user.id,
      );
      after.role_id = role.id;
      after.role_name = role.name;
    }
    if (
      this.edits.duplicates(after, await this.rules.getRoleMappings(server))
        .exact
    )
      throw new ConflictException('This exact rule already exists.');
    if (ruleEditVersion(before) === ruleEditVersion(after))
      throw new BadRequestException('No rule requirements changed.');
    return this.mutate(session, server, input.request_id, before, after);
  }

  private async targetRole(
    guild: Guild,
    roleId: string | undefined,
    roleName: string | undefined,
    actor: string,
  ) {
    if (!!roleId === !!roleName?.trim())
      throw new BadRequestException('Choose a role or enter a new role name.');
    await guild.roles.fetch();
    const name = normalizeRoleName(roleName?.trim() || '');
    let role = roleId
      ? guild.roles.cache.get(roleId)
      : guild.roles.cache.find(
          (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
        );
    if (roleId && !role)
      throw new BadRequestException(
        'This role no longer exists. Choose another role.',
      );
    if (!role) {
      if (!name || name.length > 100)
        throw new BadRequestException('Enter a role name of 1–100 characters.');
      role = await guild.roles.create({
        name,
        color: 'Blue',
        reason: `Bouncer dashboard: ${actor}`,
      });
    }
    if (!role.editable || role.managed || role.id === guild.id)
      throw new BadRequestException(
        'Bouncer must be above the selected role and have Manage Roles.',
      );
    return role;
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
    const guild = await this.access(session, server);
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
    if (
      data.before_rule &&
      data.after_rule &&
      data.before_rule.role_id !== data.after_rule.role_id
    ) {
      await this.targetRole(
        guild,
        data.before_rule.role_id,
        undefined,
        session.user.id,
      );
    }
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
    if (data && !['create', 'edit', 'delete', 'reverse'].includes(data.kind))
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
    if (['setup_channels', 'setup_recover'].includes(a.kind))
      return { id: a.id, kind: a.kind, created_at: a.created_at, actor_id: a.actor_id,
        setup: a.after_rule, before_rule: null, after_rule: null, reverts: null };
    if (['role_action_set', 'role_action_delete'].includes(a.kind))
      return {
        id: a.id,
        kind: a.kind,
        created_at: a.created_at,
        actor_id: a.actor_id,
        role_action: a.after_rule || a.before_rule,
        before_rule: null,
        after_rule: null,
        reverts: null,
      };
    if (['wallet_block', 'wallet_unblock'].includes(a.kind))
      return {
        id: a.id,
        kind: a.kind,
        created_at: a.created_at,
        actor_id: a.actor_id,
        wallet: a.after_rule || a.before_rule,
        before_rule: null,
        after_rule: null,
        reverts: null,
      };
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
    sort: 'asc' | 'desc' = 'desc',
    limit = 20,
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
          ? 'id,server_id,role_id,user_id,role_action_role_id,status,attempts,result,created_at,updated_at'
          : 'id,user_id,user_name,role_id,role_name,status,verified_at,last_checked,updated_at';
    const { data, error, count } = await this.db
      .from(table)
      .select(fields, { count: 'exact' })
      .eq('server_id', server)
      .order(kind === 'changes' ? 'created_at' : 'updated_at', {
        ascending: sort === 'asc',
      })
      .order('id', { ascending: sort === 'asc' })
      .range((page - 1) * limit, page * limit - 1);
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
        reversible:
          ['create', 'edit', 'delete', 'reverse'].includes(a.kind) &&
          !used.has(a.id),
      }));
    }
    return {
      items,
      total: count || 0,
      page,
      pages: Math.max(1, Math.ceil((count || 0) / limit)),
      page_size: limit,
    };
  }
  private memberQuery(input: string): string {
    if (typeof input !== 'string' || input.trim().length > 100)
      throw new BadRequestException(
        'Enter a username, Discord user ID or full wallet address.',
      );
    return input
      .trim()
      .replace(/^<@!?(\d{17,22})>$/, '$1')
      .replace(/^@/, '')
      .normalize('NFC')
      .toLowerCase();
  }

  private memberNames(member: any): string[] {
    return [member.user.username, member.user.globalName, member.nickname]
      .filter(Boolean)
      .map((name) => name.normalize('NFC').toLowerCase());
  }

  private walletMemberQuery(input: string): boolean {
    // Full addresses are longer than Discord usernames/nicknames. Preserve
    // ordinary name lookup for members such as "0xcollector".
    const value = input.trim();
    return value.length >= 42 && /^(0x|bc1)/i.test(value);
  }

  private async walletMembers(guild: Guild, input: string) {
    let address: string;
    try {
      address = normalizeBlockedWallet(input);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
    const current = await this.db
      .from('user_wallets')
      .select('user_id')
      .eq('address', address);
    this.dbError(current.error || (!Array.isArray(current.data) ? {} : null));
    const ids = new Map<string, 'current' | 'history'>(
      current.data.map((row) => [row.user_id, 'current']),
    );
    for (let offset = 0; ; offset += 1000) {
      const history = await this.db
        .from('verifier_member_actions')
        .select('id,user_id')
        .eq('address', address)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + 999);
      this.dbError(history.error || (!Array.isArray(history.data) ? {} : null));
      for (const row of history.data)
        if (!ids.has(row.user_id)) ids.set(row.user_id, 'history');
      if (history.data.length < 1000) break;
    }
    const matches: { member: any; wallet_match: 'current' | 'history' }[] = [];
    for (const [id, wallet_match] of ids) {
      try {
        const member = await guild.members.fetch({ user: id, force: true });
        matches.push({ member, wallet_match });
      } catch (error) {
        if (error?.code === 10007) continue;
        throw new ServiceUnavailableException(
          'Could not confirm wallet matches in this server. Please try again.',
        );
      }
    }
    return matches;
  }

  private memberSuggestion(member: any, wallet_match?: 'current' | 'history') {
    return {
      id: member.id,
      name: member.displayName,
      username: member.user.username,
      avatar: member.displayAvatarURL({ size: 64 }),
      ...(wallet_match ? { wallet_match } : {}),
    };
  }

  async memberSuggestions(
    session: PortalSession,
    server: string,
    query: string,
  ) {
    const guild = await this.access(session, server);
    const text = this.memberQuery(query);
    if (text.length < 2) return { members: [] };
    if (this.walletMemberQuery(query)) {
      // Validate the original casing: lowercasing first would incorrectly
      // accept mixed-case Bitcoin encodings. Incomplete typing has no matches.
      try {
        normalizeBlockedWallet(query);
      } catch {
        return { members: [] };
      }
      const matches = await this.walletMembers(guild, query);
      return {
        members: matches.map(({ member, wallet_match }) =>
          this.memberSuggestion(member, wallet_match),
        ),
      };
    }
    let members;
    try {
      if (snowflake(text))
        members = [await guild.members.fetch({ user: text, force: true })];
      else
        members = [
          ...(
            await guild.members.search({ query: text, limit: 25, cache: false })
          ).values(),
        ];
    } catch (error) {
      if (error?.code === 10007) return { members: [] };
      throw new ServiceUnavailableException(
        'Member search is temporarily unavailable. You can still enter a Discord user ID.',
      );
    }
    return {
      members: members.map((member) => this.memberSuggestion(member)),
    };
  }

  private async resolveMember(guild: Guild, input: string) {
    const text = this.memberQuery(input);
    if (this.walletMemberQuery(input)) {
      const matches = await this.walletMembers(guild, input);
      if (!matches.length)
        throw new NotFoundException(
          'No current server member has this wallet in their saved history.',
        );
      if (matches.length > 1)
        throw new BadRequestException(
          'This wallet matches several server members. Choose a member from the suggestions.',
        );
      return matches[0].member;
    }
    let id = text;
    if (!snowflake(id)) {
      if (text.length < 2)
        throw new BadRequestException(
          'Enter at least two characters or a Discord user ID.',
        );
      let results;
      try {
        results = await guild.members.search({
          query: text,
          limit: 100,
          cache: false,
        });
      } catch {
        throw new ServiceUnavailableException(
          'Member search is temporarily unavailable. Try their Discord user ID.',
        );
      }
      const exact = [...results.values()].filter((member) =>
        this.memberNames(member).includes(text),
      );
      if (exact.length > 1)
        throw new BadRequestException(
          'Several members use that name. Choose a member from the suggestions.',
        );
      if (exact.length !== 1)
        throw new NotFoundException(
          'No exact name match. Choose a suggestion or enter their Discord user ID.',
        );
      id = exact[0].id;
    }
    try {
      return await guild.members.fetch({ user: id, force: true });
    } catch (error) {
      if (error?.code === 10007)
        throw new NotFoundException('This member is not in this server.');
      throw new ServiceUnavailableException(
        'Could not confirm this member’s current membership. Please try again.',
      );
    }
  }

  async member(
    session: PortalSession,
    server: string,
    id: string,
    check: boolean,
  ) {
    const guild = await this.access(session, server);
    const member = await this.resolveMember(guild, id);
    id = member.id;
    const assignments = await this.rules.getEarnedRoleAssignments({
      userId: id,
      serverId: server,
    });
    const { data: wallets, error } = await this.db
      .from('user_wallets')
      .select('address,wallet_type,last_verified_at')
      .eq('user_id', id);
    this.dbError(error);
    const removedWallets = await this.removedWallets(
      id,
      new Set((wallets || []).map((wallet) => wallet.address)),
    );
    const restrictions = new Map<string, any>();
    const addresses = [
      ...new Set(
        [...(wallets || []), ...removedWallets].map((wallet) => wallet.address),
      ),
    ];
    for (let offset = 0; offset < addresses.length; offset += 100) {
      const { data, error } = await this.db
        .from('verifier_wallet_blocks')
        .select('address,reason,blocked_at')
        .eq('server_id', server)
        .in('address', addresses.slice(offset, offset + 100));
      this.dbError(error);
      for (const block of data || []) restrictions.set(block.address, block);
    }
    const withRestriction = (wallet: any) => ({
      ...wallet,
      blocked: restrictions.has(wallet.address),
      block: restrictions.get(wallet.address) || null,
    });
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
      username: member.user.username,
      avatar: member.displayAvatarURL(),
      wallets: (wallets || []).map(withRestriction),
      removed_wallets: removedWallets.map(withRestriction),
      roles,
    };
  }
  async walletBlock(
    session: PortalSession,
    server: string,
    id: string,
    dto: PortalWalletBlockDto,
  ) {
    const member = await this.member(session, server, id, false);
    let address: string;
    try {
      address = normalizeBlockedWallet(dto.address);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
    if (
      ![...member.wallets, ...member.removed_wallets].some(
        (wallet) => wallet.address === address,
      )
    )
      throw new BadRequestException(
        'This wallet is not in the selected member’s saved history.',
      );
    const { data, error } = await this.db.rpc('verifier_portal_wallet_block', {
      p_server: server,
      p_actor: session.user.id,
      p_address: address,
      p_blocked: dto.blocked,
      p_reason: dto.reason?.trim() || null,
      p_request: dto.request_id,
    });
    if (error)
      throw new ConflictException(
        'Could not update this wallet restriction. Refresh the member and try again.',
      );
    return data;
  }
  async roleAction(
    session: PortalSession,
    server: string,
    dto: PortalRoleActionDto,
  ) {
    const guild = await this.access(session, server);
    const roles = await guild.roles.fetch();
    if (
      dto.remove_role_ids != null &&
      !guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)
    )
      throw new BadRequestException(
        'Bouncer needs Manage Roles to configure role actions.',
      );
    for (const id of dto.remove_role_ids == null
      ? []
      : [dto.trigger_role_id, ...dto.remove_role_ids]) {
      const role = roles.get(id);
      if (!role || role.id === server || role.managed || !role.editable)
        throw new BadRequestException(
          'Choose existing roles below Bouncer in this server.',
        );
    }
    if (dto.remove_role_ids?.includes(dto.trigger_role_id))
      throw new BadRequestException('A role cannot remove itself.');
    const { data, error } = await this.db.rpc('verifier_portal_role_action', {
      p_server: server,
      p_actor: session.user.id,
      p_trigger: dto.trigger_role_id,
      p_remove: dto.remove_role_ids ?? null,
      p_expected: dto.version || null,
      p_request: dto.request_id,
    });
    if (error?.message?.includes('cycle'))
      throw new BadRequestException('Role actions cannot form a cycle.');
    if (error)
      throw new ConflictException(
        'Could not save this role action. Refresh the server and try again.',
      );
    return data;
  }
  async walletAudit(
    session: PortalSession,
    server: string,
    dto: PortalWalletAuditDto,
  ) {
    const guild = await this.access(session, server);
    const target = dto.member_id
      ? await this.resolveMember(guild, dto.member_id)
      : null;
    if (dto.after) {
      try {
        normalizeBlockedWallet(dto.after);
      } catch {
        throw new BadRequestException('Invalid audit cursor.');
      }
    }
    if (dto.address) {
      try {
        normalizeBlockedWallet(dto.address);
      } catch {
        throw new BadRequestException('Invalid wallet address.');
      }
    }
    if (dto.account_after && !dto.address)
      throw new BadRequestException(
        'Choose a wallet before paging its accounts.',
      );
    const members = new Map<string, any>();
    let after: string | undefined;
    // REST pagination works without enabling a new gateway subscription. If
    // Discord denies the member list, fail rather than report a partial audit.
    try {
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error('Member list limit');
        const batch = await guild.members.list({
          limit: 1000,
          ...(after ? { after } : {}),
        });
        const ids = [...batch.keys()];
        if (ids.some((id) => members.has(id)))
          throw new Error('Repeated member page');
        for (const [id, member] of batch) members.set(id, member);
        if (batch.size < 1000) break;
        const next = ids
          .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
          .at(-1);
        if (next === after) throw new Error('Member page did not advance');
        after = next;
      }
    } catch {
      throw new ServiceUnavailableException(
        'Could not read the complete server member list. Check Bouncer’s Server Members access in Discord and try again. No partial audit was returned.',
      );
    }
    const { data, error } = await this.db.rpc('verifier_portal_wallet_audit', {
      p_server: server,
      p_users: [...members.keys()],
      p_member: dto.member_id || null,
      p_after: dto.after || null,
      p_limit: 20,
      p_address: dto.address || null,
      p_account_after: dto.account_after || null,
    });
    this.dbError(error);
    for (const item of data.items)
      for (const account of item.accounts) {
        const live = members.get(account.user_id);
        account.name = live?.displayName || account.name || account.user_id;
        account.in_server = !!live;
      }
    return {
      ...data,
      member_id: dto.member_id || null,
      member_name: target?.displayName || null,
      checked_at: new Date().toISOString(),
    };
  }
  private async removedWallets(userId: string, current: Set<string>) {
    const removed = new Map<string, any>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.db
        .from('verifier_member_actions')
        .select('id,address,wallet_type,kind,created_at,last_proven_at')
        .eq('user_id', userId)
        .in('kind', ['wallet_remove', 'wallet_transfer_out'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + 999);
      this.dbError(error);
      for (const row of data || [])
        if (!current.has(row.address) && !removed.has(row.address))
          removed.set(row.address, {
            address: row.address,
            wallet_type: row.wallet_type,
            last_verified_at: row.last_proven_at,
            removed_at: row.created_at,
            transferred: row.kind === 'wallet_transfer_out',
          });
      if (!data || data.length < 1000) break;
    }
    return [...removed.values()];
  }
  async fix(
    session: PortalSession,
    server: string,
    id: string,
    request: string,
  ) {
    const member = await this.member(session, server, id, false);
    id = member.id;
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
      .select('role_id,user_id,status,rule_id,member_ids,role_action_role_id')
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
        rule_id: prior.data.rule_id,
        member_ids: prior.data.member_ids,
        role_action_role_id: prior.data.role_action_role_id,
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
