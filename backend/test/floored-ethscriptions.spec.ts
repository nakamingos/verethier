import { FlooredEthscriptionsClient } from '../src/services/floored-ethscriptions.client';
const wallet = '0x' + '1'.repeat(40);
const market = '0x' + '2'.repeat(40);
const slug = 'call-data-comrades';
const item = (i = 1) => ({ transactionHash: '0x' + i.toString(16).padStart(64, '0'), currentOwner: wallet,
  previousOwner: wallet, isEscrowed: false, collectionItem: { collectionSlug: slug, attributes: { Type: ['Blue', 'Gold'] } } });
const page = (data: any[], more = false, offset = 0, total = data.length) => ({ data,
  pagination: { limit: 100, offset, hasMore: more, total } });
const response = (body: any, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
describe('Floored Ethscriptions collection reads', () => {
  let client: FlooredEthscriptionsClient;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => { client = new FlooredEthscriptionsClient('synthetic-key'); fetchMock = jest.spyOn(global, 'fetch'); });
  afterEach(() => jest.restoreAllMocks());
  it('requires a backend key and preserves incompatible legacy definitions', () => {
    expect(new FlooredEthscriptionsClient().supportsCollection(slug)).toBe(false);
    for (const s of ['ALL', 'all-collections', 'comrades-otd', 'misprint-mingos']) expect(client.supportsCollection(s)).toBe(false);
    expect(client.supportsCollection(slug)).toBe(true);
  });
  it('reads every page, deduplicates input wallets, and retains array traits', async () => {
    fetchMock.mockResolvedValueOnce(response(page(Array.from({ length: 100 }, (_, i) => item(i + 1)), true, 0, 101)))
      .mockResolvedValueOnce(response(page([item(101)], false, 100, 101)));
    const result = await client.inventory([wallet, wallet.toUpperCase().replace('0X','0x')], slug);
    expect(result).toHaveLength(101);
    expect(result[0].attributes_new?.values.Type).toEqual(['Blue', 'Gold']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('collection=call-data-comrades');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { 'X-API-Key': 'synthetic-key' }, redirect: 'error' });
  });
  it('accepts a complete empty inventory', async () => {
    fetchMock.mockResolvedValue(response(page([])));
    expect(await client.inventory([wallet], slug)).toEqual([]);
  });
  it('counts escrow only with a recognized market and matching previous owner', async () => {
    fetchMock.mockResolvedValueOnce(response(page([{ ...item(), currentOwner: market, isEscrowed: true }])))
      .mockResolvedValueOnce(response({ data: [{ address: market }] }));
    expect(await client.inventory([wallet], slug)).toHaveLength(1);
  });
  it.each([
    ['duplicate IDs', page([item(), item()])],
    ['truncated page', page([item()], true, 0, 200)],
    ['incorrect total', page([item()], false, 0, 2)],
    ['wrong collection', page([{ ...item(), collectionItem: { collectionSlug: 'other', attributes: {} } }])],
    ['missing metadata', page([{ ...item(), collectionItem: { collectionSlug: slug } }])],
    ['arbitrary previous owner', page([{ ...item(), currentOwner: market }])],
    ['wrong offset', page([item()], false, 100)],
  ])('rejects %s instead of producing a negative ownership result', async (_, body) => {
    fetchMock.mockResolvedValue(response(body));
    await expect(client.inventory([wallet], slug)).rejects.toThrow();
  });
  it('preserves legacy pinned-market ownership when its endpoint escrow flag is false', async () => {
    fetchMock.mockResolvedValue(response(page([{ ...item(),
      currentOwner: '0xd3418772623be1a3cc6b6d45cb46420cedd9154a', isEscrowed: false }])));
    expect(await client.inventory([wallet], slug)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects an unrecognized escrow contract', async () => {
    fetchMock.mockResolvedValueOnce(response(page([{ ...item(), currentOwner: market, isEscrowed: true }])))
      .mockResolvedValueOnce(response({ data: [{ address: wallet }] }));
    await expect(client.inventory([wallet], slug)).rejects.toThrow('ownership_mismatch');
  });
  it('rejects changing inventory totals', async () => {
    fetchMock.mockResolvedValueOnce(response(page(Array.from({ length: 100 }, (_, i) => item(i + 1)), true, 0, 101)))
      .mockResolvedValueOnce(response(page([item(101)], false, 100, 102)));
    await expect(client.inventory([wallet], slug)).rejects.toThrow('inventory_changed');
  });
  it('respects rate limiting without exposing an upstream error body', async () => {
    fetchMock.mockResolvedValue(response({ error: { message: 'sensitive upstream body' } }, 429, { 'retry-after': '60' }));
    await expect(client.inventory([wallet], slug)).rejects.toThrow('http_429');
    await expect(client.inventory([wallet], slug)).rejects.toThrow('provider_cooldown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not hide a failed wallet behind another successful wallet', async () => {
    fetchMock.mockResolvedValueOnce(response(page([item()])))
      .mockResolvedValueOnce(response({}, 503));
    await expect(client.inventory([wallet, market], slug)).rejects.toThrow('http_503');
  });
});
