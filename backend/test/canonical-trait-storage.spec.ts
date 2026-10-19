import { DbService } from '../src/services/db.service';
import { portalRule } from '../src/portal/portal.service';
import { ruleEditFields } from '../src/utils/rule-edit.util';
import { AdminFeedback } from '../src/services/utils/admin-feedback.util';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { RuleEditService } from '../src/services/rule-edit.service';
import { inscriptionCriteria } from '../src/utils/inscription-rule.util';

const trait_filter: any = {
  operator: 'AND',
  conditions: [{ key: 'Hat', value: 'Crown' }],
};
const rule: any = {
  id: 1,
  server_id: 'server',
  channel_id: 'verify',
  role_id: 'holder',
  role_name: 'Holder',
  asset_type: 'ethscription',
  slug: 'comrades',
  min_items: 1,
  trait_filter,
};

describe('Canonical trait storage without legacy columns', () => {
  let db: DbService, q: any;
  beforeEach(() => {
    q = {
      from: jest.fn(() => q),
      select: jest.fn(() => q),
      insert: jest.fn((value) => {
        expect(value).not.toHaveProperty('attribute_key');
        expect(value).not.toHaveProperty('attribute_value');
        return q;
      }),
      update: jest.fn((value) => {
        expect(value).not.toHaveProperty('attribute_key');
        expect(value).not.toHaveProperty('attribute_value');
        return q;
      }),
      eq: jest.fn((key) => {
        expect(['attribute_key', 'attribute_value']).not.toContain(key);
        return q;
      }),
      is: jest.fn(() => q),
      or: jest.fn(() => q),
      single: jest.fn().mockResolvedValue({ data: rule, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: rule, error: null }),
      then: (resolve) =>
        Promise.resolve({ data: rule, error: null }).then(resolve),
    };
    db = new DbService(q);
  });
  it('translates simple slash inputs into canonical inserts and strips input aliases', async () => {
    await db.addRoleMapping(
      'server',
      'Server',
      'verify',
      'Verify',
      'comrades',
      'holder',
      'Holder',
      'Hat',
      'Crown',
      1,
      {
        asset_type: 'ethscription',
        attribute_key: 'Hat',
        attribute_value: 'Crown',
      },
    );
    expect(q.insert.mock.calls[0][0].trait_filter).toEqual(trait_filter);
  });
  it('restores historical rules from their original single-trait audit JSON', async () => {
    await db.restoreRuleWithOriginalId({
      ...rule,
      trait_filter: undefined,
      attribute_key: 'Hat',
      attribute_value: 'Crown',
    });
    expect(q.insert.mock.calls[0][0].trait_filter).toEqual(trait_filter);
  });
  it('guards writes and snapshot refreshes using the full JSON instead of old columns', async () => {
    await db.editRule(rule, { ...rule, min_items: 2 });
    expect(q.eq).toHaveBeenCalledWith(
      'trait_filter',
      JSON.stringify(trait_filter),
    );
    expect(q.update.mock.calls[0][0].trait_filter).toEqual(trait_filter);
    await db.cacheOrdinalTraitSnapshot(
      { ...rule, asset_type: 'ordinal' },
      {
        criteria_hash: 'hash',
        fetched_at: '2026-10-19T00:00:00.000Z',
        inscription_ids: [],
      },
    );
    expect(q.eq).toHaveBeenCalledWith(
      'trait_filter',
      JSON.stringify(trait_filter),
    );
  });
  it('finds simple conflicts using the generated semantic key', async () => {
    await db.findConflictingRule(
      'server',
      'verify',
      'holder',
      'comrades',
      'Hat',
      'Crown',
      1,
    );
    expect(q.eq).toHaveBeenCalledWith('trait_key', expect.any(String));
  });
  it('renders the portal, command editor and Discord feedback from canonical-only rules', () => {
    expect(portalRule(rule).trait_filter).toEqual(trait_filter);
    expect(
      ruleEditFields(rule).find((field) => field.key === 'attribute_key')
        ?.value,
    ).toBe('Hat');
    expect(
      ruleEditFields(rule).find((field) => field.key === 'attribute_value')
        ?.value,
    ).toBe('Crown');
    expect(AdminFeedback.formatRule(rule)).toContain('Hat=Crown');
    const display = Object.create(DiscordVerificationService.prototype);
    expect(display.formatRoleRequirement(rule)).toContain('Crown');
  });
  it('keeps simple Discord edits while persisting the canonical filter', async () => {
    const data: any = {
      getAllSlugs: async () => ['comrades'],
      getAttributeKeys: async () => ['Hat'],
      getAllAttributeValues: async () => ['Crown', 'Cap'],
    };
    const edit = new RuleEditService(data, null, null, null);
    const after = await edit.prepare(rule, {
      slug: 'comrades',
      attribute_key: 'Hat',
      attribute_value: 'Cap',
      min_items: '1',
    });
    await db.editRule(rule, after);
    expect(q.update.mock.calls[0][0].trait_filter).toEqual({
      operator: 'AND',
      conditions: [{ key: 'Hat', value: 'Cap' }],
    });
  });
  it('rejects traits on specific-inscription selections using canonical data', () => {
    expect(() =>
      inscriptionCriteria({
        ...rule,
        slug: null,
        inscription_criteria: { kind: 'numbers', ranges: [[1, 2]] },
      }),
    ).toThrow('Invalid specific');
  });
});
