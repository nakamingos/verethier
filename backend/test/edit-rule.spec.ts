import { PermissionFlagsBits } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { VerifierRole } from '../src/models/verifier-role.interface';
import { EditRuleHandler } from '../src/services/discord-commands/handlers/edit-rule.handler';
import { RuleEditService } from '../src/services/rule-edit.service';
import { DbService } from '../src/services/db.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { parseInscriptionCriteria } from '../src/utils/inscription-rule.util';
import { ordinalTraitHash } from '../src/utils/ordinal-rule.util';
import { compactTokenIds, ruleCriteriaKey, ruleEditFields, ruleEditVersion, splitRuleEditList } from '../src/utils/rule-edit.util';

const base: VerifierRole = {
  id: 173, server_id: 'guild', server_name: 'Guild', channel_id: 'verify', channel_name: 'Verify',
  role_id: 'holder', role_name: 'Holder', asset_type: 'ethscription', slug: 'comrades', attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1
};
const nft: VerifierRole = {
  ...base, asset_type: 'nft', slug: null, chain_id: 46630, contract_address: '0x' + 'a'.repeat(40),
  token_standard: 'erc1155', token_ids: ['0', '1', '2'], collection_name: 'NFT Collection'
};
const ordinal: VerifierRole = { ...base, asset_type: 'ordinal', slug: 'pizza-comrades', attribute_key: 'Category', attribute_value: 'Cosmic Oven-Lord' };
const token: VerifierRole = {
  ...nft, asset_type: 'erc20', min_items: null, token_standard: null, token_ids: null,
  min_balance: '500000', token_decimals: 6, token_symbol: 'TEST'
};
const numbers: VerifierRole = {
  ...base, asset_type: 'ordinal', slug: null,
  inscription_criteria: { kind: 'numbers', ranges: [[97308505, 97308527]] }
};
const inscriptionId = (n: number) => n.toString(16).padStart(64, '0') + 'i0';
const snapshot = (rule = ordinal, fetched = new Date(Date.now() - 1000).toISOString()) => ({
  criteria_hash: ordinalTraitHash(rule), fetched_at: fetched, inscription_ids: [inscriptionId(1)]
});
function inputs(rule: VerifierRole) { return Object.fromEntries(ruleEditFields(rule).map(field => [field.key, field.value])); }

function editor() {
  const data = {
    getAllSlugs: jest.fn().mockResolvedValue(['comrades', 'other']), getAttributeKeys: jest.fn().mockResolvedValue(['Category']),
    getAllAttributeValues: jest.fn().mockResolvedValue(['Cosmic Oven-Lord', 'Rare'])
  };
  const nfts = { prepareRule: jest.fn().mockResolvedValue({ token_standard: 'erc1155', token_ids: ['1', '3'] }), validateTraits: jest.fn() };
  const prepare = (type: 'ordinal' | 'ethscription') => jest.fn(async (ids, nums) => ({ inscription_criteria: parseInscriptionCriteria(ids, nums, type) }));
  const ordinals = {
    prepareRule: jest.fn().mockImplementation(async slug => ({ slug, collection_name: 'New Collection' })),
    prepareTraitSnapshot: jest.fn().mockImplementation(async rule => snapshot(rule)), prepareInscriptionRule: prepare('ordinal')
  };
  const ethscriptions = { prepareInscriptionRule: prepare('ethscription') };
  return { data, nfts, ordinals, ethscriptions, editor: new RuleEditService(data as any, nfts as any, ordinals as any, ethscriptions as any) };
}

describe('Rule editor field preservation', () => {
  it('keeps the first isolated Ordinal number while compressing later ranges', () => {
    const rule = { ...numbers, inscription_criteria: parseInscriptionCriteria(null, '97305462,97308505-97308527') };
    expect(ruleEditFields(rule)[0].value).toBe('97305462,97308505-97308527');
    expect(parseInscriptionCriteria(null, ruleEditFields(rule)[0].value)).toEqual(rule.inscription_criteria);
  });
  it('round-trips signed historical numbers', () => {
    const rule = { ...numbers, inscription_criteria: parseInscriptionCriteria(null, '-10--1,0,15') };
    expect(parseInscriptionCriteria(null, ruleEditFields(rule)[0].value)).toEqual(rule.inscription_criteria);
  });
  it('preserves every ID across two inputs and refuses an oversized list', () => {
    const ids = Array.from({ length: 88 }, (_, n) => inscriptionId(n));
    const value = ids.join(','); const split = splitRuleEditList(value);
    expect(split.every(part => part.length <= 4000)).toBe(true);
    expect(split.join(',')).toBe(value);
    expect(split[0].startsWith(ids[0])).toBe(true); expect(split[1].endsWith(ids[87])).toBe(true);
    expect(splitRuleEditList('123')).toEqual(['123', '']);
    expect(() => splitRuleEditList(Array.from({ length: 150 }, (_, n) => inscriptionId(n)).join(','))).toThrow('exceeds');
  });
  it('compresses NFT IDs with exact uint256 arithmetic', () => {
    const first = (1n << 256n) - 3n;
    expect(compactTokenIds([first.toString(), (first + 1n).toString(), (first + 2n).toString()])).toBe(`${first}-${first + 2n}`);
    expect(compactTokenIds(['0', '1', '2', '500'])).toBe('0-2,500');
    expect(compactTokenIds(null)).toBe('');
  });
  it('uses exact human-readable ERC-20 balances and excludes immutable fields', () => {
    expect(ruleEditFields(token)).toEqual([{ key: 'min_balance', label: 'Minimum token balance', value: '0.5', required: true, maxLength: 360 }]);
    for (const rule of [base, nft, ordinal, numbers]) {
      expect(ruleEditFields(rule).map(field => field.key)).not.toEqual(expect.arrayContaining(['role_id', 'channel_id', 'chain_id', 'asset_type', 'contract_address']));
    }
  });
  it('ignores background snapshots and display names for stale-edit detection', () => {
    expect(ruleEditVersion({ ...ordinal, role_name: 'Renamed', ordinal_trait_snapshot: snapshot() })).toBe(ruleEditVersion(ordinal));
    expect(ruleEditVersion({ ...ordinal, min_items: 2 })).not.toBe(ruleEditVersion(ordinal));
    expect(ruleEditVersion({ ...numbers, inscription_criteria: { ranges: [[97308505, 97308527]], kind: 'numbers' } })).toBe(ruleEditVersion(numbers));
  });
});

describe('Rule edit validation', () => {
  it.each(['0', '-1', '1.2', '1e2', '', String(Number.MAX_SAFE_INTEGER + 1)])('rejects invalid minimum %s', async minimum => {
    await expect(editor().editor.prepare(base, { ...inputs(base), min_items: minimum })).rejects.toThrow('positive whole');
  });
  it('normalizes and validates all Ethscription values, including ones outside autocomplete', async () => {
    const { editor: service, data } = editor();
    const result = await service.prepare(base, { ...inputs(base), slug: ' comrades ', attribute_key: 'Category', attribute_value: 'Cosmic Oven-Lord', min_items: '2' });
    expect(result).toMatchObject({ slug: 'comrades', attribute_value: 'Cosmic Oven-Lord', min_items: 2 });
    expect(data.getAllAttributeValues).toHaveBeenCalledWith('Category', 'comrades');
    await expect(service.prepare(base, { ...inputs(base), slug: 'comrades,other', attribute_key: 'Category' })).rejects.toThrow('one collection per rule');
    await expect(service.prepare(base, { ...inputs(base), slug: 'missing' })).rejects.toThrow('does not exist');
    await expect(service.prepare(base, { ...inputs(base), attribute_value: 'Rare' })).rejects.toThrow('without specifying');
  });
  it('saves canonical Ethscription criteria and preserves role names and trait spacing', async () => {
    const { editor: service, data } = editor();
    data.getAllSlugs.mockResolvedValue(['Pizza-Comrades']);
    data.getAttributeKeys.mockResolvedValue(['EyeColor']);
    data.getAllAttributeValues.mockResolvedValue(['Gold Crown']);
    const result = await service.prepare({...base, role_name: 'Gold Crown Holders'}, {...inputs(base), slug: ' PIZZA   COMRADES ', attribute_key: ' eyecolor ', attribute_value: ' gold crown '});
    expect(result).toMatchObject({slug: 'Pizza-Comrades', attribute_key: 'EyeColor', attribute_value: 'Gold Crown', role_name: 'Gold Crown Holders'});
  });
  it('normalizes Ordinals slug edits before deciding whether metadata needs refreshing', async () => {
    const { editor: service, ordinals } = editor();
    const before = {...ordinal, ordinal_trait_snapshot: snapshot()};
    const result = await service.prepare(before, {...inputs(before), slug: ' PIZZA   COMRADES '});
    expect(result.slug).toBe('pizza-comrades');
    expect(ordinals.prepareRule).not.toHaveBeenCalled();
    expect(ordinals.prepareTraitSnapshot).not.toHaveBeenCalled();
  });
  it('rejects multiple collections and uses a single collection field', async () => {
    await expect(editor().editor.prepare(base, { ...inputs(base), slug: 'other, comrades' })).rejects.toThrow('one collection per rule');
    expect(ruleEditFields(base)[0]).toMatchObject({ label: 'Collection slug' });
    expect(ruleEditFields(base)[0].list).toBeUndefined();
  });
  it('keeps labels separate from eligibility and avoids ownership calls for a label-only edit', async () => {
    const {editor: service, ordinals} = editor();
    const result = await service.prepare(numbers, {...inputs(numbers), label: '  Krampus Knows  '});
    expect(result.rule_label).toBe('Krampus Knows');
    expect(result.inscription_criteria).toEqual(numbers.inscription_criteria);
    expect(ruleCriteriaKey(result)).toBe(ruleCriteriaKey(numbers));
    expect(ruleEditVersion(result)).not.toBe(ruleEditVersion(numbers));
    expect(ordinals.prepareInscriptionRule).not.toHaveBeenCalled();
    expect(await service.prepare(result, {...inputs(result), label: ''})).toMatchObject({rule_label: null});
  });
  it('uses existing NFT contract/network validation and refreshes token selection', async () => {
    const { editor: service, nfts } = editor(); const result = await service.prepare(nft, { ...inputs(nft), token_ids: '1,3' });
    expect(nfts.prepareRule).toHaveBeenCalledWith(nft.contract_address, '1,3', nft.collection_name, nft.chain_id);
    expect(nfts.validateTraits).toHaveBeenCalledWith(result);
    expect(result).toMatchObject({ id: 173, chain_id: 46630, role_id: 'holder', token_ids: ['1', '3'] });
    nfts.prepareRule.mockResolvedValue({ token_standard: 'erc721', token_ids: ['1'] });
    await expect(service.prepare(nft, inputs(nft))).rejects.toThrow('standard changed');
    expect(await service.prepare({ ...nft, token_standard: 'erc721' }, { ...inputs(nft), min_items: '2' })).toMatchObject({token_ids:['1'], min_items:2});
  });
  it('rebuilds an Ordinal snapshot when traits change and clears it when removed', async () => {
    const { editor: service, ordinals } = editor(); const before = { ...ordinal, ordinal_trait_snapshot: snapshot() };
    const after = await service.prepare(before, { ...inputs(before), attribute_value: 'Rare' });
    expect(ordinals.prepareTraitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ attribute_value: 'Rare' }));
    expect(after.ordinal_trait_snapshot.criteria_hash).toBe(ordinalTraitHash(after));
    expect(await service.prepare(before, { ...inputs(before), attribute_key: 'ALL', attribute_value: 'ALL' })).toMatchObject({ ordinal_trait_snapshot: null });
  });
  it('avoids collection requests for a minimum-only edit with a fresh snapshot', async () => {
    const { editor: service, ordinals } = editor(); const before = { ...ordinal, ordinal_trait_snapshot: snapshot() };
    expect(await service.prepare(before, { ...inputs(before), min_items: '2' })).toMatchObject({ min_items: 2, ordinal_trait_snapshot: before.ordinal_trait_snapshot });
    expect(ordinals.prepareRule).not.toHaveBeenCalled(); expect(ordinals.prepareTraitSnapshot).not.toHaveBeenCalled();
    await service.prepare({ ...before, ordinal_trait_snapshot: snapshot(ordinal, new Date(Date.now() - 86400001).toISOString()) }, inputs(before));
    expect(ordinals.prepareTraitSnapshot).toHaveBeenCalledTimes(1);
  });
  it('validates a changed Ordinals collection and updates its label', async () => {
    const { editor: service, ordinals } = editor();
    expect(await service.prepare(ordinal, { ...inputs(ordinal), slug: ' YONDER ' })).toMatchObject({ slug: 'yonder', collection_name: 'New Collection' });
    expect(ordinals.prepareRule).toHaveBeenCalledWith('yonder');
    expect(ordinals.prepareTraitSnapshot).toHaveBeenCalledWith(expect.objectContaining({ slug: 'yonder' }));
  });
  it.each(['ordinal', 'ethscription'] as const)('retains %s numeric mode and calls its creation validator', async asset_type => {
    const { editor: service, ordinals, ethscriptions } = editor(); const before = { ...numbers, asset_type };
    const after = await service.prepare(before, { selection: '97305462,97308505-97308527', min_items: '1' });
    expect(after.inscription_criteria).toEqual({ kind: 'numbers', ranges: [[97305462, 97305462], [97308505, 97308527]] });
    expect((asset_type === 'ordinal' ? ordinals : ethscriptions).prepareInscriptionRule).toHaveBeenCalledWith(null, '97305462,97308505-97308527', 1);
  });
  it('retains ID mode and validates the whole list', async () => {
    const { editor: service, ordinals } = editor(); const before = { ...numbers, inscription_criteria: parseInscriptionCriteria(inscriptionId(1)) };
    await service.prepare(before, { selection: `${inscriptionId(1)},${inscriptionId(2)}`, min_items: '2' });
    expect(ordinals.prepareInscriptionRule).toHaveBeenCalledWith(`${inscriptionId(1)},${inscriptionId(2)}`, null, 2);
    await expect(service.prepare(before, { selection: '123', min_items: '1' })).rejects.toThrow('full inscription IDs');
  });
  it('changes exact ERC-20 minimums without provider requests', async () => {
    const { editor: service, nfts, ordinals } = editor();
    expect(await service.prepare(token, { min_balance: '0.123456' })).toMatchObject({ min_balance: '123456', token_decimals: 6 });
    await expect(service.prepare(token, { min_balance: '0.1234567' })).rejects.toThrow('decimal places');
    await expect(service.prepare(token, { min_balance: '0' })).rejects.toThrow('positive');
    expect(nfts.prepareRule).not.toHaveBeenCalled(); expect(ordinals.prepareRule).not.toHaveBeenCalled();
  });
  it('rejects immutable input fields and distinguishes duplicates from shared requirements', async () => {
    const { editor: service } = editor(); await expect(service.prepare(base, { ...inputs(base), role_id: 'other' })).rejects.toThrow('cannot be edited');
    expect(service.duplicates(base, [base, { ...base, id: 174 }, { ...base, id: 175, role_id: 'other' }, { ...base, id: 176, server_id: 'other' }])).toMatchObject({ exact: { id: 174 }, shared: [{ id: 175 }] });
  });
});

function harness(rule = base) {
  const validation = editor();
  const db = {
    getRuleForServer: jest.fn().mockResolvedValue(rule), getRoleMappings: jest.fn().mockResolvedValue([rule]),
    editRule: jest.fn().mockImplementation(async (_before, after) => {
      db.getRuleForServer.mockResolvedValue(structuredClone(after));
      return after;
    })
  };
  const roles = { reverifyRoleInServer: jest.fn().mockResolvedValue({ verified: 1, revoked: 0, errors: 0 }) };
  const handler = new EditRuleHandler(db as any, validation.editor, roles as any);
  const interaction = (extra: any = {}) => ({
    id: 'session', guildId: 'guild', user: { id: 'admin' }, memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    options: { getString: () => String(rule.id) }, reply: jest.fn(), showModal: jest.fn(), deferReply: jest.fn(), editReply: jest.fn(), deferUpdate: jest.fn(), update: jest.fn(), ...extra
  } as any);
  const start = async () => { const command = interaction(); await handler.handle(command); return command; };
  const preview = async (updates: Record<string, string> = {}) => {
    const values = { ...inputs(rule), ...updates };
    const modal = interaction({ customId: 'edit-rule-form-session', fields: { getTextInputValue: key => key.endsWith('_continued') ? '' : values[key] } });
    await handler.handleModal(modal); return modal;
  };
  const button = (action = 'save', extra = {}) => interaction({ customId: `edit-rule-${action}-session`, ...extra });
  return { ...validation, db, roles, handler, interaction, start, preview, button };
}

describe('Prefilled edit forms and confirmation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it.each([base, nft, ordinal, numbers, token])('opens only relevant fields within Discord limits for $asset_type', async rule => {
    const h = harness(rule); const command = await h.start(); const modal = command.showModal.mock.calls[0][0].toJSON();
    expect(modal.components.length).toBeLessThanOrEqual(5);
    expect(modal.components.flatMap(row => row.components).map(field => field.custom_id)).not.toContain('role_id');
    expect(h.db.editRule).not.toHaveBeenCalled(); expect(h.nfts.prepareRule).not.toHaveBeenCalled();
  });
  it('shows every existing ID in the two prefilled inputs and rejects oversized forms', async () => {
    const ids = Array.from({ length: 88 }, (_, n) => inscriptionId(n));
    const h = harness({ ...numbers, inscription_criteria: { kind: 'ids', ids } }); const command = await h.start();
    const fields = command.showModal.mock.calls[0][0].toJSON().components.flatMap(row => row.components);
    expect([fields[0].value, fields[1].value].join(',')).toBe(ids.join(','));
    const tooBig = harness({ ...numbers, inscription_criteria: { kind: 'ids', ids: Array.from({ length: 150 }, (_, n) => inscriptionId(n)) } });
    const rejected = await tooBig.start(); expect(rejected.reply.mock.calls[0][0].content).toContain('exceeds');
    expect(rejected.showModal).not.toHaveBeenCalled();
  });
  it('does not save until confirmed; cancel leaves the row and roles untouched', async () => {
    const h = harness(); await h.start(); const modal = await h.preview({ min_items: '2' });
    expect(modal.editReply.mock.calls[0][0].embeds[0].toJSON().title).toContain('Review');
    expect(h.db.editRule).not.toHaveBeenCalled();
    await h.handler.handleButton(h.button('cancel'));
    expect(h.db.editRule).not.toHaveBeenCalled(); expect(h.roles.reverifyRoleInServer).not.toHaveBeenCalled();
    const expired = h.button(); await h.handler.handleButton(expired); expect(expired.reply).toHaveBeenCalled();
  });
  it('recombines both long-list fields before validation and saves all inscription IDs', async () => {
    const ids = Array.from({ length: 88 }, (_, n) => inscriptionId(n));
    const rule = { ...numbers, inscription_criteria: parseInscriptionCriteria(ids.join(',')) };
    const h = harness(rule); const command = await h.start();
    const fields = command.showModal.mock.calls[0][0].toJSON().components.flatMap(row => row.components);
    const values = Object.fromEntries(fields.map(field => [field.custom_id, field.value || ''])); values.min_items = '2';
    const modal = h.interaction({ customId: 'edit-rule-form-session', fields: { getTextInputValue: key => values[key] } });
    await h.handler.handleModal(modal); await h.handler.handleButton(h.button());
    expect(h.db.editRule.mock.calls[0][1].inscription_criteria).toEqual({ kind: 'ids', ids });
  });
  it('saves, undoes, and redoes label-only edits without rechecking member roles', async () => {
    const h = harness(numbers); await h.start(); const preview = await h.preview({label: 'Krampus Knows'});
    expect(preview.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('Only the label changes');
    await h.handler.handleButton(h.button());
    expect(h.db.editRule.mock.calls[0][1].rule_label).toBe('Krampus Knows');
    await h.handler.handleButton(h.interaction({customId: 'edit-rule-undo-session-1'}));
    expect(h.db.editRule.mock.calls[1][1].rule_label ?? null).toBeNull();
    await h.handler.handleButton(h.interaction({customId: 'edit-rule-redo-session-2'}));
    expect(h.db.editRule.mock.calls[2][1].rule_label).toBe('Krampus Knows');
    expect(h.roles.reverifyRoleInServer).not.toHaveBeenCalled();
    expect(h.ordinals.prepareInscriptionRule).not.toHaveBeenCalled();
  });
  it('lets admins find an inscription rule by its label in the edit selector', async () => {
    const h = harness({...numbers, rule_label: 'Krampus Knows'});
    const interaction = h.interaction({options: {getFocused: () => 'krampus'}, respond: jest.fn()});
    await h.handler.autocomplete(interaction);
    expect(interaction.respond).toHaveBeenCalledWith([{name: expect.stringContaining('Krampus Knows'), value: '173'}]);
  });
  it('saves the original row and immediately rechecks all previous holders of its role', async () => {
    const h = harness(numbers); await h.start(); await h.preview({ selection: '97305462,97308505-97308527' });
    await h.handler.handleButton(h.button());
    expect(h.db.editRule).toHaveBeenCalledWith(numbers, expect.objectContaining({
      id: 173, role_id: 'holder', channel_id: 'verify',
      inscription_criteria: { kind: 'numbers', ranges: [[97305462, 97305462], [97308505, 97308527]] }
    }));
    expect(h.roles.reverifyRoleInServer).toHaveBeenCalledWith('guild', 'holder');
  });
  it('rejects unchanged criteria and exact duplicates before Save', async () => {
    const h = harness(); await h.start(); const unchanged = await h.preview(); expect(unchanged.editReply.mock.calls[0][0].content).toContain('No rule requirements changed');
    await h.start(); h.db.getRoleMappings.mockResolvedValue([base, { ...base, id: 174, min_items: 2 }]);
    const duplicate = await h.preview({ min_items: '2' }); expect(duplicate.editReply.mock.calls[0][0].content).toContain('duplicate rule 174');
    expect(h.db.editRule).not.toHaveBeenCalled();
  });
  it('warns when another role shares the edited criteria', async () => {
    const h = harness(); await h.start(); h.db.getRoleMappings.mockResolvedValue([base, { ...base, id: 174, role_id: 'another', min_items: 2 }]);
    const modal = await h.preview({ min_items: '2' }); expect(modal.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('also match rule(s) 174');
  });
  it('rejects stale edits and duplicates that appear after preview', async () => {
    const h = harness(); await h.start(); await h.preview({ min_items: '2' }); h.db.getRuleForServer.mockResolvedValue({ ...base, min_items: 3 });
    const stale = h.button(); await h.handler.handleButton(stale); expect(stale.editReply.mock.calls[0][0].content).toContain('changed or was removed');
    h.db.getRuleForServer.mockResolvedValue(base); await h.start(); await h.preview({ min_items: '2' });
    h.db.getRoleMappings.mockResolvedValue([base, { ...base, id: 174, min_items: 2 }]);
    const duplicate = h.button(); await h.handler.handleButton(duplicate); expect(duplicate.editReply.mock.calls[0][0].content).toContain('now exists');
    expect(h.db.editRule).not.toHaveBeenCalled();
  });
  it.each([{ user: { id: 'another' } }, { guildId: 'another' }, { memberPermissions: { has: () => false } }])('guards sessions against other users, servers, or lost admin access', async change => {
    const h = harness(); await h.start(); await h.preview({ min_items: '2' });
    const intruder = h.button('save', change); await h.handler.handleButton(intruder);
    expect(intruder.reply).toHaveBeenCalled(); expect(h.db.editRule).not.toHaveBeenCalled();
  });
  it('guards modal ownership, command access, and server-scoped lookups', async () => {
    const h = harness(); await h.start(); const other = h.interaction({ customId: 'edit-rule-form-session', user: { id: 'another' } });
    await h.handler.handleModal(other); expect(other.reply).toHaveBeenCalled(); expect(other.deferReply).not.toHaveBeenCalled();
    const denied = h.interaction({ memberPermissions: { has: () => false } }); await h.handler.handle(denied); expect(denied.showModal).not.toHaveBeenCalled();
    expect(h.db.getRuleForServer).toHaveBeenCalledWith('173', 'guild');
    h.db.getRuleForServer.mockResolvedValue({ ...base, server_id: 'elsewhere' }); const cross = await h.start(); expect(cross.showModal).not.toHaveBeenCalled();
  });
  it('expires previews after ten minutes and prevents duplicate saves', async () => {
    const h = harness(); await h.start(); await h.preview({ min_items: '2' }); jest.advanceTimersByTime(600001);
    const expired = h.button(); await h.handler.handleButton(expired); expect(expired.reply).toHaveBeenCalled();
    await h.start(); await h.preview({ min_items: '2' }); await Promise.all([h.handler.handleButton(h.button()), h.handler.handleButton(h.button())]);
    expect(h.db.editRule).toHaveBeenCalledTimes(1);
  });
  it('retains newer snapshots refreshed while the form was open', async () => {
    const before = { ...ordinal, ordinal_trait_snapshot: snapshot(ordinal, new Date(Date.now() - 5000).toISOString()) };
    const h = harness(before); await h.start(); await h.preview({ min_items: '2' });
    const latest = snapshot(); h.db.getRuleForServer.mockResolvedValue({ ...before, ordinal_trait_snapshot: latest });
    await h.handler.handleButton(h.button()); expect(h.db.editRule.mock.calls[0][1].ordinal_trait_snapshot).toEqual(latest);
  });
  it('attaches the entire before/after selection when the embed preview is shortened', async () => {
    const ids = Array.from({ length: 30 }, (_, n) => inscriptionId(n)); const h = harness({ ...numbers, inscription_criteria: { kind: 'ids', ids } });
    await h.start(); const modal = await h.preview({ min_items: '2' }); const payload = modal.editReply.mock.calls[0][0];
    const attachment = payload.files[0].attachment.toString(); expect(attachment).toContain(ids.join(','));
    expect(payload.embeds[0].toJSON().fields.every(field => field.value.length <= 1024)).toBe(true);
    expect(attachment).toContain('Minimum items: 2');
  });
  it('attaches complete previews when markdown escaping alone exceeds the field limit', async () => {
    const rule = { ...base, attribute_key: 'Category', attribute_value: '*'.repeat(600) }; const h = harness(rule);
    h.data.getAllAttributeValues.mockResolvedValue(['*'.repeat(600)]); await h.start(); const modal = await h.preview({ min_items: '2' });
    expect(modal.editReply.mock.calls[0][0].files).toHaveLength(1);
  });
  it('reports a committed edit as saved even if provider checks or Discord feedback fail', async () => {
    const h = harness(); await h.start(); await h.preview({ min_items: '2' });
    h.roles.reverifyRoleInServer.mockRejectedValue(new Error('provider down')); const button = h.button();
    button.editReply.mockRejectedValueOnce(new Error('reply failed')); await h.handler.handleButton(button);
    expect(h.db.editRule).toHaveBeenCalledTimes(1); expect(h.roles.reverifyRoleInServer).toHaveBeenCalledTimes(1);
    expect(button.editReply.mock.calls.at(-1)[0].embeds[0].toJSON().description).toContain('was saved');
  });
  it('does not recheck roles after an atomic stale-save rejection', async () => {
    const h = harness(); await h.start(); await h.preview({ min_items: '2' }); h.db.editRule.mockRejectedValue(new Error('This rule changed'));
    await h.handler.handleButton(h.button()); expect(h.roles.reverifyRoleInServer).not.toHaveBeenCalled();
  });
  it('searches only this server’s rules and limits Discord autocomplete results', async () => {
    const h = harness(); h.db.getRoleMappings.mockResolvedValue(Array.from({ length: 30 }, (_, n) => ({ ...base, id: n + 1 })));
    const request = h.interaction({ options: { getFocused: () => 'holder' }, respond: jest.fn() }); await h.handler.autocomplete(request);
    expect(h.db.getRoleMappings).toHaveBeenCalledWith('guild'); expect(request.respond.mock.calls[0][0]).toHaveLength(25);
    expect(request.respond.mock.calls[0][0][0].value).toBe('30');
  });
});

describe('Rule edit Undo/Redo chains', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function saved(rule = base, updates: Record<string, string> = { min_items: '2' }) {
    const h = harness(rule);
    await h.start(); await h.preview(updates);
    const button = h.button(); await h.handler.handleButton(button);
    return { ...h, last: button };
  }
  function nextButton(h: ReturnType<typeof harness>, last: any) {
    const payload = last.editReply.mock.calls.at(-1)[0];
    const button = payload.components[0].toJSON().components[0];
    return { data: button, interaction: h.interaction({ customId: button.custom_id }) };
  }

  it('alternates Undo and Redo repeatedly, keeping the same row and rechecking earned holders every time', async () => {
    const h = await saved(); let last = h.last;
    for (let step = 1; step <= 12; step++) {
      const next = nextButton(h, last);
      expect(next.data.label).toBe(step % 2 ? 'Undo' : 'Redo');
      expect(next.data.custom_id).toBe(`edit-rule-${step % 2 ? 'undo' : 'redo'}-session-${step}`);
      await h.handler.handleButton(next.interaction);
      const [expected, written] = h.db.editRule.mock.calls.at(-1);
      expect(expected.min_items).toBe(step % 2 ? 2 : 1);
      expect(written).toMatchObject({ id: 173, role_id: 'holder', channel_id: 'verify', server_id: 'guild', min_items: step % 2 ? 1 : 2 });
      last = next.interaction;
    }
    expect(h.db.editRule).toHaveBeenCalledTimes(13);
    expect(h.roles.reverifyRoleInServer).toHaveBeenCalledTimes(13);
    expect(h.roles.reverifyRoleInServer.mock.calls.every(args => args.join(',') === 'guild,holder')).toBe(true);
    expect((h.handler as any).sessions.size).toBe(1);
    expect((h.handler as any).expiryTimers.size).toBe(1);
  });

  it.each([base, nft, ordinal, numbers, token])('restores exact $asset_type requirements without provider validation gating Undo/Redo', async rule => {
    const h = await saved(rule, rule.asset_type === 'erc20' ? { min_balance: '0.75' } : { min_items: '2' });
    const edited = structuredClone(h.db.editRule.mock.calls[0][1]);
    h.nfts.prepareRule.mockRejectedValue(new Error('provider down'));
    h.ordinals.prepareRule.mockRejectedValue(new Error('provider down'));
    h.ordinals.prepareTraitSnapshot.mockRejectedValue(new Error('provider down'));
    const undo = nextButton(h, h.last); await h.handler.handleButton(undo.interaction);
    expect(ruleEditVersion(h.db.editRule.mock.calls[1][1])).toBe(ruleEditVersion(rule));
    const redo = nextButton(h, undo.interaction); await h.handler.handleButton(redo.interaction);
    expect(ruleEditVersion(h.db.editRule.mock.calls[2][1])).toBe(ruleEditVersion(edited));
  });

  it('renews the five-minute window after every action and rejects the chain after inactivity', async () => {
    const h = await saved();
    jest.advanceTimersByTime(299000);
    const undo = nextButton(h, h.last); await h.handler.handleButton(undo.interaction);
    jest.advanceTimersByTime(299000);
    const redo = nextButton(h, undo.interaction); await h.handler.handleButton(redo.interaction);
    expect(h.db.editRule).toHaveBeenCalledTimes(3);
    const expired = nextButton(h, redo.interaction);
    jest.advanceTimersByTime(300001); await h.handler.handleButton(expired.interaction);
    expect(expired.interaction.reply).toHaveBeenCalled(); expect(h.db.editRule).toHaveBeenCalledTimes(3);
    expect((h.handler as any).sessions.size).toBe(0); expect((h.handler as any).expiryTimers.size).toBe(0);
  });

  it('handles simultaneous Undo clicks once and rejects a replay after later Redo', async () => {
    const h = await saved(); const undo = nextButton(h, h.last);
    await Promise.all([h.handler.handleButton(undo.interaction), h.handler.handleButton(h.interaction({ customId: undo.data.custom_id }))]);
    expect(h.db.editRule).toHaveBeenCalledTimes(2);
    const redo = nextButton(h, undo.interaction); await h.handler.handleButton(redo.interaction);
    const replay = h.interaction({ customId: undo.data.custom_id }); await h.handler.handleButton(replay);
    expect(replay.reply).toHaveBeenCalled(); expect(h.db.editRule).toHaveBeenCalledTimes(3);
    const fresh = nextButton(h, redo.interaction); await h.handler.handleButton(fresh.interaction);
    expect(h.db.editRule).toHaveBeenCalledTimes(4);
  });

  it.each(['undo','redo'])('guards %s against another admin, another server, and lost permissions', async action => {
    const h = await saved(); let next = nextButton(h, h.last);
    if (action === 'redo') { await h.handler.handleButton(next.interaction); next = nextButton(h, next.interaction); }
    const writes = h.db.editRule.mock.calls.length;
    for (const extra of [{ user: { id: 'another-admin' } }, { guildId: 'another-server' }, { memberPermissions: { has: () => false } }]) {
      const denied = h.interaction({ customId: next.data.custom_id, ...extra }); await h.handler.handleButton(denied);
      expect(denied.reply).toHaveBeenCalled(); expect(h.db.editRule).toHaveBeenCalledTimes(writes);
    }
    await h.handler.handleButton(next.interaction); expect(h.db.editRule).toHaveBeenCalledTimes(writes + 1);
  });

  it.each(['undo','redo'])('refuses %s when a newer edit exists', async action => {
    const h = await saved(); let next = nextButton(h, h.last);
    if (action === 'redo') { await h.handler.handleButton(next.interaction); next = nextButton(h, next.interaction); }
    const writes = h.db.editRule.mock.calls.length;
    h.db.getRuleForServer.mockResolvedValue({ ...base, min_items: 3 });
    await h.handler.handleButton(next.interaction);
    expect(h.db.editRule).toHaveBeenCalledTimes(writes);
    expect(next.interaction.editReply.mock.calls.at(-1)[0].content).toContain('changed or was removed');
    expect(next.interaction.editReply.mock.calls.at(-1)[0].components).toEqual([]);
    expect((h.handler as any).sessions.size).toBe(0);
  });

  it('retains the same Undo button for retry after a failed database write', async () => {
    const h = await saved(); const undo = nextButton(h, h.last);
    h.db.editRule.mockRejectedValueOnce(new Error('Database unavailable'));
    await h.handler.handleButton(undo.interaction);
    expect(h.roles.reverifyRoleInServer).toHaveBeenCalledTimes(1);
    const retry = nextButton(h, undo.interaction); expect(retry.data.custom_id).toBe(undo.data.custom_id);
    await h.handler.handleButton(retry.interaction);
    expect(h.roles.reverifyRoleInServer).toHaveBeenCalledTimes(2);
    expect(nextButton(h, retry.interaction).data.label).toBe('Redo');
  });

  it('keeps the original edit applied when another rule would conflict with Undo', async () => {
    const h = await saved(); const undo = nextButton(h, h.last);
    h.db.getRoleMappings.mockResolvedValue([{ ...base, min_items: 2 }, { ...base, id: 174 }]);
    await h.handler.handleButton(undo.interaction);
    expect(h.db.editRule).toHaveBeenCalledTimes(1);
    expect(undo.interaction.editReply.mock.calls.at(-1)[0].content).toContain('identical rule (174)');
    h.db.getRoleMappings.mockResolvedValue([{ ...base, min_items: 2 }]);
    const retry = nextButton(h, undo.interaction); await h.handler.handleButton(retry.interaction);
    expect(h.db.editRule.mock.calls.at(-1)[1].min_items).toBe(1);
  });

  it('does not recreate a deleted rule when Undo is clicked', async () => {
    const h = await saved(); const undo = nextButton(h, h.last);
    h.db.getRuleForServer.mockResolvedValue(null);
    await h.handler.handleButton(undo.interaction);
    expect(h.db.editRule).toHaveBeenCalledTimes(1);
    expect(undo.interaction.editReply.mock.calls.at(-1)[0].components).toEqual([]);
    expect((h.handler as any).sessions.size).toBe(0);
  });

  it('preserves the Undo retry after acknowledgment fails without writing the database', async () => {
    const h = await saved(); const undo = nextButton(h, h.last);
    undo.interaction.deferUpdate.mockRejectedValueOnce(new Error('Could not acknowledge'));
    await h.handler.handleButton(undo.interaction);
    expect(undo.interaction.reply).toHaveBeenCalled(); expect(h.db.editRule).toHaveBeenCalledTimes(1);
    const retry = h.interaction({ customId: undo.data.custom_id }); await h.handler.handleButton(retry);
    expect(h.db.editRule).toHaveBeenCalledTimes(2); expect(nextButton(h, retry).data.label).toBe('Redo');
  });

  it('leaves Redo available after a successful Undo even if role checks and feedback fail', async () => {
    const h = await saved(); const undo = nextButton(h, h.last);
    h.roles.reverifyRoleInServer.mockRejectedValueOnce(new Error('provider down'));
    undo.interaction.editReply.mockRejectedValueOnce(new Error('progress reply failed'));
    await h.handler.handleButton(undo.interaction);
    const final = undo.interaction.editReply.mock.calls.at(-1)[0];
    expect(final.embeds[0].toJSON().title).toContain('Undone');
    expect(final.embeds[0].toJSON().description).toContain('now uses its original requirements');
    expect(final.content).toBe(''); expect(final.attachments).toEqual([]);
    expect(nextButton(h, undo.interaction).data.label).toBe('Redo');
    expect(h.db.editRule).toHaveBeenCalledTimes(2);
  });

  it('blocks another change while role reconciliation is running', async () => {
    const h = harness(); await h.start(); await h.preview({ min_items: '2' });
    let finish: (result: any) => void; let started: () => void;
    const checking = new Promise<void>(resolve => { started = resolve; });
    h.roles.reverifyRoleInServer.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const button = h.button(); const pending = h.handler.handleButton(button); await checking;
    jest.advanceTimersByTime(600001);
    const premature = h.interaction({ customId: 'edit-rule-undo-session-1' }); await h.handler.handleButton(premature);
    expect(premature.reply).toHaveBeenCalled(); expect(h.db.editRule).toHaveBeenCalledTimes(1);
    finish({ verified: 1, revoked: 0, errors: 0 }); await pending;
    const undo = nextButton(h, button); await h.handler.handleButton(undo.interaction);
    expect(h.db.editRule).toHaveBeenCalledTimes(2);
  });

  it('restores each Ordinals trait with its own matching snapshot', async () => {
    const original = { ...ordinal, ordinal_trait_snapshot: snapshot() };
    const h = await saved(original, { attribute_value: 'Rare' });
    const edited = h.db.editRule.mock.calls[0][1];
    const undo = nextButton(h, h.last); await h.handler.handleButton(undo.interaction);
    expect(h.db.editRule.mock.calls[1][1]).toMatchObject({ attribute_value: 'Cosmic Oven-Lord', ordinal_trait_snapshot: original.ordinal_trait_snapshot });
    const redo = nextButton(h, undo.interaction); await h.handler.handleButton(redo.interaction);
    expect(h.db.editRule.mock.calls[2][1]).toMatchObject({ attribute_value: 'Rare', ordinal_trait_snapshot: edited.ordinal_trait_snapshot });
    expect(h.ordinals.prepareTraitSnapshot).toHaveBeenCalledTimes(1);
  });

  it('retains a newer matching snapshot during Undo but clears an expired snapshot', async () => {
    const original = { ...ordinal, ordinal_trait_snapshot: snapshot() }; const h = await saved(original);
    jest.advanceTimersByTime(1000); const latest = snapshot(ordinal, new Date().toISOString());
    h.db.getRuleForServer.mockResolvedValue({ ...original, min_items: 2, ordinal_trait_snapshot: latest });
    const undo = nextButton(h, h.last); await h.handler.handleButton(undo.interaction);
    expect(h.db.editRule.mock.calls[1][1].ordinal_trait_snapshot).toEqual(latest);

    const old = { ...ordinal, ordinal_trait_snapshot: snapshot(ordinal, new Date(Date.now()-86400001).toISOString()) };
    const stale = await saved(old, { attribute_value: 'Rare' });
    const restore = nextButton(stale, stale.last); await stale.handler.handleButton(restore.interaction);
    expect(stale.db.editRule.mock.calls[1][1].ordinal_trait_snapshot).toBeNull();
    expect(stale.ordinals.prepareTraitSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('Atomic rule editing through the Supabase query builder', () => {
  function storage(result: any) {
    const requests: Array<{ url: URL; init: any }> = [];
    const fetch = async (url, init) => {
      requests.push({ url: new URL(String(url)), init }); return new Response(JSON.stringify(result), {
        status: result?.code ? 400 : 200, headers: { 'Content-Type': 'application/json' }
      });
    };
    return { requests, db: new DbService(createClient('http://localhost:8000', 'test-key', {
      global: { fetch: fetch as any }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })) };
  }
  it('sends one PATCH with null, JSON, array, and server guards while updating only editable fields', async () => {
    const { db, requests } = storage({ ...nft, min_items: 2 });
    await db.editRule(nft, { ...nft, min_items: 2, role_id: 'injected', server_id: 'injected', contract_address: 'injected' });
    expect(requests).toHaveLength(1); const { url, init } = requests[0]; expect(init.method).toBe('PATCH');
    expect(url.searchParams.get('server_id')).toBe('eq.guild'); expect(url.searchParams.get('id')).toBe('eq.173');
    expect(url.searchParams.get('token_ids')).toBe('eq.{0,1,2}'); expect(url.searchParams.get('slug')).toBe('is.null');
    const patch = JSON.parse(init.body); expect(patch).toMatchObject({ min_items: 2 });
    for (const key of ['id', 'role_id', 'server_id', 'channel_id', 'contract_address', 'chain_id', 'asset_type']) expect(patch).not.toHaveProperty(key);
    const numeric = storage({ ...numbers, min_items: 2 }); await numeric.db.editRule(numbers, { ...numbers, min_items: 2 });
    expect(numeric.requests[0].url.searchParams.get('inscription_criteria')).toBe('eq.' + JSON.stringify(numbers.inscription_criteria));
  });
  it('rejects a no-match PATCH rather than silently overwriting newer criteria', async () => {
    await expect(storage(null).db.editRule(base, { ...base, min_items: 2 })).rejects.toThrow('changed or was removed');
    await expect(storage({ code: '23505', message: 'duplicate' }).db.editRule(base, { ...base, min_items: 2 })).rejects.toThrow('identical rule');
  });
  it('reads a rule with both its ID and server and filters earned holders by role rather than representative rule', async () => {
    const one = storage(base); await one.db.getRuleForServer('173', 'guild');
    expect(one.requests[0].url.searchParams.get('server_id')).toBe('eq.guild');
    const holders = storage([]); expect(await holders.db.getEarnedRoleAssignments({ serverId: 'guild', roleId: 'holder' })).toEqual([]);
    expect(holders.requests[0].url.searchParams.get('role_id')).toBe('eq.holder');
    expect(holders.requests[0].url.searchParams.has('rule_id')).toBe(false);
    expect(holders.requests[0].url.searchParams.get('status')).toBe('in.(active,revoked,expired)');
  });
});

describe('Edited roles retain alternative rules and reconcile only earned history', () => {
  function reconciliation(count: any) {
    const assignment = { id: 1, user_id: 'earned-member', server_id: 'guild', role_id: 'holder', rule_id: 174, status: 'revoked' };
    const db = {
      getEarnedRoleAssignments: jest.fn().mockResolvedValue([assignment]), getRoleMappings: jest.fn().mockResolvedValue([
        { ...base, min_items: 2 }, { ...base, id: 174, channel_id: 'other-channel' }]), saveRoleCheckDetails: jest.fn(),
      updateRoleAssignmentStatus: jest.fn(), updateLastVerified: jest.fn()
    };
    const ownership = { count: jest.fn(count) };
    const engine = new VerificationEngine(db as any, ownership as any, { getUserAddresses: jest.fn().mockResolvedValue(['wallet']) } as any,
      { allowedAddresses: jest.fn().mockImplementation(async (_server, addresses) => addresses) } as any);
    const discord = { addUserRoleDynamic: jest.fn().mockResolvedValue(true), removeUserRole: jest.fn().mockResolvedValue(true) };
    return { db, ownership, discord, roles: new DynamicRoleService(db as any, engine, discord as any) };
  }
  it('restores a previous holder who passes another rule even if the edited rule fails', async () => {
    const h = reconciliation(async () => 1n); expect(await h.roles.reverifyRoleInServer('guild', 'holder')).toEqual({ verified: 1, revoked: 0, errors: 0 });
    expect(h.db.getEarnedRoleAssignments).toHaveBeenCalledWith({ serverId: 'guild', roleId: 'holder' });
    expect(h.discord.addUserRoleDynamic).toHaveBeenCalledWith('earned-member', 'guild', 'holder', expect.any(Map));
    expect(h.db.saveRoleCheckDetails).toHaveBeenCalledWith(1, expect.objectContaining({ matched_rule_ids: [174] }));
    expect(h.ownership.count.mock.calls[0][2].ordinalMode).toBe('scheduled');
    h.db.getEarnedRoleAssignments.mockResolvedValue([]); h.discord.addUserRoleDynamic.mockClear();
    expect(await h.roles.reverifyRoleInServer('guild', 'holder')).toEqual({ verified: 0, revoked: 0, errors: 0 });
    expect(h.discord.addUserRoleDynamic).not.toHaveBeenCalled();
  });
  it('preserves the role when checks are unavailable and removes it only on confirmed failure', async () => {
    const unavailable = reconciliation(async () => { throw new Error('provider down'); });
    expect(await unavailable.roles.reverifyRoleInServer('guild', 'holder')).toEqual({ verified: 0, revoked: 0, errors: 1 });
    expect(unavailable.discord.removeUserRole).not.toHaveBeenCalled(); expect(unavailable.db.updateRoleAssignmentStatus).not.toHaveBeenCalled();
    const failed = reconciliation(async () => 0n); expect(await failed.roles.reverifyRoleInServer('guild', 'holder')).toEqual({ verified: 0, revoked: 1, errors: 0 });
    expect(failed.discord.removeUserRole).toHaveBeenCalledWith('earned-member', 'guild', 'holder', expect.any(Map));
  });
});
