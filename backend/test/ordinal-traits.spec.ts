import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { OrdnetOwnershipService } from '../src/services/ordnet-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import { VerifierRole } from '../src/models/verifier-role.interface';
import { ordinalTraitHash, usableOrdinalTraitSnapshot, ORDINAL_SNAPSHOT_MAX_AGE_MS } from '../src/utils/ordinal-rule.util';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address;
const other = vectors.valid[1].address;
const id = (n: number) => 'a'.repeat(64) + 'i' + n;
const base: VerifierRole = { id: 1, server_id: 'guild', server_name: 'Guild', channel_id: 'verify', channel_name: 'Verify',
  role_id: 'blue', role_name: 'Blue', asset_type: 'ordinal', slug: 'pizza-comrades',
  attribute_key: 'Background', attribute_value: 'Blue', min_items: 1 };
const item = (n: number, owner: string | null = wallet, value = 'Blue') => ({ id: id(n), inscriptionId: id(n),
  collection: base.slug, collections: [], owner, traits: [{ type: 'Background', value }] });
const page = (items: any[], nextCursor: string | null = null) => ({ items, pagination: { pageSize: 100, hasNext: nextCursor !== null, nextCursor } });
const run = (scheduled = false): NftCheckContext => ({ checks: new Map(), ...(scheduled ? { ordinalMode: 'scheduled' as const } : {}) });
function cached(ids = [id(1)], overrides: Partial<VerifierRole> = {}): VerifierRole {
  const rule = { ...base, ...overrides };
  return { ...rule, ordinal_trait_snapshot: { inscription_ids: ids, criteria_hash: ordinalTraitHash(rule), fetched_at: new Date().toISOString() } };
}
const collectionPage = (ids: string[]) => ({ collectionId: base.slug, total: ids.length, limit: 25, offset: 0,
  inscriptions: ids.map(id => ({ id, currentLocation: 'b'.repeat(64) + ':0:0' })) });

describe('Ordinals live traits and outage fallback', () => {
  let get: jest.Mock;
  let db: { cacheOrdinalTraitSnapshot: jest.Mock };
  let service: OrdinalsOwnershipService;
  let ordnet: OrdnetOwnershipService;
  let request: jest.SpyInstance;
  let owned: string[];
  let owners: Map<string, string>;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_PROVIDER', 'ordnet');
    jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', 'mock-only-key');
    get = jest.fn().mockRejectedValue(new Error('ord.net unavailable'));
    db = { cacheOrdinalTraitSnapshot: jest.fn().mockResolvedValue(undefined) };
    ordnet = new OrdnetOwnershipService({ get } as any);
    service = new OrdinalsOwnershipService(ordnet, db as any);
    owned = [id(1)]; owners = new Map([[id(1), wallet]]);
    request = jest.spyOn(service as any, 'request').mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/ordinals/collections/')) return { id: base.slug, name: 'Pizza Comrades' };
      if (path.includes('/inscriptions/collection/')) return collectionPage(owned);
      if (path.endsWith('/collections?limit=25&offset=0')) return { totalCollections: 1, limit: 25, offset: 0, items: [{ id: base.slug, total: owned.length }] };
      if (path.startsWith('/v1/inscriptions/batch?')) return new URLSearchParams(path.split('?')[1]).get('inscriptionIds').split(',')
        .map(id => ({ id, currentAddress: owners.get(id) || other }));
      throw new Error('Unexpected mock request: ' + path);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('counts case-insensitive traits across wallets, saves all matching IDs, and shares a complete scan', async () => {
    get.mockResolvedValue(page([item(1), item(2, other), item(3, wallet, 'Red')]));
    const rule = { ...base, attribute_key: ' background ', attribute_value: ' blue ' };
    const context = run();
    expect(await service.count(rule, [wallet, wallet], context)).toBe(1n);
    expect(await service.count(rule, [other], context)).toBe(1n);
    expect(await service.count({ ...base, id: 2, attribute_value: 'Red' }, [wallet, other], context)).toBe(1n);
    expect(get).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(rule.ordinal_trait_snapshot.inscription_ids).toEqual([id(1), id(2)]);
    expect(db.cacheOrdinalTraitSnapshot).toHaveBeenCalledTimes(2);
  });
  it('counts key-only rules and keeps separate trait criteria in the count cache', async () => {
    get.mockResolvedValue(page([item(1), item(2, wallet, 'Red')]));
    const context = run();
    expect(await service.count({ ...base, attribute_value: 'ALL' }, [wallet], context)).toBe(2n);
    expect(await service.count({ ...base, attribute_value: 'Red' }, [wallet], context)).toBe(1n);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('builds setup snapshots from every page and refuses nonexistent traits', async () => {
    get.mockResolvedValueOnce(page([item(1, wallet, 'Red')], 'next')).mockResolvedValueOnce(page([item(2, other)]));
    expect((await service.prepareTraitSnapshot(base as any)).inscription_ids).toEqual([id(2)]);
    get.mockResolvedValue(page([item(1, wallet, 'Red')]));
    await expect(service.prepareTraitSnapshot(base as any)).rejects.toThrow('No inscriptions match');
    expect(db.cacheOrdinalTraitSnapshot).not.toHaveBeenCalled();
  });
  it('stores a confirmed empty snapshot after a complete scan', async () => {
    get.mockResolvedValue(page([item(1, wallet, 'Red')]));
    const rule = cached();
    expect(await service.count(rule, [wallet])).toBe(0n);
    expect(rule.ordinal_trait_snapshot.inscription_ids).toEqual([]);
    expect(db.cacheOrdinalTraitSnapshot).toHaveBeenCalled();
  });
  it.each(['missing-traits', 'partial-pages'])('does not overwrite a snapshot after %s', async problem => {
    const rule = cached(); const previous = rule.ordinal_trait_snapshot;
    get.mockResolvedValue(problem === 'missing-traits' ? page([{ ...item(1), traits: null }]) : page([item(1)], 'loop'));
    expect(await service.count(rule, [wallet])).toBe(1n);
    expect(rule.ordinal_trait_snapshot).toBe(previous);
    expect(db.cacheOrdinalTraitSnapshot).not.toHaveBeenCalled();
  });
  it('continues a live check when saving its optional snapshot fails', async () => {
    get.mockResolvedValue(page([item(1)])); db.cacheOrdinalTraitSnapshot.mockRejectedValue(new Error('db unavailable'));
    expect(await service.count({ ...base }, [wallet])).toBe(1n);
  });
  it('uses fresh Xverse ownership when a matching item has an unknown ord.net owner', async () => {
    get.mockResolvedValue(page([item(1, null)])); const context = run();
    expect(await service.count({ ...base }, [wallet], context)).toBe(1n);
    expect(service.checkDetails(base, [wallet], context)).toMatchObject({ provider: 'xverse', source: 'trait-snapshot' });
  });
  it('recognizes replacements and first-time holders using wallet intersections without renewing the snapshot', async () => {
    const rule = cached([id(1), id(2)]); const timestamp = rule.ordinal_trait_snapshot.fetched_at;
    owned = [id(2), id(3)]; const context = run();
    expect(await service.count(rule, [wallet], context)).toBe(1n);
    expect(rule.ordinal_trait_snapshot.fetched_at).toBe(timestamp);
    expect(service.checkDetails(rule, [wallet], context)).toEqual({ provider: 'xverse', source: 'trait-snapshot', snapshot_fetched_at: timestamp });
    expect(request.mock.calls.some(([path]) => path.includes('/inscriptions/batch'))).toBe(false);
  });
  it('deduplicates stacked wallet IDs and shares wallet reads across different traits', async () => {
    const context = run();
    expect(await service.count(cached(), [wallet, other, wallet], context)).toBe(1n);
    expect(await service.count(cached([id(1)], { id: 2, attribute_value: 'Red' }), [wallet, other], context)).toBe(1n);
    expect(request.mock.calls.filter(([path]) => path.includes('/inscriptions/collection/'))).toHaveLength(2);
    expect(request.mock.calls.filter(([path]) => path.startsWith('/v1/ordinals/collections/'))).toHaveLength(1);
  });
  it('shares bounded owner batches across rules and members during scheduled checks', async () => {
    const ids = Array.from({ length: 51 }, (_, n) => id(n));
    owners = new Map(ids.map((id, n) => [id, n % 2 ? other : wallet])); const context = run(true);
    expect(await service.count(cached(ids), [wallet], context)).toBe(26n);
    expect(await service.count(cached(ids.slice(10), { id: 2 }), [other], context)).toBe(20n);
    const batches = request.mock.calls.filter(([path]) => path.startsWith('/v1/inscriptions/batch'));
    expect(batches).toHaveLength(3);
    expect(batches.map(([path]) => new URLSearchParams(path.split('?')[1]).get('inscriptionIds').split(',').length)).toEqual([25, 25, 1]);
  });
  it('shares overlapping concurrent batches without duplicate requested IDs', async () => {
    owners = new Map([id(1), id(2), id(3)].map(id => [id, wallet]));
    const context = run(true);
    await Promise.all([service.count(cached([id(1), id(2)]), [wallet], context), service.count(cached([id(2), id(3)], { id: 2 }), [wallet], context)]);
    const requested = request.mock.calls.filter(([path]) => path.startsWith('/v1/inscriptions/batch')).flatMap(([path]) =>
      new URLSearchParams(path.split('?')[1]).get('inscriptionIds').split(','));
    expect(requested.sort()).toEqual([id(1), id(2), id(3)]);
  });
  it('defers when cached IDs no longer qualify but the collection still meets the threshold', async () => {
    owned = [id(9)];
    await expect(service.count(cached(), [wallet])).rejects.toThrow('unavailable');
  });
  it('fails only with a complete collection count below the trait threshold', async () => {
    owned = [id(9)]; const rule = cached([id(1)], { min_items: 2 }); const context = run();
    expect(await service.count(rule, [wallet], context)).toBe(1n);
    expect(service.checkDetails(rule, [wallet], context)).toEqual({ provider: 'xverse', source: 'collection-upper-bound' });
  });
  it.each(['missing', 'expired', 'changed', 'future', 'malformed'])('cannot grant from a %s snapshot and retains a collection holder', async problem => {
    const rule = cached();
    if (problem === 'missing') rule.ordinal_trait_snapshot = null;
    if (problem === 'expired') rule.ordinal_trait_snapshot.fetched_at = new Date(Date.now() - ORDINAL_SNAPSHOT_MAX_AGE_MS).toISOString();
    if (problem === 'changed') rule.attribute_value = 'Red';
    if (problem === 'future') rule.ordinal_trait_snapshot.fetched_at = new Date(Date.now() + 60000).toISOString();
    if (problem === 'malformed') rule.ordinal_trait_snapshot.inscription_ids = ['bad-id'];
    await expect(service.count(rule, [wallet])).rejects.toThrow('unavailable');
    owned = [];
    expect(await service.count(rule, [wallet], run())).toBe(0n);
  });
  it.each(['omitted', 'duplicate', 'unexpected', 'unknown-owner', 'testnet-owner', 'failed'])('keeps eligibility uncertain after a %s batch response', async problem => {
    const normal = request.getMockImplementation();
    request.mockImplementation(async path => {
      if (!String(path).startsWith('/v1/inscriptions/batch')) return normal(path);
      if (problem === 'failed') throw new Error('provider unavailable');
      if (problem === 'omitted') return [];
      if (problem === 'duplicate') return [{ id: id(1), currentAddress: wallet }, { id: id(1), currentAddress: wallet }];
      return [{ id: problem === 'unexpected' ? id(9) : id(1), currentAddress: problem === 'unknown-owner' ? null : 'tb1pbad' }];
    });
    await expect(service.count(cached(), [wallet], run(true))).rejects.toThrow('unavailable');
  });
  it('never treats an unknown Xverse collection as an empty collection', async () => {
    request.mockRejectedValue(new Error('collection not found')); owned = [];
    await expect(service.count(cached(), [wallet])).rejects.toThrow('not found');
  });
  it('does not revoke or advance successful timestamps when both providers fail', async () => {
    request.mockRejectedValue(new Error('Xverse unavailable'));
    const rule = cached();
    const database: any = { getDisabledBackgroundServers: jest.fn().mockResolvedValue(new Set()), getEarnedRoleAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'guild', role_id: base.role_id }]),
      getRoleMappings: jest.fn().mockResolvedValue([rule]), saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn() };
    const engine = new VerificationEngine(database, new AssetOwnershipService({} as any, {} as any, service), { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    const discord = { removeUserRole: jest.fn() };
    await new DynamicRoleService(database, engine, discord as any).performScheduledReverification();
    expect(discord.removeUserRole).not.toHaveBeenCalled(); expect(database.updateLastVerified).not.toHaveBeenCalled();
    expect(database.saveRoleCheckDetails).toHaveBeenCalledWith('assignment', expect.objectContaining({ last_check_status: 'unavailable' }));
  });
  it('records the provider while keeping snapshot IDs out of member check details', async () => {
    const rule = cached(); const engine = new VerificationEngine({} as any, new AssetOwnershipService({} as any, {} as any, service),
      { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    const result = await engine.verifyUser('user', rule.id, wallet, run(), rule);
    expect(result.isValid).toBe(true); expect(result.ownershipDetails.provider).toBe('xverse');
    expect(result.rule.ordinal_trait_snapshot).toBeUndefined(); expect(JSON.stringify(result)).not.toContain('inscription_ids');
  });
  it('allows another passing rule for the same role when a trait check is unavailable', async () => {
    const rule = cached(); owned = [id(9)];
    const quantity = { ...base, id: 2, attribute_key: 'ALL', attribute_value: 'ALL', ordinal_trait_snapshot: null };
    const engine = new VerificationEngine({ getRoleMappings: jest.fn().mockResolvedValue([rule, quantity]) } as any,
      new AssetOwnershipService({} as any, {} as any, service), { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    expect((await engine.evaluateRole('user', 'guild', base.role_id)).status).toBe('passed');
  });
  it('continues using saved traits when the primary provider is switched to Xverse', async () => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_PROVIDER', 'xverse');
    expect(await service.count(cached(), [wallet])).toBe(1n); expect(get).not.toHaveBeenCalled();
  });
  it('rejects contradictory existing collection counts without using them to revoke', async () => {
    const context = run(true); context.ordinalSummaries = new Map([[wallet, Promise.resolve(new Map())]]);
    owned = [];
    await expect(service.count(cached(), [wallet], context)).rejects.toThrow('unavailable');
  });
  it('warms suggestions from full scans and supports key-only, case-insensitive suggestions', async () => {
    get.mockResolvedValue(page([item(1), item(2, wallet, 'Red')]));
    await ordnet.snapshot(base.slug, run());
    expect(await service.suggestions(base.slug)).toEqual(['Background']);
    expect(await service.suggestions(base.slug, 'background')).toEqual(['Blue', 'Red']);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate snapshot IDs and fingerprints only collection/trait criteria', () => {
    expect(usableOrdinalTraitSnapshot(cached([id(1), id(1)]))).toBeNull();
    expect(ordinalTraitHash(base)).toBe(ordinalTraitHash({ ...base, min_items: 99, role_id: 'different', attribute_key: 'background', attribute_value: 'blue' }));
    expect(ordinalTraitHash({ ...base, attribute_value: 'ALL' })).not.toBe(ordinalTraitHash({ ...base, attribute_value: 'all' }));
  });
  it('shows the trait criteria in member role requirements', () => {
    const messages = new DiscordVerificationService({} as any, {} as any, {} as any, {} as any, {} as any, { allowedAddresses: async (_server, wallets) => wallets } as any);
    expect((messages as any).formatRoleRequirement(base)).toContain('Background=Blue');
    expect((messages as any).formatRoleRequirement({ ...base, attribute_value: 'ALL' })).toContain('Background (any value)');
  });
});
