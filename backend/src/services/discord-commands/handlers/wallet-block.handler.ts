import { Injectable, Logger } from '@nestjs/common';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction,
  EmbedBuilder, escapeMarkdown, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { WalletBlockService, normalizeBlockedWallet } from '../../wallet-block.service';
import { DynamicRoleService } from '../../dynamic-role.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';

@Injectable()
export class WalletBlockHandler {
  private readonly logger = new Logger(WalletBlockHandler.name);
  private readonly PAGE_SIZE = 6;

  constructor(private readonly blocks: WalletBlockService, private readonly roles: DynamicRoleService) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const command = interaction.options.getSubcommand();
      if (command === 'list-blocked-wallets') return await this.showPage(interaction, 0);
      if (command !== 'block-wallet' && command !== 'unblock-wallet') throw new Error('Unknown wallet command.');
      const address = normalizeBlockedWallet(interaction.options.getString('address', true));
      const reason = interaction.options.getString('reason');
      const blocking = command === 'block-wallet';
      if (blocking) await this.blocks.block(interaction.guildId, address, interaction.user.id, reason);
      else if (!await this.blocks.unblock(interaction.guildId, address)) {
        await interaction.editReply({ embeds: [AdminFeedback.info('Wallet Not Blocked', `\`${address}\` is not blocked in this server.`)], allowedMentions: { parse: [] } });
        return;
      }

      const title = blocking ? 'Wallet Blocked' : 'Wallet Unblocked';
      const description = blocking
        ? `\`${address}\` can no longer verify or contribute holdings in this server.`
        : `\`${address}\` can verify and contribute holdings in this server again.`;
      await interaction.editReply({ embeds: [AdminFeedback.success(title, `${description}\n\nChecking the linked member's previously earned roles…`)], allowedMentions: { parse: [] } });
      let checked = 0;
      let errors = 0;
      try {
        for (const userId of await this.blocks.linkedUsers(address)) {
          const result = await this.roles.reverifyUserInServer(userId, interaction.guildId);
          checked++;
          errors += result.errors;
        }
      } catch (error) {
        errors++;
        this.logger.warn(`Wallet restriction saved; immediate role check failed: ${error.message}`);
      }
      const feedback = errors
        ? 'The wallet restriction is saved. Some role checks could not finish; scheduled checks will retry.'
        : checked ? 'The linked member’s previously earned roles have been rechecked using eligible wallets.'
        : 'This wallet is not linked to a member yet.';
      const embed = errors ? AdminFeedback.warning(title, `${description}\n\n${feedback}`)
        : AdminFeedback.success(title, `${description}\n\n${feedback}`);
      if (blocking && reason?.trim()) embed.addFields({ name: 'Reason', value: this.safeText(reason.trim()) });
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      this.logger.warn(`Wallet command failed: ${error.message}`);
      await interaction.editReply({ embeds: [AdminFeedback.error('Wallet Command Failed', this.safeText(error.message || 'Could not update wallet restrictions. Please try again.'))], allowedMentions: { parse: [] } });
    }
  }

  async handlePaginationButton(interaction: ButtonInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    const match = /^wallet-blocks-(prev|next)-(\d+)-(\d+)-(\d+)$/.exec(interaction.customId);
    if (!match || match[3] !== interaction.user.id || match[4] !== interaction.guildId || !Number.isSafeInteger(Number(match[2]))) {
      await interaction.reply({ content: '❌ Run `/setup list-blocked-wallets` to open your own list.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferUpdate();
    try {
      await this.showPage(interaction, Math.max(0, Number(match[2]) + (match[1] === 'next' ? 1 : -1)));
    } catch {
      await interaction.editReply({ content: '❌ Could not list blocked wallets. Please run `/setup list-blocked-wallets` again.', embeds: [], components: [] });
    }
  }

  private async authorized(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<boolean> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '🚫 Administrator permissions in a server are required.', flags: MessageFlags.Ephemeral });
      return false;
    }
    return true;
  }

  private safeText(value: string): string {
    return escapeMarkdown(value.replace(/[\r\n\t]/g, ' ').slice(0, 300));
  }

  private async showPage(interaction: ChatInputCommandInteraction | ButtonInteraction, page: number): Promise<void> {
    let data = await this.blocks.list(interaction.guildId, page, this.PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(data.total / this.PAGE_SIZE));
    if (page >= pages) {
      page = pages - 1;
      data = await this.blocks.list(interaction.guildId, page, this.PAGE_SIZE);
    }
    const rows = data.rows.map(row => {
      const timestamp = Math.floor(new Date(row.blocked_at).getTime() / 1000);
      const admin = /^\d{17,20}$/.test(row.blocked_by) ? `<@${row.blocked_by}>` : 'Unknown admin';
      return `\`${row.address}\`\nBlocked by ${admin} · <t:${timestamp}:f>\n${row.reason ? `Reason: ${this.safeText(row.reason)}` : 'No reason provided.'}`;
    });
    const embed = new EmbedBuilder().setColor(0x00FF73)
      .setTitle(`Blocked Wallets (Page ${page + 1}/${pages})`)
      .setDescription(rows.join('\n\n') || 'No wallets are blocked in this server.')
      .setFooter({ text: data.total ? `Showing ${page * this.PAGE_SIZE + 1}–${page * this.PAGE_SIZE + rows.length} of ${data.total} wallets` : 'Blocks apply only to this server' });
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`wallet-blocks-prev-${page}-${interaction.user.id}-${interaction.guildId}`)
        .setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`wallet-blocks-next-${page}-${interaction.user.id}-${interaction.guildId}`)
        .setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
    );
    await interaction.editReply({ embeds: [embed], components: data.total ? [buttons] : [], allowedMentions: { parse: [] } });
  }
}
