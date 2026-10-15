import { Inject, Injectable, InjectionToken, NgZone, OnDestroy } from '@angular/core';

import { Address, PublicClient, createPublicClient, getAddress, http } from 'viem';
import { mainnet } from 'viem/chains';

import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import {
  Config,
  GetAccountReturnType,
  getAccount,
  signTypedData,
  watchAccount,
} from '@wagmi/core';

import { Observable, Subject } from 'rxjs';

import { env } from '@/../env/env';

const projectId = 'd183619f342281fd3f3ff85716b6016a';

const metadata = {
  name: 'Bouncer',
  description: 'Verify your wallet. Get your roles.',
  url: window.location.origin,
  icons: [new URL('/assets/bouncer.svg', window.location.origin).href],
};

const themeVariables = {
  '--apkt-font-family': 'Montserrat, sans-serif',
  '--apkt-accent': '#00FF73',
  '--apkt-z-index': 99999,
  '--apkt-border-radius-master': '0px',
};

export interface EvmWalletConnection {
  config: Config;
  modal: ReturnType<typeof createAppKit>;
}

// AppKit and its Wagmi config must share the same lifetime and connector instances.
export const EVM_WALLET_CONNECTION = new InjectionToken<EvmWalletConnection>('EVM wallet connection', {
  providedIn: 'root',
  factory: () => {
    const adapter = new WagmiAdapter({
      networks: [mainnet],
      projectId,
      transports: {
        [1]: http(env.rpcHttpProvider),
      },
    });
    const modal = createAppKit({
      adapters: [adapter],
      networks: [mainnet],
      projectId,
      metadata,
      enableReconnect: false,
      enableCoinbase: true,
      enableBaseAccount: false,
      enableInjected: true,
      enableEIP6963: true,
      features: {
        analytics: false,
        connectMethodsOrder: ['wallet'],
        email: false,
        socials: [],
        swaps: false,
        onramp: false,
        send: false,
        receive: false,
        history: false,
      },
      themeVariables,
    });
    return { config: adapter.wagmiConfig, modal };
  },
});

function connectionErrorMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/already (?:pending|active)|request.*pending|pending.*request|already processing/i.test(reason)) {
    return 'A wallet connection request is already pending. Open your wallet to finish or cancel it, then try again.';
  }
  if (/user rejected|user denied|user disapproved/i.test(reason)) {
    return 'The wallet connection request was declined. Try again when you are ready.';
  }
  if (/network|websocket|relay|timed? ?out|timeout|fetch/i.test(reason)) {
    return 'Could not reach the wallet connection service. Check your connection and try again.';
  }
  // Keep the useful reason, without displaying connection URIs or credential-bearing URLs.
  const detail = reason.replace(/(?:https?:\/\/|wc:)[^\s]+/gi, '[connection link]')
    .split('\n')[0].slice(0, 200);
  return detail && detail !== 'Unknown'
    ? `Could not connect to your wallet: ${detail}`
    : 'Could not connect to your wallet. Try again, or open your wallet and check for a pending connection request.';
}

@Injectable({ providedIn: 'root' })
export class WalletService implements OnDestroy {
  readonly connectedState$: Observable<GetAccountReturnType>;
  private readonly connectionErrors = new Subject<string | null>();
  readonly connectionErrors$ = this.connectionErrors.asObservable();
  readonly client: PublicClient;
  readonly config: Config;
  readonly modal: ReturnType<typeof createAppKit>;
  private readonly unsubscribeEvents: () => void;
  private connecting?: Promise<void>;

  constructor(private ngZone: NgZone, @Inject(EVM_WALLET_CONNECTION) connection: EvmWalletConnection) {
    this.config = connection.config;
    this.modal = connection.modal;
    this.client = createPublicClient({ chain: mainnet, transport: http(env.rpcHttpProvider) });

    this.connectedState$ = new Observable((observer) => {
      observer.next(getAccount(this.config));
      return watchAccount(this.config, {
        onChange: (account) => this.ngZone.run(() => observer.next(account)),
      });
    });
    this.unsubscribeEvents = this.modal.subscribeEvents(({ data }) => {
      this.ngZone.run(() => {
        if (data.event === 'CONNECT_ERROR' || data.event === 'USER_REJECTED' || data.event === 'CONNECT_PROXY_ERROR') {
          this.connectionErrors.next(connectionErrorMessage(data.properties.message));
        } else if (data.event === 'SELECT_WALLET' || data.event === 'CONNECT_SUCCESS') {
          this.connectionErrors.next(null);
        }
      });
    });
  }

  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.openConnection().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    this.connectionErrors.next(null);
    try {
      await this.modal.ready();
      if (getAccount(this.config).isConnected) await this.disconnectWeb3();
      await this.modal.open({ view: 'Connect', namespace: 'eip155' });
      // Opening the picker is not a finished connection. Wait for approval or dismissal.
      await new Promise<void>((resolve) => {
        const unsubscribe = this.modal.subscribeState(({ open }) => {
          if (!open) { unsubscribe(); resolve(); }
        });
        if (!this.modal.getState().open) { unsubscribe(); resolve(); }
      });
    } catch (error) {
      throw new Error(connectionErrorMessage(error));
    }
  }

  async disconnectWeb3(): Promise<void> {
    await this.modal.ready();
    if (getAccount(this.config).isConnected) await this.modal.disconnect('eip155');
  }

  ngOnDestroy(): void {
    this.unsubscribeEvents();
    this.connectionErrors.complete();
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
