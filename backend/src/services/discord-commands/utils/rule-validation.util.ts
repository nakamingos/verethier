import { Logger } from '@nestjs/common';
import type { DataService } from '../../data.service';
import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { AdminFeedback } from '../../utils/admin-feedback.util';

/**
 * Rule Validation Utilities
 *
 * Common validation functions for rule creation and management
 */

/**
 * Validates basic input parameters for rule creation.
 * @returns Input parameters if valid, null if validation failed (error already sent to user)
 */
export async function validateRuleInputParams(interaction: ChatInputCommandInteraction): Promise<{
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
 * Formats attribute key/value pairs for display
 */
export function formatAttribute(key: string, value: string): string {
  if (key !== 'ALL' && value !== 'ALL') return `${key}=${value}`;
  if (key !== 'ALL' && value === 'ALL') return `${key} (any value)`;
  if (key === 'ALL' && value !== 'ALL') return `ALL=${value}`;
  return 'ALL';
}

export async function validateEthscriptionCriteria(dataSvc: DataService, slug: string, attributeKey: string, attributeValue: string): Promise<{ isValid: boolean; message: string }> {

  if (slug.includes(',')) return {
    isValid: false,
    message: 'Use one collection per rule. Add another rule with the same role and minimum to combine holdings.'
  };

  // If all options are 'ALL', no validation needed
  if (slug === 'ALL' && attributeKey === 'ALL' && attributeValue === 'ALL') {
    return { isValid: true, message: '' };
  }

  try {
    if (slug !== 'ALL') {
      const availableSlugs = await dataSvc.getAllSlugs();
      if (!availableSlugs.includes(slug)) return {
        isValid: false, message: `Collection "${slug}" does not exist in the marketplace database.`
      };
    }

    // Validate attribute key exists for the selected collection
    if (attributeKey !== 'ALL') {
      if (slug === 'ALL') {
        // If no specific collection, check if attribute key exists across all collections
        const allKeys = await dataSvc.getAttributeKeys('ALL');
        if (!allKeys.includes(attributeKey)) {
          return {
            isValid: false,
            message: `Attribute key "${attributeKey}" does not exist in any collection.`
          };
        }
      } else {
        // Check if attribute key exists for the specific collection
        const keysForCollection = await dataSvc.getAttributeKeys(slug);
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
        valuesForKey = await dataSvc.getAllAttributeValues(attributeKey, 'ALL');
      } else {
        // Get ALL values for specific collection and attribute key (not just rarest 25)
        valuesForKey = await dataSvc.getAllAttributeValues(attributeKey, slug);
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
    Logger.error('Error validating input combinations:', error);
    return {
      isValid: false,
      message: 'Error validating options against database. Please try again.'
    };
  }
}
