import { nftRuleCriteria } from '@/utils/nft-rule.util';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ButtonInteraction, ChatInputCommandInteraction, ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { DbService } from '../../db.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { RemovalUndoInteractionHandler } from './removal-undo.interaction';
import { DuplicateRuleConfirmationInteractionHandler } from './duplicate-rule-confirmation.interaction';
import { cleanupNewlyCreatedRole } from '../utils/role-management.util';
import { formatAttribute } from '../utils/rule-validation.util';

/**
 * Restore Undo Interaction Handler
 * 
 * Handles button interactions for undoing rule restorations.
 * Manages collectors, timeouts, and removal logic for restored rules.
 * Supports both single and bulk undo operations.
 */
@Injectable()
export class RestoreUndoInteractionHandler {
  private readonly logger = new Logger(RestoreUndoInteractionHandler.name);

  // Maps to store restored rule data for undo functionality
  private restoredRules = new Map<string, any>();
  private removedRules = new Map<string, any>();
  
  // Rate limiting for button clicks
  private lastInteractionTime = new Map<string, number>();
  private readonly INTERACTION_COOLDOWN_MS = 1000; // 1 second cooldown

  constructor(
    private readonly dbSvc: DbService,
    @Inject(forwardRef(() => RemovalUndoInteractionHandler))
    private readonly removalUndoHandler: RemovalUndoInteractionHandler,
    @Inject(forwardRef(() => DuplicateRuleConfirmationInteractionHandler))
    private readonly duplicateRuleConfirmationHandler: DuplicateRuleConfirmationInteractionHandler
  ) {}

  /**
   * Sets up button handler for rule restoration undo functionality
   */
  setupRestoreButtonHandler(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    restoredRules: Map<string, any>
  ): void {
    // Store reference to restored rules for this interaction
    this.restoredRules = restoredRules;

    const filter = (i: any) => 
      i.customId.startsWith('undo_restore_') && 
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel?.createMessageComponentCollector({ 
      filter, 
      time: 300000, // 5 minutes
      componentType: ComponentType.Button
    });

    collector?.on('collect', async (i) => {
      if (i.customId.startsWith('undo_restore_')) {
        await this.handleUndoRestore(i);
      }
      collector.stop();
    });

    collector?.on('end', (collected) => {
      if (collected.size === 0) {
        // Timeout - clean up restore data
        // Use chain ID from the first entry in the map
        for (const [chainId] of this.restoredRules) {
          this.restoredRules.delete(chainId);
          break;
        }
      }
    });
  }

  /**
   * Handles Undo button interaction for rule restoration - removes the restored rule(s)
   */
  private async handleUndoRestore(interaction: ButtonInteraction): Promise<void> {
    const interactionId = interaction.customId.replace('undo_restore_', '');
    const userId = interaction.user.id;
    
    // Rate limiting check to prevent rapid clicking
    const now = Date.now();
    const lastTime = this.lastInteractionTime.get(userId) || 0;
    if (now - lastTime < this.INTERACTION_COOLDOWN_MS) {
      this.logger.debug(`Rate limiting undo restore for user ${userId}`);
      return; // Silently ignore rapid clicks
    }
    this.lastInteractionTime.set(userId, now);
    
    const restoredRuleData = this.restoredRules.get(interactionId);

    if (!restoredRuleData) {
      // Check if interaction is still valid before responding
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: AdminFeedback.simple('Undo session expired. Rule restoration cannot be undone.', true),
          flags: MessageFlags.Ephemeral
        });
      }
      return;
    }

    try {
      // Defer the interaction early to prevent timeout and acknowledgment issues
      // But first check if the interaction is still valid
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (deferError) {
          // If we can't defer, the interaction is likely expired
          this.logger.warn('Failed to defer interaction, likely expired:', deferError.message);
          // Clean up data and return silently
          this.restoredRules.delete(interactionId);
          return;
        }
      }

      // Check if this is a bulk operation
      if (restoredRuleData.isBulk && restoredRuleData.rules) {
        await this.handleBulkUndoRestore(interaction, restoredRuleData.rules);
      } else {
        // Single rule restoration (existing logic)
        await this.handleSingleUndoRestore(interaction, restoredRuleData, interactionId);
      }

      // Clean up the restore data
      this.restoredRules.delete(interactionId);
    } catch (error) {
      this.logger.error('Error undoing rule restoration:', error);
      
      // Improved error handling - check for specific Discord errors
      if (error.code === 10062 || error.message?.includes('Unknown interaction')) {
        // Interaction has expired, clean up silently
        this.logger.warn('Interaction expired during restore undo, cleaning up silently');
        this.restoredRules.delete(interactionId);
        return;
      }
      
      // Only try to respond if we haven't already responded and the interaction is still valid
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: AdminFeedback.simple(`Error removing rule(s): ${error.message}`, true),
            flags: MessageFlags.Ephemeral
          });
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content: AdminFeedback.simple(`Error removing rule(s): ${error.message}`, true),
          });
        } else if (interaction.replied) {
          // Use followUp if already replied
          await interaction.followUp({
            content: AdminFeedback.simple(`Error removing rule(s): ${error.message}`, true),
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (responseError) {
        // If we can't respond to the interaction, just log it and clean up
        this.logger.error('Failed to send error response to interaction:', responseError);
        this.restoredRules.delete(interactionId);
      }
    }
  }

  /**
   * Handles bulk undo restore for multiple rules
   */
  private async handleBulkUndoRestore(interaction: any, restoredRules: any[]): Promise<void> {
    const removalResults = [];
    
    for (const restoredRule of restoredRules) {
      try {
        // Validate that the rule data exists and has required properties
        if (!restoredRule || !restoredRule.id) {
          this.logger.warn('Invalid rule data in bulk undo restore:', restoredRule);
          removalResults.push({ 
            success: false, 
            ruleId: 'unknown', 
            error: 'Invalid rule data structure',
            originalData: restoredRule
          });
          continue;
        }

        // Remove the rule that was restored
        await this.dbSvc.deleteRoleMapping(String(restoredRule.id), restoredRule.server_id);
        
        // If this rule was restored with a newly created role, try to clean it up
        if (restoredRule.wasNewlyCreated && restoredRule.role_id) {
          await cleanupNewlyCreatedRole(interaction, restoredRule.role_id, restoredRule.server_id);
        }
        
        removalResults.push({ 
          success: true, 
          originalData: restoredRule
        });
      } catch (error) {
        this.logger.error('Error removing restored rule:', error);
        removalResults.push({ 
          success: false, 
          ruleId: restoredRule?.id || 'unknown', 
          error: error.message,
          originalData: restoredRule
        });
      }
    }

    // Store the removed rules for potential undo (restore again)
    const successful = removalResults.filter(r => r.success);
    if (successful.length > 0) {
      const bulkRemovedData = {
        rules: successful.map(s => ({ ...s.originalData, wasNewlyCreated: s.originalData.wasNewlyCreated })),
        isBulk: true
      };
      // Use chain ID from the interaction custom ID
      const chainId = interaction.customId.replace('undo_restore_', '');
      this.removedRules.set(chainId, bulkRemovedData);
    }

    // Send bulk removal message and set up next undo handler
    await this.sendBulkRuleRemovedMessage(interaction, removalResults);
  }

  /**
   * Handles single undo restore
   */
  private async handleSingleUndoRestore(interaction: any, restoredRuleData: any, interactionId: string): Promise<void> {
    // Remove the rule that was restored
    await this.dbSvc.deleteRoleMapping(String(restoredRuleData.id), restoredRuleData.server_id);
    
    // If this rule was restored with a newly created role, try to clean it up
    if (restoredRuleData.wasNewlyCreated) {
      await cleanupNewlyCreatedRole(interaction, restoredRuleData.role_id, restoredRuleData.server_id);
    }

    // Store the removed rule for potential undo (restore again) using chain ID
    this.removedRules.set(interactionId, {
      ...restoredRuleData,
      wasNewlyCreated: restoredRuleData.wasNewlyCreated,
      isDuplicateRule: restoredRuleData.isDuplicateRule,
      duplicateType: restoredRuleData.duplicateType
    });

    // Create "Rule Removed" message with undo button
    const embedTitle = restoredRuleData.isDuplicateRule 
      ? (restoredRuleData.duplicateType === 'role' 
          ? 'Rule Removed for Existing Role' 
          : 'Additional Rule Removed')
      : 'Rule Removed';
    const embed = AdminFeedback.destructive(
      embedTitle, 
      `Rule ${restoredRuleData.id} for ${restoredRuleData.channel_name} and @${restoredRuleData.role_name} has been removed.`
    );

    // Add detailed rule info fields
    const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields({
      rule_id: restoredRuleData.id,
      role_id: restoredRuleData.role_id,
      role_name: restoredRuleData.role_name,
      channel_name: restoredRuleData.channel_name,
      ...restoredRuleData,
      slug: restoredRuleData.slug,
      attribute_key: restoredRuleData.attribute_key,
      attribute_value: restoredRuleData.attribute_value,
      min_items: restoredRuleData.min_items
    });
    embed.addFields(ruleInfoFields);
    
    // Add duplicate context note if applicable
    if (restoredRuleData.isDuplicateRule && restoredRuleData.duplicateType) {
      const noteText = restoredRuleData.duplicateType === 'role' 
        ? 'This role no longer has multiple ways to be earned in this channel.'
        : 'Users meeting these criteria will no longer receive multiple roles.';
      embed.addFields({
        name: '⚠️ Note',
        value: noteText,
        inline: false
      });
    }

    await interaction.editReply({
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`undo_removal_${interactionId}`) // Use chain ID to continue the cycle
              .setLabel('Undo')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('↩️')
          )
      ]
    });

    // Set up removal undo handler to continue the chain
    const removedRulesMap = new Map();
    removedRulesMap.set(interactionId, {
      ...restoredRuleData,
      wasNewlyCreated: restoredRuleData.wasNewlyCreated,
      isDuplicateRule: restoredRuleData.isDuplicateRule,
      duplicateType: restoredRuleData.duplicateType
    });
    this.removalUndoHandler.setupRemovalButtonHandler(interaction, removedRulesMap);

    this.logger.log(`Rule ${restoredRuleData.id} removed successfully (undo restore) with user confirmation`);
  }

  /**
   * Sends feedback for bulk rule removal with undo functionality
   */
  private async sendBulkRuleRemovedMessage(
    interaction: ButtonInteraction,
    removalResults: any[]
  ): Promise<void> {
    const successful = removalResults.filter(r => r.success);
    const failed = removalResults.filter(r => !r.success);

    // Store the removed rules data for undo functionality (only successful ones)
    if (successful.length > 0) {
      const bulkRemovedData = {
        rules: successful.map(s => s.originalData),
        isBulk: true
      };
      // Store using the original chain ID to maintain the undo chain  
      const chainId = interaction.customId.replace('undo_restore_', '');
      this.removedRules.clear();
      this.removedRules.set(chainId, bulkRemovedData);
    }

    // Create success message
    let description = '';
    if (successful.length > 0) {
      const ruleList = successful.map(s => `Rule ${s.originalData.id}`).join(', ');
      description += `✅ **Successfully removed:** ${ruleList}\n\n`;
      
      // Add clean rule info for each removed rule using list format
      successful.forEach(s => {
        const rule = s.originalData;
        const attribute = formatAttribute(rule.attribute_key, rule.attribute_value);
        const slug = rule.slug || 'ALL';
        const minItems = rule.min_items || 1;
        
        const criteria = rule.asset_type === 'nft' ? `Collection: ${nftRuleCriteria(rule)}` : `Slug: ${slug} | Attr: ${attribute} | Min: ${minItems}`;
        const ruleInfo = `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | ${criteria}`;
        description += ruleInfo + '\n\n';
      });
    }

    if (failed.length > 0) {
      description += '\n❌ **Failed to remove:**\n';
      failed.forEach(f => {
        description += `Rule ${f.ruleId}: ${f.error}\n`;
      });
    }

    const embed = AdminFeedback.destructive(
      successful.length === 1 ? 'Rule Removed' : `${successful.length} Rules Removed`, 
      description.trim()
    );

    const components = [];
    if (successful.length > 0) {
      // Create Undo button for successful removals using the chain ID
      const chainId = interaction.customId.replace('undo_restore_', '');
      components.push(
        new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`undo_removal_${chainId}`)
              .setLabel('Undo')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('↩️')
          )
      );
    }

    await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Set up removal undo handler for the "Rules Removed" message  
    if (successful.length > 0) {
      const removedRulesMap = new Map<string, any>();
      const chainId = interaction.customId.replace('undo_restore_', '');
      removedRulesMap.set(chainId, this.removedRules.get(chainId));
      this.removalUndoHandler.setupRemovalButtonHandler(interaction, removedRulesMap);
    }
  }

}
