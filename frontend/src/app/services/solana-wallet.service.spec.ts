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
