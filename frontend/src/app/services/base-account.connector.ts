import { baseAccount } from '@wagmi/connectors';
import { getAddress } from 'viem';
import { base } from 'viem/chains';

/** Base Account starts on Base; ordinary wallet connectors keep their own network. */
export function bouncerBaseAccountConnector(metadata: {
  name: string;
  icons: string[];
}) {
  const factory = baseAccount({
    appName: metadata.name,
    appLogoUrl: metadata.icons[0],
    preference: { telemetry: false },
  });
  return ((config) => {
    const connector = factory(config);
    type Self = typeof connector;
    type Provider = Awaited<ReturnType<Self['getProvider']>>;
    // Listeners bound by a restored session. The installed connector binds its
    // own in connect(), so these are removed before it runs again.
    let restored: { provider: Provider; events: [string, (...args: any[]) => void][] } | undefined;
    const unbind = () => {
      restored?.events.forEach(([event, listener]) => restored!.provider.removeListener(event as any, listener));
      restored = undefined;
    };
    return {
      ...connector,
      connect: async function (this: Self, parameters = {}) {
        if ('isReconnecting' in parameters && parameters.isReconnecting) {
          // @wagmi/connectors 6.2.0 sends wallet_connect even when restoring a
          // saved session, and the SDK always shows its popup for that. Read the
          // saved session instead, as @wagmi/connectors 8 does. Remove this
          // override with the Wagmi 3 upgrade.
          const provider = await this.getProvider();
          const accounts = ((await provider.request({ method: 'eth_accounts' })) as string[]).map(a => getAddress(a));
          if (!accounts.length) throw new Error('No saved Base Account session.');
          const chainId = await this.getChainId();
          if (!restored) {
            const events: [string, (...args: any[]) => void][] = [
              ['accountsChanged', this.onAccountsChanged.bind(this)],
              ['chainChanged', this.onChainChanged.bind(this)],
              ['disconnect', this.onDisconnect.bind(this)],
            ];
            events.forEach(([event, listener]) => provider.on(event as any, listener));
            restored = { provider, events };
          }
          return {
            accounts: (parameters.withCapabilities
              ? accounts.map(address => ({ address, capabilities: {} }))
              : accounts) as any,
            chainId,
          };
        }
        unbind();
        return connector.connect.call(this, {
          ...parameters,
          chainId: base.id,
        });
      } as Self['connect'],
      disconnect: async function (this: Self) {
        unbind();
        return connector.disconnect.call(this);
      },
    };
  }) as typeof factory;
}
