import { Injectable } from '@nestjs/common';
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { ordinalCollectionId } from '@/utils/ordinal-rule.util';
import { DbService } from '../../db.service';
import { OrdinalsOwnershipService } from '../../ordinals-ownership.service';
import { AdminFeedback } from '../../utils/admin-feedback.util';

@Injectable()
export class RefreshCollectionHandler {
  constructor(private readonly db: DbService, private readonly ordinals: OrdinalsOwnershipService) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const slug = ordinalCollectionId(interaction.options.getString('collection_slug', true));
      const rules = await this.db.getRoleMappings(interaction.guildId);
      if (!rules.some(rule => rule.asset_type === 'ordinal' && rule.slug === slug)) {
        throw new Error('This server has no Ordinals collection rule for that slug.');
      }
      await interaction.editReply({ content: 'Refreshing collection metadata. Existing verification remains available while the scan runs.' });
      const result = await this.ordinals.refreshCollection(slug);
      await interaction.editReply({ content: '', embeds: [AdminFeedback.success('Collection Metadata Refreshed',
        `Updated ${result.count.toLocaleString()} inscriptions and their traits for **${result.slug}**. Wallet ownership is checked separately during verification.`)] });
    } catch (error) {
      await interaction.editReply({ content: AdminFeedback.simple(error.message || 'Collection metadata could not be refreshed.', true), embeds: [] });
    }
  }
}
