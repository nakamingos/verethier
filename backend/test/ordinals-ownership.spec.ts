import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { VerifierRole } from '../src/models/verifier-role.interface';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address;
const secondWallet = vectors.valid[1].address;
const evm = '0x' + '1'.repeat(40);
const rule: VerifierRole = { id: 1, server_id: 'guild', server_name: 'Guild', channel_id: 'channel', channel_name: 'verify',
  role_id: 'holder', role_name: 'Holder', slug: 'pizza-comrades', asset_type: 'ordinal', chain_id: null,
  collection_name: 'Pizza Comrades', attribute_key: 'ALL', attribute_value: 'ALL', min_items: 10 };
const summary = (items = [{ id: 'pizza-comrades', total: 76, inscriptionSubset: ['example'] }]) => ({ items, limit: 25, offset: 0, totalCollections: items.length, totalInscriptions: 76 });
const inscription = (number: number) => ({ id: 'a'.repeat(64) + 'i' + number, currentLocation: 'b'.repeat(64) + ':0:0' });

describe('Ordinals ownership counts', () => {
  let service: OrdinalsOwnershipService;
  let request: jest.SpyInstance;
  beforeEach(() => {
    service = new OrdinalsOwnershipService();
    request = jest.spyOn(service as any, 'request');
  });
  afterEach(() => jest.restoreAllMocks());

  it('validates a collection slug and uses its provider name without depending on supply', async () => {
    request.mockResolvedValue({ id: 'pizza-comrades', name: 'Pizza Comrades', supply: '0' });
    expect(await service.prepareRule(' Pizza-Comrades ')).toMatchObject({ asset_type: 'ordinal', slug: 'pizza-comrades', chain_id: null, collection_name: 'Pizza Comrades' });
    for (const invalid of ['ALL', '', 'pizza-comrades,other', 'https://satflow.com/ordinals/pizza-comrades']) {
      await expect(service.prepareRule(invalid)).rejects.toThrow('one Ordinals collection slug');
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses the full collection count, not sample inscriptions, and shares summaries across rules and collections', async () => {
    request.mockResolvedValue(summary([{ id: 'pizza-comrades', total: 76, inscriptionSubset: ['one'] }, { id: 'other', total: 3, inscriptionSubset: [] }]));
    const context: NftCheckContext = { checks: new Map() };
    const counts = await Promise.all([service.count(rule, [wallet], context), service.count({ ...rule, min_items: 50 }, [wallet], context),
      service.count({ ...rule, slug: 'other' }, [wallet], context)]);
    expect(counts).toEqual([76n, 76n, 3n]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('returns zero only after a complete non-holder summary', async () => {
    request.mockResolvedValue(summary([]));
    await expect(service.count(rule, [wallet])).resolves.toBe(0n);
    await expect(service.count(rule, [])).resolves.toBe(0n);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reads every summary page before deciding a collection is absent', async () => {
    request.mockResolvedValueOnce({ ...summary(), totalCollections: 2, limit: 1, items: [{ id: 'other', total: 2 }] })
      .mockResolvedValueOnce({ ...summary(), totalCollections: 2, limit: 1, offset: 1, items: [{ id: 'pizza-comrades', total: 76 }] });
    await expect(service.count(rule, [wallet])).resolves.toBe(76n);
    expect(request.mock.calls[1][0]).toContain('offset=1');
  });

  it.each(['duplicate', 'offset', 'changed-total', 'missing-item', 'invalid-count'])('treats %s summary data as unavailable', async problem => {
    request.mockResolvedValueOnce({ ...summary(), limit: 1, totalCollections: 2 });
    const next = { ...summary(), limit: 1, totalCollections: 2, offset: 1, items: [{ id: 'other', total: 1, inscriptionSubset: [] }] };
    if (problem === 'duplicate') next.items[0].id = 'pizza-comrades';
    if (problem === 'offset') next.offset = 0;
    if (problem === 'changed-total') next.totalCollections = 3;
    if (problem === 'missing-item') next.items = [];
    if (problem === 'invalid-count') next.items[0].total = -1;
    request.mockResolvedValueOnce(next);
    await expect(service.count(rule, [wallet])).rejects.toThrow('unavailable');
  });

  it('stacks multiple wallets using unique inscription IDs and deduplicates addresses', async () => {
    request.mockImplementation(async path => ({ collectionId: 'pizza-comrades', limit: 25, offset: 0, total: 2,
      inscriptions: path.includes(wallet) ? [inscription(1), inscription(2)] : [inscription(2), inscription(3)] }));
    await expect(service.count(rule, [wallet, secondWallet, wallet])).resolves.toBe(3n);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete inscription pages and unsupported traits', async () => {
    request.mockResolvedValue({ collectionId: 'pizza-comrades', limit: 25, offset: 0, total: 2, inscriptions: [inscription(1)] });
    await expect(service.count(rule, [wallet, secondWallet])).rejects.toThrow('unavailable');
    await expect(service.count({ ...rule, attribute_key: 'Hat' }, [wallet])).rejects.toThrow('quantity only');
  });

  it('routes mixed wallets to the matching asset provider and keeps OR behavior across rules', async () => {
    request.mockResolvedValue(summary());
    const nft = { count: jest.fn().mockResolvedValue(2n) };
    const data = { checkAssetOwnershipWithCriteria: jest.fn().mockResolvedValue(3) };
    const ownership = new AssetOwnershipService(data as any, nft as any, service);
    const db = { getRoleMappings: jest.fn().mockResolvedValue([rule, { ...rule, id: 2, asset_type: 'nft', min_items: 100 }]) };
    const addresses = { getUserAddresses: jest.fn().mockResolvedValue([evm, wallet]) };
    const engine = new VerificationEngine(db as any, ownership, addresses as any);
    expect((await engine.evaluateRole('user', 'guild', 'holder')).status).toBe('passed');
    expect(nft.count.mock.calls[0][1]).toEqual([evm]);
    expect(request.mock.calls[0][0]).toContain(wallet);
    expect(data.checkAssetOwnershipWithCriteria).not.toHaveBeenCalled();
    await ownership.count({ ...rule, asset_type: 'ethscription' }, [evm, wallet]);
    expect(data.checkAssetOwnershipWithCriteria.mock.calls[0][0]).toEqual([evm]);
    await expect(ownership.count({ ...rule, asset_type: 'ethscription' }, [wallet])).resolves.toBe(0n);
  });

  it('shares provider requests across role assignments and servers for one scheduled run', async () => {
    request.mockResolvedValue(summary());
    const assignments = ['guild', 'other-guild'].map((server, index) => ({ id: String(index), user_id: 'user', server_id: server, role_id: 'holder' }));
    const db = { getActiveRoleAssignments: jest.fn().mockResolvedValue(assignments), getRoleMappings: jest.fn().mockResolvedValue([rule]),
      saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn() };
    const ownership = new AssetOwnershipService({} as any, {} as any, service);
    const engine = new VerificationEngine(db as any, ownership, { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any);
    const discord = { removeUserRole: jest.fn() };
    await new DynamicRoleService(db as any, engine, discord as any).performScheduledReverification();
    expect(request).toHaveBeenCalledTimes(1);
    expect(db.updateLastVerified).toHaveBeenCalledTimes(2);
    expect(discord.removeUserRole).not.toHaveBeenCalled();
  });

  it('reuses the verification summary when showing progress toward additional roles', async () => {
    request.mockResolvedValue(summary());
    const bonus = { ...rule, id: 2, role_id: 'bonus', min_items: 100 };
    const db = { getRoleMappings: jest.fn().mockResolvedValue([rule, bonus]) };
    const addresses = { getUserAddresses: jest.fn().mockResolvedValue([wallet]) };
    const ownership = new AssetOwnershipService({} as any, {} as any, service);
    const context: NftCheckContext = { checks: new Map() };
    const engine = new VerificationEngine(db as any, ownership, addresses as any);
    expect((await engine.verifyUserBulk('user', [rule.id], wallet, [rule], context)).validRules).toHaveLength(1);
    const discord = new DiscordVerificationService(db as any, {} as any, {} as any, addresses as any, ownership);
    discord.initialize({ guilds: { fetch: jest.fn().mockResolvedValue({
      members: { fetch: jest.fn().mockResolvedValue({ roles: { cache: new Map([['holder', {}]]) } }) },
      roles: { fetch: jest.fn().mockResolvedValue({ name: 'Bonus Holder' }) },
    }) } } as any);
    const recommendations = await discord.analyzePotentialRoles('guild', 'user', ['holder'], wallet, context);
    expect(recommendations[0].matchedRules[0].matchingCount).toBe(76);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retains roles and successful check timestamps when the provider is unavailable', async () => {
    request.mockRejectedValue(new Error('unavailable'));
    const db = { getActiveRoleAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'guild', role_id: 'holder' }]),
      getRoleMappings: jest.fn().mockResolvedValue([rule]), saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn() };
    const engine = new VerificationEngine(db as any, new AssetOwnershipService({} as any, {} as any, service), { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any);
    const discord = { removeUserRole: jest.fn() };
    await new DynamicRoleService(db as any, engine, discord as any).performScheduledReverification();
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(db.updateLastVerified).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith('assignment', expect.objectContaining({ last_check_status: 'unavailable' }));
  });
});

describe('Xverse request handling', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', 'local-test-key'); });
  afterEach(async () => { await jest.runAllTimersAsync(); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('requires a backend key and does not send provider requests without it', async () => {
    jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', undefined);
    const fetch = jest.spyOn(global, 'fetch');
    await expect(new OrdinalsOwnershipService().count(rule, [wallet])).rejects.toThrow('Set XVERSE_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serializes requests and sends the key only to the documented provider', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(summary())));
    const service = new OrdinalsOwnershipService();
    const first = service.count(rule, [wallet]);
    await first;
    fetch.mockResolvedValue(new Response(JSON.stringify(summary())));
    const second = service.count(rule, [secondWallet]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(650);
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/api\.secretkeylabs\.io\//), expect.objectContaining({ redirect: 'error', headers: { 'x-api-key': 'local-test-key', Accept: 'application/json' } }));
  });

  it('retries a rate-limited request with bounded backoff', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(summary())));
    const pending = new OrdinalsOwnershipService().count(rule, [wallet]);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe(76n);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats an invalid key as unavailable instead of zero ownership', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(new OrdinalsOwnershipService().count(rule, [wallet])).rejects.toThrow('unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses a complete collection-specific response when an empty-wallet summary returns 500', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ collectionId: 'pizza-comrades', total: 0, limit: 25, offset: 0, inscriptions: [] })));
    const service = new OrdinalsOwnershipService();
    const context: NftCheckContext = { checks: new Map() };
    const pending = service.count(rule, [wallet], context);
    await jest.advanceTimersByTimeAsync(650);
    await expect(pending).resolves.toBe(0n);
    await expect(service.count({ ...rule, min_items: 50 }, [wallet], context)).resolves.toBe(0n);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('/inscriptions/collection/pizza-comrades');
  });

  it('does not turn summary and collection-specific provider failures into zero ownership', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const pending = new OrdinalsOwnershipService().count(rule, [wallet]);
    const rejection = expect(pending).rejects.toThrow('unavailable');
    await jest.advanceTimersByTimeAsync(4000);
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
