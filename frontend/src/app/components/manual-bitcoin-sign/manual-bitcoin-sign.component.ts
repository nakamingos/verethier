import { AsyncPipe } from '@angular/common';
import { Component, Input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BitcoinWalletService } from '@/services/bitcoin-wallet.service';

/** Shows Bouncer's message for manual signing and takes the pasted signature. */
@Component({
  selector: 'app-manual-bitcoin-sign',
  imports: [AsyncPipe, FormsModule],
  template: `
    @if (bitcoin.manualRequest$ | async; as request) {
      <div class="manual-bitcoin-sign">
        <p>
          In your wallet, sign this exact message with
          <span class="pink">{{ request.address }}</span>, then paste the
          signature below. In Freewallet, use <strong>Sign Message</strong> on
          that address.
        </p>
        <label>Message to sign:<textarea readonly rows="9" [value]="request.message"></textarea></label>
        <div class="actions">
          <button type="button" (click)="copy(request.message)">{{ copied() ? 'Copied' : 'Copy message' }}</button>
        </div>
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
    .manual-bitcoin-sign p { overflow-wrap: anywhere; }
    textarea { overflow-wrap: anywhere; }
  `,
})
export class ManualBitcoinSignComponent {
  @Input({ required: true }) bitcoin!: BitcoinWalletService;
  signature = '';
  readonly error = signal('');
  readonly copied = signal(false);

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
    this.signature = '';
    this.error.set('');
    this.bitcoin.cancelManualSignature();
  }
}
