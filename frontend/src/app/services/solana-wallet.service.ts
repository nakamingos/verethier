import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SolanaWalletService implements OnDestroy {
  private readonly addressState = new BehaviorSubject<string | null>(null);
  readonly address$ = this.addressState.asObservable();
  private wallet: any;
  private account: any;
  private provider: any;
  private generation = 0;
  private readonly wallets = new Set<any>();
  private cleanup?: () => void;
  private readonly registry = {
    register: (...wallets: any[]) => {
      wallets.forEach((wallet) => this.wallets.add(wallet));
      return () => wallets.forEach((wallet) => this.wallets.delete(wallet));
    },
  };
  private readonly register = (event: Event) => {
    const callback = (event as CustomEvent).detail;
    if (typeof callback === 'function') callback(this.registry);
  };
  constructor() {
    window.addEventListener('wallet-standard:register-wallet', this.register);
    window.dispatchEvent(
      new CustomEvent('wallet-standard:app-ready', { detail: this.registry }),
    );
  }
  private phantomWallet() {
    return [...this.wallets].find(
      (wallet) =>
        wallet.name === 'Phantom' &&
        wallet.features?.['standard:connect'] &&
        wallet.features?.['solana:signMessage'],
    );
  }
  private injectedProvider() {
    const provider = (window as any).phantom?.solana;
    return provider?.isPhantom ? provider : undefined;
  }
  isAvailable(): boolean {
    return !!(this.phantomWallet() || this.injectedProvider());
  }
  canOpenPhantomMobile(): boolean {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return mobile && !this.isAvailable();
  }
  async connect(): Promise<string> {
    this.disconnect();
    const generation = this.generation;
    const wallet = this.phantomWallet();
    if (wallet) {
      const result = await wallet.features['standard:connect'].connect();
      if (generation !== this.generation)
        throw new Error('Wallet connection changed. Try again.');
      const account = result.accounts?.find(
        (a: any) =>
          a.chains?.includes('solana:mainnet') &&
          a.features?.includes('solana:signMessage'),
      );
      if (!account)
        throw new Error(
          'Select a Phantom account supporting Solana mainnet message signing.',
        );
      this.wallet = wallet;
      this.account = account;
      this.cleanup = wallet.features['standard:events']?.on('change', () => {
        this.generation++;
        this.addressState.next(null);
        this.account = undefined;
      });
      this.addressState.next(account.address);
      return account.address;
    }
    const provider = this.injectedProvider();
    if (!provider)
      throw new Error(
        this.canOpenPhantomMobile()
          ? 'Open this page in the Phantom app to connect your wallet.'
          : 'Install or enable the Phantom browser extension, then refresh this page.',
      );
    const result = await provider.connect();
    if (generation !== this.generation)
      throw new Error('Wallet connection changed. Try again.');
    this.provider = provider;
    const changed = () => {
      this.generation++;
      this.addressState.next(null);
    };
    provider.on?.('accountChanged', changed);
    provider.on?.('disconnect', changed);
    this.cleanup = () => {
      provider.removeListener?.('accountChanged', changed);
      provider.removeListener?.('disconnect', changed);
    };
    const address = result.publicKey?.toString();
    if (!address) throw new Error('Phantom did not return a Solana address.');
    this.addressState.next(address);
    return address;
  }
  async syncConnectedAccount(): Promise<string> {
    const current = this.wallet
      ? this.wallet.accounts?.find(
          (a: any) => a.address === this.account?.address,
        )?.address
      : this.provider?.publicKey?.toString();
    if (!current || current !== this.addressState.value) {
      this.disconnect();
      throw new Error('Your Solana account changed. Reconnect and sign again.');
    }
    return current;
  }
  async signMessage(
    address: string,
    message: string,
  ): Promise<{ address: string; signature: string }> {
    if ((await this.syncConnectedAccount()) !== address)
      throw new Error('Your Solana account changed.');
    const generation = this.generation,
      bytes = new TextEncoder().encode(message);
    let signature: Uint8Array;
    if (this.wallet) {
      const [result] = await this.wallet.features[
        'solana:signMessage'
      ].signMessage({ account: this.account, message: bytes });
      if (
        !(result?.signedMessage instanceof Uint8Array) ||
        result.signedMessage.length !== bytes.length ||
        result.signedMessage.some((b: number, i: number) => b !== bytes[i])
      )
        throw new Error(
          'The wallet returned a different message. Nothing was submitted.',
        );
      signature = result.signature;
    } else
      signature = (await this.provider.signMessage(bytes, 'utf8')).signature;
    if (
      generation !== this.generation ||
      (await this.syncConnectedAccount()) !== address
    )
      throw new Error('Your Solana account changed. Sign again.');
    if (!(signature instanceof Uint8Array) || signature.length !== 64)
      throw new Error('The wallet returned an invalid Solana signature.');
    return {
      address,
      signature: btoa(
        Array.from(signature, (b) => String.fromCharCode(b)).join(''),
      ),
    };
  }
  phantomMobileUrl(page = window.location.href): string {
    const target = new URL(page);
    if (target.protocol !== 'https:')
      throw new Error('Phantom mobile requires an HTTPS page.');
    target.searchParams.set('wallet', 'phantom');
    return `https://phantom.com/ul/browse/${encodeURIComponent(target.href)}?ref=${encodeURIComponent(window.location.origin)}`;
  }
  openPhantomMobile() {
    if (this.canOpenPhantomMobile()) window.location.assign(this.phantomMobileUrl());
  }
  disconnect() {
    this.generation++;
    this.cleanup?.();
    this.cleanup = undefined;
    this.wallet = undefined;
    this.account = undefined;
    this.provider = undefined;
    this.addressState.next(null);
  }
  ngOnDestroy() {
    this.disconnect();
    window.removeEventListener(
      'wallet-standard:register-wallet',
      this.register,
    );
  }
}
