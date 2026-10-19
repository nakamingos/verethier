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
import { ruleCriteriaKey, ruleEditFields, ruleEditSummary, ruleEditVersion, splitRuleEditList } from '@/utils/rule-edit.util';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { ordinalTrait, ordinalTraitHash, usableOrdinalTraitSnapshot } from '@/utils/ordinal-rule.util';
import { ruleTraits } from '@/utils/trait-filter.util';

interface EditSession {
  owner: string; server: string; before: VerifierRole; after?: VerifierRole;
  current?: VerifierRole;
  revision: number;
  stage: 'form' | 'validating' | 'preview' | 'saving' | 'saved' | 'undone'; expires: number;
}

type EditAction = 'save' | 'undo' | 'redo';

@Injectable()
export class EditRuleHandler {
  private readonly logger = new Logger(EditRuleHandler.name);
  private readonly sessions = new Map<string, EditSession>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly TTL = 10 * 60 * 1000;
  private readonly UNDO_TTL = 5 * 60 * 1000;
  constructor(private readonly db: DbService, private readonly editor: RuleEditService, private readonly roles: DynamicRoleService) { }

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    try {
      const id = interaction.options.getString('rule_id', true).trim();
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Enter one valid rule ID from /setup list-rules.');
      const before = await this.db.getRuleForServer(id, interaction.guildId);
      if (!before || before.server_id !== interaction.guildId) throw new Error('This rule was not found in this server.');
      if ((ruleTraits(before)?.conditions.length || 0) > 1) throw new Error('This rule has multiple trait conditions. Edit it in the web Control Room to preserve the complete filter.');
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
      const session: EditSession = { owner: interaction.user.id, server: interaction.guildId, before: structuredClone(before), revision: 0, stage: 'form', expires: 0 };
      this.sessions.set(interaction.id, session);
      this.renewSession(interaction.id, session, this.TTL);
      try { await interaction.showModal(modal); } catch (error) { this.dropSession(interaction.id); throw error; }
    } catch (error) {
      await interaction.reply({ content: `❌ ${this.safe(error.message)}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.respond([]);
    try {
      const search = String(interaction.options.getFocused()).toLowerCase().trim();
      const rules = await this.db.getRoleMappings(interaction.guildId);
      await interaction.respond(rules.filter(rule => `${rule.id} ${rule.role_name || ''} ${rule.slug || rule.collection_name || ''} ${rule.rule_label || ''}`.toLowerCase().includes(search))
        .sort((a, b) => b.id - a.id).slice(0, 25).map(rule => ({ name: `${rule.id} · ${rule.role_name || 'Role'}${rule.rule_label ? ' · ' + rule.rule_label : ''} · ${rule.asset_type || 'ethscription'}`.replace(/[\r\n\t]/g, ' ').slice(0, 100), value: String(rule.id) })));
    } catch { await interaction.respond([]); }
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    const key = interaction.customId.replace(/^edit-rule-form-/, '');
    const session = await this.session(interaction, key, 'form', 'validating'); if (!session) return;
    let acknowledged = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      acknowledged = true;
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
      session.after = after; session.stage = 'preview';
      this.renewSession(key, session, this.TTL);
      const oldText = ruleEditSummary(session.before), newText = ruleEditSummary(after);
      const long = escapeMarkdown(oldText).length > 1000 || escapeMarkdown(newText).length > 1000;
      let description = `Rule **${after.id}** · <#${after.channel_id}> · <@&${after.role_id}>\nReview the changes, then Save or Cancel. ${ruleCriteriaKey(after) === ruleCriteriaKey(session.before) ? 'Only the label changes; verification requirements stay the same.' : 'Previously earned roles will be rechecked.'}`;
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
      this.dropSession(key);
      const payload = { content: `❌ ${this.safe(error.message)} Run \`/setup edit-rule\` again to retry.`, embeds: [], components: [], allowedMentions: { parse: [] } };
      if (acknowledged || interaction.deferred) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  }

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!await this.authorized(interaction)) return;
    const history = /^edit-rule-(undo|redo)-(.+)-(\d+)$/.exec(interaction.customId);
    if (history) {
      const action = history[1] as 'undo' | 'redo';
      const session = await this.session(interaction, history[2], action === 'undo' ? 'saved' : 'undone', 'saving', Number(history[3]));
      if (session) await this.applyChange(interaction, history[2], session, action);
      return;
    }
    const match = /^edit-rule-(save|cancel)-(.+)$/.exec(interaction.customId);
    const session = await this.session(interaction, match?.[2], 'preview', 'saving'); if (!session) return;
    if (match[1] === 'cancel') {
      this.dropSession(match[2]);
      await interaction.update({ content: 'Rule edit canceled.', embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } }); return;
    }
    await this.applyChange(interaction, match[2], session, 'save');
  }

  private async applyChange(interaction: ButtonInteraction, key: string, session: EditSession, action: EditAction): Promise<void> {
    const expected = action === 'save' ? session.before : session.current;
    const target = action === 'undo' ? session.before : session.after;
    const previousStage = action === 'save' ? 'preview' : action === 'undo' ? 'saved' : 'undone';
    let invalidate = action === 'save';
    let acknowledged = false;
    let saved: VerifierRole;
    try {
      await interaction.deferUpdate();
      acknowledged = true;
      const current = await this.db.getRuleForServer(String(expected.id), session.server);
      if (!current || ruleEditVersion(current) !== ruleEditVersion(expected)) {
        invalidate = true;
        throw new Error('The rule changed or was removed after your last action. Run /setup edit-rule again.');
      }
      const candidate = this.definitionWithSnapshot(target, current);
      const duplicates = this.editor.duplicates(candidate, await this.db.getRoleMappings(session.server));
      if (duplicates.exact) throw new Error(`An identical rule (${duplicates.exact.id}) now exists. This action was not applied.`);
      saved = await this.db.editRule(expected, candidate);
    } catch (error) {
      if (invalidate) this.dropSession(key);
      else {
        session.stage = previousStage;
        this.renewSession(key, session, this.UNDO_TTL);
      }
      const payload = { content: `❌ ${this.safe(error.message)}`, embeds: [],
        components: invalidate ? [] : [this.historyButton(key, session)], attachments: [], allowedMentions: { parse: [] } };
      try {
        if (acknowledged || interaction.deferred) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      } catch (responseError) { this.logger.warn(`Rule ${expected.id} ${action} failed; feedback failed: ${responseError.message}`); }
      return;
    }

    // Keep both definitions so each successful action offers its inverse.
    // The last written definition guards every subsequent atomic update.
    session.current = structuredClone(saved);
    if (action === 'undo') session.before = structuredClone(saved);
    else session.after = structuredClone(saved);
    session.revision++;
    const title = action === 'undo' ? 'Rule Edit Undone' : action === 'redo' ? 'Rule Edit Redone' : 'Rule Updated';
    const status = action === 'undo' ? 'now uses its original requirements' : action === 'redo' ? 'now uses its edited requirements' : 'was saved';
    const nextStage = action === 'undo' ? 'undone' : 'saved';
    if (ruleCriteriaKey(expected) === ruleCriteriaKey(saved)) {
      session.stage = nextStage;
      this.renewSession(key, session, this.UNDO_TTL);
      const labelStatus = action === 'undo' ? 'label was restored' : action === 'redo' ? 'label change was reapplied' : 'label was saved';
      const embed = AdminFeedback.success(title, `Rule **${saved.id}** ${labelStatus}. Verification requirements stay the same.`);
      embed.setFooter({text: 'Undo/Redo is available for 5 minutes after each action.'});
      try {
        await interaction.editReply({content: '', embeds: [embed], components: [this.historyButton(key, session)], attachments: [], allowedMentions: {parse: []}});
      } catch (error) { this.logger.warn(`Rule ${saved.id} label ${action} applied; final reply failed: ${error.message}`); }
      return;
    }
    try {
      await interaction.editReply({ content: '', embeds: [AdminFeedback.success(title, `Rule **${saved.id}** ${status}. Rechecking members who previously earned <@&${saved.role_id}>…`)],
        components: [], attachments: [], allowedMentions: { parse: [] } });
    } catch (error) { this.logger.warn(`Rule ${saved.id} ${action} applied; progress reply failed: ${error.message}`); }
    let result: { verified: number; revoked: number; errors: number };
    try { result = await this.roles.reverifyRoleInServer(saved.server_id, saved.role_id); }
    catch (error) { this.logger.warn(`Rule ${saved.id} ${action} applied; immediate role checks failed: ${error.message}`); result = { errors: 1, verified: 0, revoked: 0 }; }
    session.stage = nextStage;
    this.renewSession(key, session, this.UNDO_TTL);
    const description = `Rule **${saved.id}** ${status}. ` + (result.errors
      ? 'Some role checks could not finish; scheduled checks will retry.'
      : `Previously earned roles were rechecked: ${result.verified} qualifying, ${result.revoked} not qualifying.`);
    try {
      const embed = result.errors ? AdminFeedback.warning(title, description) : AdminFeedback.success(title, description);
      embed.setFooter({ text: 'Undo/Redo is available for 5 minutes after each action.' });
      await interaction.editReply({ content: '', embeds: [embed], components: [this.historyButton(key, session)], attachments: [], allowedMentions: { parse: [] } });
    } catch (error) { this.logger.warn(`Rule ${saved.id} ${action} applied; final reply failed: ${error.message}`); }
  }

  /** Reuse validated definitions; ownership checks refresh stale trait data. */
  private definitionWithSnapshot(target: VerifierRole, current: VerifierRole): VerifierRole {
    const candidate = structuredClone(target);
    if (candidate.asset_type === 'ordinal' && !candidate.inscription_criteria) {
      candidate.ordinal_trait_snapshot = null;
      if (ordinalTrait(candidate).enabled) {
        const saved = usableOrdinalTraitSnapshot(target);
        const latest = ordinalTraitHash(current) === ordinalTraitHash(target) ? usableOrdinalTraitSnapshot(current) : null;
        candidate.ordinal_trait_snapshot = latest && (!saved || Date.parse(latest.fetched_at) > Date.parse(saved.fetched_at)) ? latest : saved;
      }
    }
    return candidate;
  }

  private historyButton(key: string, session: EditSession): ActionRowBuilder<ButtonBuilder> {
    const undo = session.stage === 'saved';
    return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
      .setCustomId(`edit-rule-${undo ? 'undo' : 'redo'}-${key}-${session.revision}`)
      .setLabel(undo ? 'Undo' : 'Redo').setEmoji(undo ? '↩️' : '↪️')
      .setStyle(undo ? ButtonStyle.Danger : ButtonStyle.Primary));
  }

  private renewSession(key: string, session: EditSession, ttl: number): void {
    clearTimeout(this.expiryTimers.get(key));
    session.expires = Date.now() + ttl;
    const timeout = setTimeout(() => {
      if (this.sessions.get(key) === session && session.expires <= Date.now()) this.dropSession(key);
    }, ttl + 1000);
    timeout.unref?.();
    this.expiryTimers.set(key, timeout);
  }

  private dropSession(key: string): void {
    clearTimeout(this.expiryTimers.get(key));
    this.expiryTimers.delete(key);
    this.sessions.delete(key);
  }

  private expireSessions(): void {
    for (const [key, session] of this.sessions) {
      if (session.stage !== 'saving' && session.stage !== 'validating' && session.expires <= Date.now()) this.dropSession(key);
    }
  }

  private async authorized(interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction): Promise<boolean> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '🚫 Administrator permissions in a server are required.', flags: MessageFlags.Ephemeral }); return false;
    }
    return true;
  }
  private async session(interaction: ModalSubmitInteraction | ButtonInteraction, key: string, stage: EditSession['stage'], next: EditSession['stage'], revision?: number): Promise<EditSession | null> {
    this.expireSessions(); const session = this.sessions.get(key);
    if (!session || session.owner !== interaction.user.id || session.server !== interaction.guildId || session.stage !== stage
      || (revision !== undefined && revision !== session.revision)) {
      await interaction.reply({ content: 'This edit session is unavailable. Run `/setup edit-rule` to open your own editor.', flags: MessageFlags.Ephemeral }); return null;
    }
    // Claim the stage before yielding; simultaneous submissions cannot both save.
    session.stage = next;
    clearTimeout(this.expiryTimers.get(key));
    this.expiryTimers.delete(key);
    return session;
  }
  private safe(text: string, limit = 500, multiline = false): string {
    const escaped = escapeMarkdown((text || 'Could not edit the rule. Please try again.').replace(multiline ? /[\r\t]/g : /[\r\n\t]/g, ' '));
    return escaped.length > limit ? escaped.slice(0, limit - 1) + '…' : escaped;
  }
}
