import { OrdnetOwnershipService } from '../src/services/ordnet-ownership.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { ordnetCompatible } from '../src/utils/ordinal-rule.util';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address, other = vectors.valid[1].address;
const id = (n: number) => 'a'.repeat(64) + 'i' + n;
const rule: any = { id: 1, asset_type: 'ordinal', server_id: 'guild', channel_id: 'verify', role_id: 'holder',
  slug: 'pizza-comrades', attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1 };
const item = (n: number, owner: string | null = wallet) => ({ id: id(n), inscriptionId: id(n), inscription: n,
  collection: rule.slug, collections: [], owner, traits: [{ type: 'Color', value: n === 1 ? 'Blue' : 'Red' }] });
const page = (items = [item(1), item(2), item(3, other)]) => ({ items, pagination: { pageSize: 100, hasNext: false, nextCursor: null } });
const run = (strict = false): NftCheckContext => ({ checks: new Map(), ...(strict ? { ordinalProviderPolicy: 'ordnet-only' } : {}) });

describe('ord.net-first ownership and automatic rule-save policy', () => {
  let get: jest.Mock, inventory: any, catalog: any, service: OrdinalsOwnershipService;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_PROVIDER', 'ordnet');
    jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', 'test-key');
    get = jest.fn().mockResolvedValue(page());
    inventory = { inventory: jest.fn().mockResolvedValue({ ids: new Set([id(1)]), provider: 'subfrost' }) };
    catalog = { snapshot: jest.fn().mockResolvedValue({ slug: rule.slug, fetched_at: new Date().toISOString(),
      items: new Map([[id(1), { owner: null, traits: [{ type: 'Color', value: 'Blue' }] }]]) }) };
    service = new OrdinalsOwnershipService(new OrdnetOwnershipService({ get } as any), undefined, undefined, catalog, inventory);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses live ord.net first even when wallet-inventory services are injected', async () => {
    const context = run();
    expect(await service.count(rule, [wallet], context)).toBe(2n);
    expect(await service.count({ ...rule, attribute_key: 'Color', attribute_value: 'Blue' }, [wallet], context)).toBe(1n);
    expect([...await service.matchingAssets(rule, [wallet], context)]).toEqual([[id(1), 1n], [id(2), 1n]]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(inventory.inventory).not.toHaveBeenCalled(); expect(catalog.snapshot).not.toHaveBeenCalled();
    expect(service.checkDetails(rule, [wallet], context)).toMatchObject({ provider: 'ordnet', source: 'live' });
  });
  it('accepts a complete zero from ord.net without checking another provider', async () => {
    get.mockResolvedValue(page([item(1, other)]));
    expect(await service.count(rule, [wallet], run())).toBe(0n);
    expect([...await service.matchingAssets(rule, [wallet], run())]).toEqual([]);
    expect(inventory.inventory).not.toHaveBeenCalled();
  });
  it('uses configured wallet-inventory fallback after an ord.net outage on explicit checks', async () => {
    get.mockRejectedValue(new Error('ord.net offline'));
    expect(await service.count(rule, [wallet], run())).toBe(1n);
    expect([...await service.matchingAssets(rule, [wallet], run())]).toEqual([[id(1), 1n]]);
    expect(inventory.inventory).toHaveBeenCalled(); expect(catalog.snapshot).toHaveBeenCalled();
  });
  it.each(['offline', 'unknown owner'])('never falls back automatically when ord.net is %s', async problem => {
    if (problem === 'offline') get.mockRejectedValue(new Error('ord.net offline'));
    else get.mockResolvedValue(page([item(1, null)]));
    await expect(service.count(rule, [wallet], run(true))).rejects.toThrow();
    await expect(service.matchingAssets(rule, [wallet], run(true))).rejects.toThrow();
    expect(inventory.inventory).not.toHaveBeenCalled(); expect(catalog.snapshot).not.toHaveBeenCalled();
  });
  it('keeps export freshness strict even when ordinary fallback is available', async () => {
    get.mockRejectedValue(new Error('offline'));
    await expect(service.count(rule, [wallet], { ...run(), freshExport: true })).rejects.toThrow();
    expect(inventory.inventory).not.toHaveBeenCalled();
  });
  it('honors the automatic policy even if the ordinary provider is Xverse', async () => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_PROVIDER', 'xverse');
    expect(await service.count(rule, [wallet], run(true))).toBe(2n);
    expect(inventory.inventory).not.toHaveBeenCalled();
  });
  it.each([{ kind: 'ids', ids: [id(1)] }, { kind: 'numbers', ranges: [[1, 2]] }])('rejects unsupported automatic selections before any provider request', async inscription_criteria => {
    const unsupported = { ...rule, slug: null, inscription_criteria };
    await expect(service.count(unsupported, [wallet], run(true))).rejects.toThrow();
    await expect(service.matchingAssets(unsupported, [wallet], run(true))).rejects.toThrow();
    expect(get).not.toHaveBeenCalled(); expect(inventory.inventory).not.toHaveBeenCalled();
  });
  it('keeps combined-group ownership and deduplication entirely on ord.net', async () => {
    const a = { ...rule, min_items: 3 }, b = { ...a, id: 2, attribute_key: 'Color', attribute_value: 'Blue' };
    const ownership = new AssetOwnershipService(undefined, undefined, service);
    const engine = new VerificationEngine({} as any, ownership, { getUserAddresses: async () => [wallet] } as any,
      { allowedAddresses: async (_server, addresses) => addresses } as any);
    const checked = await engine.verifyUserBulk('user', [1, 2], wallet, [a, b], run(true));
    expect(checked.validRules).toHaveLength(0); // Same blue item must not be counted twice.
    expect(get).toHaveBeenCalledTimes(1); expect(inventory.inventory).not.toHaveBeenCalled();
  });
  it('retains an earned role and successful timestamp during an automatic ord.net outage', async () => {
    get.mockRejectedValue(new Error('offline'));
    const db: any = { getRoleMappings: jest.fn().mockResolvedValue([rule]),
      getEarnedRoleAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'guild', role_id: 'holder' }]),
      saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn() };
    const engine = new VerificationEngine(db, new AssetOwnershipService(undefined, undefined, service),
      { getUserAddresses: async () => [wallet] } as any, { allowedAddresses: async (_server, addresses) => addresses } as any);
    const discord: any = { removeUserRole: jest.fn(), addUserRoleDynamic: jest.fn() };
    expect(await new DynamicRoleService(db, engine, discord).reverifyRoleInServer('guild', 'holder', run(true)))
      .toEqual({ verified: 0, revoked: 0, errors: 1 });
    expect(discord.removeUserRole).not.toHaveBeenCalled(); expect(discord.addUserRoleDynamic).not.toHaveBeenCalled();
    expect(db.updateLastVerified).not.toHaveBeenCalled(); expect(inventory.inventory).not.toHaveBeenCalled();
  });
  it('skips a queued job whose role gained an incompatible additional-output alternative', async () => {
    const incompatible = { ...rule, id: 2, role_id: 'another', additional_roles: [{ id: 'holder', name: 'Holder' }], slug: null,
      inscription_criteria: { kind: 'numbers', ranges: [[1, 2]] } };
    const db: any = { getRoleMappings: jest.fn().mockResolvedValue([rule, incompatible]), getEarnedRoleAssignments: jest.fn() };
    const engine: any = { evaluateRole: jest.fn(), evaluateRuleGroup: jest.fn() };
    const roles = new DynamicRoleService(db, engine, {} as any);
    expect(await roles.reverifyRoleInServer('guild', 'holder', run(true))).toMatchObject({ verified: 0, revoked: 0, errors: 0, skipped: expect.any(String) });
    expect(await roles.reverifyRoleChangeInServer('guild', 'holder', '1', ['user'], run(true))).toHaveProperty('skipped');
    expect(db.getEarnedRoleAssignments).not.toHaveBeenCalled(); expect(engine.evaluateRole).not.toHaveBeenCalled(); expect(engine.evaluateRuleGroup).not.toHaveBeenCalled();
  });
});

describe('ord.net-compatible Ordinals rule forms', () => {
  it.each([
    [rule, true],
    [{ ...rule, slug: null, inscription_criteria: { kind: 'numbers', ranges: [[1, 2]], collection_slug: 'pizza-comrades' } }, true],
    [{ ...rule, slug: null, inscription_criteria: { kind: 'numbers', ranges: [[1, 2]] } }, false],
    [{ ...rule, slug: null, inscription_criteria: { kind: 'ids', ids: [id(1)] } }, false],
    [{ ...rule, slug: 'all' }, false],
    [{ ...rule, slug: null }, false],
    [{ ...rule, slug: 'BAD SLUG' }, false],
    [{ ...rule, asset_type: 'ethscription', slug: null }, true],
  ])('classifies %j as %s', (candidate, expected) => expect(ordnetCompatible(candidate)).toBe(expected));
});
