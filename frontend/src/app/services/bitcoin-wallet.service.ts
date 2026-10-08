import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const XVERSE_PROVIDER = 'XverseProviders.BitcoinProvider';

@Injectable()
export class BitcoinWalletService {
  readonly address$ = new BehaviorSubject<string | null>(null);

  async connect(): Promise<void> {
    const address = await this.readAddress();
    this.address$.next(address);
  }

  disconnect(): void {
    this.address$.next(null);
  }

  async syncConnectedAccount(): Promise<string> {
    const connected = this.address$.value;
    if (!connected) throw new Error('Connect your Xverse wallet first.');
    const current = await this.readAddress();
    if (current !== connected) {
      this.disconnect();
      throw new Error('Your Xverse account changed. Reconnect before signing.');
    }
    return current;
  }

  async signMessage(address: string, message: string): Promise<{ signature: string; address: string }> {
    if (await this.syncConnectedAccount() !== address) throw new Error('Your Xverse account changed. Reconnect before signing.');
    const response = await this.callWallet('signMessage', { address, message, protocol: 'BIP322' });
    if (response.status !== 'success') throw new Error('Message signing was cancelled or failed. Please try again in Xverse.');
    const result = response.result;
    if (!result.signature || (result.address && result.address.toLowerCase() !== address)
      || (result.protocol && result.protocol !== 'BIP322')) throw new Error('Xverse returned a signature for a different address or signing method.');
    if (await this.syncConnectedAccount() !== address) throw new Error('Your Xverse account changed. Reconnect before signing.');
    return { signature: result.signature, address };
  }

  private async readAddress(): Promise<string> {
    const response = await this.callWallet('getAddresses', {
      purposes: ['ordinals'], message: 'Connect your Ordinals address to verify your collection for Discord roles.',
    });
    if (response.status !== 'success') throw new Error('Wallet connection was cancelled or failed. Please try again in Xverse.');
    const address = response.result.addresses?.find((item: any) => item.purpose === 'ordinals')?.address;
    const network = response.result.network?.bitcoin?.name;
    if (typeof address !== 'string' || !/^bc1p[ac-hj-np-z02-9]{58}$/i.test(address)
      || (network && network.toLowerCase() !== 'mainnet')) {
      throw new Error('Switch Xverse to Bitcoin mainnet and connect your Ordinals address (bc1p…).');
    }
    return address.toLowerCase();
  }

  private async callWallet(method: 'getAddresses' | 'signMessage', params: any): Promise<any> {
    const provider = (window as any).XverseProviders?.BitcoinProvider;
    if (!provider) throw new Error('Open this page in Xverse or install the Xverse browser extension, then try again.');
    const { request } = await import('@sats-connect/core');
    return request(method, params, XVERSE_PROVIDER);
  }
}
