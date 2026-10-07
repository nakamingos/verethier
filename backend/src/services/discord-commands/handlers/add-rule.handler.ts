import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { 
  ChatInputCommandInteraction, 
  TextChannel, 
  Role, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ComponentType,
  ButtonInteraction,
  ChannelType,
  GuildTextBasedChannel,
  MessageFlags
} from 'discord.js';
import { DbService } from '../../db.service';
import { DiscordMessageService } from '../../discord-message.service';
import { DiscordService } from '../../discord.service';
import { DataService } from '../../data.service';
import { NftOwnershipService } from '../../nft-ownership.service';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { getNftNetworkId } from '@/utils/nft-network.util';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { RuleConfirmationInteractionHandler } from '../interactions/rule-confirmation.interaction';
import { validateRuleInputParams, formatAttribute } from '../utils/rule-validation.util';
import { findOrCreateRole } from '../utils/role-management.util';
import { DuplicateRuleConfirmationInteractionHandler } from '../interactions/duplicate-rule-confirmation.interaction';

/**
 * Add Rule Command Handler
 * 
 * Handles the complete flow for adding verification rules:
 * - Input validation
 * - Role creation/finding
 * - Duplicate detection and warnings
 * - Rule creation with confirmation
 * - Integration with verification messages
 */
@Injectable()
export class AddRuleHandler {
  private readonly logger = new Logger(AddRuleHandler.name);
  
  // Store pending rules for confirmation flow
  private pendingRules: Map<string, any> = new Map();

  constructor(
    private readonly dbSvc: DbService,
    private readonly messageSvc: DiscordMessageService,
    @Inject(forwardRef(() => DiscordService))
    private readonly discordSvc: DiscordService,
    private readonly dataSvc: DataService,
    private readonly nftSvc: NftOwnershipService,
    private readonly ruleConfirmationHandler: RuleConfirmationInteractionHandler,
    private readonly duplicateRuleConfirmationHandler: DuplicateRuleConfirmationInteractionHandler
  ) {}

  /**
   * Main entry point for add rule command
   */
  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Validate input parameters
      const params = await this.validateInputParams(interaction);
      if (!params) {
        return; // Error already handled
      }

      const { channel, roleName, slug, attributeKey, attributeValue, minItems, assetFields } = params;

      // Find or create the role
      const roleResult = await findOrCreateRole(interaction, roleName);
      if (!roleResult) {
        return; // Error already handled in findOrCreateRole
      }
      
      const { role, wasNewlyCreated } = roleResult;

      // Check for duplicate rules
      if (!(await this.checkForDuplicateRules(interaction, channel, role, slug, attributeKey, attributeValue, minItems, wasNewlyCreated, assetFields))) {
        return; // Duplicate found and handled
      }

      // No duplicate found, proceed with normal rule creation
      await this.createRuleDirectly(interaction, {
        channel,
        role,
        slug,
        attributeKey,
        attributeValue,
        minItems,
        assetFields,
        wasNewlyCreated
      });

    } catch (error) {
      this.logger.error('Error in handleAddRule:', error);
      if (interaction.deferred) {
        await interaction.editReply('An error occurred while adding the rule.');
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ 
          content: AdminFeedback.simple('An error occurred while adding the rule.', true)
        });
      }
    }
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
    assetFields?: NftRuleFields;
  } | null> {
    const channel = interaction.options.getChannel('channel') as TextChannel;
    const roleName = interaction.options.getString('role');
    let slug = interaction.options.getString('slug') || 'ALL';
    const attributeKey = interaction.options.getString('attribute_key') || 'ALL';
    const attributeValue = interaction.options.getString('attribute_value') || 'ALL';
    const minItems = interaction.options.getInteger('min_items') ?? 1;

    if (!channel || !roleName) {
      await interaction.editReply({
        content: AdminFeedback.simple('Channel and role are required.', true)
      });
      return null;
    }

    if (!Number.isSafeInteger(minItems) || minItems < 1) {
      await interaction.editReply({ content: AdminFeedback.simple('Minimum items must be a positive whole number.', true) });
      return null;
    }
    const assetType = interaction.options.getString('asset_type') || 'ethscription';
    const contract = interaction.options.getString('contract_address');
    const tokenIds = interaction.options.getString('token_ids');
    const name = interaction.options.getString('collection_name');
    const network = interaction.options.getString('network');
    if (assetType === 'nft') {
      if (!contract || slug !== 'ALL' || attributeKey !== 'ALL' || attributeValue !== 'ALL') {
        await interaction.editReply({ content: AdminFeedback.simple('NFT rules require contract_address. Leave slug and attribute options empty.', true) });
        return null;
      }
      try {
        const assetFields = await this.nftSvc.prepareRule(contract, tokenIds, name, getNftNetworkId(network || 'ethereum'));
        if (assetFields.token_standard === 'erc721' && assetFields.token_ids && minItems !== 1) {
          throw new Error('A specific ERC-721 token rule requires min_items:1.');
        }
        return { channel, roleName, slug, attributeKey, attributeValue, minItems, assetFields };
      } catch (error) {
        await interaction.editReply({ content: AdminFeedback.simple(error.message || 'Could not check the NFT contract. Please try again.', true) });
        return null;
      }
    }
    if (assetType !== 'ethscription' || contract || tokenIds != null || name != null || network != null) {
      await interaction.editReply({ content: AdminFeedback.simple('Select asset_type:NFT to use network, contract_address, token_ids, or collection_name.', true) });
      return null;
    }

    // Normalize multi-slug input: parse, trim, sort alphabetically, rejoin
    // This prevents duplicate rules like "collection-a,collection-b" vs "collection-b,collection-a"
    if (slug !== 'ALL' && slug.includes(',')) {
      const slugs = slug.split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .sort(); // Alphabetical sorting ensures consistent ordering
      
      if (slugs.length === 0) {
        slug = 'ALL';
      } else {
        slug = slugs.join(',');
      }
    }

    // Validate input combinations against database
    try {
      const validationResult = await this.validateInputCombinations(slug, attributeKey, attributeValue);
      if (!validationResult.isValid) {
        await interaction.editReply({
          embeds: [AdminFeedback.error(
            '⚠️ Invalid Option Combination',
            validationResult.message,
            [
              '**Discord Autocomplete Limitation**: Options may appear available even when they don\'t match',
              '**Solution**: Select options in order (Collection → Attribute Key → Attribute Value)',
              '**Tip**: Leave fields empty to allow ALL values for that criteria'
            ]
          )]
        });
        return null;
      }
    } catch (error) {
      this.logger.error('Error validating input combinations:', error);
      await interaction.editReply({
        content: AdminFeedback.simple('Error validating options. Please try again.', true)
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
    wasNewlyCreated: boolean = false,
    assetFields?: NftRuleFields
  ): Promise<boolean> {
    // Check for exact duplicate rules first (same role + same criteria)
    const exactDuplicate = await this.dbSvc.checkForExactDuplicateRule(
      interaction.guild.id,
      channel.id,
      slug,
      attributeKey,
      attributeValue,
      minItems,
      role.id,
      assetFields
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
      role.id, // Exclude the same role
      assetFields
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
          assetFields,
          wasNewlyCreated
        }
      );
      return false;
    }

    // Check for duplicate roles (same role with different criteria)
    const allChannelRules = await this.dbSvc.getRulesByChannel(
      interaction.guild.id,
      channel.id
    );
    
    const existingRoleRules = allChannelRules.filter(rule => rule.role_id === role.id);

    if (existingRoleRules && existingRoleRules.length > 0) {
      // Found existing rule(s) for this role - warn the admin
      await this.showDuplicateRoleWarning(
        interaction,
        existingRoleRules[0], // Show the first existing rule for this role
        {
          channel,
          role,
          slug,
          attributeKey,
          attributeValue,
          minItems,
          assetFields,
          wasNewlyCreated
        }
      );
      return false;
    }

    return true; // No duplicates found
  }

  /**
   * Shows duplicate rule warning and handles user confirmation
   */
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
      assetFields?: NftRuleFields;
      wasNewlyCreated?: boolean;
    }
  ): Promise<void> {
    // Get the existing role name for display
    const existingRole = await this.discordSvc.getRole(interaction.guild.id, existingRule.role_id);
    
    // Create rule objects for consistent formatting
    const existingRuleFormatted = {
      ...existingRule,
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
      min_items: newRuleData.minItems,
      ...newRuleData.assetFields
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

    // Generate a chain ID for this undo/redo chain
    const chainId = this.generateChainId(interaction);

    // Use the interaction handler for button management
    const buttonRow = this.duplicateRuleConfirmationHandler.createDuplicateRuleButtons(chainId);

    await interaction.editReply({
      embeds: [embed],
      components: [buttonRow]
    });

    // Store the new rule data for later use if confirmed
    this.duplicateRuleConfirmationHandler.storeRuleData(chainId, {
      ...newRuleData,
      serverId: interaction.guild.id,
      duplicateType: 'criteria', // Same criteria, different role
      isDuplicateRule: true
    });

    // Set up button interaction handler with proper undo chain integration
    this.duplicateRuleConfirmationHandler.setupDuplicateRuleButtonHandler(
      interaction,
      chainId,
      async (ruleData: any) => {
        // Create Anyway - proceed with rule creation and set up undo chain
        await this.createRuleDirectly(interaction, ruleData, true, chainId);
      },
      async (ruleData: any) => {
        // Cancel - show cancellation message with undo button
        await this.showRuleCancellationMessage(interaction, ruleData, chainId);
      }
    );
  }

  /**
   * Shows duplicate role warning (same role, different criteria)
   */
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
      assetFields?: NftRuleFields;
      wasNewlyCreated?: boolean;
    }
  ): Promise<void> {
    const newRuleFormatted = {
      role_id: newRuleData.role.id,
      slug: newRuleData.slug,
      attribute_key: newRuleData.attributeKey,
      attribute_value: newRuleData.attributeValue,
      min_items: newRuleData.minItems,
      ...newRuleData.assetFields
    };

    const embed = AdminFeedback.warning(
      'Role Already Has Rules',
      `The role <@&${newRuleData.role.id}> already has verification rules in this channel. Adding another rule will create multiple ways to earn the same role.`,
      [
        'Click "Create Anyway" to add another way to earn this role',
        'Click "Cancel" to modify your criteria'
      ],
      [
        {
          name: 'Existing Rule',
          value: AdminFeedback.formatRule(existingRule),
          inline: true
        },
        {
          name: 'New Rule (Proposed)',
          value: AdminFeedback.formatRule(newRuleFormatted, newRuleData.role.name),
          inline: true
        }
      ]
    );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_duplicate_role_${interaction.id}`)
          .setLabel('Create Anyway')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`cancel_duplicate_role_${interaction.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('❌')
      );

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    // Store the new rule data for later use if confirmed
    this.pendingRules.set(`confirm_duplicate_role_${interaction.id}`, {
      interaction,
      newRuleData: {
        ...newRuleData,
        isDuplicateRule: true,
        duplicateType: 'role' // Same role, different criteria
      },
      isDuplicateRole: true
    });

    // Set up button collector to handle Create Anyway/Cancel buttons
    this.setupDuplicateRoleButtonHandler(interaction, newRuleData);
  }

  /**
   * Sets up button collector for duplicate role confirmation
   */
  private setupDuplicateRoleButtonHandler(
    interaction: ChatInputCommandInteraction,
    newRuleData: {
      channel: TextChannel;
      role: Role;
      slug: string;
      attributeKey: string;
      attributeValue: string;
      minItems: number;
      assetFields?: NftRuleFields;
      wasNewlyCreated?: boolean;
    }
  ): void {
    const filter = (i: any) => 
      (i.customId.startsWith('confirm_duplicate_role_') || i.customId.startsWith('cancel_duplicate_role_')) && 
      i.customId.endsWith(`_${interaction.id}`) && 
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel?.createMessageComponentCollector({ 
      filter, 
      time: 60000 // 1 minute
    });

    collector?.on('collect', async (i) => {
      try {
        if (i.customId.startsWith('confirm_duplicate_role_')) {
          await i.deferUpdate();
          // Create the rule anyway
          await this.createRuleDirectly(interaction, newRuleData, true);
          this.pendingRules.delete(`confirm_duplicate_role_${interaction.id}`);
        } else if (i.customId.startsWith('cancel_duplicate_role_')) {
          await i.deferUpdate();
          
          // If a new role was created, delete it since the rule creation was cancelled
          if (newRuleData.wasNewlyCreated && newRuleData.role) {
            try {
              await newRuleData.role.delete('Rule creation was cancelled');
              this.logger.log(`Deleted newly created role ${newRuleData.role.name} due to rule cancellation`);
            } catch (error) {
              this.logger.error(`Failed to delete newly created role ${newRuleData.role.name}:`, error);
            }
          }

          // Create rule info fields for display
          const cancelledRuleFormatted = {
            role_id: newRuleData.role.id,
            role_name: newRuleData.role.name,
            channel_name: newRuleData.channel.name,
            slug: newRuleData.slug,
            attribute_key: newRuleData.attributeKey,
            attribute_value: newRuleData.attributeValue,
            min_items: newRuleData.minItems,
            ...newRuleData.assetFields
          };
          const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields(cancelledRuleFormatted);

          const embed = AdminFeedback.destructive(
            'Rule Creation Cancelled', 
            `Rule creation for ${newRuleData.channel.name} and @${newRuleData.role.name} has been cancelled.${newRuleData.wasNewlyCreated ? ' The newly created role has been removed.' : ''}`
          );
          embed.addFields(ruleInfoFields);
          embed.addFields({
            name: '⚠️ Note',
            value: 'This role already has verification rules in this channel. Users would have had multiple ways to earn the same role.',
            inline: false
          });

          await interaction.editReply({
            embeds: [embed],
            components: []
          });
          this.pendingRules.delete(`confirm_duplicate_role_${interaction.id}`);
        }
      } catch (error) {
        this.logger.error('Error handling duplicate role button interaction:', error);
        await interaction.editReply({
          embeds: [AdminFeedback.error('Error', 'An error occurred while processing your request.')],
          components: []
        });
      } finally {
        collector.stop();
      }
    });

    collector?.on('end', async (collected) => {
      if (collected.size === 0) {
        // Timeout - clean up
        this.pendingRules.delete(`confirm_duplicate_role_${interaction.id}`);
        
        // If a new role was created, delete it since the rule creation timed out
        if (newRuleData.wasNewlyCreated && newRuleData.role) {
          try {
            await newRuleData.role.delete('Rule creation timed out');
            this.logger.log(`Deleted newly created role ${newRuleData.role.name} due to timeout`);
          } catch (error) {
            this.logger.error(`Failed to delete newly created role ${newRuleData.role.name}:`, error);
          }
        }

        interaction.editReply({
          embeds: [AdminFeedback.warning('Timeout', `No response received. Rule creation cancelled.${newRuleData.wasNewlyCreated ? ' The newly created role has been removed.' : ''}`)],
          components: []
        }).catch(error => {
          this.logger.error('Error updating interaction after timeout:', error);
        });
      }
    });
  }

  /**
   * Creates the rule directly without further confirmation
   */
  private async createRuleDirectly(
    interaction: ChatInputCommandInteraction,
    ruleData: {
      channel: TextChannel;
      role: Role;
      slug: string;
      attributeKey: string;
      attributeValue: string;
      minItems: number;
      assetFields?: NftRuleFields;
      wasNewlyCreated?: boolean;
    },
    isDuplicateConfirmed: boolean = false,
    chainId?: string
  ): Promise<void> {
    const { channel, role, slug, attributeKey, attributeValue, minItems, wasNewlyCreated = false } = ruleData;

    // Declare duplicate type at function level to avoid redeclaration
    let duplicateType: 'criteria' | 'role' | undefined = undefined;

    // Check for existing verification setup
    const existingRules = await this.dbSvc.getRulesByChannel(interaction.guild.id, channel.id) || [];
    
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
        minItems,
        ruleData.assetFields
      );
    } catch (error) {
      this.logger.error('Error creating rule:', error);
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
      let headerTitle = 'Rule Added';
      let existingRoleRules: any[] = [];
      
      if (isDuplicateConfirmed) {
        // Determine duplicate type to use correct terminology
        const allChannelRules = await this.dbSvc.getRulesByChannel(interaction.guild.id, channel.id);
        existingRoleRules = allChannelRules.filter(rule => rule.role_id === role.id && rule.id !== newRule.id);
        
        if (existingRoleRules.length > 0) {
          // This is a duplicate role (same role, different criteria)
          duplicateType = 'role';
          headerTitle = 'Rule Created for Existing Role';
        } else {
          // This is duplicate criteria (same criteria, different role)
          duplicateType = 'criteria';
          headerTitle = 'Additional Rule Created';
        }
      }
      
      const embed = AdminFeedback.success(
        headerTitle,
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
        min_items: minItems,
        ...ruleData.assetFields
      });
      embed.addFields(ruleInfoFields);

      if (isDuplicateConfirmed) {
        if (existingRoleRules.length > 0) {
          // This is a duplicate role (same role, different criteria)
          embed.addFields({
            name: '⚠️ Note',
            value: 'This role already has verification rules in this channel. Users now have multiple ways to earn the same role.',
            inline: false
          });
        } else {
          // This is duplicate criteria (same criteria, different role)  
          embed.addFields({
            name: '⚠️ Note',
            value: 'This rule has the same criteria as an existing rule. Users meeting these criteria will receive multiple roles.',
            inline: false
          });
        }
      }

      if (wasNewlyCreated) {
        embed.addFields({
          name: '🆕 New Role Created',
          value: `The role <@&${role.id}> was created for this verification rule.`,
          inline: false
        });
      }

      // Store confirmation data for Undo functionality
      const confirmationId = chainId || interaction.id;
      
      const confirmationInfo = {
        ruleId: newRule.id,
        serverId: interaction.guild.id,
        channel,
        role,
        slug,
        attributeKey,
        attributeValue,
        minItems,
        wasNewlyCreated,
        isDuplicateRule: isDuplicateConfirmed,
        duplicateType
      };
      this.ruleConfirmationHandler.storeConfirmationData(confirmationId, confirmationInfo);

      // Create Undo button
      const actionButtons = this.ruleConfirmationHandler.createConfirmationButtons(confirmationId);

      await interaction.editReply({ 
        embeds: [embed], 
        components: [actionButtons]
      });

      // Set up button interaction handler with timeout
      this.ruleConfirmationHandler.setupConfirmationButtonHandler(interaction);
    } else {
      // Create new verification message
      await this.createNewVerificationSetup(interaction, channel, role, slug, attributeKey, attributeValue, minItems, isDuplicateConfirmed, newRule, wasNewlyCreated, chainId);
    }
  }

  /**
   * Creates new verification setup for the first rule in a channel
   */
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
    wasNewlyCreated: boolean = false,
    chainId?: string
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

      const formatAttribute = (key: string, value: string) => {
        if (key !== 'ALL' && value !== 'ALL') return `${key}=${value}`;
        if (key !== 'ALL' && value === 'ALL') return `${key} (any value)`;
        if (key === 'ALL' && value !== 'ALL') return `ALL=${value}`;
        return 'ALL';
      };

      // Create success embed
      let headerTitle = isDuplicateConfirmed ? 'Additional Rule Created' : 'Verification Rule Added';
      
      // For new verification setups, duplicates are always criteria-based (different roles)
      // since we wouldn't reach this method if there were existing rules in the channel
      const embed = AdminFeedback.success(
        headerTitle,
        `Rule ${newRule.id} for <#${channel.id}> and <@&${role.id}> has been ${messageCreated ? 'created with a new verification message' : 'added to existing verification message'}.`
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
        min_items: minItems,
        ...newRule
      });
      embed.addFields(ruleInfoFields);

      if (isDuplicateConfirmed) {
        embed.addFields({
          name: '⚠️ Note',
          value: 'This rule has the same criteria as an existing rule. Users meeting these criteria will receive multiple roles.',
          inline: false
        });
      }

      if (wasNewlyCreated) {
        embed.addFields({
          name: '🆕 New Role Created',
          value: `The role <@&${role.id}> was created for this verification rule.`,
          inline: false
        });
      }

      // Store confirmation data for Undo functionality
      const confirmationId = chainId || interaction.id;
      
      // For new verification setups, duplicates are always criteria-based (different roles)
      // since we wouldn't reach this method if there were existing rules in the channel
      const duplicateType = isDuplicateConfirmed ? 'criteria' : undefined;
      
      const confirmationInfo = {
        ruleId: newRule.id,
        serverId: interaction.guild.id,
        channel,
        role,
        slug,
        attributeKey,
        attributeValue,
        minItems,
        wasNewlyCreated,
        isDuplicateRule: isDuplicateConfirmed,
        duplicateType
      };
      this.ruleConfirmationHandler.storeConfirmationData(confirmationId, confirmationInfo);

      // Create Undo button
      const actionButtons = this.ruleConfirmationHandler.createConfirmationButtons(confirmationId);

      await interaction.editReply({ 
        embeds: [embed], 
        components: [actionButtons]
      });

      // Set up button interaction handler with timeout
      this.ruleConfirmationHandler.setupConfirmationButtonHandler(interaction);

    } catch (error) {
      this.logger.error('Error creating new verification setup:', error);
      await interaction.editReply({
        embeds: [AdminFeedback.error(
          'Setup Failed', 
          'Failed to set up verification. The rule was created but verification message setup failed.',
          ['The rule exists in the database', 'Try running the recover-verification command']
        )],
        components: []
      });
    }
  }

  /**
   * Shows rule cancellation message with undo functionality
   */
  private async showRuleCancellationMessage(
    interaction: ChatInputCommandInteraction,
    ruleData: any,
    chainId: string
  ): Promise<void> {
    // If a new role was created, delete it since the rule creation was cancelled
    if (ruleData.wasNewlyCreated && ruleData.role) {
      try {
        await ruleData.role.delete('Rule creation was cancelled');
        this.logger.log(`Deleted newly created role ${ruleData.role.name} due to rule cancellation`);
      } catch (error) {
        this.logger.error(`Failed to delete newly created role ${ruleData.role.name}:`, error);
      }
    }

    // Create rule info fields for display
    const cancelledRuleFormatted = {
      role_id: ruleData.role.id,
      role_name: ruleData.role.name,
      channel_name: ruleData.channel.name,
      slug: ruleData.slug,
      attribute_key: ruleData.attributeKey,
      attribute_value: ruleData.attributeValue,
      min_items: ruleData.minItems,
      ...ruleData.assetFields
    };
    const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields(cancelledRuleFormatted);

    const embed = AdminFeedback.destructive(
      'Rule Creation Cancelled',
      `Rule creation for ${ruleData.channel.name} and @${ruleData.role.name} has been cancelled.${ruleData.wasNewlyCreated ? ' The newly created role has been removed.' : ''}`
    );
    embed.addFields(ruleInfoFields);
    
    // Add duplicate context note
    if (ruleData.duplicateType) {
      const noteText = this.getDuplicateRuleNote(ruleData.duplicateType);
      embed.addFields({
        name: '⚠️ Note',
        value: `This would have been a duplicate rule: ${noteText}`,
        inline: false
      });
    }

    // Create undo button
    const undoButton = this.duplicateRuleConfirmationHandler.createUndoRemovalButton(chainId, 'cancellation');

    await interaction.editReply({
      embeds: [embed],
      components: [undoButton]
    });

    // Set up undo functionality
    this.duplicateRuleConfirmationHandler.setupCancellationButtonHandler(
      interaction,
      chainId,
      async (undoRuleData: any) => {
        // Undo cancellation - recreate the duplicate warning
        await this.recreateDuplicateWarning(interaction, undoRuleData);
      }
    );
  }

  /**
   * Recreates the duplicate warning after undoing cancellation
   */
  private async recreateDuplicateWarning(
    interaction: ChatInputCommandInteraction,
    ruleData: any
  ): Promise<void> {
    // Re-check for duplicate rules and show the warning again
    const existingRule = await this.dbSvc.checkForDuplicateRule(
      interaction.guild.id,
      ruleData.channel.id,
      ruleData.slug,
      ruleData.attributeKey,
      ruleData.attributeValue,
      ruleData.minItems,
      ruleData.role.id, // Exclude the same role
      ruleData.assetFields
    );

    if (existingRule) {
      await this.showDuplicateRuleWarning(interaction, existingRule, ruleData);
    } else {
      // No duplicate found anymore, proceed with rule creation
      await this.createRuleDirectly(interaction, ruleData, false);
    }
  }

  /**
   * Generates a consistent chain ID for undo/redo functionality
   */
  private generateChainId(interaction: ChatInputCommandInteraction): string {
    return `${interaction.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Determines the type of duplication for a rule
   */
  private async determineDuplicateType(serverId: string, channelId: string, roleId: string, excludeRuleId?: number): Promise<'criteria' | 'role'> {
    const allChannelRules = await this.dbSvc.getRulesByChannel(serverId, channelId);
    const existingRoleRules = allChannelRules.filter(rule => 
      rule.role_id === roleId && 
      (excludeRuleId ? rule.id !== excludeRuleId : true)
    );
    
    // If there are existing rules for the same role, it's a role duplicate
    if (existingRoleRules.length > 0) {
      return 'role';
    }
    
    // Otherwise it's a criteria duplicate (same criteria, different rule)
    return 'criteria';
  }

  /**
   * Gets the appropriate warning note for duplicate rules
   */
  private getDuplicateRuleNote(duplicateType: 'criteria' | 'role'): string {
    if (duplicateType === 'role') {
      return 'This role already has verification rules in this channel. Users now have multiple ways to earn the same role.';
    } else {
      return 'This rule has the same criteria as an existing rule. Users meeting these criteria will receive multiple roles.';
    }
  }

  /**
   * Validates that the selected options exist in the database and belong together
   */
  private async validateInputCombinations(
    slug: string, 
    attributeKey: string, 
    attributeValue: string
  ): Promise<{ isValid: boolean; message: string }> {
    
    // If all options are 'ALL', no validation needed
    if (slug === 'ALL' && attributeKey === 'ALL' && attributeValue === 'ALL') {
      return { isValid: true, message: '' };
    }

    try {
      // Validate slug(s) exist (unless ALL)
      if (slug !== 'ALL') {
        const availableSlugs = await this.dataSvc.getAllSlugs();
        
        // Handle multi-slug input: validate each slug individually
        const inputSlugs = slug.split(',').map(s => s.trim()).filter(s => s.length > 0);
        const invalidSlugs = inputSlugs.filter(s => !availableSlugs.includes(s));
        
        if (invalidSlugs.length > 0) {
          const slugLabel = invalidSlugs.length > 1 ? 'Collections' : 'Collection';
          const slugList = invalidSlugs.map(s => `"${s}"`).join(', ');
          return {
            isValid: false,
            message: `${slugLabel} ${slugList} do not exist in the marketplace database.`
          };
        }
        
        // For multi-slug rules, attributes must be ALL (can't filter specific attributes across multiple collections)
        if (inputSlugs.length > 1 && (attributeKey !== 'ALL' || attributeValue !== 'ALL')) {
          return {
            isValid: false,
            message: 'Multi-collection rules (comma-separated slugs) do not support attribute filtering. Set both attribute key and value to ALL.'
          };
        }
      }

      // Validate attribute key exists for the selected collection
      if (attributeKey !== 'ALL') {
        if (slug === 'ALL') {
          // If no specific collection, check if attribute key exists across all collections
          const allKeys = await this.dataSvc.getAttributeKeys('ALL');
          if (!allKeys.includes(attributeKey)) {
            return {
              isValid: false,
              message: `Attribute key "${attributeKey}" does not exist in any collection.`
            };
          }
        } else {
          // Check if attribute key exists for the specific collection
          const keysForCollection = await this.dataSvc.getAttributeKeys(slug);
          if (!keysForCollection.includes(attributeKey)) {
            return {
              isValid: false,
              message: `Attribute key "${attributeKey}" does not exist for collection "${slug}".`
            };
          }
        }
      }

      // Validate attribute value exists for the selected key and collection
      if (attributeValue !== 'ALL') {
        if (attributeKey === 'ALL') {
          return {
            isValid: false,
            message: 'Cannot specify an attribute value without specifying an attribute key first.'
          };
        }

        let valuesForKey: string[];
        if (slug === 'ALL') {
          // Get ALL values across all collections for this attribute key (not just rarest 25)
          valuesForKey = await this.dataSvc.getAllAttributeValues(attributeKey, 'ALL');
        } else {
          // Get ALL values for specific collection and attribute key (not just rarest 25)
          valuesForKey = await this.dataSvc.getAllAttributeValues(attributeKey, slug);
        }

        // Values from getAllAttributeValues are already clean (no count suffix)
        if (!valuesForKey.includes(attributeValue)) {
          const keyLocation = slug === 'ALL' ? 'any collection' : `collection "${slug}"`;
          return {
            isValid: false,
            message: `Attribute value "${attributeValue}" does not exist for attribute key "${attributeKey}" in ${keyLocation}.`
          };
        }
      }

      return { isValid: true, message: '' };
      
    } catch (error) {
      this.logger.error('Error validating input combinations:', error);
      return {
        isValid: false,
        message: 'Error validating options against database. Please try again.'
      };
    }
  }
}
