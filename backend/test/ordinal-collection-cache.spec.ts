import { OrdinalCollectionCacheService } from '../src/services/ordinal-collection-cache.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address;
const id = (n: number) => 'a'.repeat(64) + 'i' + n;
const slug = 'pizza-comrades';
const raw = (fetched = new Date().toISOString()) => ({ slug, fetched_at: fetched, item_count: 2,
  items: [{ inscription_id: id(1), values: { Category: 'Cosmic Oven-Lord' } },
    { inscription_id: id(2), values: { Category: ['Pirate', 'Gold Bearer'] } }] });
const live = () => ({ slug, fetched_at: new Date().toISOString(), items: new Map([
  [id(1), { owner: wallet, traits: [{ type: 'Category', value: 'Cosmic Oven-Lord' }] }],
  [id(2), { owner: wallet, traits: [{ type: 'Category', value: 'Pirate' }, { type: 'Category', value: 'Gold Bearer' }] }],
]) });
const run = () => ({ checks: new Map() });
const rule: any = { id: 1, asset_type: 'ordinal', slug, attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1 };

describe('persistent Ordinals collection catalogs', () => {
  let db: any;
  let ordnet: any;
  let requests: any;
  let cache: OrdinalCollectionCacheService;
  beforeEach(() => {
    db = { getOrdinalCollection: jest.fn().mockResolvedValue(raw()), replaceOrdinalCollection: jest.fn().mockResolvedValue(true),
      getOrdinalCatalogRules: jest.fn().mockResolvedValue([{ slug }, { slug }, { slug: null, inscription_criteria: { kind: 'numbers' } }]) };
    ordnet = { snapshot: jest.fn().mockResolvedValue(live()), promoteScan: jest.fn() };
    requests = { promote: jest.fn(work => work.priority = 'interactive') };
    cache = new OrdinalCollectionCacheService(db, ordnet, requests);
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_PROVIDER', 'ordnet');
  });
  afterEach(() => jest.restoreAllMocks());

  it('requires a live catalog refresh for exports and never substitutes a stored answer after failure', async () => {
    const saved = await cache.snapshot(slug, run());
    expect(saved.items.size).toBe(2);
    ordnet.snapshot.mockRejectedValue(new Error('provider unavailable'));
    await expect(cache.snapshot(slug, { ...run(), freshExport: true })).rejects.toThrow('unavailable');
    expect(ordnet.snapshot).toHaveBeenCalledTimes(1);
    expect(await cache.snapshot(slug, run())).toBe(saved);
  });

  it('loads the complete persistent catalog after a restart and never restores owners', async () => {
    const collection = await cache.snapshot(slug, run());
    expect(collection.items.size).toBe(2);
    expect([...collection.items.values()].every(item => item.owner === null)).toBe(true);
    expect(collection.items.get(id(2)).traits).toHaveLength(2);
    await new OrdinalCollectionCacheService(db, ordnet, requests).snapshot(slug, run());
    expect(db.getOrdinalCollection).toHaveBeenCalledTimes(2);
    expect(ordnet.snapshot).not.toHaveBeenCalled();
  });

  it('fills a missing collection once across concurrent members and writes market-style JSONB values', async () => {
    db.getOrdinalCollection.mockResolvedValue(null);
    const [first, second] = await Promise.all([cache.snapshot(slug, run()), cache.snapshot(slug, run())]);
    expect(first).toBe(second);
    expect(ordnet.snapshot).toHaveBeenCalledTimes(1);
    expect(db.replaceOrdinalCollection).toHaveBeenCalledWith(slug, first.fetched_at, [
      { inscription_id: id(1), values: { Category: 'Cosmic Oven-Lord' } },
      { inscription_id: id(2), values: { Category: ['Pirate', 'Gold Bearer'] } },
    ]);
    expect(first.items.get(id(1)).owner).toBeNull();
  });

  it('serves stored metadata while an overdue background refresh is unfinished', async () => {
    db.getOrdinalCollection.mockResolvedValue(raw(new Date(Date.now() - 7 * 3600000).toISOString()));
    let finish: (value: any) => void;
    ordnet.snapshot.mockImplementation(() => new Promise(resolve => finish = resolve));
    const saved = await cache.snapshot(slug, run());
    expect(saved.items.size).toBe(2);
    expect(ordnet.snapshot.mock.calls[0][1].ordinalWork.priority).toBe('background');
    finish(live());
    await cache.refresh(slug);
    expect(db.replaceOrdinalCollection).toHaveBeenCalledTimes(1);
  });

  it.each(['partial scan', 'unknown traits', 'empty scan', 'invalid trait', 'duplicate DB IDs'])('keeps good metadata after %s', async problem => {
    const saved = await cache.snapshot(slug, run());
    if (problem === 'partial scan') ordnet.snapshot.mockRejectedValue(new Error('cursor failed'));
    else {
      const next = live();
      if (problem === 'unknown traits') next.items.get(id(1)).traits = null;
      if (problem === 'empty scan') next.items.clear();
      if (problem === 'invalid trait') next.items.get(id(1)).traits = [{ type: 'Category', value: '' }];
      if (problem === 'duplicate DB IDs') { db.getOrdinalCollection.mockResolvedValue({ ...raw(), items: [raw().items[0], raw().items[0]] }); ordnet.snapshot.mockRejectedValue(new Error('unavailable')); }
      else ordnet.snapshot.mockResolvedValue(next);
    }
    await expect(cache.refresh(slug)).rejects.toThrow('unavailable');
    expect(db.replaceOrdinalCollection).not.toHaveBeenCalled();
    expect(await cache.snapshot(slug, run())).toBe(saved);
  });

  it('does not use a truncated persisted catalog as proof of zero holdings', async () => {
    db.getOrdinalCollection.mockResolvedValue({ ...raw(), item_count: 3 });
    ordnet.snapshot.mockRejectedValue(new Error('unavailable'));
    await expect(cache.snapshot(slug, run())).rejects.toThrow('unavailable');
  });

  it('promotes a cold background scan when an interactive verifier joins', async () => {
    let finish: (value: any) => void;
    ordnet.snapshot.mockImplementation(() => new Promise(resolve => finish = resolve));
    const background = cache.refresh(slug);
    const interactive = cache.refresh(slug, { priority: 'interactive' });
    expect(requests.promote).toHaveBeenCalled();
    expect(ordnet.promoteScan).toHaveBeenCalledWith(slug);
    finish(live());
    expect(await interactive).toBe(await background);
  });

  it('refreshes each unique configured collection once per scheduled run', async () => {
    const context: any = { checks: new Map(), ordinalMode: 'scheduled' };
    await cache.refreshScheduled(context);
    expect(ordnet.snapshot).toHaveBeenCalledTimes(1);
    expect(context.ordinalNeedsNumbers).toBeUndefined();
    expect((await context.ordinalCatalogs.get(slug)).items.size).toBe(2);
  });

  it('serves trait autocomplete from persistent data without a provider scan', async () => {
    expect(await cache.suggestions(slug)).toEqual(['Category']);
    expect(await cache.suggestions(slug, 'category')).toEqual(['Cosmic Oven-Lord', 'Gold Bearer', 'Pirate']);
    expect(ordnet.snapshot).not.toHaveBeenCalled();
  });

  it('uses the newer committed version if another worker finished a newer refresh', async () => {
    db.replaceOrdinalCollection.mockResolvedValue(false);
    const newer = raw(new Date(Date.now() + 1000).toISOString());
    db.getOrdinalCollection.mockResolvedValue(newer);
    expect((await cache.refresh(slug)).fetched_at).toBe(newer.fetched_at);
  });

  it('counts only fresh wallet IDs against saved membership and traits', async () => {
    const inventory = { inventory: jest.fn().mockResolvedValue({ ids: new Set([id(1), id(99)]), provider: 'subfrost' }) };
    const service = new OrdinalsOwnershipService(ordnet, db, requests, cache, inventory as any);
    const context: any = run();
    expect(await service.count(rule, [wallet], context)).toBe(1n);
    expect(await service.count({ ...rule, attribute_key: 'Category', attribute_value: 'cosmic oven-lord' }, [wallet], context)).toBe(1n);
    expect(await service.count({ ...rule, attribute_key: 'Category', attribute_value: 'Pirate' }, [wallet], context)).toBe(0n);
    expect(service.checkDetails(rule, [wallet], context)).toMatchObject({ provider: 'subfrost', source: 'collection-cache' });
    expect(ordnet.snapshot).not.toHaveBeenCalled();
  });

  it('returns unavailable when every ownership lookup fails, even with valid metadata', async () => {
    const inventory = { inventory: jest.fn().mockRejectedValue(new Error('Ordinals verification is temporarily unavailable.')) };
    const service = new OrdinalsOwnershipService(ordnet, db, requests, cache, inventory as any);
    await expect(service.count(rule, [wallet], run())).rejects.toThrow('unavailable');
  });

  it('refreshes metadata before scheduled role evaluation and keeps checks running if refresh fails', async () => {
    const sequence: string[] = [];
    const dbRoles: any = { getDisabledBackgroundServers: jest.fn().mockResolvedValue(new Set()), getEarnedRoleAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'guild', role_id: 'role' }]),
      saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn() };
    const engine: any = { evaluateRole: jest.fn(async () => { sequence.push('evaluate'); return { status: 'passed', results: [] }; }) };
    const discord: any = { addUserRoleDynamic: jest.fn().mockResolvedValue(true) };
    const ordinal: any = { refreshScheduledCatalogs: jest.fn(async () => { sequence.push('refresh'); throw new Error('outage'); }) };
    await new DynamicRoleService(dbRoles, engine, discord, ordinal).performScheduledReverification();
    expect(sequence).toEqual(['refresh', 'evaluate']);
  });
});
