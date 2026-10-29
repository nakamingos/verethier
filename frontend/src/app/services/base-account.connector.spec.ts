import {
  connect,
  createConfig,
  disconnect,
  getAccount,
  http,
  signTypedData,
} from '@wagmi/core';
import { base, mainnet } from 'viem/chains';
import { serializeErc6492Signature } from 'viem';
import { bouncerBaseAccountConnector } from './base-account.connector';

describe('Bouncer Base Account connector', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const signature = serializeErc6492Signature({
    address: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
    data: '0x12345678',
    signature: '0x11223344',
  });
  let config: ReturnType<typeof createConfig>,
    provider: any,
    previous: PropertyDescriptor | undefined;
  let declineConnection: boolean, declineSignature: boolean;
  beforeEach(() => {
    declineConnection = false;
    declineSignature = false;
    provider = {
      isCoinbaseBrowser: true,
      on: jasmine.createSpy('on'),
      removeListener: jasmine.createSpy('removeListener'),
      disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
      request: jasmine
        .createSpy('request')
        .and.callFake(async ({ method }: { method: string }) => {
          if (method === 'wallet_connect') {
            if (declineConnection)
              throw Object.assign(new Error('User denied account'), {
                code: 4001,
              });
            return { accounts: [{ address }], chainIds: ['0x2105'] };
          }
          if (method === 'eth_accounts') return [address];
          if (method === 'eth_chainId') return '0x2105';
          if (method === 'eth_signTypedData_v4') {
            if (declineSignature)
              throw Object.assign(new Error('User rejected the request'), {
                code: 4001,
              });
            return signature;
          }
          throw new Error(method);
        }),
    };
    previous = Object.getOwnPropertyDescriptor(window, 'ethereum');
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: provider,
    });
    config = createConfig({
      chains: [mainnet, base],
      transports: { [1]: http(), [8453]: http() },
      storage: null,
      connectors: [
        bouncerBaseAccountConnector({
          name: 'Bouncer',
          icons: ['https://bouncer.test/icon.svg'],
        }),
      ],
    });
  });
  afterEach(() => {
    if (previous) Object.defineProperty(window, 'ethereum', previous);
    else delete (window as any).ethereum;
  });
  const typed = {
    domain: { name: 'Bouncer', version: '1', chainId: 8453 },
    types: { Proof: [{ name: 'Nonce', type: 'string' }] },
    primaryType: 'Proof' as const,
    message: { Nonce: 'fresh-proof' },
  };
  it('starts on Base even while the general EVM picker defaults to Ethereum', async () => {
    const connection = await connect(config, {
      connector: config.connectors[0],
      chainId: 1,
    });
    expect(connection.chainId).toBe(8453);
    expect(connection.accounts[0]).toBe(address);
    const request = provider.request.calls
      .allArgs()
      .map((args: any[]) => args[0])
      .find((value: any) => value.method === 'wallet_connect');
    expect(request.params[0].chainIds).toEqual(['0x2105', '0x1']);
    expect(
      provider.request.calls
        .allArgs()
        .some((args: any[]) => args[0].method === 'eth_signTypedData_v4'),
    ).toBeFalse();
  });
  it('allows connection cancellation, fresh retry and deliberate disconnect', async () => {
    declineConnection = true;
    await expectAsync(
      connect(config, { connector: config.connectors[0] }),
    ).toBeRejected();
    expect(getAccount(config).isConnected).toBeFalse();
    declineConnection = false;
    await connect(config, { connector: config.connectors[0] });
    await disconnect(config);
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(getAccount(config).isConnected).toBeFalse();
  });
  it('preserves wrapped signatures and permits a new signing attempt after rejection', async () => {
    await connect(config, { connector: config.connectors[0] });
    declineSignature = true;
    await expectAsync(signTypedData(config, typed)).toBeRejected();
    declineSignature = false;
    expect(await signTypedData(config, typed)).toBe(signature);
    expect(
      provider.request.calls
        .allArgs()
        .some((args: any[]) => /^eth_send|wallet_send/.test(args[0].method)),
    ).toBeFalse();
  });
});
