import { normalizeRuleLabel } from '../src/utils/inscription-rule.util';
import { EnvironmentConfig } from '../src/config/environment.config';
import { VerifierRole } from '../src/models/verifier-role.interface';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { inscriptionCriteria, inscriptionCriteriaCapacity, inscriptionRuleScope, parseInscriptionCriteria } from '../src/utils/inscription-rule.util';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address;
const other = vectors.valid[1].address;
const id = (n: number) => 'a'.repeat(64) + 'i' + n;
const base: VerifierRole = { id: 1, server_id: 'guild', server_name: 'Guild', channel_id: 'verify', channel_name: 'Verify',
  role_id: 'special', role_name: 'Special', asset_type: 'ordinal', slug: null, chain_id: null,
  attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1, inscription_criteria: { kind: 'ids', ids: [id(1)] } };
const run = (): NftCheckContext => ({ checks: new Map(), ordinalMode: 'scheduled' });
const inventoryItem = (n: number, number = n) => ({ id: id(n), number, currentAddress: wallet, currentOutput: 'b'.repeat(64) + ':0' });

describe('Specific inscription inputs', () => {
  it('normalizes full IDs for each chain and removes duplicates', () => {
    expect(parseInscriptionCriteria(`${id(2)}, ${id(1).toUpperCase()},${id(2)}`)).toEqual({ kind: 'ids', ids: [id(1), id(2)] });
    expect(parseInscriptionCriteria('0x' + 'A'.repeat(64), null, 'ethscription')).toEqual({ kind: 'ids', ids: ['0x' + 'a'.repeat(64)] });
  });
  it('stores inclusive ranges compactly and merges duplicate, overlapping, and adjacent selections', () => {
    expect(parseInscriptionCriteria(null, '100-200,150,0-99,201,500')).toEqual({ kind: 'numbers', ranges: [[0, 201], [500, 500]] });
    expect(parseInscriptionCriteria(null, '0-99999')).toEqual({ kind: 'numbers', ranges: [[0, 99999]] });
    expect(inscriptionCriteriaCapacity(parseInscriptionCriteria(null, '0-99999'))).toBe(100000n);
    expect(parseInscriptionCriteria(null, '-10--1,0')).toEqual({ kind: 'numbers', ranges: [[-10, 0]] });
  });
  it.each(['', '1,', '1,,2', '10-1', '1.5', '1e3', '9007199254740992', 'all', '1-2-3'])('rejects malformed number selection %s', input => {
    expect(() => parseInscriptionCriteria(null, input)).toThrow();
  });
  it('rejects crossed ID formats, mixed inputs, negative Ethscription numbers, and oversized lists', () => {
    expect(() => parseInscriptionCriteria('0x' + 'a'.repeat(64))).toThrow();
    expect(() => parseInscriptionCriteria(id(1), null, 'ethscription')).toThrow();
    expect(() => parseInscriptionCriteria(id(1), '1')).toThrow('not both');
    expect(() => parseInscriptionCriteria(null, '-1', 'ethscription')).toThrow();
    expect(() => parseInscriptionCriteria(null, Array(1001).fill('1').join(','))).toThrow();
    expect(() => parseInscriptionCriteria('a'.repeat(64) + 'i01')).toThrow();
  });
  it('rejects corrupt or incompatible saved criteria and formats bounded displays', () => {
    for (const change of [
      { slug: 'yonder' }, { attribute_key: 'Hat' }, { asset_type: 'nft' },
      { inscription_criteria: { kind: 'ids', ids: [id(2), id(1)] } },
      { inscription_criteria: { kind: 'numbers', ranges: [[0, 10], [10, 20]] } },
      { inscription_criteria: { kind: 'numbers', ranges: [[1, 1.5]] } },
      { inscription_criteria: { kind: 'ids', ids: [id(1)], unexpected: true } },
    ]) expect(() => inscriptionCriteria({ ...base, ...change } as any)).toThrow();
    const criteria = parseInscriptionCriteria(Array.from({ length: 1000 }, (_, n) => id(n)).join(','));
    expect(inscriptionRuleScope({ ...base, inscription_criteria: criteria }).length).toBeLessThan(1024);
    expect(inscriptionRuleScope({ ...base, inscription_criteria: criteria })).toContain('995 more');
    expect(inscriptionRuleScope({ ...base, inscription_criteria: { kind: 'ids', ids: [id(1) + '0'.repeat(6000)] } }).length).toBeLessThan(1024);
  });
});

describe('Specific Ordinals ownership', () => {
  let service: OrdinalsOwnershipService;
  let request: jest.SpyInstance;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_PROVIDER', 'ordnet');
    jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', 'test-key');
    service = new OrdinalsOwnershipService();
    request = jest.spyOn(service as any, 'request');
  });
  afterEach(() => jest.restoreAllMocks());

  it('validates exact IDs before setup without a collection lookup and skips number expansion', async () => {
    request.mockResolvedValue([{ id: id(1), currentAddress: wallet }]);
    expect(await service.prepareInscriptionRule(id(1), null, 1)).toMatchObject({ slug: null, asset_type: 'ordinal', inscription_criteria: base.inscription_criteria });
    expect(request.mock.calls[0][0]).toContain('/v1/inscriptions/batch?');
    request.mockClear();
    expect(await service.prepareInscriptionRule(null, '0-99999', 2)).toMatchObject({ inscription_criteria: { kind: 'numbers', ranges: [[0, 99999]] } });
    expect(request).not.toHaveBeenCalled();
    await expect(service.prepareInscriptionRule(`${id(1)},${id(1)}`, null, 2)).rejects.toThrow('cannot exceed');
  });
  it('requires the provider capability and backend key for these rules', async () => {
    jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', undefined);
    await expect(service.prepareInscriptionRule(null, '1', 1)).rejects.toThrow('XVERSE_API_KEY');
    expect(request).not.toHaveBeenCalled();
  });
  it('shares fresh owner batches across overlapping rules, members and stacked wallets', async () => {
    request.mockImplementation(async path => new URLSearchParams(path.split('?')[1]).get('inscriptionIds').split(',')
      .map(value => ({ id: value, currentAddress: value === id(2) ? other : wallet })));
    const context = run();
    const list = { ...base, inscription_criteria: parseInscriptionCriteria(`${id(1)},${id(2)}`) };
    expect(await service.count(list, [wallet, other, wallet], context)).toBe(2n);
    expect(await service.count(base, [wallet], context)).toBe(1n);
    expect(await service.count(base, [other], context)).toBe(0n);
    expect(request).toHaveBeenCalledTimes(1);
    expect(service.checkDetails(base, [wallet], context)).toEqual({ provider: 'xverse', source: 'live' });
    expect(await service.count(list, [wallet], run())).toBe(1n);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('uses batches of 25 and does not make a separate lookup for every member', async () => {
    request.mockImplementation(async path => new URLSearchParams(path.split('?')[1]).get('inscriptionIds').split(',').map(value => ({ id: value, currentAddress: wallet })));
    const list = { ...base, inscription_criteria: parseInscriptionCriteria(Array.from({ length: 26 }, (_, n) => id(n)).join(',')) };
    const context = run();
    expect(await service.count(list, [wallet], context)).toBe(26n);
    expect(await service.count(list, [other], context)).toBe(0n);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('reads every number page and shares inventories across ranges and minimums', async () => {
    request.mockResolvedValueOnce({ limit: 25, offset: 0, items: Array.from({ length: 25 }, (_, n) => inventoryItem(n, n + 100)) })
      .mockResolvedValueOnce({ limit: 25, offset: 25, items: [inventoryItem(25, 1000), inventoryItem(26, -1)] });
    const context = run();
    const range = { ...base, inscription_criteria: parseInscriptionCriteria(null, '100-124,1000') };
    expect(await service.count(range, [wallet], context)).toBe(26n);
    expect(await service.count({ ...range, min_items: 20 }, [wallet], context)).toBe(26n);
    expect(await service.count({ ...base, inscription_criteria: parseInscriptionCriteria(null, '-10--1') }, [wallet], context)).toBe(1n);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toContain('offset=25');
  });
  it('confirms the final empty page for an exact multiple of the page size', async () => {
    request.mockResolvedValueOnce({ limit: 25, offset: 0, items: Array.from({ length: 25 }, (_, n) => inventoryItem(n)) })
      .mockResolvedValueOnce({ limit: 25, offset: 25, items: [] });
    expect(await service.count({ ...base, inscription_criteria: parseInscriptionCriteria(null, '0-24') }, [wallet])).toBe(25n);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('counts unique inscriptions across linked wallets', async () => {
    request.mockImplementation(async path => ({ limit: 25, offset: 0, items: path.includes(wallet)
      ? [inventoryItem(1), inventoryItem(2)]
      : [{ ...inventoryItem(2), currentAddress: other }, { ...inventoryItem(3), currentAddress: other }] }));
    expect(await service.count({ ...base, inscription_criteria: parseInscriptionCriteria(null, '1-3') }, [wallet, other, wallet])).toBe(3n);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(['missing-number', 'duplicate', 'wrong-owner', 'wrong-offset', 'partial', 'null-response', 'oversized-limit'])('treats %s inventory as unavailable', async problem => {
    const data: any = { limit: 25, offset: 0, items: [inventoryItem(1)] };
    if (problem === 'missing-number') delete data.items[0].number;
    if (problem === 'duplicate') data.items.push(data.items[0]);
    if (problem === 'wrong-owner') data.items[0].currentAddress = other;
    if (problem === 'wrong-offset') data.offset = 25;
    if (problem === 'partial') data.total = 2;
    if (problem === 'oversized-limit') data.limit = 26;
    request.mockResolvedValue(problem === 'null-response' ? null : data);
    await expect(service.count({ ...base, inscription_criteria: parseInscriptionCriteria(null, '1-10') }, [wallet])).rejects.toThrow('unavailable');
  });
  it('rejects repeated/overlapping pages instead of counting them', async () => {
    request.mockResolvedValueOnce({ limit: 1, offset: 0, items: [inventoryItem(1)] })
      .mockResolvedValueOnce({ limit: 1, offset: 1, items: [inventoryItem(1)] });
    await expect(service.count({ ...base, inscription_criteria: parseInscriptionCriteria(null, '1') }, [wallet])).rejects.toThrow('unavailable');
  });
  it('retains roles on uncertain checks and revokes only after a confirmed non-match', async () => {
    const db = { getDisabledBackgroundServers: jest.fn().mockResolvedValue(new Set()), getEarnedRoleAssignments: jest.fn().mockResolvedValue([{ id: 'assignment', user_id: 'user', server_id: 'guild', role_id: 'special' }]),
      getRoleMappings: jest.fn().mockResolvedValue([base]), saveRoleCheckDetails: jest.fn(), updateLastVerified: jest.fn(), updateRoleAssignmentStatus: jest.fn() };
    const engine = new VerificationEngine(db as any, new AssetOwnershipService({} as any, {} as any, service), { getUserAddresses: jest.fn().mockResolvedValue([wallet]) } as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    const discord = { removeUserRole: jest.fn().mockResolvedValue(true) };
    const scheduler = new DynamicRoleService(db as any, engine, discord as any);
    request.mockResolvedValue([]); // Missing requested ID is uncertain, not zero.
    await scheduler.performScheduledReverification();
    expect(discord.removeUserRole).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith('assignment', expect.objectContaining({ last_check_status: 'unavailable' }));
    request.mockResolvedValue([{ id: id(1), currentAddress: other }]);
    await scheduler.performScheduledReverification();
    expect(discord.removeUserRole).toHaveBeenCalledWith('user', 'guild', 'special', expect.any(Map));
  });
});

describe('specific-inscription labels', () => {
  it('preserves human-readable names and allows clearing the label', () => {
    expect(normalizeRuleLabel('  Pizza Comrades — Gold Crowns  ')).toBe('Pizza Comrades — Gold Crowns');
    expect(normalizeRuleLabel(' ')).toBeNull();
    for (const label of ['a'.repeat(101), 'first\nsecond', 'first\tsecond']) expect(() => normalizeRuleLabel(label)).toThrow('one line');
  });
  it('shows an escaped label while retaining the exact selection and minimum semantics', () => {
    const rule: any = {asset_type: 'ordinal', slug: null, attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1,
      inscription_criteria: {kind: 'numbers', ranges: [[123,123], [456,456]]}, rule_label: '**Gold Crowns**'};
    expect(inscriptionRuleScope(rule)).toContain('Label: \\*\\*Gold Crowns\\*\\*');
    expect(inscriptionRuleScope(rule)).toContain('123, 456');
    expect(inscriptionCriteria(rule)).toEqual(rule.inscription_criteria);
  });
});
