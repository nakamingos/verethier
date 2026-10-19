import { planRuleConsolidation } from '../src/utils/rule-consolidation.util';
import { matchesTraits, ruleTraits } from '../src/utils/trait-filter.util';
import { ordinalTraitHash } from '../src/utils/ordinal-rule.util';
const rule = (id: number, key = 'Hat', value = 'Crown', extra: any = {}) =>
  ({
    id,
    server_id: 'server',
    channel_id: 'verify',
    role_id: 'holder',
    asset_type: 'ethscription',
    chain_id: 1,
    slug: 'comrades',
    min_items: 1,
    trait_filter: { operator: 'AND', conditions: [{ key, value }] },
    ...extra,
  }) as any;
describe('Safe existing-rule consolidation', () => {
  it('retains the lowest ID and preserves the asset union for every combination of trait matches', () => {
    const before = [
      rule(3, 'Hat', 'Cap'),
      rule(1),
      rule(2, 'Background', 'Blue'),
    ];
    const plan = planRuleConsolidation(before)[0];
    expect(plan.after.id).toBe(1);
    expect(plan.before.map((r) => r.id)).toEqual([1, 2, 3]);
    const conditions = before.flatMap((r) => ruleTraits(r).conditions);
    for (let subset = 0; subset < 1 << conditions.length; subset++) {
      const attributes = conditions.filter((_, i) => subset & (1 << i));
      expect(matchesTraits(attributes, plan.after)).toBe(
        before.some((r) => matchesTraits(attributes, r)),
      );
    }
  });
  it.each([
    'server_id',
    'channel_id',
    'role_id',
    'slug',
    'min_items',
    'collection_name',
    'token_ids',
  ])('does not merge different %s', (key) => {
    expect(
      planRuleConsolidation([
        rule(1),
        rule(2, 'Hat', 'Cap', {
          [key]:
            key === 'min_items' ? 2 : key === 'token_ids' ? ['1'] : 'different',
        }),
      ]),
    ).toEqual([]);
  });
  it('preserves nested AND rules and excludes tokens or specific inscriptions', () => {
    expect(
      planRuleConsolidation([
        rule(1),
        rule(2, 'Hat', 'Cap', {
          trait_filter: {
            operator: 'AND',
            conditions: [
              { key: 'Hat', value: 'Cap' },
              { key: 'Background', value: 'Blue' },
            ],
          },
        }),
      ]),
    ).toEqual([]);
    expect(
      planRuleConsolidation([
        rule(1),
        rule(2, 'Hat', 'Cap', {
          inscription_criteria: { kind: 'numbers', ranges: [[1, 2]] },
        }),
      ]),
    ).toEqual([]);
  });
  it('enforces the condition limit and deduplicates equivalent conditions', () => {
    expect(
      planRuleConsolidation(
        Array.from({ length: 11 }, (_, n) => rule(n, 'Hat', String(n))),
      ),
    ).toEqual([]);
    expect(
      ruleTraits(
        planRuleConsolidation([rule(1), rule(2, 'hat', 'crown')])[0].after,
      ).conditions,
    ).toHaveLength(1);
  });
  it('merges Ordinals cache identities without making older metadata appear fresh', () => {
    const before = [
      rule(1, 'Hat', 'Crown', { asset_type: 'ordinal', chain_id: null }),
      rule(2, 'Hat', 'Cap', { asset_type: 'ordinal', chain_id: null }),
    ];
    before.forEach(
      (r, i) =>
        (r.ordinal_trait_snapshot = {
          criteria_hash: ordinalTraitHash(r),
          fetched_at: `2026-10-19T0${i}:00:00.000Z`,
          inscription_ids: ['a'.repeat(64) + 'i' + i],
        }),
    );
    const after = planRuleConsolidation(before)[0].after;
    expect(after.ordinal_trait_snapshot.inscription_ids).toHaveLength(2);
    expect(after.ordinal_trait_snapshot.fetched_at).toBe(
      before[0].ordinal_trait_snapshot.fetched_at,
    );
    expect(after.ordinal_trait_snapshot.criteria_hash).toBe(
      ordinalTraitHash(after),
    );
  });
});
