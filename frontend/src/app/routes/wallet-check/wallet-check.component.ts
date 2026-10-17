import { Component, Injector, NgZone, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type SignClient from '@walletconnect/sign-client';
import { evmWalletMetadata, projectId } from '../../services/evm-wallet.config';
import { safeWalletError, traceWalletClient } from './wallet-trace';

@Component({
  selector: 'app-wallet-check',
  templateUrl: './wallet-check.component.html',
  styleUrl: './wallet-check.component.scss',
})
export class WalletCheckComponent implements OnDestroy {
  readonly direct: boolean;
  readonly status = signal('Ready to start');
  readonly busy = signal(false);
  readonly connected = signal(false);
  readonly rainbowLink = signal<string | null>(null);
  readonly lines = signal<string[]>([]);
  readonly copied = signal(false);
  private readonly started = Date.now();
  private readonly cleanup: Array<() => void> = [];
  private client?: SignClient;
  private wallet?: import('../../services/wallet.service').WalletService;
  private topic?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(private route: ActivatedRoute, private injector: Injector, private zone: NgZone) {
    this.direct = route.snapshot.queryParamMap.get('mode') === 'direct';
    this.record('Wallet check v2; AppKit 1.8.24; Wagmi Core 2.22.1; WalletConnect 2.23.7');
    this.record(this.direct ? 'Mode: WalletConnect only' : 'Mode: Bouncer AppKit');
    this.record(`Origin: ${window.location.origin}`);
    this.record(`Browser: ${navigator.userAgent}`);
    this.listen(document, 'visibilitychange', () => this.record(`Page ${document.visibilityState}`));
    this.listen(window, 'pageshow', () => this.record('Page shown'));
    this.listen(window, 'pagehide', () => this.record('Page hidden'));
    this.listen(window, 'error', (event: ErrorEvent) => this.record(`Browser error: ${safeWalletError(event.message)}`));
    this.listen(window, 'unhandledrejection', (event: PromiseRejectionEvent) => this.record(`SDK error: ${safeWalletError(event.reason)}`));
  }

  get report(): string { return this.lines().join('\n'); }

  async start(): Promise<void> {
    if (this.busy() || this.connected()) return;
    this.busy.set(true);
    this.rainbowLink.set(null);
    this.status.set('Starting wallet connection');
    this.record('Start pressed');
    this.timer = setTimeout(() => {
      if (!this.connected()) {
        this.record('45 seconds elapsed without a connected session');
        this.status.set('Still waiting for the wallet. Return here after the error and copy the connection details.');
      }
    }, 45000);
    try {
      if (this.direct) await this.startDirect();
      else await this.startAppKit();
    } catch (error) {
      this.rainbowLink.set(null);
      this.status.set('Connection failed');
      this.record(`Connection error: ${safeWalletError(error)}`);
    } finally {
      if (!this.destroyed) this.busy.set(false);
      clearTimeout(this.timer);
    }
  }

  private async startAppKit(): Promise<void> {
    if (!this.wallet) {
      const { WalletService } = await import('../../services/wallet.service');
      this.wallet = this.injector.get(WalletService);
      const provider = await this.wallet.modal.getUniversalProvider();
      if (!provider) throw new Error('WalletConnect provider unavailable');
      this.cleanup.push(traceWalletClient(provider.client, stage => this.record(stage)));
      this.cleanup.push(this.wallet.modal.subscribeEvents(({ data }) => {
        if (['SELECT_WALLET', 'CONNECT_SUCCESS', 'CONNECT_ERROR', 'USER_REJECTED', 'CONNECT_PROXY_ERROR'].includes(data.event)) {
          this.record(`AppKit: ${data.event}`);
          if ('properties' in data && data.properties && 'message' in data.properties) this.record(safeWalletError(data.properties.message));
          if (data.event === 'CONNECT_ERROR' || data.event === 'CONNECT_PROXY_ERROR' || data.event === 'USER_REJECTED') {
            this.status.set('Wallet connection failed');
            clearTimeout(this.timer);
          }
        }
      }));
      const uri = () => { this.record('Pairing link created'); this.status.set('Waiting for wallet approval'); };
      provider.on('display_uri', uri);
      this.cleanup.push(() => provider.removeListener('display_uri', uri));
      const account = this.wallet.connectedState$.subscribe(account => {
        if (account.isConnected && !account.isReconnecting) {
          this.connected.set(true);
          this.status.set('Connected successfully');
          this.record('Bouncer received a connected account');
          clearTimeout(this.timer);
        } else if (this.connected()) {
          this.connected.set(false);
          this.record('Bouncer account disconnected');
        }
      });
      this.cleanup.push(() => account.unsubscribe());
      await this.wallet.modal.ready();
      this.record('AppKit ready');
    }
    if (!this.connected()) await this.wallet.connect();
  }

  private async startDirect(): Promise<void> {
    if (!this.client) {
      const { SignClient } = await import('@walletconnect/sign-client');
      this.client = await SignClient.init({
        projectId, metadata: evmWalletMetadata(), logger: 'silent', telemetryEnabled: false,
        // Keep this diagnostic session separate from the real verification app.
        customStoragePrefix: 'bouncer-wallet-check',
      });
      this.cleanup.push(traceWalletClient(this.client, stage => this.record(stage)));
      const deleted = () => this.zone.run(() => {
        this.topic = undefined;
        this.connected.set(false);
        this.status.set('Wallet disconnected');
        this.record('Wallet deleted the test session');
      });
      this.client.on('session_delete', deleted);
      this.cleanup.push(() => this.client?.off('session_delete', deleted));
    }
    let session = this.client.session.getAll().find(value => value.expiry * 1000 > Date.now());
    if (session) this.record('Restored the existing test session');
    else {
      this.record('Publishing wallet connection proposal');
      const { uri, approval } = await this.client.connect({
        optionalNamespaces: { eip155: {
          chains: ['eip155:1'], methods: ['eth_signTypedData_v4'], events: ['accountsChanged', 'chainChanged'],
        } },
      });
      if (!uri) throw new Error('WalletConnect did not create a pairing link');
      this.zone.run(() => {
        this.rainbowLink.set(`rainbow://wc?uri=${encodeURIComponent(uri)}`);
        this.status.set('Ready. Open Rainbow and approve the connection.');
        this.record('Pairing link ready; waiting for Open Rainbow');
      });
      session = await approval();
    }
    const approved = session;
    if (!approved.namespaces['eip155']?.accounts.length) throw new Error('Wallet approved no Ethereum accounts');
    this.zone.run(() => {
      this.topic = approved.topic;
      this.rainbowLink.set(null);
      this.connected.set(true);
      this.status.set('Connected successfully');
      this.record('WalletConnect returned an approved session');
    });
  }

  openRainbow(): void { this.record('Open Rainbow pressed'); }

  async sign(): Promise<void> {
    if (this.direct || !this.wallet || !this.connected() || this.busy()) return;
    this.busy.set(true);
    this.status.set('Waiting for the wallet signature');
    this.record('Test signature pressed');
    // This message cannot be submitted to Bouncer's verification API: it has a
    // different domain/type and contains no Discord identity or verification nonce.
    const challenge = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const typedData = {
      domain: { name: 'Bouncer Wallet Check', version: '1', chainId: 1 },
      types: { WalletCheck: [{ name: 'Purpose', type: 'string' }, { name: 'Challenge', type: 'string' }] },
      primaryType: 'WalletCheck',
      message: { Purpose: 'Test wallet signing only. This does not verify holdings or change Discord roles.', Challenge: challenge },
    };
    this.timer = setTimeout(() => {
      this.record('45 seconds elapsed without a signature');
      this.status.set('Still waiting for the signature. Return here and copy the details.');
    }, 45000);
    try {
      await this.wallet.signTypedMessage(typedData, stage => this.record(stage));
      this.status.set('Signature received successfully');
    } catch (error) {
      this.status.set('Signature failed');
      this.record(`Signature error: ${safeWalletError(error)}`);
    } finally {
      clearTimeout(this.timer);
      if (!this.destroyed) this.busy.set(false);
    }
  }

  async disconnect(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.direct && this.client && this.topic) {
        await this.client.disconnect({ topic: this.topic, reason: { code: 6000, message: 'Connection test complete' } });
        this.topic = undefined;
      } else await this.wallet?.disconnectWeb3();
      this.connected.set(false);
      this.status.set('Disconnected. Ready for another test.');
      this.record('Test disconnected by user');
    } catch (error) { this.record(`Disconnect error: ${safeWalletError(error)}`); }
    finally { this.busy.set(false); }
  }

  async copy(): Promise<void> {
    try { await navigator.clipboard.writeText(this.report); this.copied.set(true); }
    catch { this.status.set('Copy unavailable. Select the connection details below to copy them.'); }
  }

  private record(stage: string): void {
    if (this.destroyed) return;
    this.zone.run(() => this.lines.update(lines => [...lines.slice(0, 4), ...lines.slice(4).slice(-75), `${((Date.now() - this.started) / 1000).toFixed(1)}s ${stage}`]));
    this.copied.set(false);
  }

  private listen(target: EventTarget, type: string, handler: (event: any) => void): void {
    target.addEventListener(type, handler);
    this.cleanup.push(() => target.removeEventListener(type, handler));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.cleanup.forEach(stop => stop());
    // Preserve the approved session for a repeat visit; close only this test tab's transport.
    void this.client?.core.relayer.transportClose().catch(() => {});
  }
}
