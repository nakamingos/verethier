import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, ChatInputCommandInteraction, GuildTextBasedChannel, MessageFlags } from 'discord.js';
import { DbService } from '../../db.service';
import { DiscordMessageService } from '../../discord-message.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';

@Injectable()
export class RefreshVerificationHandler {
  private readonly logger = new Logger(RefreshVerificationHandler.name);

  constructor(
    private readonly dbSvc: DbService,
    private readonly messageSvc: DiscordMessageService
  ) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const channel = interaction.options.getChannel('channel') as GuildTextBasedChannel | null;
      if (!interaction.guild || !channel || channel.type !== ChannelType.GuildText || channel.guild.id !== interaction.guild.id) {
        await interaction.editReply({
          content: AdminFeedback.simple('Please specify a valid text channel in this server.', true)
        });
        return;
      }

      const rules = await this.dbSvc.getRulesByChannel(interaction.guild.id, channel.id);
      if (rules.length === 0) {
        await interaction.editReply({
          content: AdminFeedback.simple('No verification rules found for this channel. Use `/setup add-rule` to create rules first.')
        });
        return;
      }

      const newMessage = interaction.options.getBoolean('new_message') ?? false;
      const messageId = newMessage
        ? await this.messageSvc.createVerificationMessage(channel)
        : await this.messageSvc.refreshVerificationMessage(channel);

      if (!messageId) {
        await interaction.editReply({
          content: AdminFeedback.simple('No verification message found in recent messages or pins. Use `/setup recover-verification` to create one, or run this command with `new_message:true`.')
        });
        return;
      }

      const messageLink = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${messageId}`;
      const embed = AdminFeedback.success(
        newMessage ? 'Verification Message Created' : 'Verification Message Refreshed',
        newMessage
          ? `Posted a new [verification message](${messageLink}). Existing verification messages still work with this channel's rules.`
          : `Updated the [verification message](${messageLink}) to the current style. Its link and pins are preserved.`,
        [
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Active Rules', value: `${rules.length} rules use this channel's verification messages`, inline: true }
        ]
      );
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error refreshing verification message:', error);
      const response = { content: AdminFeedback.simple(`Could not refresh the verification message: ${error.message}`, true) };
      if (interaction.deferred) {
        await interaction.editReply(response);
      } else if (!interaction.replied) {
        await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
      }
    }
  }
}
