import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { PixelSelectComponent } from '@/components/pixel-select/pixel-select.component';
import { PortalSessionService } from '@/services/portal-session.service';
@Component({
  selector: 'app-wallet-exports',
  imports: [FormsModule, DatePipe, PixelSelectComponent],
  template: `<section class="panel">
    <h2>Wallet snapshot export</h2>
    <p>
      Build a fresh snapshot for this server. Managed role/rule requirements are
      checked against current holdings; ordinary Discord-role filters use live
      role membership. Each exported wallet must match the selected network and
      scope. Combined holdings can qualify a member across several wallets.
    </p>
    <fieldset [disabled]="busy || !!job">
      <div class="toolbar">
        <label
          >Wallet family:<app-pixel-select
            label="Wallet family"
            [options]="families"
            [(ngModel)]="filters.family"
            [disabled]="busy || !!job"
        /></label>
        <label
          >Blockchain:<app-pixel-select
            label="Blockchain"
            [options]="networks"
            [(ngModel)]="filters.network"
            [disabled]="busy || !!job"
        /></label>
        <label
          >Verification channel:<app-pixel-select
            label="Export verification channel"
            [options]="channelOptions"
            [(ngModel)]="filters.channel"
            [disabled]="busy || !!job"
        /></label>
        <label
          >Rule / collection:<app-pixel-select
            label="Export rule"
            [options]="ruleOptions"
            [(ngModel)]="filters.rule"
            [disabled]="busy || !!job"
        /></label>
      </div>
      <div class="toolbar">
        <label
          >Include role:<app-pixel-select
            label="Include role"
            [options]="roleOptions"
            [(ngModel)]="includeRole"
            [disabled]="busy || !!job"
        /></label>
        <button
          (click)="addRole(false)"
          [disabled]="!includeRole || busy || !!job"
        >
          Add role
        </button>
        <label
          >Match included roles:<app-pixel-select
            label="Role matching"
            [options]="matches"
            [(ngModel)]="filters.role_match"
            [disabled]="busy || !!job"
        /></label>
        <label
          >Exclude role:<app-pixel-select
            label="Exclude role"
            [options]="roleOptions"
            [(ngModel)]="excludeRole"
            [disabled]="busy || !!job"
        /></label>
        <button
          (click)="addRole(true)"
          [disabled]="!excludeRole || busy || !!job"
        >
          Add exclusion
        </button>
      </div>
      <div class="actions">
        @for (r of filters.roles; track r) {
          <button (click)="removeRole(r, false)">
            Include {{ roleName(r) }} · Remove
          </button>
        }
        @for (r of filters.exclude_roles; track r) {
          <button (click)="removeRole(r, true)">
            Exclude {{ roleName(r) }} · Remove
          </button>
        }
      </div>
      <div class="toolbar">
        <label
          >Wallet last proven since:<input
            type="datetime-local"
            [(ngModel)]="verifiedSince"
        /></label>
        <label
          >Joined server before:<input type="date" [(ngModel)]="joinedBefore"
        /></label>
      </div>
      <label class="checkbox-label"
        ><input type="checkbox" [(ngModel)]="filters.exclude_blocked" /> Exclude
        server-blocked wallets.</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" [(ngModel)]="filters.identities" /> Include
        Discord names and IDs where authorized.</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" [(ngModel)]="filters.one_per_member" /> One
        wallet per member per network, using the most recently proven matching
        wallet.</label
      >
      <p class="muted">
        “Most recently proven” means a successful wallet signature in Bouncer.
        It is not on-chain transaction activity. EVM addresses may be reused
        across EVM chains. Dates use your browser’s local timezone.
      </p>
      @if (session.operator) {
        <label class="checkbox-label"
          ><input type="checkbox" [(ngModel)]="filters.operator_override" />
          Operator override: include wallets regardless of community
          sharing/export choices.</label
        >
        @if (filters.operator_override) {
          <label
            >Override reason:<input
              type="text"
              [(ngModel)]="filters.reason"
              maxlength="300"
              placeholder="Purpose of this administrative export"
          /></label>
          <p>
            This override and the download are recorded in the operator audit
            log.
          </p>
        }
      }
    </fieldset>
    @if (error) {
      <p role="alert">{{ error }}</p>
    }
    <div class="actions">
      @if (!job) {
        <button
          (click)="start()"
          [disabled]="
            busy || (filters.operator_override && !filters.reason.trim())
          "
        >
          Check and preview export
        </button>
      } @else {
        <button (click)="refresh()" [disabled]="busy">Refresh status</button>
        @if (job.status === 'completed') {
          <button (click)="download()" [disabled]="busy">Download CSV</button>
        }
        @if (job.status === 'failed' || job.status === 'expired') {
          <button (click)="retry()" [disabled]="busy">
            Retry fresh checks
          </button>
        }
        <button (click)="newExport()" [disabled]="busy">New export</button>
      }
    </div>
    @if (job) {
      <p role="status">
        <span class="badge">{{ job.status }}</span>
        @if (job.total) {
          {{ job.progress }} / {{ job.total }} members checked
        }
      </p>
      @if (job.status === 'completed') {
        <p>
          {{ job.count }} wallet rows ready. {{ job.before_dedup }} rows before
          selecting one wallet per member/network.
        </p>
        <p>
          Fresh checks started {{ job.checked_at | date: 'medium' }}. Download
          within 15 minutes of that time; permissions are checked again at
          download.
        </p>
      }
      @if (job.error) {
        <p>{{ job.error }}</p>
      }
    }
    <p class="muted">
      Ordinary exports include only members who allowed export participation.
      Identity columns also require identity-sharing permission. Address-only
      exports are not anonymous; downloaded copies cannot be recalled.
    </p>
  </section>`,
  styles: [
    `
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
      }
      .checkbox-label {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin-block: 8px;
      }
      .checkbox-label input {
        flex: none;
      }
      .toolbar label {
        min-width: 160px;
      }
      input[type='date'],
      input[type='datetime-local'] {
        min-width: 180px;
      }
    `,
  ],
})
export class WalletExportsComponent implements OnChanges, OnDestroy {
  @Input() server = '';
  @Input() data: any;
  readonly session = inject(PortalSessionService);
  filters: any = {
    family: 'all',
    network: 'all',
    channel: '',
    rule: '',
    roles: [],
    exclude_roles: [],
    role_match: 'any',
    exclude_blocked: true,
    identities: false,
    one_per_member: false,
    operator_override: false,
    reason: '',
  };
  includeRole = '';
  excludeRole = '';
  verifiedSince = '';
  joinedBefore = '';
  job: any = null;
  busy = false;
  error = '';
  private timer: any;
  private live = true;
  private revision = 0;
  readonly families = [
    { value: 'all', label: 'All wallet families' },
    { value: 'evm', label: 'EVM' },
    { value: 'bitcoin', label: 'Bitcoin' },
  ];
  readonly networks = [
    { value: 'all', label: 'All blockchains' },
    { value: 'ethereum', label: 'Ethereum' },
    { value: 'robinhood', label: 'Robinhood' },
    { value: 'bitcoin', label: 'Bitcoin' },
  ];
  readonly matches = [
    { value: 'any', label: 'Any included role' },
    { value: 'all', label: 'All included roles' },
  ];
  get channelOptions() {
    return [
      { value: '', label: 'All verification channels' },
      ...(this.data?.channels || []).map((c: any) => ({
        value: c.id,
        label: c.name,
      })),
    ];
  }
  get roleOptions() {
    return [
      { value: '', label: 'Choose a role' },
      ...(this.data?.roles || []).map((r: any) => ({
        value: r.id,
        label: r.name,
      })),
    ];
  }
  get ruleOptions() {
    return [
      { value: '', label: 'All applicable rules' },
      ...(this.data?.rules || []).map((r: any) => ({
        value: String(r.id),
        label: `#${r.id} · ${r.collection_name || r.slug || r.rule_label || r.role_name}`,
      })),
    ];
  }
  roleName(id: string) {
    return this.data?.roles?.find((r: any) => r.id === id)?.name || id;
  }
  addRole(exclude: boolean) {
    const key = exclude ? 'exclude_roles' : 'roles',
      id = exclude ? this.excludeRole : this.includeRole;
    if (id && !this.filters[key].includes(id) && this.filters[key].length < 20)
      this.filters[key].push(id);
  }
  removeRole(id: string, exclude: boolean) {
    const key = exclude ? 'exclude_roles' : 'roles';
    this.filters[key] = this.filters[key].filter((r: string) => r !== id);
  }
  ngOnChanges(changes: SimpleChanges) {
    if (changes['server']) {
      this.filters.channel = '';
      this.filters.rule = '';
      this.filters.roles = [];
      this.filters.exclude_roles = [];
      this.includeRole = '';
      this.excludeRole = '';
      this.newExport();
    }
  }
  ngOnDestroy() {
    this.live = false;
    clearTimeout(this.timer);
    this.revision++;
  }
  newExport() {
    clearTimeout(this.timer);
    this.revision++;
    this.job = null;
    this.error = '';
  }
  private async api(path: string, body?: any) {
    const r = await fetch(`/api/portal/servers/${this.server}/exports${path}`, {
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
    if (!r.ok) throw new Error(d.message || 'Could not build the export.');
    return d;
  }
  private poll() {
    clearTimeout(this.timer);
    if (['pending', 'running'].includes(this.job?.status))
      this.timer = setTimeout(() => void this.refresh(), 3000);
  }
  async start() {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    const version = this.revision;
    try {
      const f = { ...this.filters, request_id: crypto.randomUUID() };
      if (!f.channel) delete f.channel;
      if (!f.rule) delete f.rule;
      if (!f.operator_override) delete f.reason;
      if (this.verifiedSince)
        f.verified_since = new Date(this.verifiedSince).toISOString();
      if (this.joinedBefore)
        f.joined_before = new Date(
          this.joinedBefore + 'T23:59:59',
        ).toISOString();
      const j = await this.api('', f);
      if (this.live && version === this.revision) {
        this.job = j;
        this.poll();
      }
    } catch (e) {
      if (this.live && version === this.revision)
        this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async refresh() {
    if (!this.job || this.busy) return;
    const version = this.revision,
      id = this.job.id;
    this.busy = true;
    try {
      const j = await this.api('/' + id);
      if (this.live && version === this.revision) {
        this.job = j;
        this.poll();
      }
    } catch (e) {
      if (this.live && version === this.revision)
        this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async retry() {
    if (this.busy || !this.job) return;
    const version = this.revision;
    this.busy = true;
    this.error = '';
    try {
      const j = await this.api('/' + this.job.id + '/retry', {});
      if (this.live && version === this.revision) {
        this.job = j;
        this.poll();
      }
    } catch (e) {
      if (this.live && version === this.revision)
        this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async download() {
    if (this.busy || !this.job) return;
    const version = this.revision;
    this.busy = true;
    this.error = '';
    try {
      const d = await this.api('/' + this.job.id + '/download', {});
      if (!this.live || version !== this.revision) return;
      const url = URL.createObjectURL(
        new Blob([d.csv], { type: 'text/csv;charset=utf-8' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = d.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (this.live && version === this.revision)
        this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
}
