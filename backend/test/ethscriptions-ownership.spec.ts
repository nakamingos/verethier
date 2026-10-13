import { EthscriptionsOwnershipService } from '../src/services/ethscriptions-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import { VerifierRole } from '../src/models/verifier-role.interface';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { parseInscriptionCriteria } from '../src/utils/inscription-rule.util';

const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const wallet = '0x' + '1'.repeat(40);
const other = '0x' + '2'.repeat(40);
const market = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
const row = (n: number, owner = wallet, prevOwner: string | null = null) => ({
  transaction_hash: hash(n), current_owner: owner, previous_owner: prevOwner, ethscription_number: String(n),
});
const page = (items: any[] = [], hasMore = false, cursor: string | null = null) => ({ result: items, pagination: { has_more: hasMore, page_key: cursor } });
const run = (): NftCheckContext => ({ checks: new Map() });
const base: VerifierRole = { id: 1, server_id: 'guild', server_name: 'Guild', channel_id: 'verify', channel_name: 'Verify',
  role_id: 'special', role_name: 'Special', asset_type: 'ethscription', chain_id: 1, slug: null,
  attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1, inscription_criteria: { kind: 'ids', ids: [hash(1)] } };

describe('Global Ethscription ownership', () => {
  let service: EthscriptionsOwnershipService;
  let request: jest.SpyInstance;
  beforeEach(() => { service = new EthscriptionsOwnershipService(); request = jest.spyOn(service as any, 'request'); });
  afterEach(() => jest.restoreAllMocks());

  it('validates transaction hashes through the protocol API without needing collection data', async () => {
    request.mockResolvedValue(page([row(1)]));
    expect(await service.prepareInscriptionRule(hash(1).toUpperCase(), null, 1)).toMatchObject({
      asset_type: 'ethscription', slug: null, chain_id: 1, inscription_criteria: base.inscription_criteria,
    });
    expect(new URLSearchParams(request.mock.calls[0][0].split('?')[1]).getAll('transaction_hash[]')).toEqual([hash(1)]);
    await expect(service.prepareInscriptionRule(`${hash(1)},${hash(1)}`, null, 2)).rejects.toThrow('cannot exceed');
  });
  it('stores global numbers and large ranges without expanding them into requests', async () => {
    expect(await service.prepareInscriptionRule(null, '5853618,0-99999', 1)).toMatchObject({
      inscription_criteria: { kind: 'numbers', ranges: [[0, 99999], [5853618, 5853618]] },
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('shares batches across overlapping rules and members, and preserves escrow ownership', async () => {
    request.mockResolvedValue(page([row(1), row(2, market, wallet), row(3, other, wallet)]));
    const context = run();
    const criteria = parseInscriptionCriteria([hash(1), hash(2), hash(3)].join(','), null, 'ethscription');
    expect(await service.countSelection([wallet], criteria, context)).toBe(2n);
    expect(await service.countSelection([other], criteria, context)).toBe(1n);
    expect(await service.countSelection([wallet, other, wallet.toUpperCase()], criteria, context)).toBe(3n);
    expect(await service.countSelection([wallet], base.inscription_criteria, context)).toBe(1n);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(page([row(1, other)]));
    expect(await service.countSelection([wallet], base.inscription_criteria, run())).toBe(0n);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('uses batches of 50 IDs with no per-member requests', async () => {
    request.mockImplementation(async path => page(new URLSearchParams(path.split('?')[1]).getAll('transaction_hash[]').map(id => ({ ...row(Number(BigInt(id))), transaction_hash: id }))));
    const criteria = parseInscriptionCriteria(Array.from({ length: 51 }, (_, n) => hash(n)).join(','), null, 'ethscription');
    const context = run();
    expect(await service.countSelection([wallet], criteria, context)).toBe(51n);
    expect(await service.countSelection([other], criteria, context)).toBe(0n);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('reads every direct and escrow page once per wallet/run for all numeric rules', async () => {
    request.mockResolvedValueOnce(page([row(10), row(100)], true, 'next'))
      .mockResolvedValueOnce(page([row(101)]))
      .mockResolvedValueOnce(page([row(102, market, wallet)]));
    const context = run();
    const criteria = parseInscriptionCriteria(null, '100-102', 'ethscription');
    expect(await service.countSelection([wallet], criteria, context)).toBe(3n);
    expect(await service.countSelection([wallet], parseInscriptionCriteria(null, '0-99', 'ethscription'), context)).toBe(1n);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1][0]).toContain('page_key=next');
    const escrow = new URLSearchParams(request.mock.calls[2][0].split('?')[1]);
    expect(escrow.get('current_owner')).toBe(market);
    expect(escrow.get('previous_owner')).toBe(wallet);
  });
  it('deduplicates linked wallets and shares number inventories between rule minimums', async () => {
    const data = { checkAssetOwnershipWithCriteria: jest.fn() };
    const assets = new AssetOwnershipService(data as any, {} as any, undefined, service);
    request.mockResolvedValueOnce(page([row(1)])).mockResolvedValueOnce(page());
    const rule = { ...base, inscription_criteria: parseInscriptionCriteria(null, '1-10', 'ethscription') };
    const context = run();
    expect(await assets.count(rule, [wallet, wallet.toUpperCase()], context)).toBe(1n);
    expect(await assets.count({ ...rule, min_items: 2 }, [wallet], context)).toBe(1n);
    expect(request).toHaveBeenCalledTimes(2);
    expect(data.checkAssetOwnershipWithCriteria).not.toHaveBeenCalled();
  });
  it.each(['missing-hash', 'duplicate-hash', 'wrong-hash', 'invalid-owner', 'missing-number', 'unsafe-number', 'escrow-owner-missing', 'incomplete'])('treats %s ID data as uncertain', async problem => {
    const item: any = row(1);
    if (problem === 'wrong-hash') item.transaction_hash = hash(2);
    if (problem === 'invalid-owner') item.current_owner = 'invalid';
    if (problem === 'missing-number') delete item.ethscription_number;
    if (problem === 'unsafe-number') item.ethscription_number = '9007199254740992';
    if (problem === 'escrow-owner-missing') item.current_owner = market;
    request.mockResolvedValue(page(problem === 'missing-hash' ? [] : problem === 'duplicate-hash' ? [item, item] : [item], problem === 'incomplete', 'next'));
    await expect(service.countSelection([wallet], base.inscription_criteria, run())).rejects.toThrow('unavailable');
  });
  it.each(['no-pagination', 'bad-number', 'wrong-owner', 'missing-cursor', 'overlap', 'repeated-cursor', 'empty-more', 'wrong-escrow-owner'])('rejects %s inventories instead of returning a false non-match', async problem => {
    const first: any = page([row(1)]);
    if (problem === 'no-pagination') delete first.pagination;
    if (problem === 'bad-number') first.result[0].ethscription_number = '-1';
    if (problem === 'wrong-owner') first.result[0].current_owner = other;
    if (['missing-cursor', 'overlap', 'repeated-cursor', 'empty-more'].includes(problem)) first.pagination.has_more = true;
    if (['overlap', 'repeated-cursor'].includes(problem)) first.pagination.page_key = 'next';
    if (problem === 'empty-more') first.result = [];
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(problem === 'overlap' ? page([row(1)])
      : problem === 'repeated-cursor' ? page([row(2)], true, 'next') : page([row(2, market, other)]));
    await expect(service.countSelection([wallet], { kind: 'numbers', ranges: [[0, 1000]] }, run())).rejects.toThrow('unavailable');
  });
  it('retains the role if either inventory fails, and removes it after a complete non-match', async () => {
    const rule = { ...base, inscription_criteria: parseInscriptionCriteria(null, '1-10', 'ethscription') };
    const db = { getEarnedRoleAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'guild', role_id: 'special' }]),
      getRoleMappings: jest.fn().mockResolvedValue([rule]), saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn() };
    const engine = new VerificationEngine(db as any, new AssetOwnershipService({} as any, {} as any, undefined, service), { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    const discord = { removeUserRole: jest.fn().mockResolvedValue(true) };
    const scheduler = new DynamicRoleService(db as any, engine, discord as any);
    request.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('offline'));
    await scheduler.performScheduledReverification();
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith('assignment', expect.objectContaining({ last_check_status: 'unavailable' }));
    request.mockResolvedValue(page());
    await scheduler.performScheduledReverification();
    expect(discord.removeUserRole).toHaveBeenCalledWith('user', 'guild', 'special', expect.any(Map));
  });
});

describe('Ethscriptions API requests', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  const response = (status: number, data: any) => ({ ok: status === 200, status, json: async () => data, headers: new Headers() } as Response);

  it('retries transient failures and uses the public API without a credential', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(response(429, null)).mockResolvedValueOnce(response(200, page([row(1)])));
    const service = new EthscriptionsOwnershipService();
    const pending = service.countSelection([wallet], base.inscription_criteria, run());
    await jest.runAllTimersAsync();
    expect(await pending).toBe(1n);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/api.ethscriptions.com\/v2\/ethscriptions\?/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Accept: 'application/json' } });
  });
  it('does not turn rejected requests into zero ownership', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(401, null));
    const pending = new EthscriptionsOwnershipService().countSelection([wallet], base.inscription_criteria, run());
    const assertion = expect(pending).rejects.toThrow('unavailable');
    await jest.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
