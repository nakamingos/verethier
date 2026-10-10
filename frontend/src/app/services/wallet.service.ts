import { Injectable, NgZone } from '@angular/core';

import { Address, PublicClient, createPublicClient, getAddress, http } from 'viem';
import { mainnet } from 'viem/chains';

import { createWeb3Modal } from '@web3modal/wagmi';
import { coinbaseWallet, walletConnect } from '@wagmi/connectors';
import {
  Config,
  GetAccountReturnType,
  createConfig,
  disconnect,
  getAccount,
  injected,
  signTypedData,
  watchAccount,
} from '@wagmi/core';

import { Observable } from 'rxjs';

import { env } from '@/../env/env';

const projectId = 'd183619f342281fd3f3ff85716b6016a';

const metadata = {
  name: 'Bouncer',
  description: 'Verify your wallet. Get your roles.',
  url: window.location.origin,
  icons: [new URL('/assets/bouncer.svg', window.location.origin).href],
};

const themeVariables = {
  '--w3m-font-family': 'Montserrat, sans-serif',
  '--w3m-accent': 'rgba(var(--highlight), 1)',
  '--w3m-z-index': 99999,
  '--w3m-border-radius-master': '0',
};

@Injectable()
export class WalletService {
  // maxCooldown = 4;
  // web3Connecting: boolean = false;
  connectedState$!: Observable<GetAccountReturnType>;

  client!: PublicClient;
  config!: Config;
  modal!: ReturnType<typeof createWeb3Modal>;

  constructor(private ngZone: NgZone) {
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(env.rpcHttpProvider),
    });

    this.config = createConfig({
      chains: [mainnet],
      transports: {
        [1]: http(env.rpcHttpProvider),
      },
      connectors: [
        walletConnect({
          projectId,
          metadata,
          showQrModal: false,
        }),
        injected({ shimDisconnect: true }),
        coinbaseWallet({
          appName: metadata.name,
          appLogoUrl: metadata.icons[0],
        }),
      ],
    });

    this.modal = createWeb3Modal({
      wagmiConfig: this.config,
      projectId,
      enableAnalytics: false,
      themeVariables,
    });


    this.connectedState$ = new Observable((observer) =>
      watchAccount(this.config, {
        onChange: (account) => this.ngZone.run(() => observer.next(account)),
      })
    );
  }

  async connect(): Promise<void> {
    try {
      if (getAccount(this.config).isConnected) {
        await this.disconnectWeb3();
      }

      await this.modal.open();
    } catch (error) {
      // Error logging handled by the component
      this.disconnectWeb3();
    }
  }

  async disconnectWeb3(): Promise<void> {
    if (getAccount(this.config).isConnected) {
      await disconnect(this.config);
    }
  }

  async syncConnectedAccount(): Promise<`0x${string}`> {
    const account = getAccount(this.config);
    if (!account.isConnected || !account.connector) {
      throw new Error('Wallet not connected');
    }

    const provider = (await account.connector.getProvider()) as
      | { request?: (args: { method: string }) => Promise<unknown> }
      | undefined;
    let accounts: readonly Address[] = [];

    if (provider?.request) {
      try {
        const providerAccounts = await provider.request({ method: 'eth_accounts' });
        if (Array.isArray(providerAccounts)) {
          accounts = providerAccounts.map((value) => getAddress(String(value)));
        }
      } catch {
        // Fall back to the connector cache below if direct provider lookup fails.
      }
    }

    if (!accounts.length) {
      accounts = await account.connector.getAccounts();
    }

    if (!accounts.length) {
      throw new Error('Wallet not connected');
    }

    const refreshedAccounts = accounts as unknown as readonly [`0x${string}`, ...`0x${string}`[]];
    const activeAddress = refreshedAccounts[0];
    const currentUid = this.config.state.current;
    const currentConnection = currentUid ? this.config.state.connections.get(currentUid) : undefined;

    if (
      currentConnection &&
      currentConnection.connector.uid === account.connector.uid &&
      currentConnection.accounts[0] !== activeAddress
    ) {
      this.config.setState((state) => ({
        ...state,
        connections: new Map(state.connections).set(currentConnection.connector.uid, {
          ...currentConnection,
          accounts: refreshedAccounts,
        }),
      }));
    }

    return activeAddress;
  }

  async signTypedMessage(typedData: any): Promise<{
    signature: `0x${string}`;
    address: `0x${string}`;
  }> {
    const address = await this.syncConnectedAccount();

    const signature = await signTypedData(this.config, typedData);

    return {
      signature,
      address,
    };
  }
}
