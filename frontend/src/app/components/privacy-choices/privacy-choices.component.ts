import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy-choices',
  imports: [RouterLink],
  template: `
    @if (policy && choice) {
      <div class="privacy-choices">
        <h3>Community privacy:</h3>
        <label class="checkbox-label"
          ><input
            type="checkbox"
            [checked]="choice.share"
            [disabled]="disabled || !policy.sharing_enabled"
            (change)="update('share', $any($event.target).checked)"
          />
          Let this community's admins see which wallets belong to me.</label
        >
        @if (!policy.sharing_enabled) {
          <p class="muted">
            This community currently has admin wallet sharing disabled.
          </p>
        }
        <label class="checkbox-label"
          ><input
            type="checkbox"
            [checked]="choice.exports"
            [disabled]="disabled"
            (change)="update('exports', $any($event.target).checked)"
          />
          Include my wallets in this community's downloadable exports.</label
        >
        <p class="muted">
          Exports can be filtered by network, role and other criteria.
          Address-only lists may still reveal associations. Discord names/IDs
          require both choices above. Downloaded copies cannot be recalled.
        </p>
        <p class="muted">
          Some optional access and rewards offered by this server may require
          your wallet address or its connection to your Discord account.
          Declining the relevant sharing or export permission may mean missing
          those offers. Normal Bouncer verification and role checks still work.
        </p>
        <p class="muted">
          These choices restrict community admins. Authorized Bouncer operators
          can view and export retained records, including when these choices are
          off.
          <a routerLink="/privacy" target="_blank" rel="noopener"
            >Privacy policy</a
          >
        </p>
      </div>
    }
  `,
  styles: [
    `
      .privacy-choices {
        margin-block: 12px;
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
