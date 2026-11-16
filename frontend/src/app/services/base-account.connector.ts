import { baseAccount } from '@wagmi/connectors';
import { base } from 'viem/chains';

/**
 * Base Account starts on Base; ordinary wallet connectors keep their own network.
 * Restoring a saved session reads it without the Coinbase popup (connectors 8).
 */
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
    return {
      ...connector,
      connect: function (this: typeof connector, parameters = {}) {
        // A restored session keeps its network; only a new connection starts on Base.
        if ('isReconnecting' in parameters && parameters.isReconnecting)
          return connector.connect.call(this, parameters);
        return connector.connect.call(this, {
          ...parameters,
          chainId: base.id,
        });
      } as typeof connector.connect,
    };
  }) as typeof factory;
}
