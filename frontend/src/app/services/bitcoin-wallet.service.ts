import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const XVERSE_PROVIDER = 'XverseProviders.BitcoinProvider';

@Injectable()
export class BitcoinWalletService {
  readonly address$ = new BehaviorSubject<string | null>(null);

  async connect(): Promise<void> {
    const response = await this.callWallet('wallet_connect', {
      addresses: ['ordinals'], network: 'Mainnet',
      message: 'Connect your Ordinals address to verify your collection for Discord roles.',
    });
    this.address$.next(this.ordinalAddress(response));
  }

  disconnect(): void {
    this.address$.next(null);
  }

  async syncConnectedAccount(): Promise<string> {
    const connected = this.address$.value;
    if (!connected) throw new Error('Connect your Xverse wallet first.');
    let current: string;
    try { current = await this.readAddress(); }
    catch (error) { this.disconnect(); throw error; }
    if (current !== connected) {
      this.disconnect();
      throw new Error('Your Xverse account changed. Reconnect before signing.');
    }
    return current;
  }

  async signMessage(address: string, message: string): Promise<{ signature: string; address: string }> {
    if (await this.syncConnectedAccount() !== address) throw new Error('Your Xverse account changed. Reconnect before signing.');
    const response = await this.callWallet('signMessage', { address, message, protocol: 'BIP322' });
    const result = this.walletResult(response, 'Message signing');
    if (!result.signature || (result.address && result.address.toLowerCase() !== address)
      || (result.protocol && result.protocol !== 'BIP322')) throw new Error('Xverse returned a signature for a different address or signing method.');
    if (await this.syncConnectedAccount() !== address) throw new Error('Your Xverse account changed. Reconnect before signing.');
    return { signature: result.signature, address };
  }

  private async readAddress(): Promise<string> {
    const response = await this.callWallet('getAddresses', {
      purposes: ['ordinals'], message: 'Connect your Ordinals address to verify your collection for Discord roles.',
    });
    return this.ordinalAddress(response);
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
