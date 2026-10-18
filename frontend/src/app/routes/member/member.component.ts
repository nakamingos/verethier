import { Component, DestroyRef, Injector, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PortalSessionService } from '@/services/portal-session.service';
import { WalletService } from '@/services/wallet.service';
import { BitcoinWalletService } from '@/services/bitcoin-wallet.service';
import { PixelSelectComponent } from '@/components/pixel-select/pixel-select.component';

interface Requirement {
  tokenStandard?: string | null;
  tokenSymbol?: string | null;
  id: string;
  role: string;
  asset: string;
  network: number | null;
  collection: string;
  minimum: string | number;
  trait: string | null;
  tokenIds: string[] | null;
  criteria: unknown;
}
interface Community {
  id: string;
  name: string;
  icon: string | null;
  defaultChannel: string;
  channels: Array<{ id: string; name: string; rules: Requirement[] }>;
  roles: Array<{ id: string; name: string; status: string }>;
}
interface Pending {
  id: string;
  purpose: string;
  address: string | null;
  server: string | null;
  channel: string | null;
  expiresAt: string;
}
interface LinkFlow {
  id: string;
  address: string;
  walletType: 'evm' | 'bitcoin';
  challenge: any;
  expiresAt: string;
}
interface Account {
  communitiesUnavailable?: boolean;
  wallets: Array<{
    address: string;
    wallet_type: 'evm' | 'bitcoin';
    last_verified_at: string;
  }>;
  communities: Community[];
  counts: { wallets: number; communities: number; roles: number };
  pending: Pending | null;
  actions: Array<{
    id: string;
    kind: string;
    address: string;
    created_at: string;
    jobs: Array<{ id: string; status: string; community: string; result: any }>;
  }>;
}

@Component({
  selector: 'app-member',
  imports: [FormsModule, RouterLink, DatePipe, PixelSelectComponent],
  providers: [BitcoinWalletService],
  templateUrl: './member.component.html',
  styleUrl: './member.component.scss',
})
export class MemberComponent {
  readonly session = inject(PortalSessionService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly bitcoin = inject(BitcoinWalletService);
  private evm?: WalletService;
  private evmAddress = '';
  private live = true;
  data: Account | null = null;
  tab = 'overview';
  busy = false;
  loading = true;
  error = '';
  notice = '';
  search = '';
  channels: Record<string, string> = {};
  hiddenPending = '';
  addOpen = false;
  walletKind = 'evm';
  address = '';
  connecting = false;
  linkFlow: LinkFlow | null = null;
  private transferProof: { flow: string; signature: string } | null = null;
  transferPending = false;
  removal: {
    address: string;
    communities: Array<{ id: string; name: string }>;
    requestId: string;
  } | null = null;
  readonly walletOptions = [
    { value: 'evm', label: 'EVM' },
    { value: 'xverse', label: 'Bitcoin · Xverse' },
    { value: 'unisat', label: 'Bitcoin · UniSat' },
  ];
  get user() {
    return this.session.user;
  }
  get communities() {
    const query = this.search.trim().toLowerCase();
    return (
      this.data?.communities.filter((c) =>
        c.name.toLowerCase().includes(query),
      ) || []
    );
  }
  constructor() {
    if (new URL(window.location.href).searchParams.get('sign_in') === 'failed')
      this.error = 'Discord sign-in could not be completed. Please try again.';
    this.destroyRef.onDestroy(() => {
      this.live = false;
      this.transferProof = null;
    });
    this.bitcoin.address$.pipe(takeUntilDestroyed()).subscribe((address) => {
      if (this.walletKind !== 'evm') this.address = address || '';
    });
    void this.init();
  }
  private async api<T = any>(path = '', body?: unknown): Promise<T> {
    const response = await fetch('/api/portal/member' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : {
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': this.session.csrf,
            },
            body: JSON.stringify(body),
          }),
    });
    const result = await response.json();
    if (response.status === 401) {
      this.session.clear();
      this.data = null;
    }
    if (!response.ok)
      throw new Error(
        Array.isArray(result.message)
          ? result.message.join(' ')
          : result.message ||
            'Could not complete this action. Please try again.',
      );
    return result;
  }
  async init() {
    this.loading = true;
    try {
      await this.session.load();
      if (this.user) await this.refresh();
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading = false;
    }
  }
  async refresh() {
    const data = await this.api<Account>();
    if (!this.live) return;
    this.data = data;
    for (const c of data.communities)
      if (!c.channels.some((ch) => ch.id === this.channels[c.id]))
        this.channels[c.id] = c.defaultChannel;
  }
  async logout() {
    if (this.busy || this.connecting) return;
    await this.session.logout();
    if (!this.session.user) {
      this.data = null;
      this.addOpen = false;
      this.linkFlow = null;
      this.address = '';
      this.transferProof = null;
      this.transferPending = false;
      this.removal = null;
    } else this.error = this.session.error;
  }
  async run(task: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      await task();
    } catch (error) {
      if (this.live) this.fail(error);
    } finally {
      this.busy = false;
    }
  }
  private fail(error: unknown) {
    this.error =
      error instanceof Error
        ? error.message
        : 'Could not complete this action. Please try again.';
  }
  changeWallet() {
    if (this.busy || this.connecting) return;
    this.address = this.walletKind === 'evm' ? this.evmAddress : '';
    this.linkFlow = null;
    this.transferProof = null;
    this.transferPending = false;
    this.bitcoin.disconnect();
  }
  private evmWallet() {
    if (!this.evm) {
      this.evm = this.injector.get(WalletService);
      this.evm.connectedState$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((account) => {
          this.evmAddress =
            account.isConnected && !account.isReconnecting
              ? account.address || ''
              : '';
          if (this.walletKind === 'evm') this.address = this.evmAddress;
        });
      this.evm.connectionErrors$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((error) => {
          if (error && this.walletKind === 'evm') this.error = error;
        });
    }
    return this.evm;
  }
  async connect() {
    if (this.busy || this.connecting) return;
    this.connecting = true;
    this.error = '';
    try {
      if (this.walletKind === 'evm') await this.evmWallet().connect();
      else
        await this.bitcoin.connect(
          this.walletKind === 'unisat' ? 'unisat' : 'xverse',
        );
    } catch (error) {
      this.fail(error);
    } finally {
      this.connecting = false;
    }
  }
  openUniSat() {
    try {
      this.bitcoin.openUniSatMobile();
    } catch (error) {
      this.fail(error);
    }
  }
  addWallet() {
    this.tab = 'wallets';
    this.addOpen = !this.addOpen;
    if (this.addOpen && this.walletKind === 'evm') this.evmWallet();
  }
  async link() {
    await this.run(async () => {
      if (!this.address) throw new Error('Connect your wallet first.');
      const walletType = this.walletKind === 'evm' ? 'evm' : 'bitcoin';
      const address =
        walletType === 'bitcoin'
          ? await this.bitcoin.syncConnectedAccount()
          : this.address;
      if (
        !this.linkFlow ||
        this.linkFlow.address.toLowerCase() !== address.toLowerCase() ||
        new Date(this.linkFlow.expiresAt).getTime() <= Date.now()
      )
        this.linkFlow = await this.api<LinkFlow>('/wallet-challenge', {
          address,
          walletType,
        });
      const flow = this.linkFlow!;
      const proof =
        walletType === 'evm'
          ? await this.evmWallet().signTypedMessage(flow.challenge)
          : await this.bitcoin.signMessage(flow.address, flow.challenge);
      if (proof.address.toLowerCase() !== flow.address.toLowerCase()) {
        this.linkFlow = null;
        throw new Error('Your wallet account changed. Please sign again.');
      }
      const submission = { flow: flow.id, signature: proof.signature };
      const result = await this.api('/wallet-proof', submission);
      if (result.requiresTransfer) {
        this.transferProof = submission;
        this.transferPending = true;
        return;
      }
      await this.linked(result.transferred);
    });
  }
  async transfer() {
    await this.run(async () => {
      if (!this.transferProof)
        throw new Error('Please sign a new wallet proof.');
      const result = await this.api('/wallet-proof', {
        ...this.transferProof,
        transfer: true,
      });
      await this.linked(result.transferred);
    });
  }
  cancelTransfer() {
    this.transferProof = null;
    this.transferPending = false;
    this.linkFlow = null;
  }
  private async linked(transferred: boolean) {
    this.transferProof = null;
    this.transferPending = false;
    this.linkFlow = null;
    this.addOpen = false;
    await this.refresh();
    this.notice = transferred
      ? 'Wallet moved to your account. Previously earned roles on the previous account are being checked.'
      : 'Wallet linked. Choose a community to verify your roles.';
  }
  async previewRemoval(address: string) {
    await this.run(async () => {
      this.removal = {
        ...(await this.api<{
          address: string;
          communities: Array<{ id: string; name: string }>;
        }>('/wallet-removal?address=' + encodeURIComponent(address))),
        requestId: crypto.randomUUID(),
      };
    });
  }
  async remove() {
    await this.run(async () => {
      if (!this.removal) return;
      await this.api('/wallet-removal', {
        address: this.removal.address,
        requestId: this.removal.requestId,
      });
      this.removal = null;
      await this.refresh();
      this.notice =
        'Wallet removed from Bouncer. Previously earned roles are being checked using your remaining wallets.';
    });
  }
  async verify(community: Community) {
    await this.run(async () => {
      const result = await this.api('/verify', {
        server: community.id,
        channel: this.channels[community.id],
      });
      await this.router.navigateByUrl(result.url);
    });
  }
  async resume() {
    await this.run(async () => {
      const result = await this.api('/resume', {
        flow: this.data?.pending?.id,
      });
      if (result.url) await this.router.navigateByUrl(result.url);
      else {
        this.linkFlow = result;
        this.tab = 'wallets';
        this.addOpen = true;
        this.walletKind = result.walletType === 'evm' ? 'evm' : 'xverse';
        if (this.walletKind === 'evm') this.evmWallet();
      }
    });
  }
  async retry(id: string) {
    await this.run(async () => {
      await this.api('/jobs/' + id + '/retry', {});
      await this.refresh();
      this.notice = 'Role check queued again.';
    });
  }
  async refreshAccount() {
    await this.run(() => this.refresh());
  }
  hasRoles() {
    return this.data?.communities.some((c) => c.roles.length) || false;
  }
  async copy(address: string) {
    await this.run(async () => {
      await navigator.clipboard.writeText(address);
      this.notice = 'Address copied.';
    });
  }
  short(address: string) {
    return address.slice(0, 6) + '…' + address.slice(-4);
  }
  explorer(address: string) {
    return address.startsWith('0x')
      ? 'https://etherscan.io/address/' + address
      : 'https://mempool.space/address/' + address;
  }
  channelOptions(community: Community) {
    return [
      { value: '', label: 'Choose a channel' },
      ...community.channels.map((c) => ({ value: c.id, label: '#' + c.name })),
    ];
  }
  requirements(community: Community) {
    return (
      community.channels.find((c) => c.id === this.channels[community.id])
        ?.rules || community.channels.flatMap((c) => c.rules)
    );
  }
  assetLabel(asset: string) {
    return (
      (
        {
          ethscription: 'Ethscriptions',
          ordinal: 'Ordinals',
          nft: 'NFTs',
          erc20: 'Tokens (ERC-20)',
        } as Record<string, string>
      )[asset] || asset
    );
  }
  selection(rule: Requirement) {
    const criteria = rule.criteria as {
      kind: string;
      ids?: string[];
      ranges?: number[][];
    } | null;
    if (criteria?.kind === 'ids') return 'IDs: ' + criteria.ids?.join(', ');
    if (criteria?.kind === 'numbers')
      return (
        'Numbers: ' +
        criteria.ranges
          ?.map((pair) => (pair[0] === pair[1] ? pair[0] : pair.join('–')))
          .join(', ')
      );
    return '';
  }
  network(rule: Requirement) {
    return rule.asset === 'nft' || rule.asset === 'erc20'
      ? rule.network === 4663
        ? 'Robinhood'
        : rule.network === 1
          ? 'Ethereum'
          : `Chain ${rule.network}`
      : '';
  }
}
