import { EthscriptionsOwnershipService } from '../src/services/ethscriptions-ownership.service';
import { NftMetadataService } from '../src/services/nft-metadata.service';
import { Erc20OwnershipService } from '../src/services/erc20-ownership.service';

const MARKET = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
const wallet = '0x1111111111111111111111111111111111111111';

describe('ownership checks fail closed on missing data', () => {
  afterEach(() => jest.restoreAllMocks());

  it('never counts an Ethscription without an owner, even in market escrow', () => {
    const service = Object.create(EthscriptionsOwnershipService.prototype) as any;
    const linked = new Set([wallet]);
    expect(service.owned({ owner: wallet, prevOwner: null }, linked)).toBe(true);
    expect(service.owned({ owner: null, prevOwner: wallet }, linked)).toBe(false);
    expect(service.owned({ owner: MARKET, prevOwner: wallet }, linked)).toBe(true);
    expect(service.owned({ owner: MARKET, prevOwner: null }, linked)).toBe(false);
  });

  it('refuses NFT metadata reads for a rule without a network or contract, before any request', async () => {
    const service = new NftMetadataService({} as any);
    const request = jest.spyOn(service as any, 'request');
    await expect(service.checkSetupHealth({ chain_id: null, contract_address: wallet } as any)).rejects.toThrow();
    await expect(service.ownedIds({ chain_id: 1, contract_address: null } as any, wallet)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses an ERC-20 rule without a network before reading balances', async () => {
    const service = Object.create(Erc20OwnershipService.prototype) as any;
    const read = jest.spyOn(service, 'readBalances');
    await expect(service.count({ asset_type: 'erc20', chain_id: null, contract_address: wallet, token_decimals: 18, min_balance: '1' }, [wallet]))
      .rejects.toThrow('Invalid ERC-20 network.');
    expect(read).not.toHaveBeenCalled();
  });
});
