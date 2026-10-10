import { Injectable, Logger } from '@nestjs/common';
import { GuildTextBasedChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Client } from 'discord.js';

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
      // Check if client is properly initialized
      const botUserId = this.client?.user?.id;
      if (!botUserId) {
        Logger.error('Discord client not properly initialized or bot user ID not available');
        return false;
      }

      // Fetch recent messages from the channel (last 100 messages should be enough)
      const messages = await channel.messages.fetch({ limit: 100 });
      
      let botMessagesCount = 0;
      let botMessagesWithButtonsCount = 0;

      for (const [messageId, message] of messages) {
        // Check if message is from our bot
        if (message.author.id !== botUserId) continue;
        botMessagesCount++;
        
        // Check for verification message with specific custom ID
        if (message.components.length > 0) {
          botMessagesWithButtonsCount++;
          
          // Check if this message has the verification button
          for (const actionRow of message.components) {
            if (actionRow.type === 1) { // ActionRow type
              for (const component of (actionRow as any).components) {
                if (component.type === 2 && // ButtonComponent type
                    component.customId === 'requestVerification') {
                  return true;
                }
              }
            }
          }
        }
      }
      
      return false;
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

    const sentMessage = await channel.send({
      embeds: [verifyEmbed],
      components: [verifyButton],
    });

    return sentMessage.id;
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
