import { Injectable, Logger } from '@nestjs/common';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction,
  EmbedBuilder, MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { DbService } from '../../db.service';

interface AuditPages {
  guildId: string;
  days: number;
  header: string;
  pages: string[][];
  total: number;
  fetchedAt: Date;
}

@Injectable()
export class AuditLogHandler {
  private readonly logger = new Logger(AuditLogHandler.name);
  private readonly paginationCache = new Map<string, AuditPages>();
  private readonly PAGE_SIZE = 20;

  constructor(private readonly dbSvc: DbService) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) {
      await interaction.editReply({ content: '❌ This command can only be used in a server.' });
      return;
    }
    const days = interaction.options.getInteger('days') ?? 1;
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      await interaction.editReply({ content: '❌ Days parameter must be between 1 and 30.' });
      return;
    }
    try {
      const entries = await this.dbSvc.getServerAuditLog(interaction.guildId, days);
      const header = `**Server:** ${this.displayText(interaction.guild?.name, 'Unknown', 100)}`;
      if (!entries.length) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF73)
          .setTitle('Role Assignment Audit Log').setDescription(`${header}\n\nNo activity found in the specified time period.`)
          .setFooter({ text: `Period: Last ${days} day${days === 1 ? '' : 's'}` })], components: [] });
        return;
      }
      const pages: string[][] = [];
      let page: string[] = [];
      let length = header.length + 2;
      for (const entry of entries) {
        const line = this.formatEntry(entry);
        if (page.length && (page.length === this.PAGE_SIZE || length + 1 + line.length > 4096)) {
          pages.push(page);
          page = [];
          length = header.length + 2;
        }
        length += (page.length ? 1 : 0) + line.length;
        page.push(line);
      }
      if (page.length) pages.push(page);
      const snapshot = { guildId: interaction.guildId, days, header, pages, total: entries.length, fetchedAt: new Date() };
      const key = `${interaction.user.id}:${interaction.id}`;
      this.paginationCache.set(key, snapshot);
      const timeout = setTimeout(() => this.paginationCache.delete(key), 5 * 60 * 1000);
      timeout.unref?.();
      await this.showPage(interaction, snapshot, 0, interaction.id);
    } catch (error) {
      this.logger.error('Failed to retrieve audit log:', error.message);
      await interaction.editReply({ content: '❌ Failed to retrieve the audit log. Please try again later.', embeds: [], components: [] });
    }
  }

  async handlePaginationButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ Administrator permissions are required to view the audit log.', flags: MessageFlags.Ephemeral });
      return;
    }
    const match = /^audit-log-(prev|next)-(\d+)-(\d+)$/.exec(interaction.customId);
    const snapshot = match && this.paginationCache.get(`${interaction.user.id}:${match[3]}`);
    if (!snapshot || snapshot.guildId !== interaction.guildId || !Number.isSafeInteger(Number(match[2]))) {
      await interaction.reply({ content: '❌ Pagination data expired. Please run `/setup audit-log` again.', flags: MessageFlags.Ephemeral });
      return;
    }
    const page = Number(match[2]) + (match[1] === 'next' ? 1 : -1);
    await this.showPage(interaction, snapshot, page, match[3], true);
  }

  private async showPage(interaction: ChatInputCommandInteraction | ButtonInteraction, snapshot: AuditPages,
    requestedPage: number, listId: string, update = false): Promise<void> {
    const page = Math.max(0, Math.min(requestedPage, snapshot.pages.length - 1));
    const rows = snapshot.pages[page];
    const start = snapshot.pages.slice(0, page).reduce((sum, entries) => sum + entries.length, 0) + 1;
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`audit-log-prev-${page}-${listId}`).setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`audit-log-next-${page}-${listId}`).setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary).setDisabled(page === snapshot.pages.length - 1),
    );
    const embed = new EmbedBuilder().setColor(0x00FF73)
      .setTitle(`Role Assignment Audit Log (Page ${page + 1}/${snapshot.pages.length})`)
      .setDescription(`${snapshot.header}\n\n${rows.join('\n')}`)
      .addFields({ name: 'Legend', value: '✅ Initial · 🔄 Re-verified · 🗑️ Removed · ⌛ Expired' })
      .setTimestamp(snapshot.fetchedAt)
      .setFooter({ text: `Showing ${start}–${start + rows.length - 1} of ${snapshot.total} entries │ Period: Last ${snapshot.days} day${snapshot.days === 1 ? '' : 's'}` });
    const reply = { embeds: [embed], components: [buttons], allowedMentions: { parse: [] as [] } };
    if (update) await (interaction as ButtonInteraction).update(reply);
    else await interaction.editReply(reply);
  }

  private displayText(value: unknown, fallback: string, limit = 100): string {
    return escapeMarkdown((typeof value === 'string' && value.trim() ? value : fallback)
      .replace(/[\r\n\t]/g, ' ').slice(0, limit));
  }

  private formatEntry(entry: any): string {
    let date = new Date(entry.updated_at || entry.created_at);
    if (Number.isNaN(date.getTime())) date = new Date(entry.created_at);
    const timestamp = Number.isNaN(date.getTime()) ? 'Unknown time' : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
    const age = new Date(entry.updated_at).getTime() - new Date(entry.created_at).getTime();
    const action = entry.status === 'revoked' ? '🗑️' : entry.status === 'expired' ? '⌛' : age > 3600000 ? '🔄' : '✅';
    const wallets = Array.isArray(entry.user_wallets) ? entry.user_wallets : [];
    const address = wallets[0]?.address;
    let wallet = 'Unknown';
    if (typeof address === 'string' && (/^0x[0-9a-fA-F]{40}$/.test(address) || /^bc1p[a-z0-9]{58}$/.test(address))) {
      const label = `${address.slice(0, 5)}…${address.slice(-5)}`;
      const url = address.startsWith('bc1p') ? `https://mempool.space/address/${address}` : `https://ethscriptions.com/${address}`;
      wallet = `[${label}](${url})${wallets.length > 1 ? ` +${wallets.length - 1}` : ''}`;
    }
    return `${action}│${this.displayText(entry.user_name, 'Unknown User')}│${this.displayText(entry.role_name || entry.role_id, 'Unknown Role')} (${wallet}) ${timestamp}`;
  }
}
