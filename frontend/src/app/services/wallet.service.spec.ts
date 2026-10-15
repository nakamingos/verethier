import { TestBed } from '@angular/core/testing';
import { createConfig, getAccount, http } from '@wagmi/core';
import { mainnet } from 'viem/chains';
import { EVM_WALLET_CONNECTION, EvmWalletConnection, WalletService } from './wallet.service';

describe('EVM wallet connection', () => {
  let service: WalletService;
  let config: EvmWalletConnection['config'];
  let modal: jasmine.SpyObj<EvmWalletConnection['modal']>;
  let notifyState: Parameters<EvmWalletConnection['modal']['subscribeState']>[0];
  let notifyEvent: Parameters<EvmWalletConnection['modal']['subscribeEvents']>[0];
  let open: boolean;
  let stopEvents: jasmine.Spy;
  let stopState: jasmine.Spy;
  const firstAddress = '0x1111111111111111111111111111111111111111';
  const activeAddress = '0x2222222222222222222222222222222222222222';

  beforeEach(() => {
    config = createConfig({ chains: [mainnet], transports: { [1]: http() }, storage: null });
    open = false;
    stopEvents = jasmine.createSpy('stopEvents');
    stopState = jasmine.createSpy('stopState');
    modal = jasmine.createSpyObj('AppKit', ['ready', 'open', 'disconnect', 'getState', 'subscribeState', 'subscribeEvents']);
    modal.ready.and.resolveTo();
    modal.open.and.callFake(async () => { open = true; });
    modal.disconnect.and.resolveTo();
    modal.getState.and.callFake(() => ({ open }) as ReturnType<typeof modal.getState>);
    modal.subscribeState.and.callFake(callback => { notifyState = callback; return stopState; });
    modal.subscribeEvents.and.callFake(callback => { notifyEvent = callback; return stopEvents; });
    TestBed.configureTestingModule({ providers: [{ provide: EVM_WALLET_CONNECTION, useValue: { config, modal } }] });
    service = TestBed.inject(WalletService);
  });

  async function openPicker() {
    const pending = service.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(modal.open).toHaveBeenCalledWith({ view: 'Connect', namespace: 'eip155' });
    return { pending };
  }

  function closePicker() {
    open = false;
    notifyState({ open } as Parameters<typeof notifyState>[0]);
  }

  function event(event: string, message = '') {
    notifyEvent({ data: { event, properties: { message } } } as Parameters<typeof notifyEvent>[0]);
  }

  function connectedWallet(request: jasmine.Spy) {
    const connector = {
      uid: 'test-wallet', id: 'test-wallet', name: 'Test Wallet', type: 'injected',
      getAccounts: async () => [firstAddress],
      getChainId: async () => 1,
      getProvider: async () => ({ request }),
    } as unknown as EvmWalletConnection['config']['connectors'][number];
    config.setState(state => ({ ...state, current: connector.uid, status: 'connected',
      connections: new Map([[connector.uid, { connector, accounts: [firstAddress], chainId: 1 }]]) }));
  }

  it('shares the application connection service across consumers', () => {
    expect(TestBed.inject(WalletService)).toBe(service);
    expect(modal.subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it('keeps Connect pending until the picker closes and prevents duplicate connection attempts', async () => {
    const { pending } = await openPicker();
    let finished = false;
    void pending.then(() => { finished = true; });
    const duplicate = service.connect();
    expect(duplicate).toBe(pending);
    expect(finished).toBeFalse();
    expect(modal.open).toHaveBeenCalledTimes(1);
    closePicker();
    await pending;
    expect(finished).toBeTrue();
    expect(stopState).toHaveBeenCalledTimes(1);
    const retry = await openPicker();
    expect(modal.open).toHaveBeenCalledTimes(2);
    closePicker();
    await retry.pending;
  });

  it('reports initialization failures and permits a fresh attempt', async () => {
    modal.ready.and.rejectWith(new Error('WebSocket connection timed out'));
    await expectAsync(service.connect()).toBeRejectedWithError(/Could not reach the wallet connection service/);
    expect(modal.open).not.toHaveBeenCalled();
    modal.ready.and.resolveTo();
    const { pending } = await openPicker();
    closePicker();
    await pending;
  });

  it('explains pending requests, clears old errors on retry, and redacts connection links', () => {
    const errors: Array<string | null> = [];
    service.connectionErrors$.subscribe(error => errors.push(error));
    event('CONNECT_ERROR', 'Request already pending');
    expect(errors.at(-1)).toContain('Open your wallet to finish or cancel it');
    event('SELECT_WALLET');
    expect(errors.at(-1)).toBeNull();
    event('CONNECT_ERROR', 'Invalid session wc:secret-pairing https://example.test/?key=secret');
    expect(errors.at(-1)).toContain('Invalid session');
    expect(errors.at(-1)).not.toContain('secret');
    event('CONNECT_PROXY_ERROR', 'Could not open wallet wc:secret-pairing');
    expect(errors.at(-1)).toContain('Could not open wallet');
    expect(errors.at(-1)).not.toContain('secret');
    event('USER_REJECTED', 'User rejected the request');
    expect(errors.at(-1)).toContain('was declined');
    event('CONNECT_SUCCESS');
    expect(errors.at(-1)).toBeNull();
  });

  it('resets an existing connection through AppKit before opening a new wallet choice', async () => {
    connectedWallet(jasmine.createSpy().and.resolveTo([firstAddress]));
    const { pending } = await openPicker();
    expect(modal.disconnect).toHaveBeenCalledOnceWith('eip155');
    closePicker();
    await pending;
  });

  it('signs with the wallet’s active account if it changed after connection', async () => {
    const signature = `0x${'11'.repeat(65)}` as const;
    const request = jasmine.createSpy('request').and.callFake(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [activeAddress];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_signTypedData_v4') return signature;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    connectedWallet(request);
    const typedData = { domain: { name: 'Bouncer', version: '1', chainId: 1 },
      types: { Verification: [{ name: 'Nonce', type: 'string' }] },
      primaryType: 'Verification', message: { Nonce: 'test-nonce' } };
    expect(await service.signTypedMessage(typedData)).toEqual({ address: activeAddress, signature });
    expect(getAccount(config).address).toBe(activeAddress);
    const signingRequest = request.calls.allArgs().map(args => args[0]).find(args => args.method === 'eth_signTypedData_v4');
    expect(signingRequest.params[0]).toBe(activeAddress);
    expect(JSON.parse(signingRequest.params[1])).toEqual(jasmine.objectContaining({
      domain: jasmine.objectContaining({ name: 'Bouncer', version: '1' }), message: { Nonce: 'test-nonce' },
    }));
  });

  it('releases its AppKit event subscription on application teardown', () => {
    service.ngOnDestroy();
    expect(stopEvents).toHaveBeenCalledTimes(1);
  });
});
