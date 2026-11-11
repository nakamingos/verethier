import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy-choices',
  imports: [RouterLink],
  template: `
    @if (policy && choice) {
      <details class="privacy-choices">
        <summary>
          <span class="privacy-title">Community privacy:</span>
          <span class="privacy-status">Admin sharing: {{ choice.share && policy.sharing_enabled ? 'On' : 'Off' }} · Wallet downloads: {{ choice.exports ? 'On' : 'Off' }}</span>
        </summary>
        <label class="checkbox-label"
          ><input
            type="checkbox"
            [checked]="choice.share"
            [disabled]="disabled || !policy.sharing_enabled"
            (change)="update('share', $any($event.target).checked)"
          />
          Let community admins see my wallets and Discord account.</label
        >
        @if (!policy.sharing_enabled) {
          <p class="muted">
            This community has turned off wallet sharing with admins.
          </p>
        }
        <label class="checkbox-label"
          ><input
            type="checkbox"
            [checked]="choice.exports"
            [disabled]="disabled"
            (change)="update('exports', $any($event.target).checked)"
          />
          Let community admins download my wallet addresses.</label
        >
        <p class="muted">
          Downloaded lists include your Discord name and ID only if both choices
          are on. Even a wallet-only list can help someone identify you.
          Turning this off won't erase copies already downloaded.
        </p>
        <p class="muted">
          Turning these off won't stop verification or normal role checks.
          You may miss extra access or rewards that need wallet sharing.
        </p>
        <p class="muted">
          Bouncer keeps wallet records for verification and security. Bouncer's
          operators can still see and download these records when sharing is off.
          These choices control what community admins can access.
          <a routerLink="/privacy" target="_blank" rel="noopener"
            >Privacy policy</a
          >
        </p>
      </details>
    }
  `,
  styles: [
    `
      .privacy-choices {
        margin-block: 12px;
      }
      summary {
        cursor: pointer;
        list-style: none;
        position: relative;
        padding-left: 22px;
      }
      summary::-webkit-details-marker {
        display: none;
      }
      summary::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0.35em;
        width: 14px;
        height: 10px;
        background: var(--pixel-select-arrow) center / contain no-repeat;
        transform: rotate(-90deg);
      }
      details[open] > summary::before {
        transform: none;
      }
      summary:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 4px;
      }
      .privacy-status {
        display: block;
        font-size: 0.85em;
        margin-top: 4px;
      }
      .checkbox-label {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-block: 8px;
      }
      .checkbox-label input {
        flex: none;
      }
      .privacy-choices p {
        font-size: 0.9em;
      }
    `,
  ],
})
export class PrivacyChoicesComponent {
  @Input() policy: any;
  @Input() choice: any;
  @Input() disabled = false;
  @Output() choiceChange = new EventEmitter<any>();
  update(key: 'share' | 'exports', value: boolean) {
    this.choiceChange.emit({ ...this.choice, [key]: value });
  }
}
