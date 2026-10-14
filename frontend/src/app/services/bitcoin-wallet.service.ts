import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const XVERSE_PROVIDER = 'XverseProviders.BitcoinProvider';

export type BitcoinWalletProvider = 'xverse' | 'unisat';

interface UniSatProvider {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getChain(): Promise<{ enum: string }>;
  signMessage(message: string, type: 'bip322-simple'): Promise<string>;
}

@Injectable()
export class BitcoinWalletService {
  readonly address$ = new BehaviorSubject<string | null>(null);
  private connectedProvider: BitcoinWalletProvider | null = null;
  private session = 0;

  preferredProvider(): BitcoinWalletProvider {
    return this.isUniSatAvailable() && !(window as any).XverseProviders?.BitcoinProvider ? 'unisat' : 'xverse';
  }

  isUniSatAvailable(): boolean {
    return !!(window as any).unisat;
  }

  /** Open the same verification link in UniSat's mobile in-app browser. */
  uniSatMobileUrl(page = window.location.href): string {
    const target = new URL(page);
    if (target.protocol !== 'https:') throw new Error('UniSat mobile requires an HTTPS verification link.');
    target.searchParams.set('wallet', 'unisat');
    const link = new URL('https://app.unisat.cloud/request');
    link.searchParams.set('method', 'openDapp');
    link.searchParams.set('from', 'Bouncer');
    link.searchParams.set('data', btoa(JSON.stringify([target.href])));
    return link.href;
  }

  openUniSatMobile(): void {
    window.location.assign(this.uniSatMobileUrl());
  }

  async connect(provider: BitcoinWalletProvider = 'xverse'): Promise<void> {
    this.disconnect();
    const session = this.session;
    let address: string;
    if (provider === 'unisat') {
      const wallet = this.uniSat();
      const accounts = await this.uniSatCall('Wallet connection', () => wallet.requestAccounts());
      address = await this.uniSatAddress(wallet, accounts);
    } else {
      const response = await this.callWallet('wallet_connect', {
        addresses: ['ordinals'], network: 'Mainnet',
        message: 'Connect your Ordinals address to verify your collection for Discord roles.',
      });
      address = this.ordinalAddress(response);
    }
    if (session !== this.session) throw new Error('Your wallet connection changed. Please connect again.');
    this.connectedProvider = provider;
    this.address$.next(address);
  }

  disconnect(): void {
    this.session++;
    this.connectedProvider = null;
    this.address$.next(null);
  }

  async syncConnectedAccount(): Promise<string> {
    const connected = this.address$.value;
    const provider = this.connectedProvider;
    const session = this.session;
    if (!connected || !provider) throw new Error('Connect your Bitcoin wallet first.');
    let current: string;
    try { current = await this.readAddress(provider); }
    catch (error) { this.disconnect(); throw error; }
    if (current !== connected || provider !== this.connectedProvider || session !== this.session) {
      this.disconnect();
      throw new Error(`Your ${this.name(provider)} account changed. Reconnect before signing.`);
    }
    return current;
  }

  async signMessage(address: string, message: string): Promise<{ signature: string; address: string }> {
    const provider = this.connectedProvider;
    const session = this.session;
    if (await this.syncConnectedAccount() !== address || provider !== this.connectedProvider || session !== this.session) {
      throw new Error('Your wallet connection changed. Reconnect before signing.');
    }
    let signature: string;
    if (provider === 'unisat') {
      const wallet = this.uniSat();
      signature = await this.uniSatCall('Message signing', () => wallet.signMessage(message, 'bip322-simple'));
      if (typeof signature !== 'string' || !signature) throw new Error('UniSat did not return a message signature. Please sign again.');
    } else {
      const response = await this.callWallet('signMessage', { address, message, protocol: 'BIP322' });
      const result = this.walletResult(response, 'Message signing');
      if (!result.signature || (result.address && result.address.toLowerCase() !== address)
        || (result.protocol && result.protocol !== 'BIP322')) throw new Error('Xverse returned a signature for a different address or signing method.');
      signature = result.signature;
    }
    if (await this.syncConnectedAccount() !== address || provider !== this.connectedProvider || session !== this.session) {
      throw new Error('Your wallet connection changed. Reconnect before signing.');
    }
    return { signature, address };
  }

  private async readAddress(provider: BitcoinWalletProvider): Promise<string> {
    if (provider === 'unisat') {
      const wallet = this.uniSat();
      return this.uniSatAddress(wallet, await this.uniSatCall('Wallet account lookup', () => wallet.getAccounts()));
    }
    const response = await this.callWallet('getAddresses', {
      purposes: ['ordinals'], message: 'Connect your Ordinals address to verify your collection for Discord roles.',
    });
    return this.ordinalAddress(response);
  }

  private uniSat(): UniSatProvider {
    const wallet = (window as any).unisat;
    if (!wallet) throw new Error('Open this verification page in the UniSat app, or install the UniSat browser extension.');
    if (['requestAccounts', 'getAccounts', 'getChain', 'signMessage'].some(method => typeof wallet[method] !== 'function')) {
      throw new Error('Update UniSat to the latest version, then try again.');
    }
    return wallet;
  }

  private async uniSatAddress(wallet: UniSatProvider, accounts: string[]): Promise<string> {
    const chain = await this.uniSatCall('Network lookup', () => wallet.getChain());
    if (chain?.enum !== 'BITCOIN_MAINNET') throw new Error('Switch UniSat to Bitcoin mainnet before verifying.');
    const address = Array.isArray(accounts) && accounts.length === 1 ? accounts[0] : null;
    if (typeof address !== 'string' || !/^bc1p[ac-hj-np-z02-9]{58}$/i.test(address)) {
      throw new Error('Select your Bitcoin mainnet Taproot Ordinals address (bc1p…) in UniSat.');
    }
    return address.toLowerCase();
  }

  private async uniSatCall<T>(action: string, call: () => Promise<T>): Promise<T> {
    try { return await call(); }
    catch (error: any) {
      if (error?.code === 4001) throw new Error(`${action} was cancelled. Please try again in UniSat.`);
      if (error?.code === -32601) throw new Error('Update UniSat to the latest version, then try again.');
      const detail = typeof error?.message === 'string' ? ` ${error.message}` : ' Please try again in UniSat.';
      throw new Error(`${action} failed.${detail}`);
    }
  }

  private name(provider: BitcoinWalletProvider): string {
    return provider === 'unisat' ? 'UniSat' : 'Xverse';
  }

  private ordinalAddress(response: any): string {
    const result = this.walletResult(response, 'Wallet connection');
    // wallet_connect returns an account; getAddresses can return the address array directly.
    const addresses = Array.isArray(result) ? result : result?.addresses;
    const ordinal = Array.isArray(addresses) ? addresses.find((item: any) => item?.purpose === 'ordinals') : undefined;
    const address = ordinal?.address;
    const network = result?.network?.bitcoin?.name || ordinal?.network;
    if (typeof address !== 'string' || !/^bc1p[ac-hj-np-z02-9]{58}$/i.test(address)
      || (network && (typeof network !== 'string' || network.toLowerCase() !== 'mainnet'))) {
      throw new Error('Switch Xverse to Bitcoin mainnet and connect your Ordinals address (bc1p…).');
    }
    return address.toLowerCase();
  }

  private walletResult(response: any, action: string): any {
    if (response?.status === 'success') return response.result;
    const error = response?.error;
    if (error?.code === -32000) throw new Error(`${action} was cancelled. Please try again in Xverse.`);
    if (error?.code === -32002) throw new Error('Xverse has not granted access to this account. Click Connect and approve the connection in Xverse.');
    if (error?.code === -32601 || error?.code === -32001) throw new Error('Update Xverse to the latest version, then try again.');
    const detail = typeof error?.message === 'string' ? ` ${error.message}` : ' Please try again in Xverse.';
    throw new Error(`${action} failed.${detail}`);
  }

  private async callWallet(method: 'wallet_connect' | 'getAddresses' | 'signMessage', params: any): Promise<any> {
    const provider = (window as any).XverseProviders?.BitcoinProvider;
    if (!provider) throw new Error('Open this page in Xverse or install the Xverse browser extension, then try again.');
    const { request } = await import('@sats-connect/core');
    return request(method, params, XVERSE_PROVIDER);
  }
}
