import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, ChannelType, GuildTextBasedChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, Role, Client, ComponentType, ButtonInteraction } from 'discord.js';
import { DbService } from './db.service';
import { DiscordMessageService } from './discord-message.service';
import { DiscordService } from './discord.service';
import { VerificationRule } from '@/models/verification-rule.interface';
import { AdminFeedback } from './utils/admin-feedback.util';
import { AddRuleHandler } from './discord-commands/handlers/add-rule.handler';
import { RemoveRuleHandler } from './discord-commands/handlers/remove-rule.handler';
import { ListRulesHandler } from './discord-commands/handlers/list-rules.handler';
import { VerificationMessageHandler } from './discord-commands/handlers/verification-message.handler';
import { RemovalUndoInteractionHandler } from './discord-commands/interactions/removal-undo.interaction';
import { RestoreUndoInteractionHandler } from './discord-commands/interactions/restore-undo.interaction';
import { RuleConfirmationInteractionHandler } from './discord-commands/interactions/rule-confirmation.interaction';
import { DuplicateRuleConfirmationInteractionHandler } from './discord-commands/interactions/duplicate-rule-confirmation.interaction';
import { RuleCreationAssetType } from '@/utils/rule-command.util';
import { normalizeRoleName } from './discord-commands/utils/role-management.util';

/**
 * DiscordCommandsService
 * 
 * Handles Discord slash command processing for server administration.
 * Provides comprehensive verification rule management through Discord's slash command interface.
 * 
 * Key responsibilities:
 * - Process add-rule commands with validation and confirmation flows
 * - Handle remove-rule commands with safety checks
 * - List and display current verification rules (all types)
 * - Create and update verification messages in channels
 * - Provide rich admin feedback with embedded messages
 * 
 * Command flows include:
 * - Rule creation with duplicate detection and confirmation
 * - Role management (find existing or create new roles)
 * - Channel validation and message posting
 * - Unified rule management for all rule types
 */
@Injectable()
export class DiscordCommandsService {
  // Store removed rule data for undo functionality
  private removedRules: Map<string, any> = new Map();
  // Store restored rule data for undo functionality
  private restoredRules: Map<string, any> = new Map();

  /**
   * Initialize the service with the Discord client.
   * This service doesn't directly use the client but maintains consistency.
   */
  initialize(client: Client): void {
    // No client needed for this service
  }

  constructor(
    private readonly dbSvc: DbService,
    private readonly messageSvc: DiscordMessageService,
    @Inject(forwardRef(() => DiscordService))
    private readonly discordSvc: DiscordService,
    private readonly addRuleHandler: AddRuleHandler,
    private readonly removeRuleHandler: RemoveRuleHandler,
    private readonly listRulesHandler: ListRulesHandler,
    private readonly verificationMessageHandler: VerificationMessageHandler,
    private readonly removalUndoHandler: RemovalUndoInteractionHandler,
    private readonly restoreUndoHandler: RestoreUndoInteractionHandler,
    private readonly ruleConfirmationHandler: RuleConfirmationInteractionHandler,
    private readonly duplicateRuleConfirmationHandler: DuplicateRuleConfirmationInteractionHandler
  ) {}

  async handleAddRule(interaction: ChatInputCommandInteraction, assetType?: RuleCreationAssetType): Promise<void> {
    // Delegate to the specialized handler
    return assetType ? this.addRuleHandler.handle(interaction, assetType) : this.addRuleHandler.handle(interaction);
  }

  private async showDuplicateRuleWarning(
    interaction: ChatInputCommandInteraction,
    existingRule: any,
    newRuleData: {
      channel: TextChannel;
      role: Role;
      slug: string;
      attributeKey: string;
      attributeValue: string;
      minItems: number;
      wasNewlyCreated?: boolean;
    }
  ): Promise<void> {
    // Get the existing role name for display
    const existingRole = await this.discordSvc.getRole(interaction.guild.id, existingRule.role_id);
    
    // Create rule objects for consistent formatting
    const existingRuleFormatted = {
      role_id: existingRule.role_id,
      slug: existingRule.slug,
      attribute_key: existingRule.attribute_key,
      attribute_value: existingRule.attribute_value,
      min_items: existingRule.min_items
    };

    const newRuleFormatted = {
      role_id: newRuleData.role.id,
      slug: newRuleData.slug,
      attribute_key: newRuleData.attributeKey,
      attribute_value: newRuleData.attributeValue,
      min_items: newRuleData.minItems
    };

    const embed = AdminFeedback.warning(
      'Duplicate Rule Criteria',
      'A rule with the same criteria already exists for a different role. Users meeting these criteria will receive **both roles**. This might be intentional (role stacking) or an error.',
      [
        'Click "Create Anyway" to proceed with role stacking',
        'Click "Cancel" to modify your criteria'
      ],
      [
        {
          name: 'Existing Rule',
          value: AdminFeedback.formatRule(existingRuleFormatted, `${existingRole?.name || 'Unknown Role'}`),
          inline: true
        },
        {
          name: 'New Rule (Proposed)',
          value: AdminFeedback.formatRule(newRuleFormatted, newRuleData.role.name),
          inline: true
        }
      ]
    );

    // Generate chain ID first, then use it consistently
    const chainId = `${interaction.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const row = this.duplicateRuleConfirmationHandler.createDuplicateRuleButtons(chainId);

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    // Store the new rule data for later use if confirmed
    this.duplicateRuleConfirmationHandler.storeRuleData(chainId, newRuleData);

    // Set up button interaction handler
    this.duplicateRuleConfirmationHandler.setupDuplicateRuleButtonHandler(
      interaction,
      chainId,
      async (ruleData) => {
        await this.createRuleDirectly(interaction, ruleData, true);
      },
      async (ruleData) => {
        // Create detailed rule info fields for the cancelled rule
        const cancelledRuleFormatted = {
          role_id: ruleData.role.id,
          role_name: ruleData.role.name,
          channel_name: ruleData.channel.name,
          slug: ruleData.slug,
          attribute_key: ruleData.attributeKey,
          attribute_value: ruleData.attributeValue,
          min_items: ruleData.minItems
        };
        const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields(cancelledRuleFormatted);
        const embed = AdminFeedback.destructive('Rule Creation Cancelled', `Proposed rule for ${ruleData.channel.name} and @${ruleData.role.name} was not created.`);
        embed.addFields(ruleInfoFields);
        
        // Create Undo button
        const undoButton = this.duplicateRuleConfirmationHandler.createUndoRemovalButton(chainId, 'cancellation');
        
        await interaction.editReply({
          embeds: [embed],
          components: [undoButton]
        });
        
        // Set up button interaction handler for undo cancellation
        this.duplicateRuleConfirmationHandler.setupCancellationButtonHandler(
          interaction,
          chainId,
          async (ruleData) => {
            // Create a mock button interaction for the undo cancellation
            const mockButtonInteraction = {
              customId: `undo_cancellation_${chainId}`,
              guild: interaction.guild,
              id: interaction.id,
              reply: interaction.editReply.bind(interaction)
            };
            await this.handleUndoCancellation(mockButtonInteraction);
          }
        );
      }
    );
  }

  private async createRuleDirectly(
    interaction: ChatInputCommandInteraction,
    ruleData: {
      channel: TextChannel;
      role: Role;
      slug: string;
      attributeKey: string;
      attributeValue: string;
      minItems: number;
      wasNewlyCreated?: boolean;
    },
    isDuplicateConfirmed: boolean = false
  ): Promise<void> {
    const { channel, role, slug, attributeKey, attributeValue, minItems, wasNewlyCreated = false } = ruleData;

    // Check for existing verification setup
    const existingRules = await this.dbSvc.getRulesByChannel(interaction.guild.id, channel.id);
    
    let newRule;
    try {
      newRule = await this.dbSvc.addRoleMapping(
        interaction.guild.id,
        interaction.guild.name,
        channel.id,
        channel.name,
        slug,
        role.id,
        role.name,
        attributeKey,
        attributeValue,
        minItems
      );
    } catch (error) {
      Logger.error('Error creating rule:', error);
      await interaction.editReply({
        embeds: [AdminFeedback.error(
          'Rule Creation Failed',
          'Failed to create the rule. Please try again.',
          ['Check that all criteria are valid', 'Try again with different settings']
        )],
        components: []
      });
      return;
    }

    if (existingRules.length > 0) {
      // Check if there's already a verification message from our bot in this channel
      const hasExistingMessage = await this.messageSvc.findExistingVerificationMessage(channel);

      // Use existing verification message
      const embed = AdminFeedback.success(
        isDuplicateConfirmed ? 'Additional Rule Created' : 'Rule Added',
        `Rule ${newRule.id} for <#${channel.id}> and <@&${role.id}> ${hasExistingMessage ? 'has been added using existing verification message' : 'created'}.`
      );

      // Add detailed rule info fields
      const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields({
        rule_id: newRule.id,
        role_id: role.id,
        role_name: role.name,
        channel_name: channel.name,
        slug: slug,
        attribute_key: attributeKey,
        attribute_value: attributeValue,
        min_items: minItems
      });
      embed.addFields(ruleInfoFields);

      if (isDuplicateConfirmed) {
        embed.addFields({
          name: '⚠️ Note',
          value: 'This rule has the same criteria as an existing rule. Users meeting these criteria will receive multiple roles.',
          inline: false
        });
      }

      // Store confirmation data for Undo functionality
      const confirmationInfo = {
        ruleId: newRule.id,
        serverId: interaction.guild.id,
        channel,
        role,
        slug,
        attributeKey,
        attributeValue,
        minItems,
        wasNewlyCreated
      };
      this.ruleConfirmationHandler.storeConfirmationData(interaction.id, confirmationInfo);

      // Create Undo button
      const actionButtons = this.ruleConfirmationHandler.createConfirmationButtons(interaction.id);

      await interaction.editReply({ 
        embeds: [embed], 
        components: [actionButtons]
      });

      // Set up button interaction handler with timeout
      this.ruleConfirmationHandler.setupConfirmationButtonHandler(interaction);
    } else {
      // Create new verification message
      await this.createNewVerificationSetup(interaction, channel, role, slug, attributeKey, attributeValue, minItems, isDuplicateConfirmed, newRule, wasNewlyCreated);
    }
  }

  private async createNewVerificationSetup(
    interaction: ChatInputCommandInteraction,
    channel: TextChannel,
    role: Role,
    slug: string,
    attributeKey: string,
    attributeValue: string,
    minItems: number,
    isDuplicateConfirmed: boolean = false,
    newRule: any,
    wasNewlyCreated: boolean = false
  ): Promise<void> {
    try {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        await interaction.editReply({
          content: AdminFeedback.simple('Selected channel is not a text or announcement channel.', true),
          components: []
        });
        return;
      }
      
      // Check if there's already a verification message in this channel
      const hasExistingMessage = await this.messageSvc.findExistingVerificationMessage(channel);
      
      let messageCreated = false;
      if (!hasExistingMessage) {
        // Only create a new verification message if one doesn't exist
        await this.messageSvc.createVerificationMessage(channel as GuildTextBasedChannel);
        messageCreated = true;
      }
      
      // No need to track message_id in database anymore

      const embed = AdminFeedback.success(
        isDuplicateConfirmed ? 'Additional Rule Created' : 'Rule Added',
        `Rule ${newRule.id} for <#${channel.id}> and <@&${role.id}> ${messageCreated ? 'has been added with new verification message' : 'has been added using existing verification message'}.`
      );

      // Add detailed rule info fields
      const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields({
        rule_id: newRule.id,
        role_id: role.id,
        role_name: role.name,
        channel_name: channel.name,
        slug: slug,
        attribute_key: attributeKey,
        attribute_value: attributeValue,
        min_items: minItems
      });
      embed.addFields(ruleInfoFields);

      if (isDuplicateConfirmed) {
        embed.addFields({
          name: '⚠️ Note',
          value: 'This rule has the same criteria as an existing rule. Users meeting these criteria will receive multiple roles.',
          inline: false
        });
      }

      // Store confirmation data for Undo functionality
      const confirmationInfo = {
        ruleId: newRule.id,
        serverId: interaction.guild.id,
        channel,
        role,
        slug,
        attributeKey,
        attributeValue,
        minItems,
        wasNewlyCreated
      };
      this.ruleConfirmationHandler.storeConfirmationData(interaction.id, confirmationInfo);

      // Create Undo button
      const actionButtons = this.ruleConfirmationHandler.createConfirmationButtons(interaction.id);

      await interaction.editReply({ 
        embeds: [embed], 
        components: [actionButtons]
      });

      // Set up button interaction handler with timeout
      this.ruleConfirmationHandler.setupConfirmationButtonHandler(interaction);
    } catch (err) {
      Logger.error('Failed to send Verify Now message', err);
      await interaction.editReply({
        content: AdminFeedback.simple('Failed to send Verify Now message. Please check my permissions and try again.', true),
        components: []
      });
    }
  }

  async handleRemoveRule(interaction: ChatInputCommandInteraction): Promise<void> {
    // Delegate to the specialized handler
    return this.removeRuleHandler.handle(interaction);
  }

  async handleListRules(interaction: ChatInputCommandInteraction): Promise<void> {
    // Delegate to the specialized handler
    return this.listRulesHandler.handle(interaction);
  }

  async handleListRulesPagination(interaction: any): Promise<void> {
    // Delegate pagination button interactions to the specialized handler
    return this.listRulesHandler.handlePaginationButton(interaction);
  }

  async handleVerification(interaction: ChatInputCommandInteraction): Promise<void> {
    return this.verificationMessageHandler.handle(interaction);
  }

  /**
   * Validates basic input parameters for rule creation.
   * @returns Input parameters if valid, null if validation failed (error already sent to user)
   */
  private async validateInputParams(interaction: ChatInputCommandInteraction): Promise<{
    channel: TextChannel;
    roleName: string;
    slug: string;
    attributeKey: string;
    attributeValue: string;
    minItems: number;
  } | null> {
    const channel = interaction.options.getChannel('channel') as TextChannel;
    const roleName = interaction.options.getString('role');
    const slug = interaction.options.getString('slug') || 'ALL';
    const attributeKey = interaction.options.getString('attribute_key') || 'ALL';
    const attributeValue = interaction.options.getString('attribute_value') || 'ALL';
    const minItems = interaction.options.getInteger('min_items') || 1;

    if (!channel || !roleName) {
      await interaction.editReply({
        content: AdminFeedback.simple('Channel and role are required.', true)
      });
      return null;
    }

    return { channel, roleName, slug, attributeKey, attributeValue, minItems };
  }

  /**
   * Checks for duplicate rules and handles them appropriately
   * @returns true if no duplicates found, false if duplicate found (error already sent to user)
   */
  private async checkForDuplicateRules(
    interaction: ChatInputCommandInteraction,
    channel: TextChannel,
    role: Role,
    slug: string,
    attributeKey: string,
    attributeValue: string,
    minItems: number,
    wasNewlyCreated: boolean = false
  ): Promise<boolean> {
    // Check for exact duplicate rules first (same role + same criteria)
    const exactDuplicate = await this.dbSvc.checkForExactDuplicateRule(
      interaction.guild.id,
      channel.id,
      slug,
      attributeKey,
      attributeValue,
      minItems,
      role.id
    );

    if (exactDuplicate) {
      await interaction.editReply({
        embeds: [AdminFeedback.error(
          'Exact Duplicate Rule',
          'This exact rule already exists!',
          [
            'Use different criteria (collection, attribute, or min items)',
            'Remove the existing rule first with `/setup remove-rule`',
            'Check existing rules with `/setup list-rules`'
          ],
          [{
            name: 'Existing Rule',
            value: AdminFeedback.formatRule(exactDuplicate),
            inline: false
          }]
        )]
      });
      return false;
    }

    // Check for duplicate rules with different roles
    const existingRule = await this.dbSvc.checkForDuplicateRule(
      interaction.guild.id,
      channel.id,
      slug,
      attributeKey,
      attributeValue,
      minItems,
      role.id // Exclude the same role (not really duplicate if same role)
    );

    if (existingRule) {
      // Found a matching rule for a different role - warn the admin
      await this.showDuplicateRuleWarning(
        interaction,
        existingRule,
        {
          channel,
          role,
          slug,
          attributeKey,
          attributeValue,
          minItems,
          wasNewlyCreated
        }
      );
      return false;
    }

    // Check for duplicate roles (same role with different criteria)
    const existingRoleRule = await this.dbSvc.checkForDuplicateRule(
      interaction.guild.id,
      channel.id,
      slug,
      attributeKey,
      attributeValue,
      minItems
    );

    if (existingRoleRule) {
      // Found a rule for this role with different criteria - warn the admin
      await this.showDuplicateRoleWarning(
        interaction,
        existingRoleRule,
        {
          channel,
          role,
          slug,
          attributeKey,
          attributeValue,
          minItems
        }
      );
      return false;
    }

    return true; // No duplicates found
  }

  /**
   * Finds an existing role or creates a new one
   * @returns Role if successful, null if there was an error (error already sent to user)
   */
  private async findOrCreateRole(
    interaction: ChatInputCommandInteraction, 
    roleName: string
  ): Promise<{ role: Role; wasNewlyCreated: boolean } | null> {
    const cleanRoleName = normalizeRoleName(roleName);
    
    // Try to find existing role (including ones we can't manage)
    let role = interaction.guild.roles.cache.find(r => 
      r.name.toLowerCase() === cleanRoleName.toLowerCase()
    );

    // If role exists, check if we can manage it or provide appropriate error
    if (role) {
      if (!role.editable) {
        await interaction.editReply({
          embeds: [AdminFeedback.error(
            'Role Hierarchy Issue',
            `A role named "${cleanRoleName}" already exists but is positioned higher than the bot's role. The bot cannot manage this role.`,
            [
              'Use a different role name',
              'Move the bot\'s role higher in the server settings',
              `Ask an admin to move the "${cleanRoleName}" role below the bot's role`
            ]
          )]
        });
        return null;
      }
      // Role exists and is manageable - we'll use it
      return { role, wasNewlyCreated: false };
    }

    // If role doesn't exist, create it
    // Double-check that no role with this name exists anywhere in the server
    const existingRoleWithName = interaction.guild.roles.cache.find(r => 
      r.name.toLowerCase() === cleanRoleName.toLowerCase()
    );
    
    if (existingRoleWithName) {
      await interaction.editReply({
        embeds: [AdminFeedback.error(
          'Duplicate Role Name',
          `A role named "${cleanRoleName}" already exists in this server.`,
          ['Choose a different name for the new role']
        )]
      });
      return null;
    }

    try {
      // Get bot member to determine role position
      const botMember = interaction.guild.members.me;
      let position = undefined;
      
      if (botMember) {
        // Create role below bot's highest role
        const botHighestPosition = botMember.roles.highest.position;
        position = Math.max(1, botHighestPosition - 1);
      }

      role = await interaction.guild.roles.create({
        name: cleanRoleName,
        color: 'Blue', // Default color
        position: position,
        reason: `Auto-created for verification rule by ${interaction.user.tag}`
      });

      return { role, wasNewlyCreated: true };
    } catch (error) {
      await interaction.editReply({
        embeds: [AdminFeedback.error(
          'Role Creation Failed',
          `Failed to create role "${cleanRoleName}": ${error.message}`,
          ['Try again with a different role name']
        )]
      });
      return null;
    }
  }

  /**
   * Universal method to send "Rule Removed" message with Undo button
   * This ensures all rule removal scenarios have consistent Undo functionality
   */
  private async sendRuleRemovedMessage(
    interaction: any,
    ruleId: number,
    removedRuleData: any,
    options: {
      ephemeral?: boolean;
      isReply?: boolean;
    } = {}
  ): Promise<void> {
    const { ephemeral = true, isReply = true } = options;
    
    // Store the removed rule data for undo functionality
    this.removedRules.set(interaction.id, removedRuleData);

    // Create Undo button
    const undoButton = this.duplicateRuleConfirmationHandler.createUndoRemovalButton(interaction.id, 'removal');
    
    // Create detailed rule info fields
    const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields(removedRuleData);
    const embed = AdminFeedback.destructive('Rule Removed', `Rule ${ruleId} for ${removedRuleData.channel_name} and @${removedRuleData.role_name} has been removed.`);
    embed.addFields(ruleInfoFields);

    const messageContent = {
      embeds: [embed],
      components: [undoButton],
      ...(ephemeral && { flags: MessageFlags.Ephemeral })
    };

    if (isReply) {
      await interaction.reply(messageContent);
    } else {
      await interaction.editReply(messageContent);
    }

    // Set up button interaction handler for undo removal
    this.removalUndoHandler.setupRemovalButtonHandler(interaction, this.removedRules);
  }

  /**
   * Sends "Multiple Rules Removed" message with Undo button for bulk operations
   * This ensures bulk rule removal scenarios have consistent Undo functionality
   */
  private async sendBulkRuleRemovedMessage(
    interaction: any,
    successful: Array<{ id: number; data: any; success: true }>,
    failed: Array<{ id: number; data: any; success: false; error: string }>,
    options: {
      ephemeral?: boolean;
      isReply?: boolean;
    } = {}
  ): Promise<void> {
    const { ephemeral = true, isReply = true } = options;
    
    // Store the removed rules data for undo functionality (only successful ones)
    if (successful.length > 0) {
      const bulkRemovedData = {
        rules: successful.map(s => s.data),
        isBulk: true
      };
      this.removedRules.set(interaction.id, bulkRemovedData);
    }

    // Create success message
    let description = '';
    if (successful.length > 0) {
      const ruleList = successful.map(s => `Rule ${s.id}`).join(', ');
      description += `✅ **Successfully removed:** ${ruleList}\n\n`;
      
      // Add clean rule info for each removed rule using list format
      successful.forEach(s => {
        const attribute = this.formatAttribute(s.data.attribute_key, s.data.attribute_value);
        const slug = s.data.slug || 'ALL';
        const minItems = s.data.min_items || 1;
        
        const ruleInfo = `ID: ${s.id} | Channel: <#${s.data.channel_id}> | Role: <@&${s.data.role_id}> | Slug: ${slug} | Attr: ${attribute} | Min: ${minItems}`;
        description += ruleInfo + '\n\n';
      });
    }

    if (failed.length > 0) {
      description += '\n❌ **Failed to remove:**\n';
      failed.forEach(f => {
        description += `Rule ${f.id}: ${f.error}\n`;
      });
    }

    const embed = AdminFeedback.destructive(
      successful.length === 1 ? 'Rule Removed' : `${successful.length} Rules Removed`, 
      description.trim()
    );

    const components = [];
    if (successful.length > 0) {
      // Create Undo button for successful removals
      const undoButton = this.duplicateRuleConfirmationHandler.createUndoRemovalButton(interaction.id, 'removal');
      components.push(undoButton);
    }

    const messageContent = {
      embeds: [embed],
      components,
      ...(ephemeral && { flags: MessageFlags.Ephemeral })
    };

    if (isReply) {
      await interaction.reply(messageContent);
    } else {
      await interaction.editReply(messageContent);
    }

    // Set up button interaction handler for undo removal (only if there are successful removals)
    if (successful.length > 0) {
      this.removalUndoHandler.setupRemovalButtonHandler(interaction, this.removedRules);
    }
  }

  /**
   * Sends feedback message for bulk rule restoration (undo removal)
   */
  private async sendBulkRuleRestoredMessage(
    interaction: any,
    restorationResults: Array<{
      success: boolean;
      rule?: any;
      ruleId?: number;
      error?: string;
      originalData?: any;
    }>
  ): Promise<void> {
    const successful = restorationResults.filter(r => r.success);
    const failed = restorationResults.filter(r => !r.success);
    
    // Store the restored rules data for potential undo functionality
    if (successful.length > 0) {
      const bulkRestoredData = {
        rules: successful.map(s => s.rule || s.originalData),
        isBulk: true
      };
      // Store in restoredRules for undo consistency, not confirmationData
      this.restoredRules.set(interaction.id, bulkRestoredData);
    }

    // Create success message
    let description = '';
    if (successful.length > 0) {
      const ruleList = successful.map(s => `Rule ${s.rule?.id || s.ruleId}`).join(', ');
      description += `✅ **Successfully restored:** ${ruleList}\n\n`;
      
      // Add clean rule info for each restored rule using list format
      successful.forEach(s => {
        const rule = s.rule || s.originalData;
        const attribute = this.formatAttribute(rule.attribute_key, rule.attribute_value);
        const slug = rule.slug || 'ALL';
        const minItems = rule.min_items || 1;
        
        const ruleInfo = `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | Slug: ${slug} | Attr: ${attribute} | Min: ${minItems}`;
        description += ruleInfo + '\n\n';
      });
    }

    if (failed.length > 0) {
      description += '\n❌ **Failed to restore:**\n';
      failed.forEach(f => {
        description += `Rule ${f.ruleId}: ${f.error}\n`;
      });
    }

    const embed = AdminFeedback.success(
      successful.length === 1 ? 'Rule Restored' : `${successful.length} Rules Restored`, 
      description.trim()
    );

    const components = [];
    if (successful.length > 0) {
      // Create Undo button for successful restorations (to remove them again)
      const undoButton = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`undo_restore_${interaction.id}`)
            .setLabel('Undo')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️')
        );
      components.push(undoButton);
    }

    const messageContent = {
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral
    };

    await interaction.reply(messageContent);

    // Set up button interaction handler for undo (only if there are successful restorations)
    if (successful.length > 0) {
      this.restoreUndoHandler.setupRestoreButtonHandler(interaction, this.restoredRules);
    }
  }

  /**
   * Creates Undo action button for rule removal/cancellation messages
   */
  private createUndoRemovalButton(interactionId: string, type: 'removal' | 'cancellation') {
    return this.duplicateRuleConfirmationHandler.createUndoRemovalButton(interactionId, type);
  }























  /**
   * Handles Undo button interaction for rule cancellation - creates the cancelled rule
   */
  private async handleUndoCancellation(interaction: any): Promise<void> {
    const interactionId = interaction.customId.replace('undo_cancellation_', '');
    const cancelledRule = this.duplicateRuleConfirmationHandler.getCancelledRule(interactionId);
    
    if (!cancelledRule) {
      await interaction.reply({
        content: AdminFeedback.simple('Undo session expired. Rule cancellation cannot be undone.', true),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      // Create the rule in the database
      const createdRule = await this.dbSvc.addRoleMapping(
        interaction.guild.id,
        interaction.guild.name,
        cancelledRule.channel.id,
        cancelledRule.channel.name,
        cancelledRule.slug,
        cancelledRule.role.id,
        cancelledRule.role.name,
        cancelledRule.attributeKey,
        cancelledRule.attributeValue,
        cancelledRule.minItems
      );
      
      // Store the created rule for potential undo
      this.ruleConfirmationHandler.storeConfirmationData(interaction.id, {
        ruleId: createdRule.id,
        serverId: interaction.guild.id
      });
      
      // Create detailed rule info fields for the created rule
      const createdRuleFormatted = {
        rule_id: createdRule.id,
        role_id: cancelledRule.role.id,
        role_name: cancelledRule.role.name,
        channel_name: cancelledRule.channel.name,
        slug: cancelledRule.slug,
        attribute_key: cancelledRule.attributeKey,
        attribute_value: cancelledRule.attributeValue,
        min_items: cancelledRule.minItems
      };
      const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields(createdRuleFormatted);
      const embed = AdminFeedback.success('Rule Added', `Rule ${createdRule.id} for ${cancelledRule.channel.name} and @${cancelledRule.role.name} has been added using existing verification message.`);
      embed.addFields(ruleInfoFields);
      
      // Create Undo button
      const undoButton = this.ruleConfirmationHandler.createConfirmationButtons(interaction.id);
      
      await interaction.reply({
        embeds: [embed],
        components: [undoButton],
        flags: MessageFlags.Ephemeral
      });
      
      // Set up button interaction handler for potential undo of this creation
      this.ruleConfirmationHandler.setupConfirmationButtonHandler(interaction);

      // Clean up the cancellation data
      this.duplicateRuleConfirmationHandler.deleteCancelledRule(interactionId);
    } catch (error) {
      Logger.error('Error undoing rule cancellation:', error);
      await interaction.reply({
        content: AdminFeedback.simple(`Error creating rule: ${error.message}`, true),
        flags: MessageFlags.Ephemeral
      });
    }
  }

  private async showDuplicateRoleWarning(
    interaction: ChatInputCommandInteraction,
    existingRule: any,
    newRuleData: {
      channel: TextChannel;
      role: Role;
      slug: string;
      attributeKey: string;
      attributeValue: string;
      minItems: number;
    }
  ): Promise<void> {
    // Create rule objects for consistent formatting
    const existingRuleFormatted = {
      role_id: existingRule.role_id,
      slug: existingRule.slug,
      attribute_key: existingRule.attribute_key,
      attribute_value: existingRule.attribute_value,
      min_items: existingRule.min_items
    };

    const newRuleFormatted = {
      role_id: newRuleData.role.id,
      slug: newRuleData.slug,
      attribute_key: newRuleData.attributeKey,
      attribute_value: newRuleData.attributeValue,
      min_items: newRuleData.minItems
    };

    const embed = AdminFeedback.warning(
      'Duplicate Role Assignment',
      'This role already has a verification rule with different criteria. Users meeting the new criteria will also receive this role. This might be intentional (multiple ways to earn same role) or an error.',
      [
        'Click "Create Anyway" to add another way to earn this role',
        'Click "Cancel" to modify your role or criteria'
      ],
      [
        {
          name: 'Existing Rule',
          value: AdminFeedback.formatRule(existingRuleFormatted, newRuleData.role.name),
          inline: true
        },
        {
          name: 'New Rule (Proposed)',
          value: AdminFeedback.formatRule(newRuleFormatted, newRuleData.role.name),
          inline: true
        }
      ]
    );

    // Generate chain ID first, then use it consistently
    const chainId = `${interaction.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_duplicate_role_${chainId}`)
          .setLabel('Create Anyway')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`cancel_duplicate_role_${chainId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('❌')
      );

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    // Store pending rule for confirmation using chainId
    this.duplicateRuleConfirmationHandler.storeRuleData(chainId, newRuleData);

    // Set up button handler with chainId
    this.setupDuplicateRoleButtonHandler(interaction, chainId);
  }

  private setupDuplicateRoleButtonHandler(interaction: ChatInputCommandInteraction, chainId: string): void {
    const filter = (i: any) => 
      (i.customId === `confirm_duplicate_role_${chainId}` || i.customId === `cancel_duplicate_role_${chainId}`) && 
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel?.createMessageComponentCollector({ 
      filter, 
      time: 60000 // 1 minute
    });

    collector?.on('collect', async (i) => {
      if (i.customId === `confirm_duplicate_role_${chainId}`) {
        await i.deferUpdate();
        const ruleData = this.duplicateRuleConfirmationHandler.getPendingRule(chainId);
        await this.createRuleDirectly(interaction, ruleData, true);
        this.duplicateRuleConfirmationHandler.deletePendingRule(chainId);
      } else if (i.customId === `cancel_duplicate_role_${chainId}`) {
        await i.deferUpdate();
        const ruleData = this.duplicateRuleConfirmationHandler.getPendingRule(chainId);
        
        // Create detailed rule info fields for the cancelled rule
        const cancelledRuleFormatted = {
          role_id: ruleData.role.id,
          role_name: ruleData.role.name,
          channel_name: ruleData.channel.name,
          slug: ruleData.slug,
          attribute_key: ruleData.attributeKey,
          attribute_value: ruleData.attributeValue,
          min_items: ruleData.minItems
        };
        const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields(cancelledRuleFormatted);
        const embed = AdminFeedback.destructive('Rule Creation Cancelled', `Proposed rule for ${ruleData.channel.name} and @${ruleData.role.name} was not created.`);
        embed.addFields(ruleInfoFields);
        
        // Create Undo button using the same chain ID
        const undoButton = this.duplicateRuleConfirmationHandler.createUndoRemovalButton(chainId, 'cancellation');
        
        // Store the cancelled rule for undo functionality
        this.duplicateRuleConfirmationHandler.storeCancelledRule(chainId, ruleData);
        
        await interaction.editReply({
          embeds: [embed],
          components: [undoButton]
        });
        
        // Set up button interaction handler for undo cancellation
        this.duplicateRuleConfirmationHandler.setupCancellationButtonHandler(
          interaction,
          chainId,
          async (ruleData) => {
            // Create a mock button interaction for the undo cancellation
            const mockButtonInteraction = {
              customId: `undo_cancellation_${chainId}`,
              guild: interaction.guild,
              id: interaction.id,
              reply: interaction.editReply.bind(interaction)
            };
            await this.handleUndoCancellation(mockButtonInteraction);
          }
        );
        
        this.duplicateRuleConfirmationHandler.deletePendingRule(chainId);
      }
      collector.stop();
    });

    collector?.on('end', (collected) => {
      if (collected.size === 0) {
        // Timeout - clean up
        this.duplicateRuleConfirmationHandler.deletePendingRule(chainId);
        interaction.editReply({
          embeds: [AdminFeedback.warning('Request Timed Out', 'Rule creation was cancelled due to timeout.')],
          components: []
        }).catch(() => {}); // Ignore errors if interaction is no longer valid
      }
    });
  }

  /**
   * Attempts to clean up a newly created role if it's no longer being used
   * Only deletes the role if no other rules are using it
   */
  private async cleanupNewlyCreatedRole(interaction: any, roleId: string, serverId: string): Promise<void> {
    try {
      // Check if any other rules are using this role
      const allRules = await this.dbSvc.getRoleMappings(serverId);
      const rulesUsingRole = allRules?.filter(rule => rule.role_id === roleId) || [];
      
      // If no other rules use this role, delete it
      if (rulesUsingRole.length === 0) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (role && role.editable) {
          await role.delete('Cleaning up unused role after rule undo');
          Logger.log(`Cleaned up newly created role: ${role.name} (${roleId})`);
        }
      }
    } catch (error) {
      // Don't fail the undo operation if role cleanup fails
      Logger.warn(`Failed to cleanup role ${roleId}:`, error);
    }
  }

  /**
   * Formats attribute key/value pairs for display
   */
  private formatAttribute(key: string, value: string): string {
    if (key && key !== 'ALL' && value && value !== 'ALL') {
      return `${key}=${value}`;
    }
    if (key && key !== 'ALL' && (!value || value === 'ALL')) {
      return `${key} (any value)`;
    }
    if ((!key || key === 'ALL') && value && value !== 'ALL') {
      return `ALL=${value}`;
    }
    return 'ALL';
  }
}
