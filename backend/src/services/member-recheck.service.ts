import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle,
  CacheType, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction,
} from 'discord.js';
import { VerifierRole } from '@/models/verifier-role.interface';
import { BoundedMap } from '@/utils/bounded-cache.util';
import { checkFamily, interactiveWalletFamilies, ruleMatchesWalletScope } from '@/utils/check-priority.util';
import { boundedEmbedDescription } from '@/utils/discord-embed.util';
import { WalletType } from '@/utils/wallet-address.util';
import { walletCheckNetwork, walletMatchesRule } from '@/utils/wallet-check.util';
import { walletOnChain } from '@/utils/wallet-scope.util';
import { DbService } from './db.service';
import { DiscordVerificationService, memberPortalButton, RoleSyncContext, VerificationReplyControls } from './discord-verification.service';
import { DynamicRoleService } from './dynamic-role.service';
import { NftCheckContext } from './nft-ownership.service';
import { OrdinalsRequestScheduler } from './ordinals-request-scheduler.service';
import { VerificationService } from './verification.service';
import { WalletBlockService } from './wallet-block.service';
import { assignVerifiedRoles } from './utils/assign-verified-roles.util';

export const RECHECK_SELECT = 'bouncer-recheck-family';
export const RECHECK_BUTTON = 'bouncer-recheck:';

const FAMILIES: WalletType[] = ['evm', 'bitcoin', 'solana'];
const LABELS: Record<WalletType, string> = { evm: 'EVM', bitcoin: 'Bitcoin', solana: 'Solana' };
// Ordinals lookups can spend paid provider credits, so Bitcoin waits longer.
const COOLDOWN_MS: Record<WalletType, number> = { evm: 5 * 60_000, solana: 5 * 60_000, bitcoin: 15 * 60_000 };
const UNAVAILABLE = 'Collection verification is temporarily unavailable. Please try again later.';

type Rule = Pick<VerifierRole, 'asset_type' | 'chain_id'> & Partial<VerifierRole>;

/** The wallet family a rule belongs to, matching the Verify page's wallet tabs. */
function ruleWalletType(rule: Rule): WalletType {
  const family = checkFamily(rule);
  return family === 'stamps' || family === 'ordinals' ? 'bitcoin' : family === 'solana' ? 'solana' : 'evm';
}

function isFamily(value: string): value is WalletType {
  return (FAMILIES as string[]).includes(value);
}

/**
 * "Re-check saved wallets" on a member's private verification reply. It re-reads
 * holdings for saved wallets the member already proved, within one wallet
 * family, and grants or removes roles exactly like a signed verification in
 * that family. Linking or claiming a wallet still needs a signature, inactive
 * (dormant) wallets still need a signature to wake, and blocked wallets stay
 * excluded.
 */
@Injectable()
export class MemberRecheckService {
  private readonly cooldowns = new BoundedMap<string, number>(10_000);

  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly dbSvc: DbService,
    private readonly verificationSvc: VerificationService,
    private readonly discord: DiscordVerificationService,
    private readonly walletBlocks: WalletBlockService,
    @Optional() private readonly earnedRoles?: DynamicRoleService,
    @Optional() private readonly ordinalRequests?: OrdinalsRequestScheduler,
  ) {}

  /**
   * Active saved wallets per family that at least one of these rules would
   * read: not blocked in the server and not inactive for the rule's network.
   */
  async activeWallets(userId: string, guildId: string, rules: Rule[]): Promise<Map<WalletType, string[]>> {
    const families = new Map<WalletType, Set<string>>();
    if (!rules.length) return new Map();
    const saved = await this.db.from('user_wallets').select('address,wallet_type,evm_chain_ids').eq('user_id', userId);
    if (saved.error || !Array.isArray(saved.data)) throw new Error('Saved wallets unavailable');
    const wallets = saved.data as Array<{ address: string; wallet_type: WalletType; evm_chain_ids: number[] | null }>;
    if (!wallets.length) return new Map();
    const key = (address: string) => (/^0x/i.test(address) || /^bc1/i.test(address)) ? address.toLowerCase() : address;
    const allowed = new Set(await this.walletBlocks.allowedAddresses(guildId, wallets.map(wallet => wallet.address)));
    const inactive = await this.db.from('verifier_wallet_dormancy').select('address,network')
      .eq('server_id', guildId).in('address', wallets.map(wallet => wallet.address));
    if (inactive.error || !Array.isArray(inactive.data)) throw new Error('Wallet checking state unavailable');
    const dormant = new Set(inactive.data.map((row: any) => `${row.network}:${row.address}`));
    for (const rule of rules) {
      const type = ruleWalletType(rule);
      const network = walletCheckNetwork(rule);
      for (const wallet of wallets) {
        if (wallet.wallet_type !== type || !allowed.has(key(wallet.address))) continue;
        if (type === 'evm' && !walletOnChain(wallet, rule.chain_id || 1)) continue;
        if (!walletMatchesRule(rule, wallet.address) || dormant.has(`${network}:${wallet.address}`)) continue;
        if (!families.has(type)) families.set(type, new Set());
        families.get(type)!.add(wallet.address);
      }
    }
    return new Map(FAMILIES.filter(type => families.has(type)).map(type => [type, [...families.get(type)!]]));
  }

  /** Initial button only; the family picker appears after it is clicked. */
  async controls(userId: string, guildId: string, rules: Rule[]): Promise<VerificationReplyControls> {
    const active = await this.activeWallets(userId, guildId, rules);
    if (!active.size) return null;
    const families = [...active.keys()];
    const only = families.length === 1 ? families[0] : 'choose';
    const button = new ButtonBuilder().setCustomId(RECHECK_BUTTON + only).setStyle(ButtonStyle.Secondary)
      .setLabel(families.length === 1 ? `Re-check ${LABELS[families[0]]} wallets` : 'Re-check saved wallets');
    return { button, rows: [] };
  }

  /** Choosing a family starts the check; no separate confirmation is needed. */
  async handleSelect(interaction: StringSelectMenuInteraction<CacheType>): Promise<void> {
    const family = interaction.values[0];
    if (!isFamily(family)) { await interaction.deferUpdate(); return; }
    await this.runCheck(interaction, family);
  }

  async handleButton(interaction: ButtonInteraction<CacheType>): Promise<void> {
    const family = interaction.customId.slice(RECHECK_BUTTON.length);
    if (family === 'choose') {
      await interaction.deferUpdate();
      if (!interaction.guildId || !interaction.channelId) return;
      try {
        const rules = await this.verificationSvc.getRulesForChannel(interaction.guildId, interaction.channelId);
        const active = await this.activeWallets(interaction.user.id, interaction.guildId, rules);
        const menu = new StringSelectMenuBuilder().setCustomId(RECHECK_SELECT)
          .setPlaceholder('Choose wallets to re-check').setMinValues(1).setMaxValues(1)
          .addOptions([...active].map(([type, wallets]) => ({ label: LABELS[type], value: type,
            description: `${wallets.length} saved wallet${wallets.length === 1 ? '' : 's'}` })));
        await interaction.editReply({
          embeds: [new EmbedBuilder().setTitle('Re-check Saved Wallets').setColor('#5865F2')
            .setDescription(active.size ? 'Choose which saved wallets to check for roles in this server. You do not need to connect or sign again.'
              : 'No active saved wallets are available here. Request a new verification link in Discord to connect a wallet.')],
          components: active.size ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] : [],
        });
      } catch {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setTitle('Saved Wallets Unavailable')
            .setDescription('Could not load your saved wallets. Please request verification again in Discord and try Re-check once more.').setColor('#FF0000')],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(memberPortalButton())],
        });
      }
      return;
    }
    if (!isFamily(family)) { await interaction.deferUpdate(); return; }
    await this.runCheck(interaction, family);
  }

  private async runCheck(interaction: ButtonInteraction<CacheType> | StringSelectMenuInteraction<CacheType>, family: WalletType): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId || !channelId) { await interaction.deferUpdate(); return; }
    const userId = interaction.user.id;
    const cooldownKey = `${userId}:${guildId}:${family}`;
    const readyAt = this.cooldowns.get(cooldownKey) ?? 0;
    if (readyAt > Date.now()) {
      await interaction.reply({
        content: `You can check your saved ${LABELS[family]} wallets again <t:${Math.ceil(readyAt / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // The cooldown starts at the click, so failed or slow checks cannot be repeated rapidly.
    this.cooldowns.set(cooldownKey, Date.now() + COOLDOWN_MS[family]);
    await interaction.deferUpdate();
    const resultRows = [new ActionRowBuilder<ButtonBuilder>().addComponents(memberPortalButton())];
    const show = (title: string, description: string, color: `#${string}`, rows: any[] = resultRows) => interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(title).setDescription(boundedEmbedDescription(description)).setColor(color)],
      components: rows,
    });
    await show('Checking Saved Wallets', `Checking your saved ${LABELS[family]} wallets… You do not need to connect or sign again.`, '#5865F2', []);
    try {
      const outcome = await this.check(userId, guildId, channelId, family);
      const guildName = interaction.guild?.name || 'this server';
      if (outcome.kind === 'no-rules') await show('No Matching Requirements', `This channel has no ${LABELS[family]} requirements.`, '#FF0000');
      else if (outcome.kind === 'no-wallets') await show('No Saved Wallets', `You have no active saved ${LABELS[family]} wallets here. Request a new verification link in Discord to connect one.`, '#FF0000');
      else if (outcome.kind === 'unavailable') await show('Wallet Check Unavailable', UNAVAILABLE, '#FF0000');
      else {
        const removed = outcome.revoked ? `\n\nRemoved ${outcome.revoked} role${outcome.revoked === 1 ? '' : 's'} you no longer qualify for.` : '';
        if (!outcome.roleResults.length) {
          await show('No Matching Roles', `Your saved ${LABELS[family]} wallets don't meet this channel's requirements.${removed}`, '#FF0000');
        } else {
          const summary = await this.discord.verificationSummary(guildId, channelId, userId, outcome.roleResults, outcome.address, outcome.context, family)
            .catch(() => '');
          await show('Wallet Check Complete', `Checked your saved ${LABELS[family]} wallets in ${guildName}.${summary}${removed}`, '#00FF00');
        }
      }
    } catch (error) {
      Logger.warn(`Saved-wallet check failed: user=${userId}; family=${family}; ${error instanceof Error ? error.message : 'unknown error'}`);
      try { await show('Wallet Check Unavailable', UNAVAILABLE, '#FF0000'); }
      catch { /* The private reply may have expired. */ }
    }
  }

  /** Checks the channel's rules in one family against the member's active saved wallets. */
  async check(userId: string, guildId: string, channelId: string, family: WalletType): Promise<
    | { kind: 'no-rules' } | { kind: 'no-wallets' } | { kind: 'unavailable' }
    | { kind: 'checked'; roleResults: any[]; revoked: number; address: string; context: NftCheckContext }
  > {
    const families = interactiveWalletFamilies(family);
    const rules = (await this.verificationSvc.getRulesForChannel(guildId, channelId)).filter(rule => ruleMatchesWalletScope(rule, families));
    if (!rules.length) return { kind: 'no-rules' };
    const wallets = (await this.activeWallets(userId, guildId, rules)).get(family) ?? [];
    if (!wallets.length) return { kind: 'no-wallets' };
    const context: NftCheckContext = { checks: new Map(), verificationCheckFamilies: families };
    context.ordinalNeedsNumbers = rules.some(rule => rule.asset_type === 'ordinal' && rule.inscription_criteria?.kind === 'numbers' && !rule.inscription_criteria.collection_slug);
    const finish = family === 'bitcoin' ? this.ordinalRequests?.beginVerification() : undefined;
    const startedAt = Date.now();
    try {
      const result = await this.verificationSvc.verifyUserBulk(userId, rules.map(rule => rule.id), wallets[0], context, rules);
      const members: RoleSyncContext = new Map();
      members.memberRecheck = { userId, guildId };
      const roleResults = result.validRules.length
        ? await assignVerifiedRoles(this.discord, { userId, guildId, nonce: 'recheck' }, result, members) : [];
      let revoked = 0;
      // Remove earned roles in this family that saved wallets no longer support.
      try { revoked = (await this.earnedRoles?.reverifyUserInServer(userId, guildId, context))?.revoked ?? 0; }
      catch { Logger.warn('Earned-role reconciliation unavailable; existing roles retained for retry.'); }
      if (!roleResults.length && result.results?.some(check => check.status === 'unavailable' || check.error)) return { kind: 'unavailable' };
      return { kind: 'checked', roleResults, revoked, address: wallets[0], context };
    } finally {
      finish?.();
      await this.verificationSvc.finishWalletChecks?.(context);
      Logger.log(`Saved-wallet check: user=${userId}; family=${family}; ${Date.now() - startedAt}ms`);
    }
  }
}
