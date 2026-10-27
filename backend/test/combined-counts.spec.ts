import { IncompleteEthscriptionTraitsError } from '../src/utils/ethscription-traits.util';
import { VerificationEngine } from '../src/services/verification-engine.service';

const rule = (id: number, type = 'ethscription', minimum = 10, extra = {}) => ({
  id, server_id: 'server', role_id: 'role', asset_type: type, min_items: minimum, ...extra,
} as any);

describe('combined collectible role counts', () => {
  let engine: VerificationEngine;
  let ownership: any;
  let rules: any[];
  beforeEach(() => {
    rules = [rule(1), rule(2, 'ordinal')];
    ownership = {
      count: jest.fn(async (rule) => rule.id === 1 ? 7n : 3n),
      matchingAssets: jest.fn(),
    };
    engine = new VerificationEngine({ getRoleMappings: async () => rules, getRuleById: async id => rules.find(rule => String(rule.id) === String(id)) } as any,
      ownership, { getUserAddresses: async () => ['0x123', 'bc1ptest'] } as any,
      { allowedAddresses: async (_, addresses) => addresses } as any);
  });
  const verify = () => engine.verifyUserBulk('member', rules.map(rule => rule.id), '0x123');

  it('combines seven Ethscriptions and three Ordinals, including scheduled evaluation', async () => {
    const result = await verify();
    expect(result.validRules).toHaveLength(2);
    expect(result.matchingAssetCounts.get('1')).toBe(10);
    expect(ownership.matchingAssets).not.toHaveBeenCalled();
    expect((await engine.evaluateRole('member', 'server', 'role')).status).toBe('passed');
  });
  it('does not combine different minimums or roles or servers', async () => {
    for (const change of [{ min_items: 11 }, { role_id: 'other' }, { server_id: 'other' }]) {
      rules[1] = rule(2, 'ordinal', 10, change);
      expect((await verify()).validRules).toHaveLength(0);
    }
  });
  it('does not mix ERC-20 amounts into collectible counts', async () => {
    rules[1] = rule(2, 'erc20', 10, { min_balance: '10', token_decimals: 0 });
    expect((await verify()).validRules).toHaveLength(0);
  });
  it('counts overlapping collection and trait matches only once', async () => {
    rules = [rule(1, 'ordinal', 8), rule(2, 'ordinal', 8, { attribute_key: 'Crown', attribute_value: 'Gold' })];
    ownership.count.mockImplementation(async rule => rule.id === 1 ? 6n : 2n);
    ownership.matchingAssets.mockImplementation(async rule => new Map(
      (rule.id === 1 ? ['a', 'b', 'c', 'd', 'e', 'f'] : ['a', 'b']).map(id => [id, 1n])));
    expect((await verify()).validRules).toHaveLength(0);
    expect((await engine.evaluateRole('member', 'server', 'role')).status).toBe('failed');
  });
  it('combines distinct assets within a protocol and preserves selection criteria', async () => {
    rules = [rule(1), rule(2, 'ethscription', 10, { inscription_criteria: { kind: 'ids', ids: ['h'] } })];
    ownership.matchingAssets.mockImplementation(async rule => new Map(
      (rule.id === 1 ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'] : ['h', 'i', 'j']).map(id => [id, 1n])));
    expect((await verify()).validRules).toHaveLength(2);
    expect(ownership.matchingAssets.mock.calls[1][0].inscription_criteria).toEqual(rules[1].inscription_criteria);
  });
  it('keeps existing roles when a provider is unavailable', async () => {
    ownership.count.mockImplementation(async rule => { if (rule.id === 2) throw new Error('offline'); return 7n; });
    expect((await engine.evaluateRole('member', 'server', 'role')).status).toBe('unavailable');
  });
  it('still passes if the known holdings meet the minimum during another provider outage', async () => {
    ownership.count.mockImplementation(async rule => { if (rule.id === 2) throw new Error('offline'); return 10n; });
    expect((await engine.evaluateRole('member', 'server', 'role')).status).toBe('passed');
  });
  it('combines known matches from incomplete Ethscription metadata with another protocol', async () => {
    ownership.count.mockImplementation(async rule=>{if(rule.id===1)throw new IncompleteEthscriptionTraitsError(['a','b','c','d','e','f','g'],1);return 3n;});
    expect((await verify()).validRules).toHaveLength(2);
    rules[1]=rule(2,'ordinal',10);ownership.count.mockImplementation(async rule=>{if(rule.id===1)throw new IncompleteEthscriptionTraitsError(['a'],1);return 3n;});
    expect((await engine.evaluateRole('member','server','role')).status).toBe('unavailable');
  });
  it('unions partial matches within a protocol without counting the same asset twice', async () => {
    rules=[rule(1,'ethscription',3),rule(2,'ethscription',3)];
    ownership.count.mockRejectedValue(new IncompleteEthscriptionTraitsError(['a','b'],1));
    ownership.matchingAssets.mockImplementation(async rule=>{throw new IncompleteEthscriptionTraitsError(rule.id===1?['a','b']:['b','c'],1);});
    expect((await verify()).validRules).toHaveLength(2);
    ownership.matchingAssets.mockRejectedValue(new IncompleteEthscriptionTraitsError(['a','b'],1));
    expect((await engine.evaluateRole('member','server','role')).status).toBe('unavailable');
  });
  it('does not silently accept partial trait evidence in export checks', async () => {
    ownership.count.mockImplementation(async rule=>{if(rule.id===1)throw new IncompleteEthscriptionTraitsError(['a','b','c','d','e','f','g'],1);return 3n;});
    const result=await engine.verifyUserBulk('member',rules.map(r=>r.id),'0x123',rules,{checks:new Map(),freshExport:true});
    expect(result.results.every(r=>r.status==='unavailable')).toBe(true);
  });
  it('does not treat an Ordinals trait upper bound as an exact matching count', async () => {
    ownership.checkDetails = (rule) => rule.id === 2 ? { source: 'collection-upper-bound', provider: 'xverse' } : undefined;
    expect((await engine.evaluateRole('member', 'server', 'role')).status).toBe('unavailable');
  });
  it('preserves ERC-1155 copy counts without double counting overlapping copies', async () => {
    rules = [rule(1, 'nft', 10, { chain_id: 1, contract_address: '0xabc' }), rule(2, 'nft', 10, { chain_id: 1, contract_address: '0xABC' })];
    ownership.matchingAssets.mockImplementation(async rule => new Map(rule.id === 1 ? [['1', 7n]] : [['1', 7n], ['2', 3n]]));
    const result = await verify();
    expect(result.matchingAssetCounts.get('1')).toBe(10);
  });
});

import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { NftOwnershipService } from '../src/services/nft-ownership.service';

describe('identities for overlapping rules', () => {
  it('filters a shared Ordinals inventory by collection traits and by number without duplicating wallets', async () => {
    const items = new Map([
      ['a', { traits: [{ type: 'Crown', value: 'Gold' }] }], ['b', { traits: [{ type: 'Crown', value: 'Silver' }] }],
    ]);
    const service = new OrdinalsOwnershipService(undefined, undefined, undefined,
      { snapshot: async () => ({ items }) } as any,
      { inventory: async () => ({ ids: new Set(['a', 'b', 'outside']), numbers: new Map([['a', 1], ['b', 2], ['outside', 3]]) }) } as any);
    const context = { checks: new Map() };
    const trait = rule(1, 'ordinal', 10, { slug: 'test', attribute_key: 'Crown', attribute_value: 'Gold' });
    expect([...await service.matchingAssets(trait, ['bc1pqq7gz5dnkmqa2w4c8tgt8j0wk2zl4umh49kmctykuf9njugp785srx2arl', 'bc1pqq7gz5dnkmqa2w4c8tgt8j0wk2zl4umh49kmctykuf9njugp785srx2arl'], context)]).toEqual([['a', 1n]]);
    const numeric = rule(2, 'ordinal', 10, { inscription_criteria: { kind: 'numbers', ranges: [[2, 3]] } });
    expect([...await service.matchingAssets(numeric, ['bc1pqq7gz5dnkmqa2w4c8tgt8j0wk2zl4umh49kmctykuf9njugp785srx2arl'], context)]).toEqual([['b', 1n], ['outside', 1n]]);
  });
  it('preserves ERC-1155 copies when filtering traits and reuses token metadata', async () => {
    const metadata = { attributes: jest.fn(async () => new Map([['1', [{ trait_type: 'Crown', value: 'Gold' }]], ['2', [{ trait_type: 'Crown', value: 'Silver' }]]])) };
    const service = new NftOwnershipService(metadata as any);
    jest.spyOn(service as any, 'blockNumber').mockResolvedValue(1n);
    const owned = jest.spyOn(service as any, 'readOwnedTokens').mockResolvedValue(new Map([['1', 7n], ['2', 3n]]));
    const nft = rule(1, 'nft', 10, { chain_id: 1, contract_address: '0xabc', token_standard: 'erc1155', token_ids: ['1', '2'], attribute_key: 'Crown', attribute_value: 'Gold' });
    expect([...await service.matchingAssets(nft, ['0x123'], { checks: new Map() })]).toEqual([['1', 7n]]);
    expect(owned).toHaveBeenCalledTimes(1);
    expect(metadata.attributes).toHaveBeenCalledTimes(1);
  });
});
