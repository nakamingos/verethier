import { nftRuleCriteria } from '@/utils/nft-rule.util';
import { EmbedBuilder, Colors } from 'discord.js';
import { VerificationRule } from '@/models/verification-rule.interface';

/**
 * Standardized admin feedback message utility
 * Color scheme:
 * - Green (0x00FF00): Success messages
 * - Red (0xFF0000): Error messages  
 * - Lime (0xC3FF00): Neutral/info messages
 * - Orange (0xFFA500): Warning messages
 */
export class AdminFeedback {
  
  /**
   * Success message with consistent formatting
   */
  static success(title: string, description?: string, fields?: Array<{name: string, value: string, inline?: boolean}>): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00) // Green
      .setTitle(`✅ ${title}`);
    
    if (description) {
      embed.setDescription(description);
    }
    
    if (fields) {
      embed.addFields(fields);
    }
    
    return embed;
  }

  /**
   * Error message with consistent formatting and guidance
   */
  static error(
    title: string, 
    description: string, 
    actions?: string[], 
    fields?: Array<{name: string, value: string, inline?: boolean}>
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000) // Red
      .setTitle(`❌ ${title}`)
      .setDescription(description);
    
    if (fields) {
      embed.addFields(fields);
    }
    
    if (actions && actions.length > 0) {
      const actionText = actions.map(action => `• ${action}`).join('\n');
      embed.addFields({
        name: '💡 What you can do:',
        value: actionText,
        inline: false
      });
    }
    
    return embed;
  }

  /**
   * Info/neutral message with consistent formatting
   */
  static info(title: string, description?: string, fields?: Array<{name: string, value: string, inline?: boolean}>): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xC3FF00) // Lime
      .setTitle(`📋 ${title}`);
    
    if (description) {
      embed.setDescription(description);
    }
    
    if (fields) {
      embed.addFields(fields);
    }
    
    return embed;
  }

  /**
   * Warning message with consistent formatting
   */
  static warning(
    title: string, 
    description: string, 
    actions?: string[], 
    fields?: Array<{name: string, value: string, inline?: boolean}>
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xFFA500) // Orange
      .setTitle(`⚠️ ${title}`)
      .setDescription(description);
    
    if (fields) {
      embed.addFields(fields);
    }
    
    if (actions && actions.length > 0) {
      const actionText = actions.map(action => `• ${action}`).join('\n');
      embed.addFields({
        name: '💡 What you can do:',
        value: actionText,
        inline: false
      });
    }
    
    return embed;
  }

  /**
   * Destructive action message with consistent formatting (red color)
   */
  static destructive(title: string, description?: string, fields?: Array<{name: string, value: string, inline?: boolean}>): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000) // Red
      .setTitle(`🗑️ ${title}`);
    
    if (description) {
      embed.setDescription(description);
    }
    
    if (fields) {
      embed.addFields(fields);
    }
    
    return embed;
  }

  /**
   * Simple text message for basic responses
   */
  static simple(message: string, isError: boolean = false): string {
    const emoji = isError ? '❌' : '✅';
    return `${emoji} ${message}`;
  }

  /**
   * Format rule details consistently
   */
  static formatRule(rule: VerificationRule, title?: string): string {
    const formatAttribute = (key: string, value: string) => {
      if (key !== 'ALL' && value !== 'ALL') return `${key}=${value}`;
      if (key !== 'ALL' && value === 'ALL') return `${key} (any value)`;
      if (key === 'ALL' && value !== 'ALL') return `ANY_KEY=${value}`;
      return 'ALL';
    };

    let result = '';
    if (title) {
      result += `**${title}**\n`;
    }
    
    result += `**Role:** <@&${rule.role_id}>\n`;
    if (rule.asset_type === 'nft') return result + `**Collection:** ${nftRuleCriteria(rule)}\n**Contract:** ${rule.contract_address}`;
    result += `**Collection:** ${rule.slug}\n`;
    result += `**Attribute:** ${formatAttribute(rule.attribute_key, rule.attribute_value)}\n`;
    result += `**Min Items:** ${rule.min_items}`;
    
    return result;
  }

  /**
   * Format multiple rules with separators
   */
  static formatRuleList(rules: VerificationRule[], channelName?: string): EmbedBuilder {
    const title = channelName ? `Verification Rules for #${channelName}` : 'Verification Rules';
    
    if (rules.length === 0) {
      return AdminFeedback.info(title, 'No verification rules found for this channel.\nUse `/setup add-rule` to create your first rule!');
    }

    const description = rules.map((rule, index) => {
      const ruleText = AdminFeedback.formatRule(rule, `Rule ${index + 1}:`);
      return index < rules.length - 1 ? `${ruleText}\n${'─'.repeat(25)}` : ruleText;
    }).join('\n\n');

    return AdminFeedback.info(title, description);
  }
}
