import { SolanaWalletService } from './solana-wallet.service';

describe('Solana wallet connector', () => {
  let service: SolanaWalletService, provider: any, prior: any;
  const address = 'So11111111111111111111111111111111111111112';
  beforeEach(() => {
    prior = (window as any).phantom;
    provider = {
      isPhantom: true,
      publicKey: { toString: () => address },
      connect: jasmine
        .createSpy()
        .and.resolveTo({ publicKey: { toString: () => address } }),
      signMessage: jasmine
        .createSpy()
        .and.resolveTo({ signature: new Uint8Array(64).fill(7) }),
      on: jasmine.createSpy(),
      removeListener: jasmine.createSpy(),
    };
    (window as any).phantom = { solana: provider };
    service = new SolanaWalletService();
  });
  afterEach(() => {
    service.ngOnDestroy();
    (window as any).phantom = prior;
  });
  it('connects the desktop extension without using the mobile app link', async () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (X11; Linux x86_64)');
    const before = window.location.href;
    expect(service.isAvailable()).toBeTrue();
    expect(service.canOpenMobileWallet()).toBeFalse();
    service.openMobileWallet('Phantom');
    expect(window.location.href).toBe(before);
    expect(await service.connect()).toBe(address);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });
  it('withdraws the previous approval before changing wallets so Phantom asks again', async () => {
    provider.disconnect = jasmine.createSpy().and.resolveTo();
    await service.connect();
    expect(provider.disconnect).not.toHaveBeenCalled();
    provider.disconnect.and.callFake(async () => expect(provider.connect).toHaveBeenCalledTimes(1));
    await service.connect();
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(provider.connect).toHaveBeenCalledTimes(2);
  });
  it('disconnects the wallet approval as well as the session', async () => {
    provider.disconnect = jasmine.createSpy().and.rejectWith(new Error('offline'));
    await service.connect();
    await service.disconnectWallet();
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    let current: string | null = 'x';
    service.address$.subscribe(value => current = value);
    expect(current).toBeNull();
  });
  it('explains an unauthorized Phantom account and ends the stale session', async () => {
    await service.connect();
    provider.signMessage.and.rejectWith({ code: 4100, message: 'The requested method and/or account has not been authorized by the user.' });
    await expectAsync(service.signMessage(address, 'hello')).toBeRejectedWithError(/Phantom hasn’t approved Bouncer for this account. Connect your wallet again/);
    let current: string | null = 'x';
    service.address$.subscribe(value => current = value);
    expect(current).toBeNull();
  });
  it('gives extension guidance on desktop when no Solana wallet is available', async () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (X11; Linux x86_64)');
    (window as any).phantom = undefined;
    expect(service.canOpenMobileWallet()).toBeFalse();
    await expectAsync(service.connect()).toBeRejectedWithError(/browser extension/);
  });
  it('offers wallet app links only on a phone without a detected wallet', () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (Linux; Android 14)');
    expect(service.canOpenMobileWallet()).toBeFalse();
    (window as any).phantom = undefined;
    expect(service.canOpenMobileWallet()).toBeTrue();
  });
  it('recognizes iPad desktop browser mode for mobile handoff', () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X)');
    spyOnProperty(navigator, 'platform', 'get').and.returnValue('MacIntel');
    spyOnProperty(navigator, 'maxTouchPoints', 'get').and.returnValue(5);
    (window as any).phantom = undefined;
    expect(service.canOpenMobileWallet()).toBeTrue();
  });
  it('keeps the verification route and selects Solana in each wallet app', () => {
    const page = 'https://bouncer.test/verify/' + 'a'.repeat(64) + '?from=member';
    for (const [name, origin, prefix] of [['Phantom', 'https://phantom.com', '/ul/browse/'], ['Solflare', 'https://solflare.com', '/ul/v1/browse/']] as const) {
      const link = new URL(service.mobileWalletUrl(name, page));
      expect(link.origin).toBe(origin);
      expect(link.pathname.startsWith(prefix)).toBeTrue();
      const target = new URL(decodeURIComponent(link.pathname.slice(prefix.length)));
      expect(target.pathname).toBe('/verify/' + 'a'.repeat(64));
      expect(target.searchParams.get('wallet')).toBe('solana');
      expect(target.searchParams.get('from')).toBe('member');
      expect(link.searchParams.get('ref')).toBe('https://bouncer.test');
    }
    expect(service.mobileWalletUrl('MetaMask', page)).toBe(
      'https://link.metamask.io/dapp/bouncer.test/verify/' + 'a'.repeat(64) + '?from=member&wallet=solana',
    );
    expect(() => service.mobileWalletUrl('Phantom', 'http://bouncer.test/verify/example')).toThrow();
  });
  it('signs the exact UTF-8 challenge and preserves case', async () => {
    expect(await service.connect()).toBe(address);
    const proof = await service.signMessage(address, 'Bouncer · proof');
    expect(proof.address).toBe(address);
    expect(atob(proof.signature).length).toBe(64);
    expect(provider.signMessage).toHaveBeenCalledWith(
      new TextEncoder().encode('Bouncer · proof'),
      'utf8',
    );
  });
  it('detects account changes before signing', async () => {
    await service.connect();
    provider.publicKey = { toString: () => '11111111111111111111111111111111' };
    await expectAsync(service.signMessage(address, 'proof')).toBeRejected();
    expect(provider.signMessage).not.toHaveBeenCalled();
  });
  it('detects account changes during signing', async () => {
    await service.connect();
    provider.signMessage.and.callFake(async () => {
      provider.publicKey = {
        toString: () => '11111111111111111111111111111111',
      };
      return { signature: new Uint8Array(64) };
    });
    await expectAsync(service.signMessage(address, 'proof')).toBeRejected();
  });
  it('rejects a truncated wallet signature', async () => {
    await service.connect();
    provider.signMessage.and.resolveTo({ signature: new Uint8Array(63) });
    await expectAsync(service.signMessage(address, 'proof')).toBeRejected();
  });
  it('does not sign while disconnected', async () => {
    await expectAsync(service.signMessage(address, 'proof')).toBeRejected();
    expect(provider.signMessage).not.toHaveBeenCalled();
  });
  it('discovers a Wallet Standard wallet and checks returned signed bytes', async () => {
    const account = {
      address,
      chains: ['solana:mainnet'],
      features: ['solana:signMessage'],
    };
    const sign = jasmine
      .createSpy()
      .and.callFake(async (input: any) => [
        { signedMessage: input.message, signature: new Uint8Array(64).fill(2) },
      ]);
    const wallet = {
      name: 'Phantom',
      chains: ['solana:mainnet'],
      accounts: [account],
      features: {
        'standard:connect': { connect: async () => ({ accounts: [account] }) },
        'solana:signMessage': { signMessage: sign },
      },
    };
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', {
        detail: (api: any) => api.register(wallet),
      }),
    );
    expect(service.isAvailable()).toBeTrue();
    expect(service.canOpenMobileWallet()).toBeFalse();
    expect(await service.connect()).toBe(address);
    await service.signMessage(address, 'exact');
    expect(provider.connect).not.toHaveBeenCalled();
    sign.and.resolveTo([
      {
        signedMessage: new TextEncoder().encode('changed'),
        signature: new Uint8Array(64),
      },
    ]);
    await expectAsync(service.signMessage(address, 'exact')).toBeRejected();
  });
  function standardWallet(name: string, chains = ['solana:mainnet']) {
    const account = { address, chains, features: ['solana:signMessage'] };
    const listeners: Array<(event: any) => void> = [];
    const wallet: any = {
      name, chains, accounts: [account],
      features: {
        'standard:connect': { connect: jasmine.createSpy(name).and.callFake(async () => ({ accounts: wallet.accounts })) },
        'standard:disconnect': { disconnect: jasmine.createSpy(name + ' disconnect').and.resolveTo() },
        'standard:events': { on: (_: string, listener: (event: any) => void) => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); } },
        'solana:signMessage': { signMessage: jasmine.createSpy() },
      },
      emit: (event: any) => listeners.forEach((listener) => listener(event)),
    };
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api: any) => api.register(wallet) }));
    return wallet;
  }
  it('lists detected Solana wallets, ignores other chains and connects the chosen one', async () => {
    const phantom = standardWallet('Phantom'), solflare = standardWallet('Solflare');
    standardWallet('Sui Wallet', ['sui:mainnet']);
    let wallets: any[] = [];
    service.wallets$.subscribe((value) => wallets = value);
    expect(wallets.map((wallet) => wallet.value)).toEqual(['Phantom', 'Solflare']);
    expect(await service.connect('Solflare')).toBe(address);
    expect(solflare.features['standard:connect'].connect).toHaveBeenCalledTimes(1);
    expect(phantom.features['standard:connect'].connect).not.toHaveBeenCalled();
    expect(service.walletName).toBe('Solflare');
    expect(provider.connect).not.toHaveBeenCalled();
  });
  it('follows an account switch made in the wallet, and asks to connect when none is approved', async () => {
    const wallet = standardWallet('Backpack');
    await service.connect();
    let current: string | null = null;
    service.address$.subscribe((value) => current = value);
    const other = { address: '11111111111111111111111111111111', chains: ['solana:mainnet'], features: ['solana:signMessage'] };
    wallet.accounts = [other];
    wallet.emit({ accounts: [other] });
    expect(current as string | null).toBe(other.address);
    expect(await service.syncConnectedAccount()).toBe(other.address);
    wallet.emit({ features: {} });
    expect(current as string | null).toBe(other.address);
    wallet.accounts = [];
    wallet.emit({ accounts: [] });
    expect(current).toBeNull();
  });
});
