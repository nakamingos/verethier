import { nftRuleScope, nftRuleCriteria } from '@/utils/nft-rule.util';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ButtonInteraction, ChatInputCommandInteraction, ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { DbService } from '../../db.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { RestoreUndoInteractionHandler } from './restore-undo.interaction';
import { formatAttribute } from '../utils/rule-validation.util';

/**
 * Removal Undo Interaction Handler
 * 
 * Handles button interactions for undoing rule removals.
 * Manages collectors, timeouts, and restoration logic.
 * Supports both single and bulk undo operations.
 */
@Injectable()
export class RemovalUndoInteractionHandler {
  private readonly logger = new Logger(RemovalUndoInteractionHandler.name);

  // Maps to store removed rule data for undo functionality
  private removedRules = new Map<string, any>();
  private restoredRules = new Map<string, any>();
  private restoredRulesForUndo = new Map<string, any>(); // For passing to RestoreUndoInteractionHandler

  constructor(
    private readonly dbSvc: DbService,
    @Inject(forwardRef(() => RestoreUndoInteractionHandler))
    private readonly restoreUndoHandler: RestoreUndoInteractionHandler
  ) {}

  /**
   * Sets up button interaction handler for removal undo messages
   */
  setupRemovalButtonHandler(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    removedRules: Map<string, any>
  ): void {
    // Store reference to removed rules for this interaction
    this.removedRules = removedRules;

    const filter = (i: any) => 
      i.customId.startsWith('undo_removal_') && 
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel?.createMessageComponentCollector({ 
      filter, 
      time: 300000, // 5 minutes
      componentType: ComponentType.Button
    });

    collector?.on('collect', async (i) => {
      if (i.customId.startsWith('undo_removal_')) {
        await this.handleUndoRemoval(i);
      }
      collector.stop();
    });

    collector?.on('end', (collected) => {
      if (collected.size === 0) {
        // Timeout - clean up removal data
        // Use chain ID from the first entry in the map
        for (const [chainId] of this.removedRules) {
          this.removedRules.delete(chainId);
          break;
        }
      }
    });
  }

  /**
   * Sets up button interaction handler for removal undo messages with extended timeout
   */
  setupRemovalButtonHandlerWithExtendedTimeout(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    removedRules: Map<string, any>
  ): void {
    // Store reference to removed rules for this interaction
    this.removedRules = removedRules;

    const filter = (i: any) => 
      i.customId.startsWith('undo_removal_') && 
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel?.createMessageComponentCollector({ 
      filter, 
      time: 600000, // 10 minutes (extended timeout for undo chains)
      componentType: ComponentType.Button
    });

    collector?.on('collect', async (i) => {
      if (i.customId.startsWith('undo_removal_')) {
        await this.handleUndoRemoval(i);
      }
      collector.stop();
    });

    collector?.on('end', (collected) => {
      if (collected.size === 0) {
        // Timeout - clean up removal data (extended timeout version)
        // Use chain ID from the first entry in the map
        for (const [chainId] of this.removedRules) {
          this.removedRules.delete(chainId);
          break;
        }
      }
    });
  }

  /**
   * Handles Undo button interaction for rule removal - recreates the removed rule(s)
   */
  private async handleUndoRemoval(interaction: any): Promise<void> {
    const interactionId = interaction.customId.replace('undo_removal_', '');
    const removedRuleData = this.removedRules.get(interactionId);
    
    if (!removedRuleData) {
      // Check if interaction is still valid before responding
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: AdminFeedback.simple('Undo session expired. Rule removal cannot be undone.', true),
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
          this.removedRules.delete(interactionId);
          return;
        }
      }

      // Check if this is a bulk operation
      if (removedRuleData.isBulk && removedRuleData.rules) {
        await this.handleBulkUndoRemoval(interaction, removedRuleData.rules);
      } else {
        // Single rule removal (existing logic) - pass the chain ID
        await this.handleSingleUndoRemoval(interaction, removedRuleData, interactionId);
      }

      // Clean up the removal data
      this.removedRules.delete(interactionId);
    } catch (error) {
      this.logger.error('Error undoing rule removal:', error);
      
      // Improved error handling - check for specific Discord errors
      if (error.code === 10062 || error.message?.includes('Unknown interaction')) {
        // Interaction has expired, clean up silently
        this.logger.warn('Interaction expired during removal undo, cleaning up silently');
        this.removedRules.delete(interactionId);
        return;
      }
      
      // Only try to respond if we haven't already responded and the interaction is still valid
      // The error might have occurred after a successful reply in handleSingleUndoRemoval,
      // so we need to check if interaction was already replied to
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: AdminFeedback.simple(`Error restoring rule(s): ${error.message}`, true),
            flags: MessageFlags.Ephemeral
          });
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content: AdminFeedback.simple(`Error restoring rule(s): ${error.message}`, true),
          });
        } else if (interaction.replied) {
          // Use followUp if already replied
          await interaction.followUp({
            content: AdminFeedback.simple(`Error restoring rule(s): ${error.message}`, true),
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (responseError) {
        // If we can't respond to the interaction, just log it and clean up
        this.logger.error('Failed to send error response to interaction:', responseError);
        this.removedRules.delete(interactionId);
      }
      
      // Don't clean up removal data on error so user can try again
    }
  }

  /**
   * Handles bulk undo removal for multiple rules
   */
  private async handleBulkUndoRemoval(interaction: any, removedRules: any[]): Promise<void> {
    const restorationResults = [];
    
    for (const removedRule of removedRules) {
      try {
        // Handle role recreation if needed
        let roleToUse = null;
        if (removedRule.wasNewlyCreated) {
          const existingRole = interaction.guild.roles.cache.get(removedRule.role_id);
          if (!existingRole) {
            // Recreate role
            const botMember = interaction.guild.members.me;
            let position = undefined;
            if (botMember) {
              const botHighestPosition = botMember.roles.highest.position;
              position = Math.max(1, botHighestPosition - 1);
            }

            roleToUse = await interaction.guild.roles.create({
              name: removedRule.role_name,
              color: 'Blue',
              position: position,
              reason: `Recreated for bulk rule restoration by ${interaction.user.tag}`
            });
            
            this.logger.log(`Recreated role for bulk rule restoration: ${roleToUse.name} (${roleToUse.id})`);
            removedRule.role_id = roleToUse.id;
          }
        }
        
        // Recreate the rule
        const recreatedRule = await this.dbSvc.restoreRuleWithOriginalId(removedRule);
        restorationResults.push({ 
          success: true, 
          rule: recreatedRule, 
          originalData: { ...removedRule, wasNewlyCreated: removedRule.wasNewlyCreated } 
        });
      } catch (error) {
        restorationResults.push({ 
          success: false, 
          ruleId: removedRule.id, 
          error: error.message,
          originalData: removedRule
        });
      }
    }

    // Send bulk restoration message and set up next undo handler
    await this.sendBulkRuleRestoredMessage(interaction, restorationResults);
  }

  /**
   * Handles single undo removal
   */
  private async handleSingleUndoRemoval(interaction: any, removedRule: any, chainId: string): Promise<void> {
    let roleToUse = null;
    
    // If this rule had a newly created role, we need to recreate it first
    if (removedRule.wasNewlyCreated) {
      try {
        // Check if the role still exists
        const existingRole = interaction.guild.roles.cache.get(removedRule.role_id);
        
        if (!existingRole) {
          // Role doesn't exist, recreate it
          const botMember = interaction.guild.members.me;
          let position = undefined;
          
          if (botMember) {
            const botHighestPosition = botMember.roles.highest.position;
            position = Math.max(1, botHighestPosition - 1);
          }

          roleToUse = await interaction.guild.roles.create({
            name: removedRule.role_name,
            color: 'Blue',
            position: position,
            reason: `Recreated for rule restoration by ${interaction.user.tag}`
          });
          
          this.logger.log(`Recreated role for rule restoration: ${roleToUse.name} (${roleToUse.id})`);
          removedRule.role_id = roleToUse.id;
        } else {
          roleToUse = existingRole;
          this.logger.log(`Using existing role for rule restoration: ${existingRole.name} (${existingRole.id})`);
        }
      } catch (roleError) {
        this.logger.error('Error recreating role for rule restoration:', roleError);
      }
    }
    
    // Recreate the rule in the database with original ID
    const recreatedRule = await this.dbSvc.restoreRuleWithOriginalId(removedRule);
    
    // Store the restored rule for potential undo using the chain ID
    const restoredRuleWithMetadata = {
      ...recreatedRule,
      wasNewlyCreated: removedRule.wasNewlyCreated,
      isDuplicateRule: removedRule.isDuplicateRule,
      duplicateType: removedRule.duplicateType
    };
    this.restoredRules.set(chainId, restoredRuleWithMetadata);
    
    // Create rule info fields for the restored rule
    const ruleInfoFields = this.createRuleInfoFields(removedRule);
    const embedTitle = removedRule.isDuplicateRule 
      ? (removedRule.duplicateType === 'role' 
          ? 'Rule Restored to Existing Role' 
          : 'Additional Rule Restored')
      : 'Rule Restored';
    const embed = AdminFeedback.success(
      embedTitle, 
      `Rule ${recreatedRule.id} for <#${removedRule.channel_id}> and <@&${removedRule.role_id}> has been restored.`
    );
    embed.addFields(ruleInfoFields);
    
    // Add duplicate context note if applicable
    if (removedRule.isDuplicateRule && removedRule.duplicateType) {
      const noteText = removedRule.duplicateType === 'role' 
        ? 'This role again has multiple ways to be earned in this channel.'
        : 'Users meeting these criteria will again receive multiple roles.';
      embed.addFields({
        name: '⚠️ Note',
        value: noteText,
        inline: false
      });
    }
    
    // Create undo button for the restoration using the chain ID
    const components = [
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`undo_restore_${chainId}`) // Use chain ID to maintain continuity
            .setLabel('Undo')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️')
        )
    ];

    await interaction.editReply({
      embeds: [embed],
      components,
    });

    // Set up restore undo handler for the "Rule Restored" message
    const restoredRulesMap = new Map();
    restoredRulesMap.set(chainId, restoredRuleWithMetadata); // Use chain ID
    this.restoreUndoHandler.setupRestoreButtonHandler(interaction, restoredRulesMap);

    this.logger.log(`Rule ${recreatedRule.id} restored successfully with user confirmation`);
  }

  /**
   * Sends feedback for bulk rule restoration with undo functionality
   */
  private async sendBulkRuleRestoredMessage(
    interaction: ButtonInteraction,
    restorationResults: any[]
  ): Promise<void> {
    const successful = restorationResults.filter(r => r.success);
    const failed = restorationResults.filter(r => !r.success);

    // Store the restored rules data for undo functionality (only successful ones)
    if (successful.length > 0) {
      const bulkRestoredData = {
        rules: successful.map(s => s.originalData),
        isBulk: true
      };
      // Store using the original chain ID to maintain the undo chain
      const chainId = interaction.customId.replace('undo_removal_', '');
      this.restoredRulesForUndo.clear();
      this.restoredRulesForUndo.set(chainId, bulkRestoredData);
    }

    // Create success message
    let description = '';
    if (successful.length > 0) {
      const ruleList = successful.map(s => `Rule ${s.rule.id || s.originalData.id}`).join(', ');
      description += `✅ **Successfully restored:** ${ruleList}\n\n`;
      
      // Add clean rule info for each restored rule using list format
      successful.forEach(s => {
        const rule = s.rule || s.originalData;
        const attribute = formatAttribute(rule.attribute_key, rule.attribute_value);
        const slug = rule.slug || 'ALL';
        const minItems = rule.min_items || 1;
        
        const criteria = rule.asset_type === 'nft' ? `Collection: ${nftRuleCriteria(rule)}` : `Slug: ${slug} | Attr: ${attribute} | Min: ${minItems}`;
        const ruleInfo = `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | ${criteria}`;
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
      // Create Undo button for successful restorations using the chain ID
      const chainId = interaction.customId.replace('undo_removal_', '');
      components.push(
        new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`undo_restore_${chainId}`)
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

    // Set up restore undo handler for the "Rules Restored" message
    if (successful.length > 0) {
      this.restoreUndoHandler.setupRestoreButtonHandler(interaction, this.restoredRulesForUndo);
    }
  }

  /**
   * Creates detailed rule information fields for consistent display
   */
  private createRuleInfoFields(ruleData: any): any[] {
    if (ruleData.asset_type === 'nft') return [
      { name: '**Collection**', value: nftRuleScope(ruleData), inline: false },
      { name: '**Contract**', value: ruleData.contract_address, inline: false },
      { name: '**Min Items**', value: String(ruleData.min_items || 1), inline: true },
    ];
    return [
      {
        name: '**Collection**',
        value: ruleData.slug || 'ALL',
        inline: true
      },
      {
        name: '**Attribute**',
        value: formatAttribute(ruleData.attribute_key || 'ALL', ruleData.attribute_value || 'ALL'),
        inline: true
      },
      {
        name: '**Min Items**',
        value: (ruleData.min_items || 1).toString(),
        inline: true
      }
    ];
  }
}
