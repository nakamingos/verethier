import { Injectable, Logger } from '@nestjs/common';
import {
  ActionRowBuilder, AttachmentBuilder, AutocompleteInteraction, ButtonBuilder, ButtonInteraction, ButtonStyle,
  ChatInputCommandInteraction, escapeMarkdown, MessageFlags, ModalBuilder, ModalSubmitInteraction,
  PermissionFlagsBits, TextInputBuilder, TextInputStyle
} from 'discord.js';
import { DbService } from '../../db.service';
import { DynamicRoleService } from '../../dynamic-role.service';
import { RuleEditService } from '../../rule-edit.service';
import { VerifierRole } from '@/models/verifier-role.interface';
import { ruleEditFields, ruleEditSummary, ruleEditVersion, splitRuleEditList } from '@/utils/rule-edit.util';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { ordinalTrait, ordinalTraitHash, usableOrdinalTraitSnapshot } from '@/utils/ordinal-rule.util';

interface EditSession {
  owner: string; server: string; before: VerifierRole; after?: VerifierRole;
  stage: 'form' | 'validating' | 'preview' | 'saving'; expires: number;
}

@Injectable()
export class EditRuleHandler {
  private readonly logger = new Logger(EditRuleHandler.name);
  private readonly sessions = new Map<string, EditSession>();
  private readonly TTL = 10 * 60 * 1000;
  constructor(private readonly db: DbService, private readonly editor: RuleEditService, private readonly roles: DynamicRoleService) { }

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    try {
      const id = interaction.options.getString('rule_id', true).trim();
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Enter one valid rule ID from /setup list-rules.');
      const before = await this.db.getRuleForServer(id, interaction.guildId);
      if (!before || before.server_id !== interaction.guildId) throw new Error('This rule was not found in this server.');
      const modal = new ModalBuilder().setCustomId(`edit-rule-form-${interaction.id}`).setTitle(`Edit rule ${id}`);
      for (const field of ruleEditFields(before)) {
        const values = field.list ? splitRuleEditList(field.value) : [field.value];
        for (const [index, value] of values.entries()) {
          if (value.length > (field.maxLength || 4000)) throw new Error('An existing value is too long for this form. The rule has not changed.');
          const input = new TextInputBuilder().setCustomId(index ? `${field.key}_continued` : field.key)
            .setLabel(index ? `${field.label} (continued)`.slice(0, 45) : field.label)
            .setStyle(field.list ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(field.required === true).setMaxLength(field.maxLength || 4000);
          if (value) input.setValue(value);
          if (index) input.setPlaceholder('Optional continuation of the comma-separated list');
          modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        }
      }
      if (modal.components.length > 5) throw new Error('This rule has too many fields for the editor. The rule has not changed.');
      this.expireSessions();
      if (this.sessions.size >= 200) throw new Error('Too many rule editors are open. Please try again shortly.');
      this.sessions.set(interaction.id, { owner: interaction.user.id, server: interaction.guildId, before: structuredClone(before), stage: 'form', expires: Date.now() + this.TTL });
      const timeout = setTimeout(() => this.expireSessions(), this.TTL + 1000); timeout.unref?.();
      try { await interaction.showModal(modal); } catch (error) { this.sessions.delete(interaction.id); throw error; }
    } catch (error) {
      await interaction.reply({ content: `❌ ${this.safe(error.message)}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.respond([]);
    try {
      const search = String(interaction.options.getFocused()).toLowerCase().trim();
      const rules = await this.db.getRoleMappings(interaction.guildId);
      await interaction.respond(rules.filter(rule => `${rule.id} ${rule.role_name || ''} ${rule.slug || rule.collection_name || ''}`.toLowerCase().includes(search))
        .sort((a, b) => b.id - a.id).slice(0, 25).map(rule => ({ name: `${rule.id} · ${rule.role_name || 'Role'} · ${rule.asset_type || 'ethscription'}`.replace(/[\r\n\t]/g, ' ').slice(0, 100), value: String(rule.id) })));
    } catch { await interaction.respond([]); }
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    const key = interaction.customId.replace(/^edit-rule-form-/, '');
    const session = await this.session(interaction, key, 'form', 'validating'); if (!session) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const inputs: Record<string, string> = {};
      for (const field of ruleEditFields(session.before)) {
        const first = interaction.fields.getTextInputValue(field.key).trim();
        const next = field.list ? interaction.fields.getTextInputValue(`${field.key}_continued`).trim() : '';
        inputs[field.key] = field.list ? [first, next].filter(Boolean).join(',') : first;
      }
      const after = await this.editor.prepare(session.before, inputs);
      if (ruleEditVersion(after) === ruleEditVersion(session.before)) throw new Error('No rule requirements changed.');
      const conflicts = this.editor.duplicates(after, await this.db.getRoleMappings(session.server));
      if (conflicts.exact) throw new Error(`This would duplicate rule ${conflicts.exact.id}. The edit was not saved.`);
      session.after = after; session.stage = 'preview'; session.expires = Date.now() + this.TTL;
      const timeout = setTimeout(() => this.expireSessions(), this.TTL + 1000); timeout.unref?.();
      const oldText = ruleEditSummary(session.before), newText = ruleEditSummary(after);
      const long = escapeMarkdown(oldText).length > 1000 || escapeMarkdown(newText).length > 1000;
      let description = `Rule **${after.id}** · <#${after.channel_id}> · <@&${after.role_id}>\nReview the changes, then Save or Cancel. Previously earned roles will be rechecked.`;
      if (conflicts.shared.length) description += `\nThese requirements also match rule(s) ${conflicts.shared.slice(0, 5).map(rule => rule.id).join(', ')} for other roles.`;
      if (long) description += '\nComplete before/after values are attached.';
      const embed = AdminFeedback.info('Review Rule Edit', description, [
        { name: 'Before', value: this.safe(oldText, 1000, true), inline: false },
        { name: 'After', value: this.safe(newText, 1000, true), inline: false },
      ]);
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`edit-rule-save-${key}`).setLabel('Save').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`edit-rule-cancel-${key}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
      const files = long ? [new AttachmentBuilder(Buffer.from(`Rule ${after.id}\n\nBefore\n${oldText}\n\nAfter\n${newText}\n`), { name: `rule-${after.id}-changes.txt` })] : [];
      await interaction.editReply({ embeds: [embed], components: [buttons], files, allowedMentions: { parse: [] } });
    } catch (error) {
      this.sessions.delete(key);
      await interaction.editReply({ content: `❌ ${this.safe(error.message)} Run \`/setup edit-rule\` again to retry.`, embeds: [], components: [], allowedMentions: { parse: [] } });
    }
  }

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    const match = /^edit-rule-(save|cancel)-(.+)$/.exec(interaction.customId);
    const session = await this.session(interaction, match?.[2], 'preview', 'saving'); if (!session) return;
    if (match[1] === 'cancel') {
      this.sessions.delete(match[2]);
      await interaction.update({ content: 'Rule edit canceled.', embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } }); return;
    }
    await interaction.deferUpdate();
    let saved: VerifierRole;
    try {
      const current = await this.db.getRuleForServer(String(session.before.id), session.server);
      if (!current || ruleEditVersion(current) !== ruleEditVersion(session.before)) throw new Error('The rule changed or was removed while this editor was open. Run /setup edit-rule again.');
      const duplicates = this.editor.duplicates(session.after, await this.db.getRoleMappings(session.server));
      if (duplicates.exact) throw new Error(`An identical rule (${duplicates.exact.id}) now exists. The edit was not saved.`);
      // Include current snapshot updates when criteria are unchanged, otherwise
      // commit the newly validated snapshot (or clear it when traits were removed).
      if (session.after.asset_type === 'ordinal' && !session.after.inscription_criteria && ordinalTrait(session.after).enabled
        && ordinalTraitHash(session.before) === ordinalTraitHash(session.after)) {
        const latest = usableOrdinalTraitSnapshot(current);
        if (latest && (!session.after.ordinal_trait_snapshot || Date.parse(latest.fetched_at) > Date.parse(session.after.ordinal_trait_snapshot.fetched_at))) {
          session.after.ordinal_trait_snapshot = latest;
        }
      }
      saved = await this.db.editRule(session.before, session.after);
    } catch (error) {
      this.sessions.delete(match[2]);
      await interaction.editReply({ content: `❌ ${this.safe(error.message)}`, embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } });
      return;
    }
    this.sessions.delete(match[2]);
    try {
      await interaction.editReply({ embeds: [AdminFeedback.success('Rule Updated', `Rule **${saved.id}** was saved. Rechecking members who previously earned <@&${saved.role_id}>…`)], components: [], attachments: [], allowedMentions: { parse: [] } });
    } catch (error) { this.logger.warn(`Rule ${saved.id} saved; progress reply failed: ${error.message}`); }
    let result;
    try { result = await this.roles.reverifyRoleInServer(saved.server_id, saved.role_id); }
    catch (error) { this.logger.warn(`Rule ${saved.id} saved; immediate role checks failed: ${error.message}`); result = { errors: 1, verified: 0, revoked: 0 }; }
    const description = result.errors
      ? `Rule **${saved.id}** was saved. Some role checks could not finish; scheduled checks will retry.`
      : `Rule **${saved.id}** was saved. Previously earned roles were rechecked: ${result.verified} qualifying, ${result.revoked} not qualifying.`;
    try {
      await interaction.editReply({ embeds: [result.errors ? AdminFeedback.warning('Rule Updated', description) : AdminFeedback.success('Rule Updated', description)], allowedMentions: { parse: [] } });
    } catch (error) { this.logger.warn(`Rule ${saved.id} saved; final reply failed: ${error.message}`); }
  }

  private async authorized(interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction): Promise<boolean> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '🚫 Administrator permissions in a server are required.', flags: MessageFlags.Ephemeral }); return false;
    }
    return true;
  }
  private expireSessions(): void { for (const [key, session] of this.sessions) if (session.expires <= Date.now()) this.sessions.delete(key); }
  private async session(interaction: ModalSubmitInteraction | ButtonInteraction, key: string, stage: EditSession['stage'], next: EditSession['stage']): Promise<EditSession | null> {
    this.expireSessions(); const session = this.sessions.get(key);
    if (!session || session.owner !== interaction.user.id || session.server !== interaction.guildId || session.stage !== stage) {
      await interaction.reply({ content: 'This edit session is unavailable. Run `/setup edit-rule` to open your own editor.', flags: MessageFlags.Ephemeral }); return null;
    }
    // Claim the stage before yielding; simultaneous submissions cannot both save.
    session.stage = next;
    return session;
  }
  private safe(text: string, limit = 500, multiline = false): string {
    const escaped = escapeMarkdown((text || 'Could not edit the rule. Please try again.').replace(multiline ? /[\r\t]/g : /[\r\n\t]/g, ' '));
    return escaped.length > limit ? escaped.slice(0, limit - 1) + '…' : escaped;
  }
}
