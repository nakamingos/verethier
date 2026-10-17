import { normalizeCollectionSlug, normalizeCriteriaOption, matchCaseInsensitive } from '@/utils/collection-input.util';
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
  const slug = normalizeCollectionSlug(interaction.options.getString('slug')) || 'ALL';
  const attributeKey = normalizeCriteriaOption(interaction.options.getString('attribute_key'));
  const attributeValue = normalizeCriteriaOption(interaction.options.getString('attribute_value'));
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

export async function resolveEthscriptionSlug(dataSvc: DataService, input: string): Promise<string | undefined> {
  const normalized = normalizeCollectionSlug(input);
  if (!normalized || normalized === 'all') return 'ALL';
  return matchCaseInsensitive(await dataSvc.getAllSlugs(), normalized);
}

export interface EthscriptionCriteriaValidation {
  isValid: boolean;
  message: string;
  criteria?: { slug: string; attributeKey: string; attributeValue: string };
}

export async function validateEthscriptionCriteria(dataSvc: DataService, slug: string, attributeKey: string, attributeValue: string): Promise<EthscriptionCriteriaValidation> {
  slug = normalizeCollectionSlug(slug) || 'all';
  attributeKey = normalizeCriteriaOption(attributeKey);
  attributeValue = normalizeCriteriaOption(attributeValue);
  if (slug.includes(',')) return {
    isValid: false,
    message: 'Use one collection per rule. Add another rule with the same role and minimum to combine holdings.'
  };
  try {
    const canonicalSlug = await resolveEthscriptionSlug(dataSvc, slug);
    if (!canonicalSlug) return { isValid: false, message: `Collection "${slug}" does not exist in the marketplace database.` };
    slug = canonicalSlug;
    if (attributeKey !== 'ALL') {
      const keys = await dataSvc.getAttributeKeys(slug);
      const canonicalKey = matchCaseInsensitive(keys, attributeKey);
      if (!canonicalKey) return { isValid: false, message: `Attribute key "${attributeKey}" does not exist for collection "${slug}".` };
      attributeKey = canonicalKey;
    }
    if (attributeValue !== 'ALL') {
      if (attributeKey === 'ALL') return {
        isValid: false, message: 'Cannot specify an attribute value without specifying an attribute key first.'
      };
      const values = await dataSvc.getAllAttributeValues(attributeKey, slug);
      const canonicalValue = matchCaseInsensitive(values, attributeValue);
      if (!canonicalValue) return { isValid: false, message: `Attribute value "${attributeValue}" does not exist for attribute key "${attributeKey}" in collection "${slug}".` };
      attributeValue = canonicalValue;
    }
    return { isValid: true, message: '', criteria: { slug, attributeKey, attributeValue } };
  } catch (error) {
    Logger.error('Error validating input combinations:', error);
    return { isValid: false, message: 'Error validating options against database. Please try again.' };
  }
}
