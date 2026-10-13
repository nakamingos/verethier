import { Erc20OwnershipService } from '../src/services/erc20-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { parseTokenBalance, tokenAmount, tokenRuleCriteria, UINT256_MAX } from '../src/utils/erc20-rule.util';
import { EnvironmentConfig } from '../src/config/environment.config';
import { NftRuleFields } from '../src/models/verifier-role.interface';
import { AdminFeedback } from '../src/services/utils/admin-feedback.util';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { DuplicateRuleConfirmationInteractionHandler } from '../src/services/discord-commands/interactions/duplicate-rule-confirmation.interaction';
import { SETUP_HELP_CONTENT } from '../src/content/setup-help.content';

const contract = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const rule: any = { id: 1, asset_type: 'erc20', chain_id: 1, contract_address: contract, token_decimals: 18,
  token_symbol: 'TEST', collection_name: 'Test Token', min_balance: '500000000000000000', min_items: null,
  slug: null, attribute_key: 'ALL', attribute_value: 'ALL', role_id: 'holder', server_id: 'guild' };

describe('exact token amounts', () => {
  it('converts fractional and large amounts without Number rounding', () => {
    expect(parseTokenBalance('0.5', 18)).toBe(rule.min_balance);
    expect(parseTokenBalance('9007199254740993.000000000000000001', 18)).toBe('9007199254740993000000000000000001');
    expect(tokenAmount(rule, 499999999999999999n)).toBe('0.499999999999999999');
    expect(parseTokenBalance('1.0', 0)).toBe('1');
    expect(parseTokenBalance('0001.2300', 2)).toBe('123');
  });
  it('supports zero-decimal tokens, uint256 limits, and uint8 decimals', () => {
    expect(parseTokenBalance(UINT256_MAX.toString(), 0)).toBe(UINT256_MAX.toString());
    expect(() => parseTokenBalance((UINT256_MAX + 1n).toString(), 0)).toThrow('limit');
    expect(parseTokenBalance('0.' + '0'.repeat(254) + '1', 255)).toBe('1');
  });
  it.each(['', '0', '-1', '+1', '1e3', '1,000', '.5', 'NaN'])('rejects invalid amounts: %s', input => {
    expect(() => parseTokenBalance(input, 18)).toThrow();
  });
  it('rejects excess precision instead of rounding it', () => {
    expect(() => parseTokenBalance('0.0000001', 6)).toThrow('decimal places');
    expect(() => parseTokenBalance('1.1', 0)).toThrow('decimal places');
  });
});

describe('ERC-20 contract reads', () => {
  let service: Erc20OwnershipService;
  let rpc: any;
  beforeEach(() => {
    service = new Erc20OwnershipService();
    rpc = { getChainId: jest.fn().mockResolvedValue(1), getBlockNumber: jest.fn().mockResolvedValue(123n),
      readContract: jest.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'decimals') return 18;
        if (functionName === 'balanceOf') return 0n;
        if (functionName === 'totalSupply') return 1000000000000000000n;
        if (functionName === 'name') return 'Test Token';
        if (functionName === 'symbol') return 'TEST';
        throw new Error('Unsupported ERC-165');
      }) };
    jest.spyOn(service as any, 'getClient').mockReturnValue(rpc);
  });
  afterEach(() => jest.restoreAllMocks());
  it('prepares exact token rules with contract metadata', async () => {
    expect(await service.prepareRule(contract, '0.5')).toMatchObject({ asset_type: 'erc20', token_decimals: 18, min_balance: rule.min_balance, collection_name: 'Test Token', token_symbol: 'TEST' });
  });
  it('allows optional name and symbol to be absent', async () => {
    const original = rpc.readContract.getMockImplementation();
    rpc.readContract.mockImplementation(async params => ['name', 'symbol'].includes(params.functionName) ? Promise.reject(new Error('Absent')) : original(params));
    expect(await service.prepareRule(contract, '1')).toMatchObject({ collection_name: null, token_symbol: null });
  });
  it('rejects NFT contracts and missing or malformed decimals', async () => {
    const original = rpc.readContract.getMockImplementation();
    rpc.readContract.mockImplementation(async params => params.functionName === 'supportsInterface' ? true : original(params));
    await expect(service.prepareRule(contract, '1')).rejects.toThrow('add-nft-rule');
    rpc.readContract.mockImplementation(async params => params.functionName === 'decimals' ? '18' : original(params));
    await expect(service.prepareRule(contract, '1')).rejects.toThrow('Could not read');
  });
  it('rejects invalid addresses and wrong-chain RPCs', async () => {
    await expect(service.prepareRule('0x0', '1')).rejects.toThrow('address');
    await expect(service.prepareRule('0x' + '0'.repeat(40), '1')).rejects.toThrow('address');
    rpc.getChainId.mockResolvedValue(4663);
    await expect(service.prepareRule(contract, '1', 1)).rejects.toThrow('network');
  });
  it('sums deduplicated wallets at one block and shares reads across different thresholds', async () => {
    rpc.readContract.mockResolvedValueOnce(200000000000000000n).mockResolvedValueOnce(300000000000000000n);
    const context = { checks: new Map() };
    expect(await service.count(rule, [wallet, wallet.toUpperCase().replace('0X', '0x'), other], context)).toBe(500000000000000000n);
    expect(await service.count({ ...rule, min_balance: '1000000000000000000' }, [other, wallet], context)).toBe(500000000000000000n);
    expect(rpc.readContract).toHaveBeenCalledTimes(2);
    expect(rpc.readContract.mock.calls.every(([params]) => params.blockNumber === 123n)).toBe(true);
    expect(rpc.getBlockNumber).toHaveBeenCalledTimes(1);
  });
  it('treats zero as a complete result but any failed wallet read as unavailable', async () => {
    expect(await service.count(rule, [wallet])).toBe(0n);
    rpc.readContract.mockRejectedValueOnce(new Error('RPC failed'));
    await expect(service.count(rule, [wallet, other])).rejects.toThrow('temporarily unavailable');
  });
  it('isolates mainnet reads from Robinhood and validates the chain during verification', async () => {
    const robinhood = { ...rule, chain_id: 4663 };
    await expect(service.count(robinhood, [wallet])).rejects.toThrow('unavailable');
    rpc.getChainId.mockResolvedValue(4663);
    expect(await service.count(robinhood, [wallet])).toBe(0n);
  });
  it('uses the existing network-specific environment variables', () => {
    const actual = new Erc20OwnershipService();
    jest.replaceProperty(EnvironmentConfig, 'RPC_URL', 'https://example.org/eth');
    jest.replaceProperty(EnvironmentConfig, 'ROBINHOOD_RPC_URL', 'https://example.org/rh');
    expect((actual as any).getClient(1).chain.id).toBe(1);
    expect((actual as any).getClient(4663).transport.url).toBe('https://example.org/rh');
  });
});

describe('token role decisions and display', () => {
  it('compares exact base units while displaying human token amounts', async () => {
    const token = { count: jest.fn().mockResolvedValueOnce(499999999999999999n).mockResolvedValueOnce(500000000000000000n) };
    const ownership = new AssetOwnershipService({} as any, {} as any, undefined, undefined, token as any);
    const engine = new VerificationEngine({ getRuleById: jest.fn().mockResolvedValue(rule) } as any, ownership,
      { getUserAddresses: jest.fn().mockResolvedValue([wallet, 'bc1ptest']) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    expect(await engine.verifyUser('user', 1, wallet)).toMatchObject({ isValid: false, matchingAssetCount: '0.499999999999999999', verificationDetails: { minItems: '0.5' } });
    expect(await engine.verifyUser('user', 1, wallet)).toMatchObject({ isValid: true, matchingAssetCount: '0.5' });
    expect(token.count.mock.calls[0][1]).toEqual([wallet]);
  });
  it('preserves earned token roles when RPC checks fail', async () => {
    const db: any = { getEarnedRoleAssignments: jest.fn().mockResolvedValue([{ id: 'a', user_id: 'user', server_id: 'guild', role_id: 'holder', status: 'active' }]),
      getRoleMappings: jest.fn().mockResolvedValue([rule]), saveRoleCheckDetails: jest.fn(), updateRoleAssignmentStatus: jest.fn(), updateLastVerified: jest.fn() };
    const ownership = new AssetOwnershipService({} as any, {} as any, undefined, undefined, { count: jest.fn().mockRejectedValue(new Error('RPC failed')) } as any);
    const engine = new VerificationEngine(db, ownership, { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    const discord: any = { removeUserRole: jest.fn(), addUserRoleDynamic: jest.fn() };
    await new DynamicRoleService(db, engine, discord).performScheduledReverification();
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(discord.addUserRoleDynamic).not.toHaveBeenCalled();
    expect(db.updateRoleAssignmentStatus).not.toHaveBeenCalled();
  });
  it('formats token amounts consistently without min-items placeholders', () => {
    expect(tokenRuleCriteria(rule)).toContain('min 0.5');
    expect(AdminFeedback.formatRule(rule)).toContain('min 0.5');
    const display = new DiscordVerificationService({} as any, {} as any, {} as any, {} as any, {} as any, { allowedAddresses: async (_server, wallets) => wallets } as any);
    expect((display as any).formatRoleRequirement(rule, {}, { style: 'holding', matchingCount: '0.5' })).toContain('(0.5/0.5)');
    const fields = new DuplicateRuleConfirmationInteractionHandler({} as any).createRuleInfoFields(rule);
    expect(fields).toContainEqual(expect.objectContaining({ name: '**Min Balance**', value: '0.5' }));
    expect(fields.some(field => field.name === '**Min Items**')).toBe(false);
  });
  it('keeps the setup help within Discord embed limits', () => {
    const content = SETUP_HELP_CONTENT;
    expect(content.title.length + content.description.length + content.footer.length + content.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0)).toBeLessThanOrEqual(6000);
    expect(content.fields.every(field => field.value.length <= 1024)).toBe(true);
  });
});
