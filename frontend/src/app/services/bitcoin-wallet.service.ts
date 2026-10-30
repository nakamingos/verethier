import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const XVERSE_PROVIDER = 'XverseProviders.BitcoinProvider';

export type BitcoinWalletProvider = 'xverse' | 'unisat';
export const canonicalBitcoinAddress = (address: string) => /^bc1/i.test(address) ? address.toLowerCase() : address;

interface UniSatProvider {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getChain(): Promise<{ enum: string }>;
  signMessage(message: string, type: 'bip322-simple' | 'ecdsa'): Promise<string>;
}

@Injectable()
export class BitcoinWalletService {
  readonly address$ = new BehaviorSubject<string | null>(null);
  private connectedProvider: BitcoinWalletProvider | null = null;
  private session = 0;
  private stamps = false;
  readonly addresses$ = new BehaviorSubject<Array<{value:string;label:string;purpose:string}>>([]);
  private selectedPurpose = 'ordinals';

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

  async connect(provider: BitcoinWalletProvider = 'xverse', stamps = false): Promise<void> {
    this.disconnect();
    this.stamps = stamps;
    const session = this.session;
    let address: string;
    if (provider === 'unisat') {
      const wallet = this.uniSat();
      const accounts = await this.uniSatCall('Wallet connection', () => wallet.requestAccounts());
      address = await this.uniSatAddress(wallet, accounts);
    } else {
      const response = await this.callWallet('wallet_connect', {
        addresses: this.stamps ? ['ordinals','payment'] : ['ordinals'], network: 'Mainnet',
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
    this.addresses$.next([]);
    this.selectedPurpose = 'ordinals';
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
      signature = await this.uniSatCall('Message signing', () => wallet.signMessage(message, address.startsWith('1') ? 'ecdsa' : 'bip322-simple'));
      if (typeof signature !== 'string' || !signature) throw new Error('UniSat did not return a message signature. Please sign again.');
    } else {
      const response = await this.callWallet('signMessage', { address, message, protocol: 'BIP322' });
      const result = this.walletResult(response, 'Message signing');
      if (!result.signature || (result.address && canonicalBitcoinAddress(result.address) !== address)
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
      purposes: this.stamps ? ['ordinals','payment'] : ['ordinals'], message: 'Connect your Ordinals address to verify your collection for Discord roles.',
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
      if (this.stamps && this.validStampAddress(address)) return canonicalBitcoinAddress(address);
      throw new Error(this.stamps ? 'Select your Bitcoin mainnet Stamps address in UniSat.' : 'Select your Bitcoin mainnet Taproot Ordinals address (bc1p…) in UniSat.');
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
    if (this.stamps && Array.isArray(addresses)) {
      const choices = addresses.filter((a:any) => ['ordinals','payment'].includes(a?.purpose) && this.validStampAddress(a.address)
        && (!a.network || (typeof a.network === 'string' && a.network.toLowerCase() === 'mainnet')));
      this.addresses$.next(choices.map((a:any) => ({value:canonicalBitcoinAddress(a.address),label:(a.purpose === 'payment' ? 'Payment address: ' : 'Ordinals address: ') + a.address,purpose:a.purpose})));
      if (!this.connectedProvider && !choices.some((a:any)=>a.purpose === this.selectedPurpose) && choices.length) this.selectedPurpose = choices[0].purpose;
      const chosen = choices.find((a:any) => a.purpose === this.selectedPurpose);
      const network = result?.network?.bitcoin?.name;
      if (!chosen || (network && (typeof network !== 'string' || network.toLowerCase() !== 'mainnet'))) throw new Error('Connect your selected Bitcoin mainnet address in Xverse.');
      return canonicalBitcoinAddress(chosen.address);
    }
    const ordinal = Array.isArray(addresses) ? addresses.find((item: any) => item?.purpose === 'ordinals') : undefined;
    const address = ordinal?.address;
    const network = result?.network?.bitcoin?.name || ordinal?.network;
    if (typeof address !== 'string' || !/^bc1p[ac-hj-np-z02-9]{58}$/i.test(address)
      || (network && (typeof network !== 'string' || network.toLowerCase() !== 'mainnet'))) {
      throw new Error('Switch Xverse to Bitcoin mainnet and connect your Ordinals address (bc1p…).');
    }
    return address.toLowerCase();
  }

  selectAddress(address: string): void {
    const choice = this.addresses$.value.find(a => a.value === address);
    if (!this.stamps || this.connectedProvider !== 'xverse' || !choice) return;
    this.selectedPurpose = choice.purpose;
    this.session++;
    this.address$.next(address);
  }

  private validStampAddress(address: unknown): address is string {
    return typeof address === 'string' && (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)
      || /^bc1q[ac-hj-np-z02-9]{38}$/i.test(address) || /^bc1p[ac-hj-np-z02-9]{58}$/i.test(address));
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
