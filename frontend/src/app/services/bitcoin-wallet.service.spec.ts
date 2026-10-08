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

  it('requests connection permission for only the mainnet Ordinals address', async () => {
    request.and.resolveTo(connected());
    await service.connect();
    expect(service.address$.value).toBe(ordinalAddress);
    expect(request).toHaveBeenCalledWith('wallet_connect', jasmine.objectContaining({ addresses: ['ordinals'], network: 'Mainnet' }));
    expect(request.calls.all().some(call => call.args[0] === 'getAddresses')).toBeFalse();
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

  it('reads the address-array response after connection without requesting another approval', async () => {
    request.and.resolveTo(connected());
    await service.connect();
    request.and.resolveTo({ status: 'success', result: connected().result.addresses });
    expect(await service.syncConnectedAccount()).toBe(ordinalAddress);
    expect(request.calls.mostRecent().args).toEqual(['getAddresses', jasmine.objectContaining({ purposes: ['ordinals'] })]);
    expect(request.calls.all().filter(call => call.args[0] === 'wallet_connect').length).toBe(1);
  });

  it('rejects a non-mainnet address-array response and clears the connection', async () => {
    request.and.resolveTo(connected());
    await service.connect();
    request.and.resolveTo({ status: 'success', result: [{ purpose: 'ordinals', address: ordinalAddress, network: 'Testnet' }] });
    await expectAsync(service.syncConnectedAccount()).toBeRejectedWithError(/Bitcoin mainnet/);
    expect(service.address$.value).toBeNull();
  });

  it('asks to reconnect when Xverse revokes account read permission', async () => {
    request.and.resolveTo(connected());
    await service.connect();
    request.and.resolveTo({ status: 'error', error: { code: -32002, message: 'Access denied' } });
    await expectAsync(service.syncConnectedAccount()).toBeRejectedWithError(/Click Connect and approve/);
    expect(service.address$.value).toBeNull();
  });

  it('shows the provider error without describing a wallet failure as cancellation', async () => {
    request.and.resolveTo({ status: 'error', error: { code: -32603, message: 'Wallet is locked' } });
    await expectAsync(service.connect()).toBeRejectedWithError('Wallet connection failed. Wallet is locked');
    expect(service.address$.value).toBeNull();
  });

  it('asks to update Xverse when the connection method is unsupported', async () => {
    request.and.resolveTo({ status: 'error', error: { code: -32601, message: 'Unsupported' } });
    await expectAsync(service.connect()).toBeRejectedWithError(/Update Xverse/);
    expect(service.address$.value).toBeNull();
  });

  it('signs the exact server message using BIP322 and checks the account again', async () => {
    request.and.callFake(async method => method !== 'signMessage' ? connected() : {
      status: 'success', result: { signature: 'signature', address: ordinalAddress, protocol: 'BIP322' },
    });
    await service.connect();
    expect(await service.signMessage(ordinalAddress, 'server challenge')).toEqual({ address: ordinalAddress, signature: 'signature' });
    expect(request).toHaveBeenCalledWith('signMessage', { address: ordinalAddress, message: 'server challenge', protocol: 'BIP322' });
    expect(request.calls.all().filter(call => call.args[0] === 'getAddresses').length).toBe(2);
  });

  it('rejects a signing response for a different address', async () => {
    request.and.callFake(async method => method !== 'signMessage' ? connected() : {
      status: 'success', result: { signature: 'signature', address: anotherAddress, protocol: 'BIP322' },
    });
    await service.connect();
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/different address/);
  });

  it('rejects an account change while signing', async () => {
    let switched = false;
    request.and.callFake(async method => {
      if (method !== 'signMessage') return connected(switched ? anotherAddress : ordinalAddress);
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
    let permissionGranted = false;
    const xverse = jasmine.createSpy('Xverse').and.callFake(async method => {
      if (method === 'getInfo') return { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unsupported' } };
      if (method === 'wallet_connect') {
        permissionGranted = true;
        return { jsonrpc: '2.0', id: 1, result: connected().result };
      }
      if (!permissionGranted) return { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } };
      if (method === 'signMessage') return { jsonrpc: '2.0', id: 1, result: { address: ordinalAddress, signature: 'signature', protocol: 'BIP322' } };
      return { jsonrpc: '2.0', id: 1, result: connected().result.addresses };
    });
    (window as any).BitcoinProvider = { request: other };
    (window as any).XverseProviders = { BitcoinProvider: { request: xverse } };
    const service = new BitcoinWalletService();
    await service.connect();
    expect(service.address$.value).toBe(ordinalAddress);
    expect(xverse).toHaveBeenCalledWith('wallet_connect', jasmine.objectContaining({ addresses: ['ordinals'], network: 'Mainnet' }));
    expect(await service.syncConnectedAccount()).toBe(ordinalAddress);
    expect(xverse).toHaveBeenCalledWith('getAddresses', jasmine.objectContaining({ purposes: ['ordinals'] }));
    expect(await service.signMessage(ordinalAddress, 'server challenge')).toEqual({ signature: 'signature', address: ordinalAddress });
    expect(xverse.calls.all().filter(call => call.args[0] === 'wallet_connect').length).toBe(1);
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
