import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { PortalSessionService } from '@/services/portal-session.service';
@Component({
  selector: 'app-deletion-requests',
  imports: [FormsModule, DatePipe],
  template: `<section class="panel">
    <h2>{{ operator ? 'Account deletion requests' : 'Account deletion' }}</h2>
    @if (operator) {
      <p>
        Showing up to 100 oldest open requests. Refresh after reviews to see the
        next requests.
      </p>
    }
    @if (!operator) {
      <p>
        Request deletion of your Bouncer account and ordinary wallet history. An
        operator reviews the request and records the outcome. Approval removes
        saved wallets and queues checks of previously earned roles before
        erasing the account records.
      </p>
      <p>
        Minimum block, security and administrative audit records may be retained
        separately where needed. Backup copies are handled through the recovery
        process described in the privacy policy.
      </p>
      <label class="checkbox-label"
        ><input type="checkbox" [(ngModel)]="confirmed" [disabled]="busy" /> I
        understand that deletion can remove roles supported by my saved
        wallets.</label
      >
      <button (click)="request()" [disabled]="busy || !confirmed || hasOpen">
        Request account deletion
      </button>
    }
    @if (error) {
      <p role="alert">{{ error }}</p>
    }
    @if (notice) {
      <p role="status">{{ notice }}</p>
    }
    <div class="actions">
      <button (click)="load()" [disabled]="busy">Refresh requests</button>
    </div>
    @for (r of requests; track r.id) {
      <section class="panel">
        <p>
          Request {{ r.id }} · <span class="badge">{{ r.status }}</span>
        </p>
        @if (operator && r.user_id) {
          <p>Discord user: {{ r.user_id }}</p>
        }
        <p>Submitted {{ r.created_at | date: 'medium' }}</p>
        @if (r.outcome) {
          <p>{{ r.outcome }}</p>
        }
        @if (operator && r.status === 'pending') {
          <label
            >Review outcome:<textarea
              [(ngModel)]="outcomes[r.id]"
              maxlength="500"
              [disabled]="busy"
            ></textarea>
          </label>
          <div class="actions">
            <button
              (click)="review(r, true)"
              [disabled]="busy || !outcomes[r.id]?.trim()"
            >
              Approve deletion
            </button>
            <button
              (click)="review(r, false)"
              [disabled]="busy || !outcomes[r.id]?.trim()"
            >
              Decline request
            </button>
          </div>
        }
        @if (r.status === 'processing') {
          <p>
            Wallets have been removed. Reconciliation and a safety interval must
            finish before erasure. Failed role checks require an operator retry;
            this request stays open until they finish.
          </p>
        }
      </section>
    } @empty {
      <p>No requests found.</p>
    }
  </section>`,
})
export class DeletionRequestsComponent implements OnInit {
  @Input() operator = false;
  private session = inject(PortalSessionService);
  requests: any[] = [];
  outcomes: Record<string, string> = {};
  confirmed = false;
  busy = false;
  error = '';
  notice = '';
  get hasOpen() {
    return this.requests.some((r) =>
      ['pending', 'processing'].includes(r.status),
    );
  }
  ngOnInit() {
    void this.load();
  }
  private async api(path: string, body?: any) {
    const r = await fetch('/api/portal/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.session.csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const d = await r.json();
    if (!r.ok)
      throw new Error(d.message || 'Could not complete the privacy request.');
    return d;
  }
  async load() {
    this.busy = true;
    this.error = '';
    try {
      this.requests = await this.api(
        (this.operator ? 'operator' : 'member') + '/deletion-requests',
      );
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async request() {
    if (!this.confirmed || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      await this.api('member/deletion-requests', {
        request_id: crypto.randomUUID(),
      });
      this.notice = 'Deletion request submitted for operator review.';
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
    if (!this.error) await this.load();
  }
  async review(r: any, approve: boolean) {
    if (this.busy || !this.outcomes[r.id]?.trim()) return;
    if (
      !confirm(
        approve
          ? 'Approve removal of this account’s wallets and queued erasure after role checks?'
          : 'Record this deletion request as declined?',
      )
    )
      return;
    this.busy = true;
    this.error = '';
    try {
      await this.api('operator/deletion-requests/' + r.id, {
        approve,
        outcome: this.outcomes[r.id],
      });
      this.notice = 'Review recorded.';
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
    if (!this.error) await this.load();
  }
}
