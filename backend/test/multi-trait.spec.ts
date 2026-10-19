import { prepareRuleCriteria } from '../src/services/rule-create.util';
import {
  matchesTraits,
  normalizeTraitFilter,
  ruleTraits,
  traitFilterKey,
  TraitFilter,
} from '../src/utils/trait-filter.util';
import { matchesNftTrait } from '../src/utils/nft-trait.util';
import {
  ordinalTraitHash,
  buildOrdinalTraitSnapshot,
  usableOrdinalTraitSnapshot,
} from '../src/utils/ordinal-rule.util';
import { ruleCriteriaKey } from '../src/utils/rule-edit.util';
import { RuleEditService } from '../src/services/rule-edit.service';
import { portalRule } from '../src/portal/portal.service';

const conditions = [
  { key: 'Background', value: 'Blue' },
  { key: 'Hat', value: 'Crown' },
];
const filter = (operator: 'AND' | 'OR' = 'AND'): TraitFilter => ({
  operator,
  conditions,
});
const base: any = {
  id: 1,
  server_id: 'server',
  channel_id: 'channel',
  role_id: 'role',
  asset_type: 'ordinal',
  slug: 'comrades',
  min_items: 1,
  attribute_key: 'Background',
  attribute_value: 'Blue',
};
const attributes = conditions.map((c) => ({ key: c.key, value: c.value }));

describe('Multi-trait rules', () => {
  it('requires AND conditions on one asset; OR matches any condition once', () => {
    expect(matchesTraits(attributes, { trait_filter: filter() })).toBe(true);
    expect(
      matchesTraits(attributes.slice(0, 1), { trait_filter: filter() }),
    ).toBe(false);
    expect(matchesTraits(attributes.slice(1), { trait_filter: filter() })).toBe(
      false,
    );
    expect(
      matchesTraits(attributes.slice(1), { trait_filter: filter('OR') }),
    ).toBe(true);
    expect(matchesTraits([], { trait_filter: filter('OR') })).toBe(false);
    expect(
      matchesNftTrait(
        attributes.map((c) => ({ trait_type: c.key, value: c.value })),
        { trait_filter: filter() },
      ),
    ).toBe(true);
  });
  it('canonicalizes reordered/case-variant conditions and duplicates without changing display spelling', () => {
    const variant: TraitFilter = {
      operator: 'AND',
      conditions: [
        { key: ' hat ', value: ' crown ' },
        { key: 'BACKGROUND', value: 'BLUE' },
        conditions[0],
      ],
    };
    expect(traitFilterKey({ trait_filter: variant })).toBe(
      traitFilterKey({ trait_filter: filter() }),
    );
    expect(
      normalizeTraitFilter({
        operator: 'OR',
        conditions: [conditions[0], conditions[0]],
      })?.operator,
    ).toBe('AND');
    expect(ruleCriteriaKey({ ...base, trait_filter: variant })).toBe(
      ruleCriteriaKey({ ...base, trait_filter: filter() }),
    );
    expect(traitFilterKey({ trait_filter: filter('OR') })).not.toBe(
      traitFilterKey({ trait_filter: filter() }),
    );
    expect(ruleTraits({ ...base, trait_filter: null })).toBeNull();
    expect(ruleTraits(base)?.conditions).toEqual([conditions[0]]);
  });
  it.each([
    {},
    { operator: 'X', conditions },
    { operator: 'AND', conditions: Array(11).fill(conditions[0]) },
    { operator: 'AND', conditions: [{ key: '', value: 'Blue' }] },
    { operator: 'OR', conditions: [{ key: 'ALL', value: 'ALL' }] },
    { operator: 'AND', conditions: [{ ...conditions[0], ignored: true }] },
  ])('rejects malformed filters: %j', (value) => {
    expect(() => normalizeTraitFilter(value)).toThrow();
  });
  it('keeps single-trait snapshot hashes and invalidates a snapshot for any condition/operator change', () => {
    expect(ordinalTraitHash({ ...base, trait_filter: ruleTraits(base) })).toBe(
      ordinalTraitHash(base),
    );
    const rule = { ...base, trait_filter: filter() };
    const id = (n: number) => 'a'.repeat(64) + 'i' + n;
    const collection: any = {
      slug: 'comrades',
      fetched_at: new Date().toISOString(),
      items: new Map([
        [
          id(1),
          { traits: conditions.map((c) => ({ type: c.key, value: c.value })) },
        ],
        [id(2), { traits: [{ type: 'Background', value: 'Blue' }] }],
      ]),
    };
    const snapshot = buildOrdinalTraitSnapshot(rule, collection);
    expect(snapshot.inscription_ids).toEqual([id(1)]);
    expect(
      buildOrdinalTraitSnapshot(
        { ...rule, trait_filter: filter('OR') },
        collection,
      ).inscription_ids,
    ).toEqual([id(1), id(2)]);
    expect(
      usableOrdinalTraitSnapshot({ ...rule, ordinal_trait_snapshot: snapshot }),
    ).toBe(snapshot);
    expect(
      usableOrdinalTraitSnapshot({
        ...rule,
        trait_filter: filter('OR'),
        ordinal_trait_snapshot: snapshot,
      }),
    ).toBeNull();
    expect(
      ordinalTraitHash({
        ...rule,
        trait_filter: {
          operator: 'AND',
          conditions: [conditions[0], { key: 'Hat', value: 'Cap' }],
        },
      }),
    ).not.toBe(snapshot.criteria_hash);
  });
  it('exposes complete editable criteria but no metadata inventory', () => {
    const result = portalRule({ ...base, trait_filter: filter() });
    expect(result.fields.find((f) => f.key === 'trait_filter')?.value).toBe(
      JSON.stringify(filter()),
    );
    expect(result.trait_filter).toEqual(filter());
  });
  it('passes all NFT creation conditions to provider validation', async () => {
    const nfts: any = {
      prepareRule: jest
        .fn()
        .mockResolvedValue({
          asset_type: 'nft',
          chain_id: 1,
          contract_address: '0x' + '1'.repeat(40),
          token_standard: 'erc721',
          token_ids: null,
        }),
      validateTraits: jest.fn(),
    };
    const prepared = await prepareRuleCriteria(
      {
        asset_type: 'nft',
        contract_address: '0x' + '1'.repeat(40),
        trait_filter: filter(),
        min_items: 2,
      },
      { data: null, nfts },
    );
    expect(prepared.assetFields.trait_filter).toEqual(filter());
    expect(nfts.validateTraits).toHaveBeenCalledWith(
      expect.objectContaining({ trait_filter: filter() }),
    );
  });
  it('validates every Ethscriptions condition and preserves them through edits', async () => {
    const data: any = {
      getAllSlugs: jest.fn().mockResolvedValue(['comrades']),
      getAttributeKeys: jest.fn().mockResolvedValue(['Background', 'Hat']),
      getAllAttributeValues: jest
        .fn()
        .mockImplementation((key) =>
          Promise.resolve(key === 'Background' ? ['Blue'] : ['Crown', 'Cap']),
        ),
    };
    const prepared = await prepareRuleCriteria(
      {
        asset_type: 'ethscription',
        slug: 'comrades',
        trait_filter: filter('OR'),
      },
      { data, nfts: null },
    );
    expect(prepared.assetFields.trait_filter).toEqual(filter('OR'));
    expect(data.getAllAttributeValues).toHaveBeenCalledWith('Hat', 'comrades');
    const edit = new RuleEditService(data, null, null, null);
    const changed = await edit.prepare(
      { ...base, asset_type: 'ethscription', trait_filter: filter() },
      {
        slug: 'comrades',
        min_items: '3',
        trait_filter: JSON.stringify({
          operator: 'AND',
          conditions: [conditions[0], { key: 'Hat', value: 'Cap' }],
        }),
      },
    );
    expect(changed.trait_filter.conditions[1]).toEqual({
      key: 'Hat',
      value: 'Cap',
    });
    expect(changed.min_items).toBe(3);
    await expect(
      prepareRuleCriteria(
        {
          asset_type: 'ethscription',
          slug: 'comrades',
          trait_filter: {
            operator: 'AND',
            conditions: [conditions[0], { key: 'Hat', value: 'Missing' }],
          },
        },
        { data, nfts: null },
      ),
    ).rejects.toThrow('does not exist');
  });
  it('refuses legacy modal fields for a multi-trait rule', async () => {
    const edit = new RuleEditService(null, null, null, null);
    await expect(
      edit.prepare(
        { ...base, trait_filter: filter() },
        {
          slug: 'comrades',
          attribute_key: 'Background',
          attribute_value: 'Blue',
          min_items: '1',
        },
      ),
    ).rejects.toThrow();
  });
});
