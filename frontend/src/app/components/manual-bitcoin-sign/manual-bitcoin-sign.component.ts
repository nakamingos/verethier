import { AsyncPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, Input, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { catchError, firstValueFrom, map, of, switchMap } from 'rxjs';
import { BitcoinWalletService, ManualSignatureRequest } from '@/services/bitcoin-wallet.service';
import { isPhone } from '@/utils/smart-wallet.util';
import { env } from 'src/env/env';

const POLL_MS = 2000;

/** Shows Bouncer's message for manual signing and takes the pasted signature. */
@Component({
  selector: 'app-manual-bitcoin-sign',
  imports: [AsyncPipe, FormsModule],
  template: `
    @if (bitcoin.manualRequest$ | async; as request) {
      <div class="manual-bitcoin-sign">
        @if (freewallet(); as link) {
          <div class="actions">
            <a class="button" [href]="link.url" (click)="openFreewallet($event, link.id, request)">Sign with Freewallet</a>
          </div>
          @if (waiting()) {
            <p class="muted" role="status">Waiting for Freewallet. Check the message there and click <strong>Yes</strong> to send the signature to Bouncer. Nothing showed up? Close any Freewallet request dialogs, then click the button again.</p>
          } @else {
            <p class="muted">Close any open Freewallet request dialogs first: Freewallet handles one request at a time. It then signs and sends the signature back.</p>
          }
          <p>Or sign it yourself:</p>
        }
        <ol>
          <li>Copy Bouncer's message.</li>
          <li>
            In your wallet, sign it with
            <span class="address">{{ request.address }}</span>. In Freewallet,
            choose <strong>Sign Message</strong>, paste it into Message and sign.
          </li>
          <li>Paste the signature below.</li>
        </ol>
        <div class="actions">
          <button type="button" (click)="copy(request.message)">{{ copied() ? 'Copied' : 'Copy message' }}</button>
        </div>
        <details>
          <summary>Show message</summary>
          <label>Message to sign:<textarea readonly rows="9" [value]="request.message"></textarea></label>
        </details>
        <label>Signature:<textarea name="manualSignature" rows="3" [(ngModel)]="signature" autocomplete="off" spellcheck="false"></textarea></label>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" (click)="submit()" [disabled]="!signature.trim()">Submit signature</button>
          <button type="button" (click)="cancel()">Cancel</button>
        </div>
      </div>
    }
  `,
  styles: `
    .manual-bitcoin-sign { min-width: 0; }
    .manual-bitcoin-sign ol { margin: 1rem 0; padding-left: 2rem; }
    .manual-bitcoin-sign li { margin-bottom: 0.5rem; }
    .address { overflow-wrap: anywhere; }
    details { margin: 1rem 0; }
    summary { cursor: pointer; }
    textarea { overflow-wrap: anywhere; }
  `,
})
export class ManualBitcoinSignComponent implements OnInit {
  @Input({ required: true }) bitcoin!: BitcoinWalletService;
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  signature = '';
  readonly error = signal('');
  readonly copied = signal(false);
  /** A `counterparty:` sign link whose signature Freewallet posts back to Bouncer. */
  readonly freewallet = signal<{ id: string; url: SafeUrl } | null>(null);
  readonly waiting = signal(false);
  private polling?: ReturnType<typeof setTimeout>;
  private lastOpened = 0;

  /** A second link while Freewallet shows a request opens an empty, stuck dialog, so ignore quick repeats. */
  openFreewallet(event: Event, id: string, request: ManualSignatureRequest) {
    if (Date.now() - this.lastOpened < 5000) {
      event.preventDefault();
      return;
    }
    this.lastOpened = Date.now();
    this.waitForFreewallet(id, request);
  }

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.stopWaiting());
    this.bitcoin.manualRequest$.pipe(
      switchMap((request) => {
        this.stopWaiting();
        this.freewallet.set(null);
        // Freewallet reads "+" in a link as a space; phones have no Freewallet link handler.
        if (!request || isPhone() || request.message.includes('+')) return of(null);
        return this.http.post<{ id: string }>(env.apiUrl + '/bitcoin-relay', request).pipe(
          map(({ id }) => ({ id, url: this.sanitizer.bypassSecurityTrustUrl(this.freewalletUrl(request, id)) })),
          catchError(() => of(null)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((link) => this.freewallet.set(link));
  }

  private freewalletUrl(request: ManualSignatureRequest, id: string): string {
    const callback = new URL(`${env.apiUrl}/bitcoin-relay/${id}`, window.location.href).href;
    return `counterparty:${request.address}?action=sign&message=${encodeURIComponent(request.message)}&callback=${encodeURIComponent(callback)}`;
  }

  /** Collects the signature once Freewallet sends it, then submits it like a pasted one. */
  waitForFreewallet(id: string, request: ManualSignatureRequest) {
    this.stopWaiting();
    this.error.set('');
    this.waiting.set(true);
    const poll = async () => {
      if (this.bitcoin.manualRequest$.value !== request) return this.stopWaiting();
      try {
        const { signature } = await firstValueFrom(this.http.get<{ signature: string | null }>(`${env.apiUrl}/bitcoin-relay/${id}`));
        if (this.bitcoin.manualRequest$.value !== request) return this.stopWaiting();
        if (signature) {
          this.stopWaiting();
          this.bitcoin.submitManualSignature(signature);
          return;
        }
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.stopWaiting();
          this.error.set('The Freewallet request expired. Click Sign Message to start again.');
          return;
        }
      }
      if (this.waiting()) this.polling = setTimeout(poll, POLL_MS);
    };
    this.polling = setTimeout(poll, POLL_MS);
  }

  private stopWaiting() {
    clearTimeout(this.polling);
    this.polling = undefined;
    this.waiting.set(false);
  }

  async copy(message: string) {
    try {
      await navigator.clipboard.writeText(message);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.error.set('Copying failed. Select the message and copy it yourself.');
    }
  }

  submit() {
    try {
      this.bitcoin.submitManualSignature(this.signature);
      this.signature = '';
      this.error.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Check the signature and try again.');
    }
  }

  cancel() {
    this.stopWaiting();
    this.signature = '';
    this.error.set('');
    this.bitcoin.cancelManualSignature();
  }
}
