import { ruleTraits, traitFilterLabel , singleTrait } from '@/utils/trait-filter.util';
import { tokenRuleCriteria } from '@/utils/erc20-rule.util';
import { nftRuleCriteria } from '@/utils/nft-rule.util';
import { ordinalRuleCriteria } from '@/utils/ordinal-rule.util';
import { inscriptionRuleScope } from '@/utils/inscription-rule.util';
import { VerifierRole } from '@/models/verifier-role.interface';
import { Injectable, Logger } from '@nestjs/common';
import { AttachmentBuilder, ChatInputCommandInteraction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { DbService } from '../../db.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { formatAttribute } from '../utils/rule-validation.util';

type RuleAssetType = NonNullable<VerifierRole['asset_type']>;
const ASSET_TYPE_LABELS: Record<RuleAssetType, string> = {
  erc20: 'Tokens (ERC-20)', nft: 'NFT', ordinal: 'Ordinals', ethscription: 'Ethscriptions'
};

/**
 * List Rules Command Handler
 * 
 * Handles the complete flow for listing verification rules with pagination:
 * - Retrieval of all server rules
 * - Optional asset type filtering and sorting by rule ID
 * - Paginated display with navigation buttons (up to 20 rules per page)
 * - Proper handling of empty rule sets
 */
@Injectable()
export class ListRulesHandler {
  private readonly logger = new Logger(ListRulesHandler.name);
  private readonly RULES_PER_PAGE = 20;

  // Simple in-memory cache for pagination data
  private paginationCache = new Map<string, { rules: any[]; assetType: RuleAssetType | null }>();

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
      const assetType = interaction.options.getString('asset_type') as RuleAssetType | null;
      
      this.logger.log(`Fetching rules for server: ${interaction.guild.id}`);
      
      // Get all verification rules for the server
      const allRules = await this.dbSvc.getRoleMappings(interaction.guild.id);
      
      this.logger.log(`Found ${allRules?.length || 0} total rules`);
      
      const rules = this.filterAndSortRules(this.withCombinedGroups(allRules), assetType);
      
      this.logger.log(`Filtered to ${rules?.length || 0} rules`);

      if (rules.length === 0) {
        await interaction.editReply({
          embeds: [AdminFeedback.info('Verification Rules', assetType
            ? `No verification rules found for ${ASSET_TYPE_LABELS[assetType]}.`
            : 'No verification rules found.')]
        });
        return;
      }

      // Store rules in cache for pagination
      this.storeRulesForPagination(interaction.user.id, interaction.id, rules, assetType);
      
      // Show first page
      await this.showRulesPage(interaction, rules, 0, false, assetType);

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
    const [, , direction, currentPageStr, listId] = customId.split('-');

    // Get stored rules data
    const cached = this.paginationCache.get(`${userId}:${listId}`);
    if (!cached) {
      await interaction.reply({
        content: '❌ Pagination data expired. Please run the command again.',
        ephemeral: true
      });
      return;
    }

    const currentPage = parseInt(currentPageStr);
    
    let newPage;
    if (direction === 'next') {
      newPage = currentPage + 1;
    } else {
      newPage = currentPage - 1;
    }

    // Show the new page
    await this.showRulesPage(interaction, cached.rules, newPage, true, cached.assetType, listId);
  }

  /**
   * Show a specific page of rules
   */
  private async showRulesPage(
    interaction: ChatInputCommandInteraction | ButtonInteraction, 
    allRules: any[], 
    page: number, 
    isUpdate: boolean = false,
    assetType: RuleAssetType | null = null,
    listId: string = interaction.id
  ): Promise<void> {
    allRules = this.withCombinedGroups(allRules);
    const pages: any[][] = [];
    let current: any[] = [];
    let length = 0;
    for (const rule of allRules) {
      const rowLength = this.formatSingleRule(rule).length;
      if (current.length && (current.length === this.RULES_PER_PAGE || length + 2 + rowLength > 4096)) {
        pages.push(current);
        current = [];
        length = 0;
      }
      length += (current.length ? 2 : 0) + rowLength;
      current.push(rule);
    }
    if (current.length) pages.push(current);
    const totalPages = pages.length;
    page = Math.max(0, Math.min(page, totalPages - 1));
    const rulesForPage = pages[page] || [];
    const startIndex = pages.slice(0, page).reduce((total, rules) => total + rules.length, 0);
    const endIndex = startIndex + rulesForPage.length;

    this.logger.log(`Showing page ${page + 1}/${totalPages} (rules ${startIndex + 1}-${endIndex} of ${allRules.length})`);

    const description = this.formatRulesListForPage(rulesForPage, startIndex);

    // Create navigation buttons
    const buttons = [];
    
    // Previous button (disabled on first page)
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`list-rules-prev-${page}-${listId}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
    );

    // Next button (disabled on last page) 
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`list-rules-next-${page}-${listId}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    const title = `${assetType ? ASSET_TYPE_LABELS[assetType] + ' ' : ''}Verification Rules (Page ${page + 1}/${totalPages})`;
    const footer = `Showing ${rulesForPage.length} of ${allRules.length} total rules`;

    const oversized = description.length > 4096;
    const files = oversized ? [new AttachmentBuilder(Buffer.from(description, 'utf8'), {name: 'rule-criteria.txt'})] : [];
    const embed = AdminFeedback.info(title, oversized ? 'The complete rule criteria exceed Discord’s message limit. See the attached file.' : description)
      .setFooter({ text: footer });

    if (isUpdate && interaction instanceof ButtonInteraction) {
      await interaction.update({
        embeds: [embed],
        attachments: [], files,
        components: [actionRow]
      });
    } else {
      await interaction.editReply({
        embeds: [embed],
        attachments: [], files,
        components: [actionRow]
      });
    }
  }

  /**
   * Store rules data for pagination
   */
  private storeRulesForPagination(userId: string, listId: string, rules: any[], assetType: RuleAssetType | null): void {
    // Keep separate results when an administrator opens multiple filtered lists.
    const cacheKey = `${userId}:${listId}`;
    this.paginationCache.set(cacheKey, { rules, assetType });
    
    // Clear cache after 5 minutes to prevent memory leaks
    const timeout = setTimeout(() => {
      this.paginationCache.delete(cacheKey);
    }, 5 * 60 * 1000);

    // Don't keep the process alive just to evict cached pagination data.
    timeout.unref?.();
  }

  /**
   * Filters out system rules, applies the optional asset type, and sorts by rule ID
   */
  private filterAndSortRules(allRules: any[], assetType: RuleAssetType | null): any[] {
    return allRules
      .filter(rule => rule.server_id !== '000000000000000000')
      .filter(rule => !assetType || (rule.asset_type ?? 'ethscription') === assetType)
      .sort((a, b) => a.id - b.id); // Sort by Rule ID in ascending order
  }

  /**
   * Formats the rules list for a specific page
   */
  private formatRulesListForPage(rules: any[], startIndex: number): string {
    return rules.map(rule => this.formatSingleRule(rule)).join('\n\n');
  }

  /**
   * Adds the shared minimum label to a rule’s criteria
   */
  private formatSingleRule(rule: any): string {
    const row = this.formatRuleCriteria(rule);
    return rule?.combinedGroup ? `${row}\n↳ Combined minimum: **${rule.min_items || 1}** · group **#${rule.combinedGroup.id}** (${rule.combinedGroup.size} rules in this channel)` : row;
  }

  private withCombinedGroups(rules: any[]): any[] {
    const groups = new Map<string, any[]>();
    for (const rule of rules) {
      if (rule.asset_type === 'erc20' || !rule.role_id || rule.server_id === '000000000000000000') continue;
      const key = JSON.stringify([rule.server_id, rule.channel_id, rule.role_id, rule.min_items || 1]);
      groups.set(key, [...(groups.get(key) || []), rule]);
    }
    return rules.map(rule => {
      const key = JSON.stringify([rule.server_id, rule.channel_id, rule.role_id, rule.min_items || 1]);
      const group = groups.get(key);
      if (rule.asset_type === 'erc20' || !group || group.length < 2) return rule;
      return { ...rule, combinedGroup: rule.combinedGroup || { id: Math.min(...group.map(item => item.id)), size: group.length } };
    });
  }

  private formatRuleCriteria(rule: any): string {
    if (!rule) {
      return 'Invalid rule data';
    }

    try {
      if (rule.asset_type === 'erc20') return `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | Token: ${tokenRuleCriteria(rule)} | Contract: ${rule.contract_address}`;
      if (rule.inscription_criteria) return `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | Inscriptions: ${inscriptionRuleScope(rule)} | Min: ${rule.min_items || 1}`;
      if (rule.asset_type === 'nft' || rule.asset_type === 'ordinal') return `ID: ${rule.id} | Channel: <#${rule.channel_id}> | Role: <@&${rule.role_id}> | Collection: ${rule.asset_type === 'ordinal' ? ordinalRuleCriteria(rule) : nftRuleCriteria(rule)}`;
      const attribute = (ruleTraits(rule)?.conditions.length || 0) > 1 ? traitFilterLabel(rule) : formatAttribute(singleTrait(rule).key, singleTrait(rule).value);
      const slug = rule.slug || 'ALL';
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
