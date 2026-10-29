import { isSolanaRule, solanaRuleLabel } from '@/utils/solana-rule.util';
import { solanaMessage, verifySolanaMessage } from '@/utils/solana.util';
import { EnvironmentConfig } from '@/config/environment.config';
import { PrivacyService } from './privacy.service';
import { ruleTraits, traitFilterLabel } from '@/utils/trait-filter.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'crypto';
import { PermissionFlagsBits } from 'discord.js';
import { EvmSignatureService } from '@/services/evm-signature.service';
import { getNftNetwork } from '@/utils/nft-network.util';
import { DiscordService } from '@/services/discord.service';
import { DbService } from '@/services/db.service';
import { NonceService } from '@/services/nonce.service';
import { BitcoinSignatureService } from '@/services/bitcoin-signature.service';
import { normalizeWalletAddress } from '@/utils/wallet-address.util';
import { PortalAuthService, PortalSession } from './portal-auth.service';
import { MemberLinkDto, MemberProofDto, MemberVerifyDto } from './member.dto';

@Injectable()
export class MemberService {
  private readonly locks = new Set<string>();
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly discord: DiscordService,
    private readonly rules: DbService,
    private readonly nonces: NonceService,
    private readonly bitcoin: BitcoinSignatureService,
    private readonly auth: PortalAuthService,
    @Optional() private readonly privacy?: PrivacyService,
    @Optional() private readonly evmSignatures: EvmSignatureService = new EvmSignatureService(),
  ) {}

  private checked<T extends { error: any; data: any }>(result: T): T['data'] {
    if (result.error)
      throw new ServiceUnavailableException(
        'Could not load your account. Please try again.',
      );
    return result.data;
  }
  private client() {
    const client = this.discord.getBotClient();
    if (!client)
      throw new ServiceUnavailableException(
        'Bouncer is reconnecting to Discord. Please try again shortly.',
      );
    return client;
  }
  private async membership(session: PortalSession, server: string) {
    if (!/^\d{17,22}$/.test(server || ''))
      throw new BadRequestException('Invalid server.');
    const guild = this.client().guilds.cache.get(server);
    if (!guild)
      throw new NotFoundException(
        'Bouncer is not installed in this community.',
      );
    try {
      return {
        guild,
        member: await guild.members.fetch({
          user: session.user.id,
          force: true,
        }),
      };
    } catch (error) {
      if (error.code === 10007)
        throw new ForbiddenException('You must be a member of this community.');
      throw new ServiceUnavailableException(
        'Could not confirm your Discord membership. Please try again.',
      );
    }
  }
  async privacyMembership(session: PortalSession, server: string) { return this.membership(session,server); }
  private async community(
    session: PortalSession,
    server: string,
    assignments: any[],
  ) {
    const { guild, member } = await this.membership(session, server);
    const [rules, channels, settings] = await Promise.all([
      this.rules.getRoleMappings(server),
      guild.channels.fetch(),
      this.db
        .from('verifier_server_settings')
        .select('verification_channel_id')
        .eq('server_id', server)
        .maybeSingle(),
    ]);
    const defaultChannel = this.checked(settings)?.verification_channel_id;
    const visible = rules.filter((rule) =>
      channels
        .get(rule.channel_id)
        ?.permissionsFor(member)
        ?.has(PermissionFlagsBits.ViewChannel),
    );
    const choices = [...new Set(visible.map((rule) => rule.channel_id))]
      .map((id) => ({
        id,
        name: channels.get(id)?.name || id,
        rules: visible
          .filter((rule) => rule.channel_id === id)
          .map((rule) => ({
            id: String(rule.id),
            role: rule.role_name || rule.role_id,
            roleId: rule.role_id,
            earned: assignments.some(
              (row) =>
                row.server_id === server &&
                row.role_id === rule.role_id &&
                row.status === 'active',
            ),
            previouslyEarned: assignments.some(
              (row) => row.server_id === server && row.role_id === rule.role_id,
            ),
            asset: rule.asset_type || 'ethscription',
            network: rule.chain_id,
            collection:
              (isSolanaRule(rule) ? solanaRuleLabel(rule) : null) ||
              rule.rule_label ||
              rule.collection_name ||
              rule.slug ||
              rule.contract_address ||
              'Selected items',
            minimum:
              ['erc20','solana_token'].includes(rule.asset_type) ? rule.min_balance : rule.min_items,
            trait:
              ruleTraits(rule)
                ? traitFilterLabel(rule)
                : null,
            tokenIds: rule.token_ids,
            tokenStandard: rule.token_standard,
            tokenSymbol: rule.token_symbol,
            criteria: rule.inscription_criteria,
          })),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    const earned = assignments.filter((row) => row.server_id === server);
    const roles = [...new Set(earned.map((row) => row.role_id))].map((id) => {
      const records = earned.filter((row) => row.role_id === id);
      return {
        id,
        name: guild.roles.cache.get(id)?.name || records[0].role_name || id,
        status: records.some((row) => row.status === 'active')
          ? 'active'
          : 'previously earned',
      };
    });
    return {
      id: server,
      privacy: this.privacy ? await this.privacy.policy(server,session.user.id) : null,
      name: guild.name,
      icon: guild.iconURL(),
      channels: choices,
      defaultChannel: choices.some((c) => c.id === defaultChannel)
        ? defaultChannel
        : choices.length === 1
          ? choices[0].id
          : '',
      roles,
    };
  }
  async overview(session: PortalSession) {
    const [wallets, assignments, actions] = await Promise.all([
      this.db
        .from('user_wallets')
        .select('address,wallet_type,last_verified_at,evm_chain_ids')
        .eq('user_id', session.user.id)
        .order('created_at'),
      this.rules.getEarnedRoleAssignments({ userId: session.user.id }),
      this.db
        .from('verifier_member_actions')
        .select(
          'id,kind,address,wallet_type,transferred,source,server_id,channel_id,created_at',
        )
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20),
    ]);
    const communities = [];
    let communitiesUnavailable = false;
    let candidates = [];
    try {
      const client = this.client();
      candidates = session.guilds.filter((g) => client.guilds.cache.has(g.id));
    } catch {
      communitiesUnavailable = true;
    }
    // OAuth limits candidates; current Discord membership gates every private summary.
    for (const g of candidates) {
      try {
        communities.push(await this.community(session, g.id, assignments));
      } catch (error) {
        if (!(error instanceof ForbiddenException))
          communitiesUnavailable = true;
      }
    }
    communities.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
    const history = this.checked(actions);
    const jobs = history.length
      ? this.checked(
          await this.db
            .from('verifier_reconciliation_jobs')
            .select('id,member_action_id,server_id,user_id,status,result')
            .in(
              'member_action_id',
              history.map((a) => a.id),
            ),
        )
      : [];
    return {
      capabilities: {solana: EnvironmentConfig.SOLANA_ENABLED},
      wallets: this.checked(wallets),
      communitiesUnavailable,
      communities,
      counts: {
        wallets: wallets.data.length,
        communities: communities.length,
        roles: communities.reduce(
          (n, c) => n + c.roles.filter((r) => r.status === 'active').length,
          0,
        ),
      },
      actions: history.map((action) => ({
        id: action.id,
        kind: action.kind,
        address: action.address,
        wallet_type: action.wallet_type,
        transferred: action.transferred,
        source: action.source,
        created_at: action.created_at,
        community: action.server_id
          ? communities.find((c) => c.id === action.server_id)?.name ||
            'Previous community'
          : null,
        channel: action.channel_id
          ? communities
              .find((c) => c.id === action.server_id)
              ?.channels.find((c) => c.id === action.channel_id)?.name || null
          : null,
        jobs: jobs
          .filter((job) => job.member_action_id === action.id)
          .map((job) => ({
            id: job.id,
            status: job.status,
            community:
              job.user_id === session.user.id
                ? communities.find((c) => c.id === job.server_id)?.name ||
                  'Previous community'
                : 'Previous account',
            // Previous owners' identity, server names and eligibility remain private.
            result: job.user_id === session.user.id ? job.result : null,
          })),
      })),
      pending: await this.pending(session),
    };
  }
  private async flow(session: PortalSession) {
    return this.checked(
      await this.db
        .from('verifier_member_flows')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle(),
    );
  }
  async pending(session: PortalSession) {
    const flow = await this.flow(session);
    if (!flow || flow.completed_at) return null;
    return {
      id: flow.id,
      purpose: flow.purpose,
      address: flow.address,
      server: flow.server_id,
      channel: flow.channel_id,
      expiresAt: flow.expires_at,
    };
  }
  private async locked<T>(session: PortalSession, task: () => Promise<T>) {
    if (this.locks.has(session.user.id))
      throw new ConflictException('An account action is already in progress.');
    this.locks.add(session.user.id);
    try {
      return await task();
    } finally {
      this.locks.delete(session.user.id);
    }
  }
  private async saveFlow(session: PortalSession, flow: any) {
    const prior = await this.flow(session);
    this.checked(
      await this.db
        .from('verifier_member_flows')
        .upsert({
          user_id: session.user.id,
          id: randomUUID(),
          server_id: null,
          channel_id: null,
          nonce: null,
          address: null,
          wallet_type: null,
          challenge: null,
          completed_at: null,
          created_at: new Date().toISOString(),
          ...flow,
        })
        .select('*')
        .single(),
    );
    if (prior?.nonce) await this.nonces.invalidateNonce(prior.nonce);
    return this.flow(session);
  }
  async linkChallenge(session: PortalSession, dto: MemberLinkDto) {
    await this.privacy?.assertActive(session.user.id);
    return this.locked(session, async () => {
      let address: string;
      try {
        if (
          dto.walletType === 'evm' &&
          !/^0x[0-9a-fA-F]{40}$/.test(dto.address)
        )
          throw new Error('Invalid EVM address');
        address = normalizeWalletAddress(dto.address, dto.walletType);
      } catch {
        throw new BadRequestException(
          'Use an EVM address or Bitcoin mainnet single-key Taproot Ordinals address.',
        );
      }
      if (dto.walletType === 'evm') getNftNetwork(dto.chainId ?? 1);
      if (dto.walletType === 'solana' && !EnvironmentConfig.SOLANA_ENABLED) throw new BadRequestException('Solana is not enabled.');
      if (dto.walletType !== 'evm' && dto.chainId !== undefined) throw new BadRequestException('Invalid wallet network.');
      const nonce = randomBytes(32).toString('hex');
      const expiry = Math.floor(Date.now() / 1000) + 600;
      const challenge =
        dto.walletType === 'evm'
          ? {
              domain: { name: 'Bouncer', version: '1', chainId: dto.chainId ?? 1 },
              primaryType: 'WalletLink',
              types: {
                WalletLink: [
                  { name: 'Purpose', type: 'string' },
                  { name: 'Domain', type: 'string' },
                  { name: 'UserID', type: 'string' },
                  { name: 'Address', type: 'address' },
                  { name: 'Nonce', type: 'string' },
                  { name: 'Expiry', type: 'uint256' },
                ],
              },
              message: {
                Purpose: 'Link wallet to Bouncer',
                Domain: this.auth.origin,
                UserID: session.user.id,
                Address: address,
                Nonce: nonce,
                Expiry: expiry,
              },
            }
          : dto.walletType === 'solana' ? solanaMessage({ origin: this.auth.origin, purpose: 'wallet_link', address, userId: session.user.id, nonce, expiry }) : [
              'Bouncer saved-wallet link',
              '',
              `Domain: ${this.auth.origin}`,
              `Discord user: ${session.user.id}`,
              `Address: ${address}`,
              `Nonce: ${nonce}`,
              `Expires at: ${new Date(expiry * 1000).toISOString()}`,
              '',
              'Link this wallet to your Bouncer account. This does not verify community roles.',
            ].join('\n');
      const flow = await this.saveFlow(session, {
        purpose: 'wallet_link',
        address,
        wallet_type: dto.walletType,
        challenge,
        expires_at: new Date(expiry * 1000).toISOString(),
      });
      return this.linkResponse(flow);
    });
  }
  private linkResponse(flow: any) {
    return {
      id: flow.id,
      address: flow.address,
      walletType: flow.wallet_type,
      challenge: flow.challenge,
      expiresAt: flow.expires_at,
    };
  }
  async link(session: PortalSession, dto: MemberProofDto) {
    return this.locked(session, async () => {
      const flow = await this.flow(session);
      if (
        !flow ||
        flow.id !== dto.flow ||
        flow.purpose !== 'wallet_link' ||
        flow.completed_at ||
        new Date(flow.expires_at).getTime() <= Date.now()
      )
        throw new BadRequestException(
          'Wallet proof expired. Start a new wallet link.',
        );
      let proof: { chainId?: number } = {};
      if (flow.wallet_type === 'solana') {
        if (!EnvironmentConfig.SOLANA_ENABLED) throw new BadRequestException('Solana is not enabled.');
        try { verifySolanaMessage(flow.address,flow.challenge,dto.signature); }
        catch { throw new BadRequestException('Invalid Solana signature. Sign again with the selected wallet.'); }
      } else if (flow.wallet_type === 'bitcoin') {
        try { this.bitcoin.verifyMessage(flow.address, flow.challenge, dto.signature); }
        catch { throw new BadRequestException('Invalid wallet signature. Please sign again with the selected wallet.'); }
      } else {
        try { proof = await this.evmSignatures.verify(flow.address, flow.challenge, dto.signature); }
        catch (error) { throw new BadRequestException(error.message); }
      }
      const result = await this.db.rpc('verifier_member_link_wallet', {
        p_user: session.user.id,
        p_flow: flow.id,
        p_transfer: !!dto.transfer,
        p_chain: proof.chainId ?? null,
      });
      if (result.error)
        throw new ConflictException(
          'The wallet link changed or expired. Refresh and try again.',
        );
      return result.data;
    });
  }
  async removalPreview(session: PortalSession, address: string) {
    const wallets = this.checked(
      await this.db
        .from('user_wallets')
        .select('address')
        .eq('user_id', session.user.id)
        .eq('address', address),
    );
    if (!wallets.length)
      throw new NotFoundException('This wallet is not linked to your account.');
    const earned = await this.rules.getEarnedRoleAssignments({
      userId: session.user.id,
    });
    return {
      address,
      communities: [...new Set(earned.map((r) => r.server_id))].map((id) => ({
        id,
        name:
          this.discord.getBotClient()?.guilds.cache.get(id)?.name ||
          'Previous community',
      })),
    };
  }
  async remove(session: PortalSession, address: string, request: string) {
    const result = await this.db.rpc('verifier_member_remove_wallet', {
      p_user: session.user.id,
      p_address: address,
      p_request: request,
    });
    if (result.error)
      throw new ConflictException(
        'The wallet link changed. Refresh your wallets and try again.',
      );
    return result.data;
  }
  async verify(session: PortalSession, dto: MemberVerifyDto) {
    return this.locked(session, () => this.startVerify(session, dto));
  }
  private async startVerify(session: PortalSession, dto: MemberVerifyDto) {
    await this.privacy?.assertActive(session.user.id);
    const { guild, member } = await this.membership(session, dto.server);
    const channel = await guild.channels.fetch(dto.channel);
    if (
      !channel?.isTextBased() ||
      !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
    )
      throw new ForbiddenException(
        'This verification channel is not available to you.',
      );
    if (!(await this.rules.getRulesByChannel(dto.server, dto.channel)).length)
      throw new BadRequestException('This channel has no verification rules.');
    const nonce = await this.nonces.createNonce(
      session.user.id,
      guild.id,
      undefined,
      channel.id,
      {
        userTag: session.user.name,
        avatar: session.user.avatar || '',
        discordName: guild.name,
        discordIcon: guild.iconURL() || '',
      },
      true,
    );
    const context = await this.nonces.getActiveNonce(
      session.user.id,
      guild.id,
      nonce,
    );
    try {
      await this.saveFlow(session, {
        purpose: 'verify',
        server_id: guild.id,
        channel_id: channel.id,
        nonce,
        expires_at: new Date(context.expiry * 1000).toISOString(),
      });
    } catch (error) {
      await this.nonces.invalidateNonce(nonce);
      throw error;
    }
    return { url: `/verify/${nonce}?from=member` };
  }
  async resume(session: PortalSession, id: string) {
    const flow = await this.flow(session);
    if (!flow || flow.id !== id || flow.completed_at)
      throw new BadRequestException(
        'This pending action is no longer available.',
      );
    if (flow.purpose === 'wallet_link') {
      if (new Date(flow.expires_at).getTime() <= Date.now())
        return this.linkChallenge(session, {
          address: flow.address,
          walletType: flow.wallet_type,
          ...(flow.wallet_type === 'evm' ? { chainId: flow.challenge.domain.chainId } : {}),
        });
      return this.linkResponse(flow);
    }
    await this.membership(session, flow.server_id);
    if (new Date(flow.expires_at).getTime() <= Date.now())
      return this.verify(session, {
        server: flow.server_id,
        channel: flow.channel_id,
      });
    try {
      await this.nonces.getActiveNonce(
        session.user.id,
        flow.server_id,
        flow.nonce,
      );
    } catch {
      return this.verify(session, {
        server: flow.server_id,
        channel: flow.channel_id,
      });
    }
    // Recheck channel visibility/rules as well as membership when continuing.
    const { member, guild } = await this.membership(session, flow.server_id);
    const channel = await guild.channels.fetch(flow.channel_id);
    if (
      !channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ||
      !(await this.rules.getRulesByChannel(flow.server_id, flow.channel_id))
        .length
    )
      throw new ForbiddenException(
        'This verification channel is no longer available.',
      );
    return { url: `/verify/${flow.nonce}?from=member` };
  }
  async retry(session: PortalSession, id: string) {
    const actions = this.checked(
      await this.db
        .from('verifier_member_actions')
        .select('id')
        .eq('user_id', session.user.id),
    );
    if (!actions.length) throw new NotFoundException('Check not found.');
    const result = await this.db
      .from('verifier_reconciliation_jobs')
      .update({
        status: 'pending',
        attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'failed')
      .in(
        'member_action_id',
        actions.map((a) => a.id),
      )
      .select('id');
    if (!this.checked(result).length)
      throw new NotFoundException('Failed check not found.');
    return { ok: true };
  }
  async assertPortalVerification(
    userId: string,
    serverId: string,
    nonce: string,
  ) {
    const context = await this.nonces.getActiveNonce(userId, serverId, nonce);
    if (!context.memberPortal) return;
    const { guild, member } = await this.membership(
      { user: { id: userId } } as PortalSession,
      serverId,
    );
    const channel = await guild.channels.fetch(context.channelId);
    if (!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
      throw new ForbiddenException(
        'This verification channel is no longer available to you.',
      );
  }
  async finishVerification(userId: string, serverId: string, nonce: string) {
    try {
      await this.nonces.getActiveNonce(userId, serverId, nonce);
      return;
    } catch {}
    // Only the matching account's flow is completed; a newer flow is untouched.
    this.checked(
      await this.db
        .from('verifier_member_flows')
        .update({ completed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('purpose', 'verify')
        .eq('nonce', nonce),
    );
  }
}
