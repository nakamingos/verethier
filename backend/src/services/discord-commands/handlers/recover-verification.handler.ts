import { Injectable, Logger } from '@nestjs/common';
import { ChatInputCommandInteraction, MessageFlags, ChannelType, GuildTextBasedChannel } from 'discord.js';
import { DbService } from '../../db.service';
import { DiscordMessageService } from '../../discord-message.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';

/**
 * Recover Verification Command Handler
 * 
 * Handles the complete flow for recovering verification setup:
 * - Channel validation (must be text channel)
 * - Detection of existing verification messages
 * - Rule discovery for the channel
 * - New verification message creation
 * - Comprehensive feedback with affected roles
 */
@Injectable()
export class RecoverVerificationHandler {
  private readonly logger = new Logger(RecoverVerificationHandler.name);

  constructor(
    private readonly dbSvc: DbService,
    private readonly messageSvc: DiscordMessageService
  ) {}

  /**
   * Main entry point for recover verification command
   */
  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Validate channel input
      const channel = await this.validateChannelInput(interaction);
      if (!channel) {
        return; // Error already handled
      }

      // Check for existing verification message
      if (await this.checkForExistingMessage(interaction, channel)) {
        return; // Already has verification message
      }

      // Get rules for this channel
      const channelRules = await this.getChannelRules(interaction, channel);
      if (!channelRules) {
        return; // No rules found, error already handled
      }

      // Create new verification message
      await this.createVerificationMessage(interaction, channel, channelRules);

    } catch (error) {
      this.logger.error('Error in handleRecoverVerification:', error);
      await this.handleError(interaction, error);
    }
  }

  /**
   * Validates channel input and ensures it's a text channel
   */
  private async validateChannelInput(interaction: ChatInputCommandInteraction): Promise<GuildTextBasedChannel | null> {
    const channel = interaction.options.getChannel('channel');
    
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply({
        content: AdminFeedback.simple('Please specify a valid text channel.', true)
      });
      return null;
    }

    return channel as GuildTextBasedChannel;
  }

  /**
   * Checks if the channel already has a verification message
   */
  private async checkForExistingMessage(
    interaction: ChatInputCommandInteraction, 
    channel: GuildTextBasedChannel
  ): Promise<boolean> {
    const hasExistingMessage = await this.messageSvc.findExistingVerificationMessage(channel);
    
    if (hasExistingMessage) {
      await interaction.editReply({
        content: AdminFeedback.simple('Channel already has a verification message. Use `/setup refresh-verification` to update it, or add `new_message:true` to post another without deleting the existing message.')
      });
      return true;
    }

    return false;
  }

  /**
   * Gets all rules for the specified channel
   */
  private async getChannelRules(
    interaction: ChatInputCommandInteraction, 
    channel: GuildTextBasedChannel
  ): Promise<any[] | null> {
    const channelRules = await this.dbSvc.getRulesByChannel(interaction.guild.id, channel.id);

    if (channelRules.length === 0) {
      await interaction.editReply({
        content: AdminFeedback.simple('No verification rules found for this channel. Use `/setup add-rule` to create rules first.')
      });
      return null;
    }

    return channelRules;
  }

  /**
   * Creates a new verification message and provides feedback
   */
  private async createVerificationMessage(
    interaction: ChatInputCommandInteraction,
    channel: GuildTextBasedChannel,
    channelRules: any[]
  ): Promise<void> {
    // Create a new verification message for the channel
    await this.messageSvc.createVerificationMessage(channel);

    // Provide detailed feedback to the admin
    const embed = AdminFeedback.success(
      'Verification Message Created',
      `Successfully created verification message for ${channel}`,
      [
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Active Rules', value: `${channelRules.length} rules will use this message`, inline: true },
        { name: 'Roles Affected', value: this.formatAffectedRoles(channelRules), inline: false }
      ]
    );
    
    embed.setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });

    this.logger.debug(`Verification message created for channel ${channel.id} with ${channelRules.length} active rules`);
  }

  /**
   * Formats the list of affected roles for display
   */
  private formatAffectedRoles(channelRules: any[]): string {
    if (channelRules.length === 0) {
      return 'None';
    }

    const roles = channelRules.map(rule => `<@&${rule.role_id}>`);
    return roles.join(', ');
  }

  /**
   * Handles errors and provides appropriate feedback
   */
  private async handleError(interaction: ChatInputCommandInteraction, error: any): Promise<void> {
    const errorMessage = `Error during recovery: ${error.message}`;
    
    if (interaction.deferred) {
      await interaction.editReply({
        content: AdminFeedback.simple(errorMessage, true)
      });
    } else {
      await interaction.reply({
        content: AdminFeedback.simple(errorMessage, true),
        flags: MessageFlags.Ephemeral
      });
    }
  }
}
