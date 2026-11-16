import { SolanaWalletService } from '@/services/solana-wallet.service';
import { PrivacyChoicesComponent } from '@/components/privacy-choices/privacy-choices.component';
import { privacyChoiceDraft } from '@/utils/privacy-choice.util';
import { evmNetworkLabel } from '@/utils/evm-network.util';
import { isBaseAccount } from '@/utils/smart-wallet.util';
import { DeletionRequestsComponent } from '@/components/deletion-requests/deletion-requests.component';
import { Component, DestroyRef, Injector, inject } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PortalSessionService } from '@/services/portal-session.service';
import { WalletService } from '@/services/wallet.service';
import { canonicalBitcoinAddress, BitcoinWalletService } from '@/services/bitcoin-wallet.service';
import { PixelSelectComponent } from '@/components/pixel-select/pixel-select.component';

interface Requirement {
  roleId: string;
  earned: boolean;
  previouslyEarned: boolean;
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
  privacy?: any;
  privacy_choice?: any;
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
  walletType: 'evm' | 'bitcoin' | 'solana';
  challenge: any;
  expiresAt: string;
}
interface Account {
  communitiesUnavailable?: boolean;
  wallets: Array<{
    address: string;
    wallet_type: 'evm' | 'bitcoin' | 'solana';
    last_verified_at: string;
    communities?: Array<{server_id: string; source: 'legacy' | 'verification' | 'member'; enabled: boolean; shared_at: string}>;
    checking?: Array<{server_id: string; server_name: string; network: string; network_name: string; empty_checked_at: string}>;
    evm_chain_ids?: number[] | null;
  }>;
  capabilities?: {solana?: boolean};
  communities: Community[];
  counts: { wallets: number; communities: number; roles: number };
  pending: Pending | null;
  actions: Array<{
    id: string;
    kind: string;
    address: string;
    created_at: string;
    transferred?: boolean;
    source: 'portal' | 'discord';
    server_id?: string | null;
    community: string | null;
    channel: string | null;
    jobs: Array<{ id: string; status: string; server_id?: string; community: string; result: any }>;
  }>;
}

@Component({
  selector: 'app-member',
  imports: [
    FormsModule,
    RouterLink,
    DatePipe, AsyncPipe,
    PixelSelectComponent,
    PrivacyChoicesComponent,
    DeletionRequestsComponent,
  ],
  providers: [BitcoinWalletService],
  templateUrl: './member.component.html',
  styleUrl: './member.component.scss',
})
export class MemberComponent {
  readonly session = inject(PortalSessionService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly solana = inject(SolanaWalletService);
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
  roleViews: Record<string, 'earned' | 'available'> = {};
  readonly roleViewOptions = [
    { value: 'available', label: 'Available roles' },
    { value: 'earned', label: 'Earned roles' },
  ];
  hiddenPending = '';
  addOpen = false;
  walletKind = 'evm';
  walletCommunityId = '';
  address = '';
  connecting = false;
  /** Network of the connected EVM wallet; Base Account members choose it here. */
  evmChainId: number | null = null;
  evmBaseAccount = false;
  networkSwitching = false;
  disconnecting = false;
  linkFlow: LinkFlow | null = null;
  private transferProof: { flow: string; signature: string } | null = null;
  transferPending = false;
  removal: {
    address: string;
    communities: Array<{ id: string; name: string }>;
    requestId: string;
  } | null = null;
  get walletOptions() {return [
    { value: 'evm', label: 'EVM' },

    { value: 'xverse', label: 'Bitcoin · Xverse' },
    { value: 'unisat', label: 'Bitcoin · UniSat' },
    ...(this.data?.capabilities?.solana ? [{value:'solana',label:'Solana · Phantom'}] : []),
  ];}
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
  get walletCommunityOptions() {
    return [{value:'',label:'All wallets'}, ...(this.data?.communities || []).map(c=>({value:c.id,label:c.name}))];
  }
  get walletCommunity() { return this.data?.communities.find(c=>c.id===this.walletCommunityId); }
  get visibleWallets() {
    const community = this.walletCommunity;
    if (!community) return this.data?.wallets || [];
    return (this.data?.wallets || []).filter(wallet => this.walletSharing(wallet) || community.channels.some(channel => channel.rules.some(rule => {
      if (wallet.wallet_type === 'bitcoin') return ['ordinal','stamp'].includes(rule.asset);
      if (wallet.wallet_type === 'solana') return ['solana_nft','solana_token'].includes(rule.asset);
      return ['ethscription','nft','erc20'].includes(rule.asset) &&
        (!wallet.evm_chain_ids?.length || wallet.evm_chain_ids.includes(rule.asset==='ethscription'?1:rule.network || 1));
    })));
  }
  walletSharing(wallet: Account['wallets'][number]) {
    return wallet.communities?.find(c=>c.server_id===this.walletCommunityId);
  }
  walletShared(wallet: Account['wallets'][number]) { return !!this.walletSharing(wallet)?.enabled; }
  walletVisible(wallet: Account['wallets'][number]) {
    const scope = this.walletSharing(wallet), since = this.walletCommunity?.privacy?.share_since;
    return !!scope?.enabled && !!since && Date.parse(scope.shared_at)>=Date.parse(since);
  }
  walletChecking(wallet: Account['wallets'][number]) {
    return (wallet.checking || []).filter(state=>state.server_id===this.walletCommunityId);
  }
  get walletActions() {
    return (this.data?.actions || []).filter(action=>!this.walletCommunityId || action.server_id===this.walletCommunityId || action.jobs.some(job=>job.server_id===this.walletCommunityId));
  }
  async shareWallet(wallet: Account['wallets'][number], input: HTMLInputElement) {
    const enabled = input.checked;
    const community = this.walletCommunity;
    if (!community) return;
    await this.run(async () => {
      await this.api('/wallet-sharing', {server:community.id,address:wallet.address,enabled,request_id:crypto.randomUUID()});
      await this.refresh();
      this.notice = enabled ? 'Wallet sharing allowed for this community. Your privacy choices still apply.' : 'Wallet hidden from this community’s admin views and exports. Private role checks continue.';
    });
    // Native checkbox state changes before the request; restore authoritative
    // state on errors as well as after a successful overview refresh.
    input.checked = !!this.data?.wallets.find(w=>w.address===wallet.address)?.communities?.find(c=>c.server_id===community.id)?.enabled;
  }
  constructor() {
    if (new URL(window.location.href).searchParams.get('sign_in') === 'failed')
      this.error = 'Discord sign-in could not be completed. Please try again.';
    this.destroyRef.onDestroy(() => {
      this.live = false;
      this.transferProof = null;
    });
    this.solana.address$.pipe(takeUntilDestroyed()).subscribe(address => {if(this.walletKind === 'solana') this.address = address || '';});
    this.bitcoin.address$.pipe(takeUntilDestroyed()).subscribe((address) => {
      if (this.walletKind === 'xverse' || this.walletKind === 'unisat') this.address = address || '';
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
      if (this.data?.capabilities?.solana && new URL(window.location.href).searchParams.get('wallet') === 'phantom') {
        this.walletKind = 'solana';
        this.tab = 'wallets';
        this.addOpen = true;
      }
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
    if (this.walletCommunityId && !data.communities.some(c=>c.id===this.walletCommunityId)) this.walletCommunityId='';
    for (const c of data.communities) {
      if (c.privacy)
        c.privacy_choice = privacyChoiceDraft(c.privacy);
      this.roleViews[c.id] ||= 'available';
      if (!c.channels.some((ch) => ch.id === this.channels[c.id]))
        this.channels[c.id] = c.defaultChannel;
    }
  }
  async savePrivacy(c: Community) {
    await this.run(async () => {
      c.privacy = await this.api('/privacy/' + c.id, c.privacy_choice);
      this.notice =
        'Privacy choices saved. Verify again to share newly proven wallet records.';
    });
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
    this.solana.disconnect();
  }
  private evmWallet() {
    if (!this.evm) {
      this.evm = this.injector.get(WalletService);
      this.evm.connectedState$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((account) => {
          const connected = account.isConnected && !account.isReconnecting;
          this.evmAddress = connected ? account.address || '' : '';
          this.evmChainId = connected ? account.chainId ?? null : null;
          this.evmBaseAccount = connected && isBaseAccount(account);
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
      if (this.walletKind === 'solana') await this.solana.connect();
      else if (this.walletKind === 'evm') await this.evmWallet().connect();
      else
        await this.bitcoin.connect(
          this.walletKind === 'unisat' ? 'unisat' : 'xverse', true,
        );
    } catch (error) {
      this.fail(error);
    } finally {
      this.connecting = false;
    }
  }
  /** Ends the wallet app session only; saved wallets stay linked. */
  async disconnectWallet() {
    if (this.busy || this.connecting || this.disconnecting || this.networkSwitching) return;
    this.disconnecting = true;
    this.error = '';
    try {
      if (this.walletKind === 'evm') {
        await this.evm?.disconnectWeb3();
        this.evmAddress = '';
      } else if (this.walletKind === 'solana') this.solana.disconnect();
      else this.bitcoin.disconnect();
      this.address = '';
      this.linkFlow = null;
      this.transferProof = null;
      this.transferPending = false;
    } catch {
      this.error = 'Could not disconnect your wallet. Please try again.';
    } finally {
      this.disconnecting = false;
    }
  }
  get evmNetworks() {
    return this.evm?.evmNetworks ?? [];
  }
  /**
   * Base Account has no network control of its own. Ordinary key-based wallets
   * don't need one: their link counts on every supported network.
   */
  async chooseNetwork(chainId: number) {
    if (!this.evm || this.busy || this.connecting || this.networkSwitching || this.evmChainId === chainId) return;
    this.networkSwitching = true;
    this.error = '';
    try {
      this.evmChainId = await this.evm.switchNetwork(chainId);
    } catch (error) {
      this.fail(error);
    } finally {
      this.networkSwitching = false;
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
      const walletType = this.walletKind === 'evm' ? 'evm' : this.walletKind === 'solana' ? 'solana' : 'bitcoin';
      const address =
        walletType === 'solana' ? await this.solana.syncConnectedAccount() : walletType === 'bitcoin'
          ? await this.bitcoin.syncConnectedAccount()
          : await this.evmWallet().syncConnectedAccount();
      const chainId = walletType === 'evm' ? await this.evmWallet().getSigningChainId() : undefined;
      if (
        !this.linkFlow ||
        (walletType === 'evm' && (this.linkFlow.challenge.domain.version !== '2' || this.linkFlow.challenge.domain.chainId !== chainId)) ||
        (walletType !== 'evm' && /^Discord (?:user|server|channel):/m.test(String(this.linkFlow.challenge))) ||
        this.linkFlow.walletType !== walletType || this.linkFlow.address !== (walletType === 'evm' ? address.toLowerCase() : walletType === 'bitcoin' ? canonicalBitcoinAddress(address) : address) ||
        new Date(this.linkFlow.expiresAt).getTime() <= Date.now()
      )
        this.linkFlow = await this.api<LinkFlow>('/wallet-challenge', {
          address,
          walletType,
          ...(chainId ? { chainId } : {}),
        });
      const flow = this.linkFlow!;
      // A rolling deployment may briefly serve an older backend. Never forward
      // its identity-bearing challenge to a wallet; retry after the backend updates.
      if ((walletType === 'evm' && flow.challenge?.domain?.version !== '2')
        || (walletType !== 'evm' && /^Discord (?:user|server|channel):/m.test(String(flow.challenge)))) {
        this.linkFlow = null;
        throw new Error('Please reload Bouncer and start a new wallet link.');
      }
      const proof =
        walletType === 'evm'
          ? await this.evmWallet().signTypedMessage(flow.challenge)
          : walletType === 'solana' ? await this.solana.signMessage(flow.address, flow.challenge) : await this.bitcoin.signMessage(flow.address, flow.challenge);
      if ((walletType === 'evm' ? proof.address.toLowerCase() : walletType === 'bitcoin' ? canonicalBitcoinAddress(proof.address) : proof.address) !== flow.address) {
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
        this.walletKind = result.walletType === 'evm' ? 'evm' : result.walletType === 'solana' ? 'solana' : 'xverse';
        if (this.walletKind === 'evm') this.evmWallet();
      }
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
  walletScope(wallet: Account['wallets'][number]) {
    if (wallet.wallet_type === 'solana') return 'Solana';
    return wallet.evm_chain_ids?.length ? 'Smart wallet' : 'EVM';
  }
  walletNetworks(wallet: Account['wallets'][number]) {
    return wallet.evm_chain_ids?.map(id => evmNetworkLabel(id)).join(', ');
  }
  explorer(address: string, chainId?: number) {
    if (chainId === 8453) return 'https://basescan.org/address/' + address;
    if (chainId === 4663) return 'https://robinhoodchain.blockscout.com/address/' + address;
    return address.startsWith('0x')
      ? 'https://etherscan.io/address/' + address
      : (/^(bc1p[ac-hj-np-z02-9]{58}|bc1q[ac-hj-np-z02-9]{38}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i.test(address)) ? 'https://mempool.space/address/' + address : 'https://solscan.io/account/'+address;
  }
  channelOptions(community: Community) {
    return [
      { value: '', label: 'Choose a channel' },
      ...community.channels.map((c) => ({ value: c.id, label: '#' + c.name })),
    ];
  }
  communityRoles(community: Community) {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        channel: string;
        earned: boolean;
        previouslyEarned: boolean;
        rules: Requirement[];
      }
    >();
    for (const channel of community.channels.filter(
      (c) =>
        !this.channels[community.id] || c.id === this.channels[community.id],
    )) {
      for (const rule of channel.rules) {
        const key = channel.id + ':' + rule.roleId;
        if (!groups.has(key))
          groups.set(key, {
            id: key,
            name: rule.role,
            channel: channel.name,
            earned: rule.earned,
            previouslyEarned: rule.previouslyEarned,
            rules: [],
          });
        groups.get(key)!.rules.push(rule);
      }
    }
    return [...groups.values()].filter((role) =>
      this.roleViews[community.id] === 'earned' ? role.earned : !role.earned,
    );
  }
  activityLabel(action: Account['actions'][number]) {
    if (action.kind === 'wallet_verify') return 'Verified';
    if (action.kind === 'wallet_remove') return 'Removed';
    if (action.kind === 'wallet_transfer_out')
      return 'Transferred from this account';
    return action.transferred ? 'Transferred to this account' : 'Linked';
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
    if (rule.asset === 'stamp') return 'Bitcoin Stamps';
    if (rule.asset === 'solana_nft' || rule.asset === 'solana_token') return 'Solana';
    return rule.asset === 'nft' || rule.asset === 'erc20'
      ? evmNetworkLabel(rule.network || 1)
      : '';
  }
}
