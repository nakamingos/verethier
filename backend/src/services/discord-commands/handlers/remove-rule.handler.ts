import { nftRuleCriteria } from '@/utils/nft-rule.util';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { DbService } from '../../db.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { RemovalUndoInteractionHandler } from '../interactions/removal-undo.interaction';
import { DuplicateRuleConfirmationInteractionHandler } from '../interactions/duplicate-rule-confirmation.interaction';
import { formatAttribute } from '../utils/rule-validation.util';

/**
 * Remove Rule Command Handler
 * 
 * Handles the complete flow for removing verification rules:
 * - Input validation and parsing (supports bulk removal)
 * - Rule existence validation  
 * - Database deletion with error handling
 * - Success/failure feedback with undo functionality
 * - Bulk operation support
 */
@Injectable()
export class RemoveRuleHandler {
  private readonly logger = new Logger(RemoveRuleHandler.name);

  // Store removed rule data for undo functionality
  private removedRules: Map<string, any> = new Map();

  constructor(
    private readonly dbSvc: DbService,
    @Inject(forwardRef(() => RemovalUndoInteractionHandler))
    private readonly removalUndoHandler: RemovalUndoInteractionHandler,
    @Inject(forwardRef(() => DuplicateRuleConfirmationInteractionHandler))
    private readonly duplicateRuleConfirmationHandler: DuplicateRuleConfirmationInteractionHandler
  ) {}

  /**
   * Main entry point for remove rule command
   */
  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const ruleIdInput = interaction.options.getString('rule_id');
    
    // Defer the reply early to prevent timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    if (!ruleIdInput) {
      await interaction.editReply({
        content: AdminFeedback.simple('Rule ID is required.', true)
      });
      return;
    }

    try {
      // Parse and validate rule IDs
      const ruleIds = await this.parseRuleIds(ruleIdInput);
      if (!ruleIds) {
        await interaction.editReply({
          content: AdminFeedback.simple('No valid rule IDs provided.', true)
        });
        return;
      }

      // Find and validate rules exist
      const { rulesToRemove, notFoundIds } = await this.findRulesToRemove(interaction, ruleIds);
      
      // Handle not found rules
      if (notFoundIds.length > 0) {
        const notFoundMessage = notFoundIds.length === 1 
          ? `Rule ${notFoundIds[0]} not found.`
          : `Rules ${notFoundIds.join(', ')} not found.`;
          
        if (rulesToRemove.length === 0) {
          // No valid rules to remove
          await interaction.editReply({
            content: AdminFeedback.simple(notFoundMessage, true)
          });
          return;
        } else {
          // Some valid rules, show warning but continue
          await interaction.followUp({
            content: AdminFeedback.simple(`⚠️ ${notFoundMessage}`, true),
            flags: MessageFlags.Ephemeral
          });
        }
      }

      // Delete rules from database
      const deletionResults = await this.deleteRules(interaction, rulesToRemove);

      // Send appropriate feedback based on results
      await this.sendRemovalFeedback(interaction, deletionResults);

    } catch (error) {
      this.logger.error('Error in handleRemoveRule:', error);
      await interaction.editReply({
        content: AdminFeedback.simple(`Error: ${error.message}`, true)
      });
    }
  }

  /**
   * Parses comma-separated rule IDs and validates format
   */
  private async parseRuleIds(ruleIdInput: string): Promise<number[] | null> {
    try {
      // Log parsing details only in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Parsing rule ID input: "${ruleIdInput}"`);
      }
      
      // Parse comma-separated rule IDs (handle both "1,2,3" and "1, 2, 3" formats)
      const ruleIds = ruleIdInput
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0)
        .map(id => {
          const parsed = parseInt(id, 10);
          if (isNaN(parsed)) {
            throw new Error(`"${id}" is not a valid rule ID`);
          }
          return parsed;
        });

      // Log parsed IDs only in development
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Parsed rule IDs: [${ruleIds.join(', ')}]`);
      }
      return ruleIds.length > 0 ? ruleIds : null;
    } catch (error) {
      this.logger.error(`Error parsing rule IDs from "${ruleIdInput}":`, error.message);
      throw new Error(`Invalid rule ID format: ${error.message}`);
    }
  }

  /**
   * Finds rules to remove and validates they exist
   */
  private async findRulesToRemove(
    interaction: ChatInputCommandInteraction, 
    ruleIds: number[]
  ): Promise<{
    rulesToRemove: Array<{ id: number; data: any }>;
    notFoundIds: number[];
  }> {
    this.logger.debug(`Finding rules to remove: [${ruleIds.join(', ')}] for server ${interaction.guild.id}`);
    
    // Get all rules for the server
    const allRules = await this.dbSvc.getRoleMappings(interaction.guild.id);
    this.logger.debug(`Found ${allRules?.length || 0} total rules for server`);
    
    // Find rules to remove and validate they exist
    const rulesToRemove = [];
    const notFoundIds = [];
    
    for (const ruleId of ruleIds) {
      const ruleToRemove = allRules.find(rule => rule.id === ruleId);
      if (ruleToRemove) {
        this.logger.debug(`Found rule ${ruleId}: Channel ${ruleToRemove.channel_name} (${ruleToRemove.channel_id}), Server ID: ${ruleToRemove.server_id}`);
        rulesToRemove.push({ id: ruleId, data: ruleToRemove });
      } else {
        this.logger.debug(`Rule ${ruleId} not found in server rules`);
        notFoundIds.push(ruleId);
      }
    }

    this.logger.debug(`Rules to remove: ${rulesToRemove.length}, Not found: ${notFoundIds.length}`);
    return { rulesToRemove, notFoundIds };
  }

  /**
   * Deletes rules from database and tracks results
   */
  private async deleteRules(
    interaction: ChatInputCommandInteraction,
    rulesToRemove: Array<{ id: number; data: any }>
  ): Promise<{
    successful: Array<{ id: number; data: any; success: true }>;
    failed: Array<{ id: number; data: any; success: false; error: string }>;
  }> {
    const deletionResults = [];
    
    this.logger.debug(`Attempting to delete ${rulesToRemove.length} rules:`, rulesToRemove.map(r => `Rule ${r.id} (Channel: ${r.data.channel_name})`));
    
    for (const { id, data } of rulesToRemove) {
      try {
        this.logger.debug(`Deleting rule ${id} from server ${interaction.guild.id}, rule belongs to server ${data.server_id}`);
        await this.dbSvc.deleteRoleMapping(String(id), interaction.guild.id);
        deletionResults.push({ id, data, success: true });
        this.logger.debug(`Successfully deleted rule ${id}`);
      } catch (error) {
        this.logger.error(`Failed to delete rule ${id}:`, error.message);
        deletionResults.push({ id, data, success: false, error: error.message });
      }
    }

    const successful = deletionResults.filter(r => r.success);
    const failed = deletionResults.filter(r => !r.success);

    this.logger.debug(`Deletion completed: ${successful.length} successful, ${failed.length} failed`);
    
    return { successful, failed };
  }

  /**
   * Sends appropriate feedback based on deletion results
   */
  private async sendRemovalFeedback(
    interaction: ChatInputCommandInteraction,
    deletionResults: {
      successful: Array<{ id: number; data: any; success: true }>;
      failed: Array<{ id: number; data: any; success: false; error: string }>;
    }
  ): Promise<void> {
    const { successful, failed } = deletionResults;

    if (successful.length === 1 && failed.length === 0) {
      // Single successful removal
      await this.sendSingleRuleRemovedMessage(
        interaction,
        successful[0].id,
        successful[0].data
      );
    } else {
      // Multiple rules or mixed results
      await this.sendBulkRuleRemovedMessage(
        interaction,
        successful,
        failed
      );
    }
  }

  /**
   * Sends feedback for single rule removal with undo functionality
   */
  private async sendSingleRuleRemovedMessage(
    interaction: ChatInputCommandInteraction,
    ruleId: number,
    removedRuleData: any
  ): Promise<void> {
    // Store the removed rule data for undo functionality
    this.removedRules.set(interaction.id, removedRuleData);

    // Create detailed rule info fields
    const ruleInfoFields = this.duplicateRuleConfirmationHandler.createRuleInfoFields({
      rule_id: ruleId,
      role_id: removedRuleData.role_id,
      role_name: removedRuleData.role_name,
      channel_name: removedRuleData.channel_name,
      ...removedRuleData,
      slug: removedRuleData.slug,
      attribute_key: removedRuleData.attribute_key,
      attribute_value: removedRuleData.attribute_value,
      min_items: removedRuleData.min_items
    });
    const embed = AdminFeedback.destructive(
      'Rule Removed', 
      `Rule ${ruleId} for ${removedRuleData.channel_name} and @${removedRuleData.role_name} has been removed.`
    );
    embed.addFields(ruleInfoFields);

    // Create Undo button
    const undoButton = this.createUndoRemovalButton(interaction.id, 'removal');

    await interaction.editReply({
      embeds: [embed],
      components: [undoButton]
    });

    // Set up button interaction handler for undo removal
    this.setupRemovalButtonHandler(interaction);
  }

  /**
   * Sends feedback for bulk rule removal with undo functionality
   */
  private async sendBulkRuleRemovedMessage(
    interaction: ChatInputCommandInteraction,
    successful: Array<{ id: number; data: any; success: true }>,
    failed: Array<{ id: number; data: any; success: false; error: string }>
  ): Promise<void> {
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
        const attribute = formatAttribute(s.data.attribute_key, s.data.attribute_value);
        let slug = s.data.slug || 'ALL';
        // Format multi-slug display with spaces after commas for readability
        if (slug !== 'ALL' && slug.includes(',')) {
          slug = slug.split(',').map(s => s.trim()).join(', ');
        }
        const minItems = s.data.min_items || 1;
        
        const criteria = s.data.asset_type === 'nft' ? `Collection: ${nftRuleCriteria(s.data)}` : `Slug: ${slug} | Attr: ${attribute} | Min: ${minItems}`;
        const ruleInfo = `ID: ${s.id} | Channel: <#${s.data.channel_id}> | Role: <@&${s.data.role_id}> | ${criteria}`;
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
      const undoButton = this.createUndoRemovalButton(interaction.id, 'removal');
      components.push(undoButton);
    }

    await interaction.editReply({
      embeds: [embed],
      components
    });

    // Set up button interaction handler for undo removal (only if there are successful removals)
    if (successful.length > 0) {
      this.setupRemovalButtonHandler(interaction);
    }
  }

  /**
   * Creates Undo action button for rule removal messages
   */
  private createUndoRemovalButton(interactionId: string, type: 'removal' | 'cancellation') {
    return {
      type: 1, // ActionRow
      components: [
        {
          type: 2, // Button
          custom_id: `undo_${type}_${interactionId}`,
          label: 'Undo',
          style: 2, // Secondary
          emoji: { name: '↩️' }
        }
      ]
    };
  }

  /**
   * Sets up button interaction handler for removal undo messages
   */
  private setupRemovalButtonHandler(interaction: ChatInputCommandInteraction): void {
    // Get the removed rules data and set up the handler
    const removedRulesMap = new Map<string, any>();
    const removedData = this.removedRules.get(interaction.id);
    if (removedData) {
      removedRulesMap.set(interaction.id, removedData);
      this.removalUndoHandler.setupRemovalButtonHandler(interaction, removedRulesMap);
    }
  }

  /**
   * Gets stored removal data for undo functionality
   */
  getRemovedRuleData(interactionId: string): any {
    return this.removedRules.get(interactionId);
  }

  /**
   * Clears stored removal data
   */
  clearRemovedRuleData(interactionId: string): void {
    this.removedRules.delete(interactionId);
  }
}
