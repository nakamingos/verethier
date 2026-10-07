import { BaseError, ContractFunctionRevertedError, parseAbi } from 'viem';
import { NftOwnershipService, NftCheckContext } from '../src/services/nft-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { SimpleRoleMonitorService } from '../src/services/simple-role-monitor.service';
import { NftRuleFields } from '../src/models/verifier-role.interface';
import { parseTokenIds, serializeAssetCount, nftRuleCriteria } from '../src/utils/nft-rule.util';

const contract = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
const otherWallet = '0x3333333333333333333333333333333333333333';
const maxId = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
const nft: NftRuleFields = { asset_type: 'nft', chain_id: 1, contract_address: contract, token_standard: 'erc1155', token_ids: ['0', '1'], collection_name: 'Example' };

describe('NFT ownership', () => {
  let service: NftOwnershipService;
  let rpc: { getChainId: jest.Mock; getBlockNumber: jest.Mock; readContract: jest.Mock };
  beforeEach(() => {
    service = new NftOwnershipService();
    rpc = { getChainId: jest.fn().mockResolvedValue(1), getBlockNumber: jest.fn().mockResolvedValue(BigInt(123)), readContract: jest.fn() };
    jest.spyOn(service as any, 'getClient').mockReturnValue(rpc);
  });

  it('detects ERC-1155 and uses the default 0–99 scope without metadata', async () => {
    rpc.readContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === 'name') throw new Error('No name method');
      return args[0] === '0xd9b67a26';
    });
    const rule = await service.prepareRule(contract);
    expect(rule.token_standard).toBe('erc1155');
    expect(rule.token_ids).toEqual(parseTokenIds('0-99'));
    expect(rule.collection_name).toContain('0x1111');
    expect(nftRuleCriteria(rule)).toContain('IDs 0–99');
  });

  it('uses an admin label and preserves uint256 token IDs', async () => {
    rpc.readContract.mockImplementation(async ({ args }) => args[0] === '0xd9b67a26');
    const rule = await service.prepareRule(contract.toUpperCase().replace('0X', '0x'), `1,${maxId}`, 'My collection');
    expect(rule.token_ids).toEqual(['1', maxId]);
    expect(rule.collection_name).toBe('My collection');
    expect(rpc.readContract).toHaveBeenCalledTimes(2);
  });

  it.each([[false, false], [true, true]])('rejects unsupported or ambiguous standards (%s, %s)', async (erc721, erc1155) => {
    rpc.readContract.mockImplementation(async ({ args }) => args[0] === '0x80ac58cd' ? erc721 : erc1155);
    await expect(service.prepareRule(contract)).rejects.toThrow('exactly one');
  });

  it('supports an ERC-721 collection or one specified ID', async () => {
    rpc.readContract.mockImplementation(async ({ functionName, args }) => functionName === 'name' ? 'Collection' : args[0] === '0x80ac58cd');
    expect((await service.prepareRule(contract)).token_ids).toBeNull();
    expect((await service.prepareRule(contract, '0')).token_ids).toEqual(['0']);
    await expect(service.prepareRule(contract, '0-1')).rejects.toThrow('one token ID');
  });

  it('rejects non-mainnet RPC configuration', async () => {
    rpc.getChainId.mockResolvedValue(137);
    await expect(service.prepareRule(contract)).rejects.toThrow('mainnet');
    await expect(service.count(nft, [wallet])).rejects.toThrow('mainnet');
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it('stacks ERC-721 balances and deduplicates wallets', async () => {
    rpc.readContract.mockResolvedValue(BigInt(2));
    expect(await service.count({ ...nft, token_standard: 'erc721', token_ids: null }, [wallet, wallet.toUpperCase(), otherWallet])).toBe(BigInt(4));
    expect(rpc.readContract).toHaveBeenCalledTimes(2);
  });

  it('checks the exact ERC-721 owner across all verified wallets', async () => {
    rpc.readContract.mockResolvedValue(otherWallet);
    const rule = { ...nft, token_standard: 'erc721' as const, token_ids: ['0'] };
    expect(await service.count(rule, [wallet, otherWallet])).toBe(BigInt(1));
    expect(await service.count(rule, [wallet])).toBe(BigInt(0));
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'ownerOf', args: [BigInt(0)] }));
  });

  it('counts a burned ERC-721 as zero, while propagating RPC failures', async () => {
    const revert = new ContractFunctionRevertedError({ abi: parseAbi(['function ownerOf(uint256) view returns (address)']), functionName: 'ownerOf' });
    rpc.readContract.mockRejectedValue(new BaseError('Call reverted', { cause: revert }));
    const rule = { ...nft, token_standard: 'erc721' as const, token_ids: ['0'] };
    expect(await service.count(rule, [wallet])).toBe(BigInt(0));
    rpc.readContract.mockRejectedValue(new Error('RPC timeout'));
    await expect(service.count(rule, [wallet])).rejects.toThrow('RPC timeout');
  });

  it('batches at most 100 wallet/ID pairs and counts every copy at the same block', async () => {
    rpc.readContract.mockImplementation(async ({ args }) => args[1].map(() => BigInt(3)));
    const ids = parseTokenIds('0-149');
    expect(await service.count({ ...nft, token_ids: ids }, [wallet, otherWallet])).toBe(BigInt(900));
    expect(rpc.readContract).toHaveBeenCalledTimes(3);
    expect(rpc.getBlockNumber).toHaveBeenCalledTimes(1);
    const pairs = rpc.readContract.mock.calls.flatMap(([call]) => call.args[1].map((id, index) => `${call.args[0][index]}:${id}`));
    expect(new Set(pairs).size).toBe(300);
    rpc.readContract.mock.calls.forEach(([call]) => {
      expect(call.args[1]).toHaveLength(100);
      expect(call.blockNumber).toBe(BigInt(123));
    });
  });

  it('caches identical scopes and shares a block across different scopes within a run', async () => {
    rpc.readContract.mockImplementation(async ({ args }) => args[1].map(() => BigInt(1)));
    const context: NftCheckContext = { checks: new Map() };
    expect(await Promise.all([service.count(nft, [wallet], context), service.count(nft, [wallet], context), service.count({ ...nft, token_ids: ['500'] }, [wallet], context)])).toEqual([BigInt(2), BigInt(2), BigInt(1)]);
    expect(rpc.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(rpc.readContract).toHaveBeenCalledTimes(2);
  });

  it('does not return a partial count when a batch fails', async () => {
    rpc.readContract.mockImplementationOnce(async ({ args }) => args[1].map(() => BigInt(5))).mockRejectedValueOnce(new Error('RPC timeout'));
    await expect(service.count({ ...nft, token_ids: parseTokenIds('0-100') }, [wallet])).rejects.toThrow('RPC timeout');
  });

  it('rejects incomplete balance responses', async () => {
    rpc.readContract.mockResolvedValue([BigInt(2)]);
    await expect(service.count(nft, [wallet])).rejects.toThrow('incomplete');
  });
});

describe('NFT IDs and counts', () => {
  it('normalizes overlapping ranges, leading zeroes and unordered IDs', () => {
    expect(parseTokenIds('500,000,1-3,2,100000')).toEqual(['0', '1', '2', '3', '500', '100000']);
    expect(parseTokenIds(maxId)).toEqual([maxId]);
    expect(parseTokenIds('0-999')).toHaveLength(1000);
  });
  it.each(['-1', '1.5', '3-1', '0-1000', '1,,2', (BigInt(maxId) + BigInt(1)).toString()])('rejects invalid or excessive IDs: %s', input => {
    expect(() => parseTokenIds(input)).toThrow();
  });
  it('serializes large counts without losing precision', () => {
    expect(serializeAssetCount(BigInt(0))).toBe(0);
    expect(serializeAssetCount(BigInt(maxId))).toBe(maxId);
    expect(JSON.stringify({ count: serializeAssetCount(BigInt(maxId)) })).toContain(maxId);
  });
});

describe('NFT rules and role decisions', () => {
  let engine: VerificationEngine;
  let db: any;
  let count: jest.Mock;
  let addresses: any;
  const rule = { ...nft, id: 1, server_id: 'server', channel_id: 'channel', role_id: 'role', slug: null, attribute_key: 'ALL', attribute_value: 'ALL', min_items: 2 };
  beforeEach(() => {
    db = { getRuleById: jest.fn().mockResolvedValue(rule), getRoleMappings: jest.fn().mockResolvedValue([rule]), saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn(), getUserActiveAssignments: jest.fn(), getUserRoleHistory: jest.fn() };
    count = jest.fn().mockResolvedValue(BigInt(2));
    addresses = { getUserAddresses: jest.fn().mockResolvedValue([wallet]) };
    engine = new VerificationEngine(db, { count } as any, addresses);
  });
  it('routes Ethscriptions and NFTs through the shared adapter', async () => {
    const data = { checkAssetOwnershipWithCriteria: jest.fn().mockResolvedValue(3) };
    const nftSvc = { count: jest.fn().mockResolvedValue(BigInt(4)) };
    const adapter = new AssetOwnershipService(data as any, nftSvc as any);
    expect(await adapter.count(rule as any, [wallet])).toBe(BigInt(4));
    expect(data.checkAssetOwnershipWithCriteria).not.toHaveBeenCalled();
    expect(await adapter.count({ ...rule, asset_type: 'ethscription', slug: 'example' } as any, [wallet])).toBe(BigInt(3));
  });
  it('compares uint256 balances exactly and returns JSON-safe counts', async () => {
    count.mockResolvedValue(BigInt(maxId));
    expect(await engine.verifyUser('user', 1, wallet)).toMatchObject({ isValid: true, status: 'passed', matchingAssetCount: maxId });
  });
  it('separates a confirmed zero from an unavailable check', async () => {
    count.mockResolvedValue(BigInt(0));
    expect((await engine.verifyUser('user', 1, wallet)).status).toBe('failed');
    count.mockRejectedValue(new Error('RPC timeout'));
    const bulk = await engine.verifyUserBulk('user', [1], wallet);
    expect(bulk.results[0].status).toBe('unavailable');
    expect(bulk.invalidRules).toEqual([]);
  });
  it('retains a role when another rule passes, including rules in other channels', async () => {
    const second = { ...rule, id: 2, channel_id: 'other-channel', asset_type: 'ethscription' };
    db.getRoleMappings.mockResolvedValue([rule, second]);
    db.getRuleById.mockImplementation(async id => id === '1' ? rule : second);
    count.mockImplementation(async checkedRule => checkedRule.id === 1 ? BigInt(0) : BigInt(3));
    expect((await engine.evaluateRole('user', 'server', 'role')).status).toBe('passed');
    count.mockRejectedValue(new Error('RPC timeout'));
    expect((await engine.evaluateRole('user', 'server', 'role')).status).toBe('unavailable');
    count.mockResolvedValue(BigInt(0));
    expect((await engine.evaluateRole('user', 'server', 'role')).status).toBe('failed');
  });
  it('does not invent wallets during background verification', async () => {
    addresses.getUserAddresses.mockResolvedValue([]);
    expect((await engine.evaluateRole('user', 'server', 'role')).status).toBe('failed');
    expect(count).not.toHaveBeenCalled();
  });
  it('does not revoke or advance successful verification after an RPC failure', async () => {
    const assignment = { id: 'assignment', user_id: 'user', server_id: 'server', role_id: 'role', rule_id: null };
    db.getUserActiveAssignments.mockResolvedValue([assignment]);
    const discord = { removeUserRole: jest.fn() };
    const dynamic = new DynamicRoleService(db, engine, discord as any);
    count.mockRejectedValue(new Error('RPC timeout'));
    expect(await dynamic.reverifyUser('user')).toEqual({ verified: 0, revoked: 0 });
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(db.updateLastVerified).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith('assignment', expect.objectContaining({ last_check_status: 'unavailable' }));
  });
  it('retains roles when verified wallets cannot be read from the database', async () => {
    db.getUserActiveAssignments.mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'server', role_id: 'role' }]);
    addresses.getUserAddresses.mockRejectedValue(new Error('Database unavailable'));
    const discord = { removeUserRole: jest.fn() };
    const dynamic = new DynamicRoleService(db, engine, discord as any);
    expect(await dynamic.reverifyUser('user')).toEqual({ verified: 0, revoked: 0 });
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(db.updateLastVerified).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
  it('manually evaluates a role once and grants it when one of two rules passes', async () => {
    const second = { ...rule, id: 2 };
    db.getRoleMappings.mockResolvedValue([rule, second]);
    db.getRuleById.mockImplementation(async id => id === '1' ? rule : second);
    db.getUserRoleHistory.mockResolvedValue([]);
    count.mockImplementation(async checkedRule => checkedRule.id === 1 ? BigInt(0) : BigInt(2));
    const discord = { getGuildMember: jest.fn().mockResolvedValue({ roles: { cache: new Map() } }), addUserRole: jest.fn().mockResolvedValue({ wasAlreadyAssigned: false }), removeUserRole: jest.fn() };
    db.logUserRole = jest.fn();
    const monitor = new SimpleRoleMonitorService(db, discord as any, engine, addresses);
    const result = await monitor.reverifyUser('user', 'server');
    expect(result.errors).toEqual([]);
    expect(result.verified).toEqual(['role']);
    expect(discord.addUserRole).toHaveBeenCalledTimes(1);
    expect(discord.removeUserRole).not.toHaveBeenCalled();
  });
});
