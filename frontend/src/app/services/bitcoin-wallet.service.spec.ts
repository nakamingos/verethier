import { BitcoinWalletService } from './bitcoin-wallet.service';

const ordinalAddress = 'bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler';
const anotherAddress = 'bc1pcquvhrqv0q68t4m0hfq6tpn006qrskyc7yrqnp2uyrf2emg3wynsdjyk38';
const connected = (address = ordinalAddress) => ({ status: 'success', result: { addresses: [
  { purpose: 'payment', address: 'bc1q-payment' }, { purpose: 'ordinals', address },
], network: { bitcoin: { name: 'Mainnet' } } } });

describe('Xverse Ordinals wallet', () => {
  let service: BitcoinWalletService;
  let request: jasmine.Spy;
  beforeEach(() => {
    service = new BitcoinWalletService();
    request = spyOn<any>(service, 'callWallet');
  });

  it('connects the Ordinals address and requests only that purpose', async () => {
    request.and.resolveTo(connected());
    await service.connect();
    expect(service.address$.value).toBe(ordinalAddress);
    expect(request).toHaveBeenCalledWith('getAddresses', jasmine.objectContaining({ purposes: ['ordinals'] }));
  });

  it('rejects a payment-only response and Bitcoin testnet', async () => {
    request.and.resolveTo({ status: 'success', result: { addresses: [{ purpose: 'payment', address: ordinalAddress }] } });
    await expectAsync(service.connect()).toBeRejectedWithError(/Ordinals address/);
    const response = connected();
    response.result.network.bitcoin.name = 'Testnet';
    request.and.resolveTo(response);
    await expectAsync(service.connect()).toBeRejectedWithError(/Bitcoin mainnet/);
  });

  it('handles a cancelled connection without marking the wallet connected', async () => {
    request.and.resolveTo({ status: 'error', error: { code: -32000 } });
    await expectAsync(service.connect()).toBeRejectedWithError(/cancelled/);
    expect(service.address$.value).toBeNull();
  });

  it('requires reconnecting when the account changes', async () => {
    request.and.resolveTo(connected());
    await service.connect();
    request.and.resolveTo(connected(anotherAddress));
    await expectAsync(service.syncConnectedAccount()).toBeRejectedWithError(/account changed/);
    expect(service.address$.value).toBeNull();
  });

  it('signs the exact server message using BIP322 and checks the account again', async () => {
    request.and.callFake(async method => method === 'getAddresses' ? connected() : {
      status: 'success', result: { signature: 'signature', address: ordinalAddress, protocol: 'BIP322' },
    });
    await service.connect();
    expect(await service.signMessage(ordinalAddress, 'server challenge')).toEqual({ address: ordinalAddress, signature: 'signature' });
    expect(request).toHaveBeenCalledWith('signMessage', { address: ordinalAddress, message: 'server challenge', protocol: 'BIP322' });
    expect(request.calls.all().filter(call => call.args[0] === 'getAddresses').length).toBe(3);
  });

  it('rejects a signing response for a different address', async () => {
    request.and.callFake(async method => method === 'getAddresses' ? connected() : {
      status: 'success', result: { signature: 'signature', address: anotherAddress, protocol: 'BIP322' },
    });
    await service.connect();
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/different address/);
  });

  it('rejects an account change while signing', async () => {
    let switched = false;
    request.and.callFake(async method => {
      if (method === 'getAddresses') return connected(switched ? anotherAddress : ordinalAddress);
      switched = true;
      return { status: 'success', result: { signature: 'signature', address: ordinalAddress, protocol: 'BIP322' } };
    });
    await service.connect();
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/account changed/);
  });
});

describe('Xverse provider selection', () => {
  let previousXverse: any;
  let previousBitcoin: any;
  beforeEach(() => {
    previousXverse = (window as any).XverseProviders;
    previousBitcoin = (window as any).BitcoinProvider;
  });
  afterEach(() => {
    (window as any).XverseProviders = previousXverse;
    (window as any).BitcoinProvider = previousBitcoin;
  });

  it('uses the named Xverse provider through the real SDK even with another Bitcoin provider installed', async () => {
    const other = jasmine.createSpy('other wallet');
    const xverse = jasmine.createSpy('Xverse').and.callFake(async method => method === 'getInfo'
      ? { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unsupported' } }
      : { jsonrpc: '2.0', id: 1, result: connected().result });
    (window as any).BitcoinProvider = { request: other };
    (window as any).XverseProviders = { BitcoinProvider: { request: xverse } };
    const service = new BitcoinWalletService();
    await service.connect();
    expect(service.address$.value).toBe(ordinalAddress);
    expect(xverse).toHaveBeenCalledWith('getAddresses', jasmine.objectContaining({ purposes: ['ordinals'] }));
    expect(other).not.toHaveBeenCalled();
  });

  it('asks for Xverse when only another provider is installed', async () => {
    const other = jasmine.createSpy('other wallet');
    (window as any).BitcoinProvider = { request: other };
    (window as any).XverseProviders = undefined;
    await expectAsync(new BitcoinWalletService().connect()).toBeRejectedWithError(/install the Xverse browser extension/);
    expect(other).not.toHaveBeenCalled();
  });
});
