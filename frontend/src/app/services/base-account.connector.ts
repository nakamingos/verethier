import { baseAccount } from '@wagmi/connectors';
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
    return {
      ...connector,
      connect: function (this: typeof connector, parameters = {}) {
        return connector.connect.call(this, {
          ...parameters,
          chainId: base.id,
        });
      } as typeof connector.connect,
    };
  }) as typeof factory;
}
