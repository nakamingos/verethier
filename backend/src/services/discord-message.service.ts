import { Injectable, Logger } from '@nestjs/common';
import { GuildTextBasedChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Message } from 'discord.js';

/**
 * DiscordMessageService
 * 
 * Manages Discord message creation and manipulation for verification systems.
 * Handles verification message formats while preventing duplicate verification 
 * messages in channels.
 * 
 * Key responsibilities:
 * - Create verification embed messages with buttons
 * - Detect existing verification messages to prevent duplicates
 * - Update verification messages with current rule information
 */
@Injectable()
export class DiscordMessageService {
  private client: Client | null = null;

  /**
   * Initialize the service with the Discord client instance.
   * Required for accessing Discord API and bot user information.
   * 
   * @param client - The initialized Discord.js client
   */
  initialize(client: Client): void {
    this.client = client;
  }

  constructor() {}

  /**
   * Checks if there's already a verification message from our bot in the specified channel
   * 
   * @param channel - The Discord channel to search for verification messages
   * @returns Promise<boolean> - True if a verification message exists, false otherwise
   */
  async findExistingVerificationMessage(channel: GuildTextBasedChannel): Promise<boolean> {
    try {
      return (await this.getExistingVerificationMessage(channel)) !== null;
    } catch (error) {
      Logger.error('Error searching for existing verification message:', error);
      return false;
    }
  }

  /**
   * Creates a new verification message in the specified channel
   * @param channel - The Discord channel to send the message to
   * @returns The message ID of the created verification message
   */
  async createVerificationMessage(channel: GuildTextBasedChannel): Promise<string> {
    const sentMessage = await channel.send(this.buildVerificationMessage());
    return sentMessage.id;
  }

  /** Updates the existing message without changing its ID, position, or pins. */
  async refreshVerificationMessage(channel: GuildTextBasedChannel): Promise<string | null> {
    // Lookup errors must propagate: failed reads are not evidence of a missing message.
    const message = await this.getExistingVerificationMessage(channel);
    if (!message) return null;

    await message.edit({ content: null, ...this.buildVerificationMessage() });
    return message.id;
  }

  async getExistingVerificationMessage(channel: GuildTextBasedChannel): Promise<Message | null> {
    const botUserId = this.client?.user?.id;
    if (!botUserId) throw new Error('Discord client not properly initialized or bot user ID not available');

    const messages = await channel.messages.fetch({ limit: 100 });
    for (const message of messages.values()) {
      if (this.isVerificationMessage(message, botUserId)) return message;
    }

    // A pinned verification message may be older than the last 100 messages.
    const pinnedMessages = await channel.messages.fetchPinned();
    for (const message of pinnedMessages.values()) {
      if (this.isVerificationMessage(message, botUserId)) return message;
    }
    return null;
  }

  private isVerificationMessage(message: Message, botUserId: string): boolean {
    return message.author.id === botUserId && message.components.some(row =>
      row.type === 1 && row.components.some(component =>
        component.type === 2 && component.customId === 'requestVerification'
      )
    );
  }

  /** Keep newly posted and refreshed verification messages on the same template. */
  private buildVerificationMessage() {
    const verifyEmbed = new EmbedBuilder()
      .setTitle('Bouncer · Wallet Verification')
      .setDescription('Verify your wallet. Get your roles. Click the button below to get started.')
      .setColor('#00FF73');
      
    const verifyButton = new ActionRowBuilder<ButtonBuilder>()
      .setComponents(
        new ButtonBuilder()
          .setCustomId('requestVerification')
          .setLabel('Request Verification')
          .setStyle(ButtonStyle.Primary)
      );

    return {
      embeds: [verifyEmbed],
      components: [verifyButton],
    };
  }

  /**
   * Checks if a Discord message still exists in the channel
   * @param channel - The Discord channel to check
   * @param messageId - The ID of the message to verify
   * @returns True if the message exists, false otherwise
   */
  async verifyMessageExists(channel: GuildTextBasedChannel, messageId: string): Promise<boolean> {
    try {
      await channel.messages.fetch(messageId);
      return true;
    } catch (error) {
      // Message not found (deleted, etc.)
      return false;
    }
  }
}
