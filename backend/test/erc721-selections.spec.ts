import { BaseError, ContractFunctionRevertedError, parseAbi } from 'viem';
import {
  NftOwnershipService,
  NftCheckContext,
} from '../src/services/nft-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { prepareRuleCriteria } from '../src/services/rule-create.util';
import { RuleEditService } from '../src/services/rule-edit.service';
import { parseTokenIds } from '../src/utils/nft-rule.util';
import { ruleCriteriaKey, ruleEditFields } from '../src/utils/rule-edit.util';

const contract = '0x' + '1'.repeat(40),
  wallet = '0x' + '2'.repeat(40),
  other = '0x' + '3'.repeat(40),
  outsider = '0x' + '4'.repeat(40);
const base: any = {
  id: 1,
  server_id: 'server',
  channel_id: 'verify',
  role_id: 'holder',
  role_name: 'Holder',
  asset_type: 'nft',
  chain_id: 1,
  contract_address: contract,
  token_standard: 'erc721',
  token_ids: ['1', '2', '3'],
  min_items: 2,
  slug: null,
  attribute_key: 'ALL',
  attribute_value: 'ALL',
  trait_filter: null,
};
const fresh = (): NftCheckContext => ({ checks: new Map() });

describe('ERC-721 ID selections', () => {
  let service: NftOwnershipService, rpc: any, metadata: any;
  beforeEach(() => {
    metadata = {
      ownedIds: jest.fn(),
      attributes: jest.fn(),
      suggestions: jest.fn(),
    };
    service = new NftOwnershipService(metadata);
    rpc = {
      getChainId: jest.fn().mockResolvedValue(1),
      getBlockNumber: jest.fn().mockResolvedValue(123n),
      readContract: jest
        .fn()
        .mockImplementation(async ({ functionName, args }) => {
          if (functionName === 'supportsInterface')
            return args[0] === '0x80ac58cd';
          if (functionName === 'name') return 'Collection';
          if (functionName === 'ownerOf')
            return args[0] === 1n ? wallet : args[0] === 2n ? other : outsider;
          throw new Error('Unexpected RPC operation');
        }),
    };
    jest.spyOn(service as any, 'getClient').mockReturnValue(rpc);
  });
  it.each([1, 4663])(
    'counts all selected IDs across deduplicated wallets on chain %s',
    async (chain_id) => {
      rpc.getChainId.mockResolvedValue(chain_id);
      const rule = { ...base, chain_id },
        context = fresh();
      expect(
        await service.count(
          rule,
          [wallet, other, wallet.toUpperCase()],
          context,
        ),
      ).toBe(2n);
      expect([
        ...(await service.matchingAssets(rule, [other, wallet], context)),
      ]).toEqual([
        ['1', 1n],
        ['2', 1n],
      ]);
      expect(rpc.readContract).toHaveBeenCalledTimes(3);
      expect(rpc.getBlockNumber).toHaveBeenCalledTimes(1);
      for (const [call] of rpc.readContract.mock.calls)
        expect(call).toMatchObject({
          functionName: 'ownerOf',
          blockNumber: 123n,
        });
      expect(metadata.ownedIds).not.toHaveBeenCalled();
      expect(metadata.attributes).not.toHaveBeenCalled();
    },
  );
  it('bounds concurrent owner reads and does not stop at the first matching ID', async () => {
    let concurrent = 0,
      max = 0;
    rpc.readContract.mockImplementation(async () => {
      concurrent++;
      max = Math.max(max, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent--;
      return wallet;
    });
    expect(
      await service.count({ ...base, token_ids: parseTokenIds('0-204') }, [
        wallet,
      ]),
    ).toBe(205n);
    expect(max).toBeLessThanOrEqual(100);
    expect(rpc.readContract).toHaveBeenCalledTimes(205);
  });
  it('reuses selected ownership across quantity and trait checks, including OR deduplication', async () => {
    metadata.attributes.mockResolvedValue(
      new Map([
        [
          '1',
          [
            { trait_type: 'Hat', value: 'Crown' },
            { trait_type: 'Background', value: 'Blue' },
          ],
        ],
        ['2', [{ trait_type: 'Background', value: 'Blue' }]],
      ]),
    );
    const context = fresh();
    expect(await service.count(base, [wallet, other], context)).toBe(2n);
    const conditions = [
      { key: 'Hat', value: 'Crown' },
      { key: 'Background', value: 'Blue' },
    ];
    expect(
      await service.count(
        { ...base, trait_filter: { operator: 'AND', conditions } },
        [wallet, other],
        context,
      ),
    ).toBe(1n);
    expect(
      await service.count(
        { ...base, trait_filter: { operator: 'OR', conditions } },
        [wallet, other],
        context,
      ),
    ).toBe(2n);
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
    expect(metadata.attributes).toHaveBeenCalledTimes(1);
    expect(metadata.attributes.mock.calls[0][1]).toEqual(['1', '2']);
  });
  it('counts burned or unminted IDs as zero without dropping the remaining owned IDs', async () => {
    const revert = new BaseError('Reverted', {
      cause: new ContractFunctionRevertedError({
        abi: parseAbi(['function ownerOf(uint256) view returns (address)']),
        functionName: 'ownerOf',
      }),
    });
    rpc.readContract.mockImplementation(async ({ args }) => {
      if (args[0] === 2n) throw revert;
      return wallet;
    });
    expect(await service.count(base, [wallet])).toBe(2n);
  });
  it('never returns a partial count when a later ownership batch fails', async () => {
    rpc.readContract.mockImplementation(async ({ args }) => {
      if (args[0] === 100n) throw new Error('RPC timeout');
      return wallet;
    });
    const context = fresh(),
      rule = { ...base, token_ids: parseTokenIds('0-100') };
    await expect(service.count(rule, [wallet], context)).rejects.toThrow(
      'RPC timeout',
    );
    await expect(service.count(rule, [wallet], context)).rejects.toThrow(
      'RPC timeout',
    );
    expect(rpc.readContract).toHaveBeenCalledTimes(101);
  });
  it('keeps selections isolated while sharing the pinned block', async () => {
    const context = fresh();
    expect(
      await service.count({ ...base, token_ids: ['1'] }, [wallet], context),
    ).toBe(1n);
    expect(
      await service.count(
        { ...base, token_ids: ['2', '3'] },
        [wallet],
        context,
      ),
    ).toBe(0n);
    expect(rpc.getBlockNumber).toHaveBeenCalledTimes(1);
  });
  it('preserves exact uint256 IDs and canonicalizes overlapping selections', async () => {
    const max = ((1n << 256n) - 1n).toString();
    expect(
      (await service.prepareRule(contract, `0002,1-3,2,${max}`)).token_ids,
    ).toEqual(['1', '2', '3', max]);
    expect((await service.prepareRule(contract, ' ')).token_ids).toBeNull();
    expect((await service.prepareRule(contract, '0')).token_ids).toEqual(['0']);
  });
  it('shares creation validation between portal and slash inputs and permits combined quantity thresholds', async () => {
    const prepared = await prepareRuleCriteria(
      {
        asset_type: 'nft',
        contract_address: contract,
        token_ids: '1-3,2',
        min_items: 3,
      },
      { data: null, nfts: service },
    );
    expect(prepared).toMatchObject({
      assetFields: { token_ids: ['1', '2', '3'], token_standard: 'erc721' },
      minItems: 3,
    });
    // A single-ID rule can contribute one item to a group whose total minimum is two.
    expect(
      (
        await prepareRuleCriteria(
          {
            asset_type: 'nft',
            contract_address: contract,
            token_ids: '1',
            min_items: 2,
          },
          { data: null, nfts: service },
        )
      ).minItems,
    ).toBe(2);
  });
  it('round-trips selection edits and canonical identities without changing rule identity', async () => {
    const editor = new RuleEditService(null, service, null, null);
    const input = { token_ids: '2,1-3', min_items: '3', trait_filter: 'null' };
    const after = await editor.prepare(base, input);
    expect(after).toMatchObject({
      id: base.id,
      role_id: base.role_id,
      token_ids: ['1', '2', '3'],
      min_items: 3,
    });
    expect(
      ruleEditFields(after).find((f) => f.key === 'token_ids')?.value,
    ).toBe('1-3');
    expect(ruleCriteriaKey(after)).toBe(
      ruleCriteriaKey({ ...after, token_ids: parseTokenIds('3,1,2') }),
    );
    expect(
      (await editor.prepare(after, { ...input, token_ids: '' })).token_ids,
    ).toBeNull();
  });
  it('deduplicates overlapping selection rules using actual ownership before applying the combined threshold', async () => {
    rpc.readContract.mockResolvedValue(wallet);
    const rules = [
      { ...base, token_ids: ['1', '2'], min_items: 4 },
      { ...base, id: 2, token_ids: ['2', '3'], min_items: 4 },
    ];
    const db: any = {
      getRoleMappings: async () => rules,
      getRuleById: async (id) => rules.find((r) => String(r.id) === String(id)),
    };
    const ownership = new AssetOwnershipService(null, service);
    const engine = new VerificationEngine(
      db,
      ownership,
      { getUserAddresses: async () => [wallet] } as any,
      { allowedAddresses: async (_, addresses) => addresses } as any,
    );
    expect(
      (await engine.evaluateRole('member', 'server', 'holder')).status,
    ).toBe('failed');
    rules.forEach((r) => (r.min_items = 3));
    expect(
      (await engine.evaluateRole('member', 'server', 'holder')).status,
    ).toBe('passed');
    rpc.readContract.mockRejectedValue(new Error('RPC unavailable'));
    expect(
      (await engine.evaluateRole('member', 'server', 'holder')).status,
    ).toBe('unavailable');
  });
});
