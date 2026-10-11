import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, ChatInputCommandInteraction, GuildTextBasedChannel, MessageFlags } from 'discord.js';
import { DbService } from '../../db.service';
import { DiscordMessageService } from '../../discord-message.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';

@Injectable()
export class VerificationMessageHandler {
  private readonly logger = new Logger(VerificationMessageHandler.name);

  constructor(
    private readonly dbSvc: DbService,
    private readonly messageSvc: DiscordMessageService
  ) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const action = interaction.options.getString('action');
      if (action !== 'refresh' && action !== 'new' && action !== 'recover') {
        await interaction.editReply({
          content: AdminFeedback.simple('Please select an action: Refresh existing, Create new, or Recover missing.', true)
        });
        return;
      }

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
          content: AdminFeedback.simple('No verification rules found for this channel. Use `/setup add-nft-rule`, `/setup add-ordinals-rule`, or `/setup add-ethscription-rule` to create rules first.')
        });
        return;
      }

      if (action === 'recover' && await this.messageSvc.getExistingVerificationMessage(channel)) {
        await interaction.editReply({
          content: AdminFeedback.simple('Channel already has a verification message. Use `/setup verification` with `action:refresh` to update it, or `action:new` to post another.')
        });
        return;
      }

      const messageId = action === 'refresh'
        ? await this.messageSvc.refreshVerificationMessage(channel)
        : await this.messageSvc.createVerificationMessage(channel);

      if (!messageId) {
        await interaction.editReply({
          content: AdminFeedback.simple('No verification message found in recent messages or pins. Use `/setup verification` with `action:recover` to create one.')
        });
        return;
      }

      const messageLink = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${messageId}`;
      const embed = AdminFeedback.success(
        action === 'refresh' ? 'Verification Message Refreshed' : action === 'recover' ? 'Verification Message Recovered' : 'Verification Message Created',
        action === 'refresh'
          ? `Updated the [verification message](${messageLink}) to the current style. Its link and pins are preserved.`
          : action === 'recover'
            ? `Recreated the missing [verification message](${messageLink}) using this channel's existing rules.`
            : `Posted a new [verification message](${messageLink}). Existing verification messages still work with this channel's rules.`,
        [
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Active Rules', value: `${rules.length} rules use this channel's verification messages`, inline: true }
        ]
      );
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error managing verification message:', error);
      const response = { content: AdminFeedback.simple(`Could not complete the verification message action: ${error.message}`, true) };
      if (interaction.deferred) {
        await interaction.editReply(response);
      } else if (!interaction.replied) {
        await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
      }
    }
  }
}
