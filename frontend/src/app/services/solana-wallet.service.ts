import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface SolanaWalletChoice {
  value: string;
  label: string;
}

/** Wallet apps with an in-app browser link, for phones where no wallet is detected. */
const browseLink = (base: string) => (target: URL) =>
  `${base}${encodeURIComponent(target.href)}?ref=${encodeURIComponent(target.origin)}`;
const MOBILE_WALLETS = [
  { name: 'Phantom', link: browseLink('https://phantom.com/ul/browse/') },
  { name: 'Solflare', link: browseLink('https://solflare.com/ul/v1/browse/') },
  // MetaMask takes the page without its scheme.
  { name: 'MetaMask', link: (target: URL) => `https://link.metamask.io/dapp/${target.host}${target.pathname}${target.search}` },
] as const;
export type SolanaMobileWallet = (typeof MOBILE_WALLETS)[number]['name'];

const usableAccount = (account: any) =>
  account?.chains?.includes('solana:mainnet') &&
  account?.features?.includes('solana:signMessage');

/**
 * Connects any Solana wallet that announces itself through the Wallet Standard
 * (Phantom, Solflare, Backpack, Coinbase Wallet, MetaMask and others). Older
 * Phantom builds without the Wallet Standard use its injected provider.
 */
@Injectable({ providedIn: 'root' })
export class SolanaWalletService implements OnDestroy {
  private readonly addressState = new BehaviorSubject<string | null>(null);
  readonly address$ = this.addressState.asObservable();
  private readonly walletsState = new BehaviorSubject<SolanaWalletChoice[]>([]);
  /** Solana wallets detected in this browser. */
  readonly wallets$ = this.walletsState.asObservable();
  readonly mobileWallets = MOBILE_WALLETS.map(({ name }) => name);
  private wallet: any;
  private account: any;
  private provider: any;
  private generation = 0;
  private readonly registered = new Set<any>();
  private cleanup?: () => void;
  private readonly registry = {
    register: (...wallets: any[]) => {
      wallets.forEach((wallet) => this.registered.add(wallet));
      this.publish();
      return () => {
        wallets.forEach((wallet) => this.registered.delete(wallet));
        this.publish();
      };
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
    this.publish();
  }
  private standardWallets() {
    const seen = new Set<string>();
    return [...this.registered].filter((wallet) => {
      const usable =
        wallet.chains?.includes('solana:mainnet') &&
        wallet.features?.['standard:connect'] &&
        wallet.features?.['solana:signMessage'];
      if (!usable || seen.has(wallet.name)) return false;
      seen.add(wallet.name);
      return true;
    });
  }
  private injectedProvider() {
    const provider = (window as any).phantom?.solana;
    return provider?.isPhantom ? provider : undefined;
  }
  private publish() {
    const wallets = this.standardWallets().map((wallet) => ({ value: wallet.name, label: wallet.name }));
    if (!wallets.length && this.injectedProvider()) wallets.push({ value: 'Phantom', label: 'Phantom' });
    const current = this.walletsState.value;
    if (current.length !== wallets.length || current.some((wallet, i) => wallet.value !== wallets[i].value))
      this.walletsState.next(wallets);
  }
  /** The connected wallet's name, for messages. */
  get walletName(): string {
    return this.wallet?.name || (this.provider ? 'Phantom' : 'Your wallet');
  }
  isAvailable(): boolean {
    this.publish();
    return this.walletsState.value.length > 0;
  }
  private isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  /** On a phone without a detected wallet, the page can open in a wallet app's browser. */
  canOpenMobileWallet(): boolean {
    return this.isMobile() && !this.isAvailable();
  }
  /** Connects the named wallet, or the first detected one. */
  async connect(name?: string): Promise<string> {
    // Changing wallets: a wallet silently returns an account it already approved,
    // so withdraw that approval first.
    const previous = { wallet: this.wallet, provider: this.provider };
    this.disconnect();
    if (previous.wallet || previous.provider) await this.revoke(previous);
    const generation = this.generation;
    const wallets = this.standardWallets();
    const wallet = name ? wallets.find((candidate) => candidate.name === name) : wallets[0];
    if (wallet) {
      const result = await wallet.features['standard:connect'].connect();
      if (generation !== this.generation)
        throw new Error('Wallet connection changed. Try again.');
      const account = (result?.accounts ?? wallet.accounts)?.find(usableAccount);
      if (!account)
        throw new Error(
          `Select a ${wallet.name} account that supports Solana mainnet message signing.`,
        );
      this.wallet = wallet;
      this.account = account;
      // Follow account switches made in the wallet. A wallet reports only the
      // accounts approved for this site; with none, connect again.
      this.cleanup = wallet.features['standard:events']?.on('change', ({ accounts }: { accounts?: any[] }) => {
        if (!accounts) return;
        const next = accounts.find(usableAccount);
        if (next && next.address === this.account?.address) return;
        this.generation++;
        this.account = next;
        this.addressState.next(next?.address ?? null);
      });
      this.addressState.next(account.address);
      return account.address;
    }
    const provider = (!name || name === 'Phantom') && !wallets.length ? this.injectedProvider() : undefined;
    if (!provider)
      throw new Error(
        this.isMobile()
          ? 'Open this page in your Solana wallet app to connect.'
          : 'Install or enable a Solana wallet browser extension, such as Phantom or Solflare, then refresh this page.',
      );
    const result = await provider.connect();
    if (generation !== this.generation)
      throw new Error('Wallet connection changed. Try again.');
    this.provider = provider;
    const changed = (publicKey?: { toString(): string } | null) => {
      this.generation++;
      this.addressState.next(publicKey?.toString() || null);
    };
    const disconnected = () => changed(null);
    provider.on?.('accountChanged', changed);
    provider.on?.('disconnect', disconnected);
    this.cleanup = () => {
      provider.removeListener?.('accountChanged', changed);
      provider.removeListener?.('disconnect', disconnected);
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
      ].signMessage({ account: this.account, message: bytes }).catch((error: unknown) => { throw this.signError(error); });
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
      signature = (await this.provider.signMessage(bytes, 'utf8').catch((error: unknown) => { throw this.signError(error); })).signature;
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
  mobileWalletUrl(name: SolanaMobileWallet, page = window.location.href): string {
    const target = new URL(page);
    if (target.protocol !== 'https:')
      throw new Error('Opening a wallet app requires an HTTPS page.');
    target.searchParams.set('wallet', 'solana');
    return MOBILE_WALLETS.find((wallet) => wallet.name === name)!.link(target);
  }
  openMobileWallet(name: SolanaMobileWallet) {
    if (this.canOpenMobileWallet()) window.location.assign(this.mobileWalletUrl(name));
  }
  /**
   * Wallets report 4100 when they no longer approve this site for the account,
   * for example after switching to an account that never connected here.
   */
  private signError(error: unknown): unknown {
    const { code, message } = (error ?? {}) as { code?: number; message?: string };
    if (code !== 4100 && !/not been authorized/i.test(String(message ?? ''))) return error;
    const name = this.walletName;
    this.disconnect();
    return new Error(`${name} hasn’t approved Bouncer for this account. Connect your wallet again, approve the connection, then sign.`);
  }
  /** Withdraws the wallet's approval of this site; failures leave only Bouncer's session ended. */
  private async revoke({ wallet, provider }: { wallet?: any; provider?: any }) {
    try {
      if (wallet) await wallet.features?.['standard:disconnect']?.disconnect();
      else await provider?.disconnect?.();
    } catch { /* The next connection may reuse the existing approval. */ }
  }
  /** Ends Bouncer’s session and asks the wallet to disconnect this site. */
  async disconnectWallet() {
    const previous = { wallet: this.wallet, provider: this.provider };
    this.disconnect();
    await this.revoke(previous);
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
