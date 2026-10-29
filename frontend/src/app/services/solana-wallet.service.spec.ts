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
    expect(service.canOpenPhantomMobile()).toBeFalse();
    service.openPhantomMobile();
    expect(window.location.href).toBe(before);
    expect(await service.connect()).toBe(address);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });
  it('gives extension guidance on desktop when Phantom is unavailable', async () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (X11; Linux x86_64)');
    (window as any).phantom = undefined;
    expect(service.canOpenPhantomMobile()).toBeFalse();
    await expectAsync(service.connect()).toBeRejectedWithError(/browser extension/);
  });
  it('offers mobile handoff only outside a browser with a Phantom provider', () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (Linux; Android 14)');
    expect(service.canOpenPhantomMobile()).toBeFalse();
    (window as any).phantom = undefined;
    expect(service.canOpenPhantomMobile()).toBeTrue();
  });
  it('recognizes iPad desktop browser mode for mobile handoff', () => {
    spyOnProperty(navigator, 'userAgent', 'get').and.returnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X)');
    spyOnProperty(navigator, 'platform', 'get').and.returnValue('MacIntel');
    spyOnProperty(navigator, 'maxTouchPoints', 'get').and.returnValue(5);
    (window as any).phantom = undefined;
    expect(service.canOpenPhantomMobile()).toBeTrue();
  });
  it('keeps the verification route and selects Solana in the mobile app', () => {
    const page = 'https://bouncer.test/verify/' + 'a'.repeat(64) + '?from=member';
    const link = new URL(service.phantomMobileUrl(page));
    expect(link.origin).toBe('https://phantom.com');
    const target = new URL(decodeURIComponent(link.pathname.slice('/ul/browse/'.length)));
    expect(target.pathname).toBe('/verify/' + 'a'.repeat(64));
    expect(target.searchParams.get('wallet')).toBe('phantom');
    expect(target.searchParams.get('from')).toBe('member');
    expect(link.searchParams.get('ref')).toBe(window.location.origin);
    expect(() => service.phantomMobileUrl('http://bouncer.test/verify/example')).toThrow();
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
  it('discovers Wallet Standard Phantom and checks returned signed bytes', async () => {
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
    expect(service.canOpenPhantomMobile()).toBeFalse();
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
});
