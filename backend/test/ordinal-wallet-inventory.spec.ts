import { OrdinalWalletInventoryService } from '../src/services/ordinal-wallet-inventory.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address;
const other = vectors.valid[1].address;
const id = (n: number) => 'b'.repeat(64) + 'i' + n;
const run = (): any => ({ checks: new Map() });
const response = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

describe('ordered Ordinals wallet ownership providers', () => {
  let service: OrdinalWalletInventoryService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let db: any;
  let requests: any;
  let xverse: jest.Mock;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, 'ORDISCAN_API_KEY', 'ordiscan-mock');
    jest.replaceProperty(EnvironmentConfig, 'SANDSHREW_API_KEY', 'sandshrew-mock');
    jest.replaceProperty(EnvironmentConfig, 'XVERSE_API_KEY', 'xverse-mock');
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_OWNERSHIP_PROVIDERS', 'ordiscan,subfrost,sandshrew,xverse');
    db = { reserveOrdinalProviderRequest: jest.fn().mockResolvedValue(true) };
    requests = { enqueue: jest.fn((provider, work, execute) => execute(0)), promote: jest.fn() };
    xverse = jest.fn().mockResolvedValue(new Map([[id(1), 113558765]]));
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).includes('ordiscan')) return response({ data: [id(1), id(2)] });
      const method = JSON.parse(options.body as string).method;
      return response({ jsonrpc: method === 'btc_getblockcount' ? '1.0' : '2.0', id: 1, result: method === 'ord_address' ? { inscriptions: [id(1)] } : 900000 });
    });
    service = new OrdinalWalletInventoryService(requests, db);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses Ordiscan first and shares one complete wallet inventory across rules', async () => {
    const context = run();
    const [first, second] = await Promise.all([service.inventory(wallet, context, false, xverse), service.inventory(wallet, context, false, xverse)]);
    expect(first).toBe(second);
    expect(first.ids.size).toBe(2);
    expect(first.provider).toBe('ordiscan');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.reserveOrdinalProviderRequest).toHaveBeenCalledTimes(1);
    expect(xverse).not.toHaveBeenCalled();
  });

  it('accepts a validated empty wallet without calling more providers', async () => {
    fetchMock.mockResolvedValue(response({ data: [] }));
    expect((await service.inventory(wallet, run(), false, xverse)).ids.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(xverse).not.toHaveBeenCalled();
  });

  it('falls back on a 429 and honors the cooldown across independent verifications', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 429, { 'retry-after': '300' }));
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('subfrost');
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('subfrost');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('ordiscan'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body as string).method === 'ord_blockheight')).toHaveLength(1);
  });

  it('does not send Ordiscan HTTP requests after the persistent allowance is exhausted', async () => {
    db.reserveOrdinalProviderRequest.mockResolvedValue(false);
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('subfrost');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('ordiscan'))).toBe(false);
    await service.inventory(wallet, run(), false, xverse);
    expect(db.reserveOrdinalProviderRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['malformed', 'duplicate', 'invalid ID', 'RPC error', 'redirect'])('falls back rather than treating %s as zero', async problem => {
    if (problem === 'malformed') fetchMock.mockResolvedValueOnce(response({ data: null }));
    if (problem === 'duplicate') fetchMock.mockResolvedValueOnce(response({ data: [id(1), id(1)] }));
    if (problem === 'invalid ID') fetchMock.mockResolvedValueOnce(response({ data: ['garbage'] }));
    if (problem === 'RPC error') fetchMock.mockResolvedValueOnce(response({ error: { code: -32000 } }));
    if (problem === 'redirect') fetchMock.mockRejectedValueOnce(new TypeError('redirect blocked'));
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('subfrost');
  });

  it('uses Sandshrew v1 after SUBFROST fails', async () => {
    db.reserveOrdinalProviderRequest.mockResolvedValue(false);
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url).includes('subfrost')) return response({}, 503);
      const method = JSON.parse(options.body as string).method;
      return response({ jsonrpc: '2.0', id: 1, result: method === 'ord_address' ? { inscriptions: [id(1)] } : 900000 });
    });
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('sandshrew');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://mainnet.sandshrew.io/v1/sandshrew-mock')).toBe(true);
  });

  it.each(['behind', 'invalid height', 'invalid wallet result'])('skips an ord node with %s', async problem => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_OWNERSHIP_PROVIDERS', 'subfrost,xverse');
    fetchMock.mockImplementation(async (url, options) => {
      const method = JSON.parse(options.body as string).method;
      const result = method === 'btc_getblockcount' ? 900000 : method === 'ord_blockheight'
        ? problem === 'behind' ? 899990 : problem === 'invalid height' ? '900000' : 900000
        : { inscriptions: null };
      return response({ jsonrpc: '2.0', id: 1, result });
    });
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('xverse');
  });

  it('uses Xverse after all earlier providers fail and never fabricates an empty inventory', async () => {
    fetchMock.mockResolvedValue(response({}, 503));
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('xverse');
    xverse.mockRejectedValue(new Error('unavailable'));
    await expect(service.inventory(wallet, run(), false, xverse)).rejects.toThrow('unavailable');
  });

  it('skips providers with missing keys', async () => {
    jest.replaceProperty(EnvironmentConfig, 'ORDISCAN_API_KEY', undefined);
    jest.replaceProperty(EnvironmentConfig, 'SANDSHREW_API_KEY', undefined);
    expect((await service.inventory(wallet, run(), false, xverse)).provider).toBe('subfrost');
    expect(db.reserveOrdinalProviderRequest).not.toHaveBeenCalled();
  });

  it('reads every numbered wallet page, checking the owner and sharing results with ID rules', async () => {
    const context = { ...run(), ordinalNeedsNumbers: true };
    fetchMock.mockImplementation(async url => response({ data: String(url).endsWith('page=1')
      ? Array.from({ length: 100 }, (_, i) => ({ inscription_id: id(i), inscription_number: i, owner_address: wallet }))
      : [{ inscription_id: id(100), inscription_number: -1, owner_address: wallet }] }));
    const inventory = await service.inventory(wallet, context, false, xverse);
    expect(inventory.numbers.size).toBe(101);
    expect(inventory.numbers.get(id(100))).toBe(-1);
    expect(await service.inventory(wallet, context, true, xverse)).toBe(inventory);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['wrong owner', 'missing number', 'duplicate number', 'duplicate ID', 'partial failure'])('rejects %s in a numbered inventory and goes to Xverse', async problem => {
    const items = [{ inscription_id: id(1), inscription_number: 1, owner_address: wallet },
      { inscription_id: id(2), inscription_number: 2, owner_address: wallet }];
    if (problem === 'wrong owner') items[0].owner_address = other;
    if (problem === 'missing number') delete items[0].inscription_number;
    if (problem === 'duplicate number') items[1].inscription_number = 1;
    if (problem === 'duplicate ID') items[1].inscription_id = id(1);
    if (problem === 'partial failure') {
      fetchMock.mockResolvedValueOnce(response({ data: Array.from({ length: 100 }, (_, i) => ({ inscription_id: id(i), inscription_number: i, owner_address: wallet })) }))
        .mockResolvedValueOnce(response({}, 500));
    } else fetchMock.mockResolvedValue(response({ data: items }));
    const inventory = await service.inventory(wallet, run(), true, xverse);
    expect(inventory.provider).toBe('xverse');
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('ordiscan'))).toBe(true);
  });

  it('routes number ranges to Xverse when earlier providers cannot return numbers', async () => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_OWNERSHIP_PROVIDERS', 'subfrost,sandshrew,xverse');
    const context = run();
    const ordinal = new OrdinalsOwnershipService(undefined, undefined, requests, undefined, service);
    jest.spyOn(ordinal as any, 'readInventory').mockResolvedValue(new Map([[id(1), 97305462], [id(2), 97308505]]));
    const rule: any = { id: 1, asset_type: 'ordinal', slug: null, attribute_key: 'ALL', attribute_value: 'ALL',
      inscription_criteria: { kind: 'numbers', ranges: [[97305462, 97305462], [97308505, 97308527]] } };
    expect(await ordinal.count(rule, [wallet], context)).toBe(2n);
    expect(await ordinal.count({ ...rule, id: 2, min_items: 2 }, [wallet], context)).toBe(2n);
    expect((ordinal as any).readInventory).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not force another scheduled wallet onto numbered inventory after checking a numeric rule', async () => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_OWNERSHIP_PROVIDERS', 'subfrost,xverse');
    const context = { ...run(), ordinalMode: 'scheduled' };
    expect((await service.inventory(wallet, context, true, xverse)).provider).toBe('xverse');
    expect((await service.inventory(other, context, false, xverse)).provider).toBe('subfrost');
    expect(xverse).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid provider order instead of silently choosing a paid default', async () => {
    jest.replaceProperty(EnvironmentConfig, 'ORDINALS_OWNERSHIP_PROVIDERS', 'invalid,xverse');
    await expect(service.inventory(wallet, run(), false, xverse)).rejects.toThrow('configuration');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(xverse).not.toHaveBeenCalled();
  });
});
