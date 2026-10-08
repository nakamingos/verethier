import { BaseError, ContractFunctionRevertedError, parseAbi } from 'viem';
import { NftOwnershipService, NftCheckContext } from '../src/services/nft-ownership.service';
import { NftMetadataService } from '../src/services/nft-metadata.service';
import { NftRuleFields } from '../src/models/verifier-role.interface';
import { matchesNftTrait, nftTrait, nftTokenId, parseNftAttributes } from '../src/utils/nft-trait.util';
import { nftRuleCriteria } from '../src/utils/nft-rule.util';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';

const contract = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const red = [{ trait_type: 'Color', value: 'Red' }];
const blue = [{ trait_type: 'Color', value: 'Blue' }];
const rule: NftRuleFields = { asset_type: 'nft', chain_id: 1, contract_address: contract, token_standard: 'erc721', token_ids: null, attribute_key: 'Color', attribute_value: 'Red' };

describe('NFT trait metadata parsing', () => {
  it('accepts string, number and boolean traits and skips display-only values', () => {
    expect(parseNftAttributes([{ trait_type: ' Level ', value: 10 }, { trait_type: 'Rare', value: false }, { value: 'display' }]))
      .toEqual([{ trait_type: 'Level', value: '10' }, { trait_type: 'Rare', value: 'false' }]);
    expect(matchesNftTrait(red, { ...rule, attribute_key: 'color', attribute_value: 'red' })).toBe(true);
    expect(matchesNftTrait(blue, { ...rule, attribute_value: 'ALL' })).toBe(true);
    expect(matchesNftTrait([], rule)).toBe(false);
    expect(matchesNftTrait(blue, rule)).toBe(false);
  });
  it.each([undefined, null, {}, [{ trait_type: 'Color' }], [{ trait_type: 'Color', value: {} }], [{ trait_type: 'Color', value: Infinity }]].map(attributes => ({ attributes })))('rejects unreadable attributes: %s', ({ attributes }) => {
    expect(() => parseNftAttributes(attributes)).toThrow('readable');
  });
  it('validates rule inputs, preserving wildcard behavior', () => {
    expect(nftTrait({})).toEqual({ key: 'ALL', value: 'ALL', enabled: false });
    expect(nftTrait({ attribute_key: ' Color ' })).toEqual({ key: 'Color', value: 'ALL', enabled: true });
    expect(() => nftTrait({ attribute_value: 'Red' })).toThrow('attribute_key');
    expect(() => nftTrait({ attribute_key: ' ' })).toThrow('1–100');
    expect(() => nftTrait({ attribute_key: 'x'.repeat(101) })).toThrow('1–100');
    expect(nftRuleCriteria(rule)).toContain('Color=Red');
    expect(nftRuleCriteria({ ...rule, attribute_value: 'ALL' })).toContain('Color (any value)');
  });
  it('canonicalizes decimal and hexadecimal uint256 IDs without losing precision', () => {
    const max = ((1n << 256n) - 1n).toString();
    expect(nftTokenId(max)).toBe(max);
    expect(nftTokenId('0x001f')).toBe('31');
    expect(nftTokenId('0001')).toBe('1');
    for (const bad of ['-1', '1.5', (1n << 256n).toString(), 1, null]) expect(() => nftTokenId(bad)).toThrow('Invalid');
  });
});

describe('NFT trait ownership', () => {
  let service: NftOwnershipService;
  let rpc: { getChainId: jest.Mock; getBlockNumber: jest.Mock; readContract: jest.Mock };
  let metadata: { ownedIds: jest.Mock; attributes: jest.Mock; suggestions: jest.Mock };
  beforeEach(() => {
    metadata = { ownedIds: jest.fn().mockResolvedValue(['1', '2']), attributes: jest.fn().mockResolvedValue(new Map([['1', red], ['2', blue]])), suggestions: jest.fn().mockResolvedValue(['Color']) };
    service = new NftOwnershipService(metadata as unknown as NftMetadataService);
    rpc = { getChainId: jest.fn().mockResolvedValue(1), getBlockNumber: jest.fn().mockResolvedValue(123n), readContract: jest.fn() };
    rpc.readContract.mockImplementation(async ({ functionName }) => functionName === 'balanceOf' ? 2n : wallet);
    jest.spyOn(service as any, 'getClient').mockReturnValue(rpc);
  });
  it('counts only matching ERC-721s at one RPC block', async () => {
    expect(await service.count(rule, [wallet])).toBe(1n);
    expect(metadata.ownedIds).toHaveBeenCalledWith(rule, wallet);
    expect(metadata.attributes).toHaveBeenCalledWith(rule, ['1', '2']);
    rpc.readContract.mock.calls.forEach(([call]) => expect(call.blockNumber).toBe(123n));
  });
  it('shares token discovery, metadata and ownership across different traits in a run', async () => {
    const context: NftCheckContext = { checks: new Map() };
    expect(await Promise.all([
      service.count(rule, [wallet], context),
      service.count({ ...rule, attribute_value: 'Blue' }, [wallet], context),
      service.count({ ...rule, attribute_value: 'ALL' }, [wallet], context),
    ])).toEqual([1n, 1n, 2n]);
    expect(metadata.ownedIds).toHaveBeenCalledTimes(1);
    expect(metadata.attributes).toHaveBeenCalledTimes(1);
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
  });
  it('deduplicates linked wallets and transferred token IDs, trusting current RPC owners', async () => {
    metadata.ownedIds.mockImplementation(async (_rule, owner) => owner === wallet ? ['1', '2'] : ['2', '3']);
    metadata.attributes.mockResolvedValue(new Map([['1', red], ['2', red], ['3', blue]]));
    rpc.readContract.mockImplementation(async ({ functionName, args }) => functionName === 'balanceOf'
      ? args[0] === wallet ? 1n : 2n : args[0] === 1n ? wallet : other);
    expect(await service.count(rule, [wallet, wallet.toUpperCase(), other])).toBe(2n);
    expect(metadata.ownedIds).toHaveBeenCalledTimes(2);
    expect(metadata.attributes).toHaveBeenCalledWith(rule, ['1', '2', '3']);
  });
  it('refuses a partial ERC-721 inventory instead of returning a lower count', async () => {
    metadata.ownedIds.mockResolvedValue(['1']);
    await expect(service.count(rule, [wallet])).rejects.toThrow('temporarily unavailable');
    expect(metadata.attributes).not.toHaveBeenCalled();
  });
  it('refuses incomplete metadata instead of treating it as a nonmatching trait', async () => {
    metadata.attributes.mockResolvedValue(new Map([['1', red]]));
    await expect(service.count(rule, [wallet])).rejects.toThrow('temporarily unavailable');
  });
  it('propagates provider failures', async () => {
    metadata.attributes.mockRejectedValue(new Error('temporarily unavailable'));
    await expect(service.count(rule, [wallet])).rejects.toThrow('temporarily unavailable');
  });
  it('checks a specified ERC-721 without discovering other IDs', async () => {
    expect(await service.count({ ...rule, token_ids: ['1'] }, [wallet])).toBe(1n);
    expect(metadata.ownedIds).not.toHaveBeenCalled();
    expect(rpc.readContract).toHaveBeenCalledTimes(1);
    expect(metadata.attributes).toHaveBeenCalledWith(expect.anything(), ['1']);
  });
  it('does not fetch metadata for tokens the wallet no longer owns', async () => {
    rpc.readContract.mockResolvedValue(other);
    expect(await service.count({ ...rule, token_ids: ['1'] }, [wallet])).toBe(0n);
    expect(metadata.attributes).not.toHaveBeenCalled();
  });
  it('does not fetch metadata for burned exact tokens', async () => {
    rpc.readContract.mockRejectedValue(new BaseError('revert', { cause: new ContractFunctionRevertedError({ abi: parseAbi(['function ownerOf(uint256) view returns (address)']), functionName: 'ownerOf' }) }));
    expect(await service.count({ ...rule, token_ids: ['1'] }, [wallet])).toBe(0n);
    expect(metadata.attributes).not.toHaveBeenCalled();
  });
  it('skips Alchemy entirely for zero RPC balances and quantity-only rules', async () => {
    rpc.readContract.mockResolvedValue(0n);
    expect(await service.count(rule, [wallet])).toBe(0n);
    rpc.readContract.mockResolvedValue(3n);
    expect(await service.count({ ...rule, attribute_key: 'ALL', attribute_value: 'ALL' }, [wallet])).toBe(3n);
    expect(metadata.ownedIds).not.toHaveBeenCalled();
    expect(metadata.attributes).not.toHaveBeenCalled();
  });
  it('counts ERC-1155 copies only within the configured IDs, across linked wallets', async () => {
    rpc.readContract.mockImplementation(async ({ args }) => args[0].map((owner, index) => args[1][index] === 1n ? owner === wallet ? 3n : 4n : args[1][index] === 2n ? 10n : 0n));
    const erc1155 = { ...rule, token_standard: 'erc1155' as const, token_ids: ['1', '2', '500'] };
    expect(await service.count(erc1155, [wallet, other, wallet])).toBe(7n);
    expect(metadata.attributes).toHaveBeenCalledWith(erc1155, ['1', '2']);
    expect(metadata.ownedIds).not.toHaveBeenCalled();
  });
  it('refuses incomplete ERC-1155 balance batches', async () => {
    rpc.readContract.mockResolvedValue([1n]);
    await expect(service.count({ ...rule, token_standard: 'erc1155', token_ids: ['1', '2'] }, [wallet])).rejects.toThrow('incomplete');
    expect(metadata.attributes).not.toHaveBeenCalled();
  });
  it('keeps trait data and ownership separate on Ethereum and Robinhood', async () => {
    const robinhood = { ...rpc, getChainId: jest.fn().mockResolvedValue(4663) };
    (service as any).getClient.mockImplementation(chain => chain === 1 ? rpc : robinhood);
    metadata.attributes.mockImplementation(async nft => new Map([['1', nft.chain_id === 1 ? red : blue], ['2', blue]]));
    const context: NftCheckContext = { checks: new Map() };
    expect(await Promise.all([service.count(rule, [wallet], context), service.count({ ...rule, chain_id: 4663 }, [wallet], context)])).toEqual([1n, 0n]);
    expect(metadata.attributes).toHaveBeenCalledTimes(2);
  });
  it('checks metadata access only for rules with traits', async () => {
    await service.validateTraits({ ...rule, attribute_key: 'ALL', attribute_value: 'ALL' });
    expect(metadata.suggestions).not.toHaveBeenCalled();
    await service.validateTraits(rule);
    expect(metadata.suggestions).toHaveBeenCalledWith(rule);
  });
  it('uses matching quantities for role decisions and retains an existing role on metadata failure', async () => {
    const savedRule = { ...rule, id: 1, server_id: 'server', role_id: 'role', channel_id: 'channel', slug: null, min_items: 2 };
    const db = {
      getRuleById: jest.fn().mockResolvedValue(savedRule), getRoleMappings: jest.fn().mockResolvedValue([savedRule]),
      getUserActiveAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'server', role_id: 'role' }]),
      saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn(),
    };
    const adapter = new AssetOwnershipService({} as any, service);
    const engine = new VerificationEngine(db as any, adapter, { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any);
    expect(await engine.verifyUser('user', 1, wallet)).toMatchObject({ status: 'failed', matchingAssetCount: 1 });
    metadata.attributes.mockResolvedValue(new Map([['1', red], ['2', red]]));
    expect(await engine.verifyUser('user', 1, wallet)).toMatchObject({ status: 'passed', matchingAssetCount: 2 });
    metadata.attributes.mockRejectedValue(new Error('NFT trait verification is temporarily unavailable. Please try again.'));
    const discord = { removeUserRole: jest.fn() };
    const dynamic = new DynamicRoleService(db as any, engine, discord as any);
    expect(await dynamic.reverifyUser('user')).toEqual({ verified: 0, revoked: 0 });
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(db.updateLastVerified).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith('assignment', expect.objectContaining({ last_check_status: 'unavailable' }));
  });
});
