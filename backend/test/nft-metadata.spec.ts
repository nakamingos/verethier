import { NftMetadataService } from '../src/services/nft-metadata.service';
import { DbService } from '../src/services/db.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { NftRuleFields } from '../src/models/verifier-role.interface';

const contract = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
const rule: NftRuleFields = { chain_id: 1, contract_address: contract, token_standard: 'erc721' };
const attributes = [{ trait_type: 'Color', value: 'Red' }];
const token = (id: string) => ({ contract: { address: contract }, tokenId: id, tokenType: 'ERC721', raw: { metadata: { attributes }, error: null } });
const baseToken = (id: string) => ({ contractAddress: contract, tokenId: id, balance: '1' });

describe('Alchemy NFT metadata', () => {
  let service: NftMetadataService;
  let db: { getCachedNftMetadata: jest.Mock; cacheNftMetadata: jest.Mock };
  let request: jest.Mock;
  beforeEach(() => {
    jest.replaceProperty(EnvironmentConfig, 'ALCHEMY_API_KEY', undefined);
    jest.replaceProperty(EnvironmentConfig, 'RPC_URL', 'https://eth-mainnet.g.alchemy.com/v2/local-test-key');
    jest.replaceProperty(EnvironmentConfig, 'ROBINHOOD_RPC_URL', 'https://robinhood-mainnet.g.alchemy.com/v2/rh-test-key');
    db = { getCachedNftMetadata: jest.fn().mockResolvedValue([]), cacheNftMetadata: jest.fn().mockResolvedValue(undefined) };
    service = new NftMetadataService(db as unknown as DbService);
    request = jest.spyOn(global, 'fetch') as jest.Mock;
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  function respond(data: any) { request.mockResolvedValueOnce({ ok: true, json: async () => data }); }

  it('uses the existing Alchemy RPC keys on each chain and caches normalized metadata', async () => {
    respond({ nfts: [token('0x01')] });
    expect(await service.attributes(rule, ['1'])).toEqual(new Map([['1', attributes]]));
    expect(new URL(request.mock.calls[0][0]).host).toBe('eth-mainnet.g.alchemy.com');
    expect(request.mock.calls[0][0]).toContain('/nft/v3/local-test-key/');
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ tokens: [{ contractAddress: contract, tokenId: '1', tokenType: 'ERC721' }] });
    expect(db.cacheNftMetadata).toHaveBeenCalledWith([expect.objectContaining({ chain_id: 1, contract_address: contract, token_id: '1', attributes })]);
    respond([token('1')]);
    await service.attributes({ ...rule, chain_id: 4663 }, ['1']);
    expect(request.mock.calls[1][0]).toContain('https://robinhood-mainnet.g.alchemy.com/nft/v3/rh-test-key/');
  });
  it('can use a separate Alchemy key with a different RPC provider', async () => {
    jest.replaceProperty(EnvironmentConfig, 'RPC_URL', 'https://other-rpc.example');
    jest.replaceProperty(EnvironmentConfig, 'ALCHEMY_API_KEY', 'separate-test-key');
    respond({ nfts: [token('1')] });
    await service.attributes(rule, ['1']);
    expect(request.mock.calls[0][0]).toContain('/nft/v3/separate-test-key/');
  });
  it('reports missing metadata configuration without making a request', async () => {
    jest.replaceProperty(EnvironmentConfig, 'RPC_URL', 'https://other-rpc.example');
    await expect(service.attributes(rule, ['1'])).rejects.toThrow('ALCHEMY_API_KEY');
    expect(request).not.toHaveBeenCalled();
  });
  it('fetches all ownership pages using the documented metadata-free response', async () => {
    respond({ ownedNfts: [baseToken('0x01')], totalCount: 2, pageKey: 'next' });
    respond({ ownedNfts: [baseToken('2')], totalCount: 2, pageKey: null });
    expect(await service.ownedIds(rule, wallet)).toEqual(['1', '2']);
    const query = new URL(request.mock.calls[1][0]).searchParams;
    expect(query.get('withMetadata')).toBe('false');
    expect(query.get('contractAddresses[]')).toBe(contract);
    expect(query.get('pageKey')).toBe('next');
  });
  it.each([
    null,
    { ownedNfts: [baseToken('1')], totalCount: 2 },
    { ownedNfts: [baseToken('1'), baseToken('0x01')], totalCount: 2 },
    { ownedNfts: [{ ...baseToken('1'), contractAddress: wallet }], totalCount: 1 },
    { ownedNfts: [], totalCount: 0, pageKey: 'next' },
    { ownedNfts: [], totalCount: null },
  ])('rejects incomplete or malformed ownership results', async data => {
    respond(data);
    await expect(service.ownedIds(rule, wallet)).rejects.toThrow('temporarily unavailable');
  });
  it('rejects repeated page keys and a changing total', async () => {
    respond({ ownedNfts: [baseToken('1')], totalCount: 3, pageKey: 'next' });
    respond({ ownedNfts: [baseToken('2')], totalCount: 3, pageKey: 'next' });
    await expect(service.ownedIds(rule, wallet)).rejects.toThrow('temporarily unavailable');
    respond({ ownedNfts: [baseToken('1')], totalCount: 2, pageKey: 'next' });
    respond({ ownedNfts: [baseToken('2')], totalCount: 3 });
    await expect(service.ownedIds(rule, wallet)).rejects.toThrow('temporarily unavailable');
  });
  it('uses fresh database metadata while refreshing malformed rows', async () => {
    db.getCachedNftMetadata.mockResolvedValue([
      { chain_id: 1, contract_address: contract, token_id: '1', attributes },
      { chain_id: 1, contract_address: contract, token_id: '2', attributes: {} },
      { chain_id: 4663, contract_address: contract, token_id: '3', attributes },
    ]);
    respond({ nfts: [token('2'), token('3')] });
    expect((await service.attributes(rule, ['1', '2', '3'])).size).toBe(3);
    expect(JSON.parse(request.mock.calls[0][1].body).tokens.map(nft => nft.tokenId)).toEqual(['2', '3']);
    const since = db.getCachedNftMetadata.mock.calls[0][3];
    expect(Date.now() - Date.parse(since)).toBeGreaterThanOrEqual(600000);
    expect(Date.now() - Date.parse(since)).toBeLessThan(601000);
  });
  it('avoids network calls for cached metadata, including uint256 IDs and empty trait lists', async () => {
    const id = ((1n << 256n) - 1n).toString();
    db.getCachedNftMetadata.mockResolvedValue([{ chain_id: 1, contract_address: contract, token_id: id, attributes: [] }]);
    expect(await service.attributes(rule, [id, id])).toEqual(new Map([[id, []]]));
    expect(request).not.toHaveBeenCalled();
  });
  it('batches metadata requests and deduplicates IDs', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => String(i));
    request.mockImplementation(async (_url, options) => ({ ok: true, json: async () => ({ nfts: JSON.parse(options.body).tokens.map(nft => token(nft.tokenId)) }) }));
    expect((await service.attributes(rule, [...ids, '0x00'])).size).toBe(101);
    expect(request.mock.calls.map(([, options]) => JSON.parse(options.body).tokens.length)).toEqual([50, 50, 1]);
  });
  it.each([
    [], [token('2')], [token('1'), token('1')],
    [{ ...token('1'), contract: { address: wallet } }],
    [{ ...token('1'), tokenType: 'ERC1155' }],
    [{ ...token('1'), raw: { metadata: {}, error: null } }],
    [{ ...token('1'), raw: { metadata: { attributes }, error: 'metadata timeout' } }],
  ].map(nfts => ({ nfts })))('refuses missing, wrong or unreadable metadata', async ({ nfts }) => {
    respond({ nfts });
    await expect(service.attributes(rule, ['1'])).rejects.toThrow('temporarily unavailable');
    expect(db.cacheNftMetadata).not.toHaveBeenCalled();
  });
  it('accepts an explicit empty attributes list as a valid nonmatch', async () => {
    respond({ nfts: [{ ...token('1'), raw: { metadata: { attributes: [] }, error: null } }] });
    expect(await service.attributes(rule, ['1'])).toEqual(new Map([['1', []]]));
  });
  it('does not expose credentials from HTTP or network errors', async () => {
    request.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(service.attributes(rule, ['1'])).rejects.toThrow('temporarily unavailable');
    expect(request).toHaveBeenCalledTimes(1);
    jest.useFakeTimers();
    request.mockRejectedValue(new Error('failed at https://eth-mainnet.g.alchemy.com/nft/v3/local-test-key'));
    const result = service.attributes(rule, ['1']).catch(error => error.message);
    await jest.runAllTimersAsync();
    expect(await result).toBe('NFT trait verification is temporarily unavailable. Please try again.');
  });
  it('retries a rate limit once', async () => {
    jest.useFakeTimers();
    request.mockResolvedValueOnce({ ok: false, status: 429 });
    respond({ nfts: [token('1')] });
    const result = service.attributes(rule, ['1']);
    await jest.runAllTimersAsync();
    expect(await result).toEqual(new Map([['1', attributes]]));
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('samples and caches autocomplete traits without restricting manual entries', async () => {
    respond({ nfts: [token('1'), token('2'), { ...token('3'), raw: {} }] });
    expect(await service.suggestions(rule)).toEqual(['Color']);
    expect(await service.suggestions(rule, 'color')).toEqual(['Red']);
    expect(request).toHaveBeenCalledTimes(1);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001);
    respond({ nfts: [token('1')] });
    await service.suggestions(rule);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
