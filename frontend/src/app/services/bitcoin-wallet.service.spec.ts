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

describe('UniSat Ordinals wallet', () => {
  let service: BitcoinWalletService;
  let previousUniSat: any;
  let previousXverse: any;
  let wallet: any;
  beforeEach(() => {
    previousUniSat = (window as any).unisat;
    previousXverse = (window as any).XverseProviders;
    wallet = { requestAccounts: jasmine.createSpy().and.resolveTo([ordinalAddress]),
      getAccounts: jasmine.createSpy().and.resolveTo([ordinalAddress]),
      getChain: jasmine.createSpy().and.resolveTo({ enum: 'BITCOIN_MAINNET', network: 'livenet' }),
      signMessage: jasmine.createSpy().and.resolveTo('unisat-signature') };
    (window as any).unisat = wallet;
    service = new BitcoinWalletService();
  });
  afterEach(() => {
    (window as any).unisat = previousUniSat;
    (window as any).XverseProviders = previousXverse;
  });

  it('connects through UniSat explicitly even with Xverse installed, without using the other wallet', async () => {
    const other = jasmine.createSpy(); (window as any).XverseProviders = { BitcoinProvider: { request: other } };
    await service.connect('unisat');
    expect(service.address$.value).toBe(ordinalAddress); expect(wallet.requestAccounts).toHaveBeenCalledTimes(1);
    expect(await service.syncConnectedAccount()).toBe(ordinalAddress);
    expect(wallet.getAccounts).toHaveBeenCalledTimes(1); expect(wallet.requestAccounts).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('selects UniSat by default inside its browser, preserving Xverse as the default when both exist', () => {
    (window as any).XverseProviders = undefined; expect(service.preferredProvider()).toBe('unisat');
    (window as any).XverseProviders = { BitcoinProvider: {} }; expect(service.preferredProvider()).toBe('xverse');
  });

  it('signs the unchanged server challenge as a BIP-322 simple proof and rereads the account', async () => {
    await service.connect('unisat');
    const message = 'Bouncer wallet verification\n\nDiscord user: user\nNonce: abc';
    expect(await service.signMessage(ordinalAddress, message)).toEqual({ signature: 'unisat-signature', address: ordinalAddress });
    expect(wallet.signMessage).toHaveBeenCalledWith(message, 'bip322-simple');
    expect(wallet.getAccounts).toHaveBeenCalledTimes(2);
    expect(wallet.requestAccounts).toHaveBeenCalledTimes(1);
  });

  it('normalizes an uppercase address but rejects unsupported addresses and multiple selected accounts', async () => {
    wallet.requestAccounts.and.resolveTo([ordinalAddress.toUpperCase()]); await service.connect('unisat');
    expect(service.address$.value).toBe(ordinalAddress);
    for (const accounts of [['bc1q-payment'], ['tb1p' + ordinalAddress.slice(4)], [], [ordinalAddress, anotherAddress]]) {
      wallet.requestAccounts.and.resolveTo(accounts);
      await expectAsync(service.connect('unisat')).toBeRejectedWithError(/Taproot Ordinals address/);
      expect(service.address$.value).toBeNull();
    }
  });

  it('rejects testnet and Fractal mainnet even when the latter reports livenet and the same bc1p address', async () => {
    for (const network of ['BITCOIN_TESTNET','BITCOIN_TESTNET4','BITCOIN_SIGNET','FRACTAL_BITCOIN_MAINNET']) {
      wallet.getChain.and.resolveTo({ enum: network, network: 'livenet' });
      await expectAsync(service.connect('unisat')).toBeRejectedWithError(/Switch UniSat to Bitcoin mainnet/);
      expect(service.address$.value).toBeNull();
    }
  });

  it('requires reconnecting when the account changes or permission is revoked', async () => {
    await service.connect('unisat'); wallet.getAccounts.and.resolveTo([anotherAddress]);
    await expectAsync(service.syncConnectedAccount()).toBeRejectedWithError(/UniSat account changed/);
    expect(service.address$.value).toBeNull();
    await service.connect('unisat'); wallet.getAccounts.and.resolveTo([]);
    await expectAsync(service.syncConnectedAccount()).toBeRejectedWithError(/Taproot Ordinals address/);
    expect(service.address$.value).toBeNull(); expect(wallet.signMessage).not.toHaveBeenCalled();
  });

  it('rejects account and network changes while signing before returning a proof', async () => {
    await service.connect('unisat');
    wallet.signMessage.and.callFake(async () => { wallet.getAccounts.and.resolveTo([anotherAddress]); return 'signature'; });
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/account changed/);
    expect(service.address$.value).toBeNull();
    wallet.getAccounts.and.resolveTo([ordinalAddress]); await service.connect('unisat');
    wallet.signMessage.and.callFake(async () => { wallet.getChain.and.resolveTo({ enum: 'FRACTAL_BITCOIN_MAINNET' }); return 'signature'; });
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/Bitcoin mainnet/);
    expect(service.address$.value).toBeNull();
  });

  it('does not sign an address that differs from the connected account', async () => {
    await service.connect('unisat');
    await expectAsync(service.signMessage(anotherAddress, 'message')).toBeRejectedWithError(/connection changed/);
    expect(wallet.signMessage).not.toHaveBeenCalled();
  });

  it('reports cancelled connection/signing requests and permits a signing retry', async () => {
    wallet.requestAccounts.and.rejectWith({ code: 4001 });
    await expectAsync(service.connect('unisat')).toBeRejectedWithError(/cancelled.*UniSat/);
    expect(service.address$.value).toBeNull();
    wallet.requestAccounts.and.resolveTo([ordinalAddress]); await service.connect('unisat');
    wallet.signMessage.and.rejectWith({ code: 4001 });
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/cancelled.*UniSat/);
    expect(service.address$.value).toBe(ordinalAddress);
    wallet.signMessage.and.resolveTo('signature');
    expect((await service.signMessage(ordinalAddress, 'message')).signature).toBe('signature');
  });

  it('rejects a missing or empty signature', async () => {
    await service.connect('unisat');
    wallet.signMessage.and.resolveTo('');
    await expectAsync(service.signMessage(ordinalAddress, 'message')).toBeRejectedWithError(/did not return/);
  });

  it('offers actionable guidance for a missing or outdated UniSat provider', async () => {
    (window as any).unisat = undefined;
    await expectAsync(service.connect('unisat')).toBeRejectedWithError(/UniSat app.*UniSat browser extension/);
    (window as any).unisat = { requestAccounts: wallet.requestAccounts, getNetwork: () => 'livenet' };
    await expectAsync(service.connect('unisat')).toBeRejectedWithError(/Update UniSat/);
    expect(wallet.requestAccounts).not.toHaveBeenCalled();
  });

  it('does not restore a stale connection after disconnecting while its approval is pending', async () => {
    let approve!: (accounts: string[]) => void;
    wallet.requestAccounts.and.callFake(() => new Promise(resolve => { approve = resolve; }));
    const pending = service.connect('unisat'); service.disconnect(); approve([ordinalAddress]);
    await expectAsync(pending).toBeRejectedWithError(/connection changed/);
    expect(service.address$.value).toBeNull();
  });

  it('builds the documented mobile openDapp link, preserving the verification token and selected wallet', () => {
    const nonce = 'a'.repeat(64);
    const target = `https://bouncer.up.railway.app/verify/${nonce}?source=discord#verify`;
    const link = new URL(service.uniSatMobileUrl(target));
    expect(link.origin).toBe('https://app.unisat.cloud'); expect(link.pathname).toBe('/request');
    expect(link.searchParams.get('method')).toBe('openDapp'); expect(link.searchParams.get('from')).toBe('Bouncer');
    const returned = new URL(JSON.parse(atob(link.searchParams.get('data')!))[0]);
    expect(returned.pathname).toBe(`/verify/${nonce}`); expect(returned.hash).toBe('#verify');
    expect(returned.searchParams.get('source')).toBe('discord'); expect(returned.searchParams.get('wallet')).toBe('unisat');
    expect(() => service.uniSatMobileUrl('http://example.test/verify')).toThrowError(/HTTPS/);
    expect(() => service.uniSatMobileUrl('javascript:alert(1)')).toThrowError(/HTTPS/);
  });
});
