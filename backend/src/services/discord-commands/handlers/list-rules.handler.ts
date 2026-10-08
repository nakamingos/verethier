import { nftRuleCriteria } from '@/utils/nft-rule.util';
import { ordinalRuleCriteria } from '@/utils/ordinal-rule.util';
import { Injectable, Logger } from '@nestjs/common';
import { ChatInputCommandInteraction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { DbService } from '../../db.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { formatAttribute } from '../utils/rule-validation.util';

/**
 * List Rules Command Handler
 * 
 * Handles the complete flow for listing verification rules with pagination:
 * - Retrieval of all server rules
 * - Filtering and sorting by rule ID
 * - Paginated display with navigation buttons (20 rules per page)
 * - Proper handling of empty rule sets
 */
@Injectable()
export class ListRulesHandler {
  private readonly logger = new Logger(ListRulesHandler.name);
  private readonly RULES_PER_PAGE = 20;

  // Simple in-memory cache for pagination data
  private paginationCache = new Map<string, any[]>();

  constructor(
    private readonly dbSvc: DbService
  ) {}

  /**
   * Main entry point for list rules command
   */
  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // Defer the reply early to prevent timeout
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      this.logger.log(`Fetching rules for server: ${interaction.guild.id}`);
      
      // Get all verification rules for the server
      const allRules = await this.dbSvc.getRoleMappings(interaction.guild.id);
      
      this.logger.log(`Found ${allRules?.length || 0} total rules`);
      
      const rules = this.filterAndSortRules(allRules);
      
      this.logger.log(`Filtered to ${rules?.length || 0} rules`);

      if (rules.length === 0) {
        await interaction.editReply({
          embeds: [AdminFeedback.info('Verification Rules', 'No verification rules found.')]
        });
        return;
      }

      // Store rules in cache for pagination
      this.storeRulesForPagination(interaction.user.id, rules);
      
      // Show first page
      await this.showRulesPage(interaction, rules, 0, false);

    } catch (error) {
      this.logger.error('Error in handleListRules:');
      this.logger.error('Error details:', error);
      this.logger.error('Error stack:', error.stack);
      this.logger.error('Error message:', error.message);
      this.logger.error('Error type:', typeof error);
      this.logger.error('Error constructor:', error.constructor?.name);
      
      const errorMessage = `Error retrieving rules: ${error?.message || error?.toString() || 'Unknown error'}`;
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

  /**
   * Handle pagination button interactions
   */
  async handlePaginationButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;
    const userId = interaction.user.id;

    // Get stored rules data
    const allRules = this.paginationCache.get(userId);
    if (!allRules) {
      await interaction.reply({
        content: '❌ Pagination data expired. Please run the command again.',
        ephemeral: true
      });
      return;
    }

    // Extract page info from button ID
    const [, , direction, currentPageStr] = customId.split('-');
    const currentPage = parseInt(currentPageStr);
    
    let newPage;
    if (direction === 'next') {
      newPage = currentPage + 1;
    } else {
      newPage = currentPage - 1;
    }

    // Show the new page
    await this.showRulesPage(interaction, allRules, newPage, true);
  }

  /**
   * Show a specific page of rules
   */
  private async showRulesPage(
    interaction: ChatInputCommandInteraction | ButtonInteraction, 
    allRules: any[], 
    page: number, 
    isUpdate: boolean = false
  ): Promise<void> {
    const totalPages = Math.ceil(allRules.length / this.RULES_PER_PAGE);
    const startIndex = page * this.RULES_PER_PAGE;
    const endIndex = Math.min(startIndex + this.RULES_PER_PAGE, allRules.length);
    const rulesForPage = allRules.slice(startIndex, endIndex);

    this.logger.log(`Showing page ${page + 1}/${totalPages} (rules ${startIndex + 1}-${endIndex} of ${allRules.length})`);

    const description = this.formatRulesListForPage(rulesForPage, startIndex);

    // Create navigation buttons
    const buttons = [];
    
    // Previous button (disabled on first page)
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`list-rules-prev-${page}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
    );

    // Next button (disabled on last page) 
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`list-rules-next-${page}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    const title = `Verification Rules (Page ${page + 1}/${totalPages})`;
    const footer = `Showing ${rulesForPage.length} of ${allRules.length} total rules`;

    const embed = AdminFeedback.info(title, description)
      .setFooter({ text: footer });

    if (isUpdate && interaction instanceof ButtonInteraction) {
      await interaction.update({
        embeds: [embed],
        components: [actionRow]
      });
    } else {
      await interaction.editReply({
        embeds: [embed],
        components: [actionRow]
      });
    }
  }

  /**
   * Store rules data for pagination
   */
  private storeRulesForPagination(userId: string, rules: any[]): void {
    this.paginationCache.set(userId, rules);
    
    // Clear cache after 5 minutes to prevent memory leaks
    const timeout = setTimeout(() => {
      this.paginationCache.delete(userId);
    }, 5 * 60 * 1000);

    // Don't keep the process alive just to evict cached pagination data.
    timeout.unref?.();
  }

  /**
   * Filters out system rules and sorts by rule ID
   */
  private filterAndSortRules(allRules: any[]): any[] {
    return allRules
      .filter(rule => rule.server_id !== '000000000000000000')
      .sort((a, b) => a.id - b.id); // Sort by Rule ID in ascending order
  }

  /**
   * Formats the rules list for a specific page
   */
  private formatRulesListForPage(rules: any[], startIndex: number): string {
    return rules.map(rule => this.formatSingleRule(rule)).join('\n\n');
  }

  /**
   * Formats a single rule for display (legacy method kept for compatibility)
   */
  private formatSingleRule(rule: any): string {
    if (!rule) {
      return 'Invalid rule data';
    }

    try {
      if (rule.asset_type === 'nft' || rule.asset_type === 'ordinal') return `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | Collection: ${rule.asset_type === 'ordinal' ? ordinalRuleCriteria(rule) : nftRuleCriteria(rule)}`;
      const attribute = formatAttribute(rule.attribute_key, rule.attribute_value);
      let slug = rule.slug || 'ALL';
      // Format multi-slug display with spaces after commas for readability
      if (slug !== 'ALL' && slug.includes(',')) {
        slug = slug.split(',').map(s => s.trim()).join(', ');
      }
      const minItems = rule.min_items || 1;
      const ruleId = rule.id || 'N/A';
      const channelId = rule.channel_id || 'N/A';
      const roleId = rule.role_id || 'N/A';

      // Only include Min when it's greater than 1
      const minPart = minItems > 1 ? ` | Min: ${minItems}` : '';

      return `ID: ${ruleId} | Channel: <#${channelId}> | Role: <@&${roleId}> | Slug: ${slug} | Attr: ${attribute}${minPart}`;
    } catch (error) {
      this.logger.warn('Error formatting rule:', rule, error);
      return `ID: ${rule.id || 'N/A'} | Error formatting rule data`;
    }
  }
}
