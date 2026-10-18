import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortalSessionService } from '../../services/portal-session.service';
import {
  PixelSelectComponent,
  SelectChoice,
} from '../../components/pixel-select/pixel-select.component';

@Component({
  selector: 'app-admin',
  imports: [CommonModule, FormsModule, PixelSelectComponent],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit, OnDestroy {
  walletExplorer(address: string) {
    return address.startsWith('0x')
      ? 'https://etherscan.io/address/' + address
      : 'https://mempool.space/address/' + address;
  }
  walletAddress(address: string) {
    return address.slice(0, 8) + '…' + address.slice(-6);
  }
  private readonly session = inject(PortalSessionService);
  get user() {
    return this.session.user;
  }
  get csrf() {
    return this.session.csrf;
  }
  get configured() {
    return this.session.configured;
  }
  ready = false;
  busy = false;
  error = '';
  notice = '';
  servers: any[] = [];
  invite = '';
  selected = '';
  loadingServer = '';
  data: any = null;
  tab = 'rules';
  filter = '';
  query = '';
  ruleSort = 'desc';
  editor: any = null;
  inputs: Record<string, string> = {};
  draft: any = {};
  mode = 'collection';
  review = false;
  private newRuleDrafts = new Map<
    string,
    { draft: any; mode: string; review: boolean }
  >();
  activity: any = {
    items: [],
    page: 1,
    pages: 1,
    total: 0,
    kind: 'roles',
    sort: 'desc',
    size: '20',
  };
  activityKind = 'roles';
  activitySort = 'desc';
  activitySize = '20';
  activityLoading = false;
  activityReady = false;
  private activityRequest?: AbortController;
  private activityEpoch = 0;
  memberId = '';
  memberQuery = '';
  memberMatches: any[] = [];
  memberMatchesOpen = false;
  memberFocused = false;
  memberMatchIndex = -1;
  memberSearching = false;
  memberSearchError = '';
  private memberSelection: any = null;
  private memberSearchTimer?: ReturnType<typeof setTimeout>;
  private memberSearchRequest?: AbortController;
  private memberSearchEpoch = 0;
  combinedGroups: any[] = [];
  private combinedIndex = new Map<string, any>();
  groupFilter = '';
  editRoleId = '';
  editRoleName = '';
  member: any = null;
  roleActionsOpen = false;
  roleActionEditor: any = null;
  roleActionTarget = '';
  roleActionReview = false;
  walletAuditResult: any = null;
  walletRestriction: {
    address: string;
    blocked: boolean;
    reason: string;
    request_id: string;
    server: string;
    memberId: string;
  } | null = null;
  messageChannel = '';
  messageAction = 'refresh';
  undo: any = null;
  undoLabel = 'Undo';
  readonly assetFilterChoices: SelectChoice[] = [
    { value: '', label: 'All assets' },
    { value: 'ethscription', label: 'Ethscriptions' },
    { value: 'ordinal', label: 'Ordinals' },
    { value: 'nft', label: 'NFTs' },
    { value: 'erc20', label: 'Tokens (ERC-20)' },
  ];
  readonly assetChoices: SelectChoice[] = this.assetFilterChoices.slice(1);
  readonly matchChoices: SelectChoice[] = [
    { value: 'collection', label: 'Collection' },
    { value: 'ids', label: 'Inscription IDs / hashes' },
    { value: 'numbers', label: 'Global inscription numbers' },
  ];
  readonly networkChoices: SelectChoice[] = [
    { value: 'ethereum', label: 'Ethereum' },
    { value: 'robinhood', label: 'Robinhood' },
  ];
  readonly messageActionChoices: SelectChoice[] = [
    { value: 'refresh', label: 'Refresh existing' },
    { value: 'new', label: 'Create another message' },
    { value: 'recover', label: 'Recover missing' },
  ];
  readonly ruleSortChoices: SelectChoice[] = [
    { value: 'asc', label: 'Ascending' },
    { value: 'desc', label: 'Descending' },
  ];
  readonly activitySortChoices: SelectChoice[] = [
    { value: 'desc', label: 'Newest first' },
    { value: 'asc', label: 'Oldest first' },
  ];
  readonly activitySizeChoices: SelectChoice[] = [
    { value: '10', label: '10' },
    { value: '20', label: '20' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
  ];
  readonly activityChoices: SelectChoice[] = [
    { value: 'roles', label: 'Role assignments' },
    { value: 'changes', label: 'Rule changes' },
    { value: 'jobs', label: 'Role checks' },
  ];
  get channelChoices(): SelectChoice[] {
    return (this.data?.channels || []).map((channel: any) => ({
      value: channel.id,
      label: '#' + channel.name,
    }));
  }
  get defaultChannelChoices(): SelectChoice[] {
    return [{ value: null, label: 'No default' }, ...this.channelChoices];
  }
  get roleChoices(): SelectChoice[] {
    return [
      { value: '', label: 'Create a new role' },
      ...(this.data?.roles || []).map((role: any) => ({
        value: role.id,
        label: role.name,
        disabled: !role.manageable,
      })),
    ];
  }
  get roleActionChoices(): SelectChoice[] {
    return [
      { value: '', label: 'Select a role' },
      ...this.roleChoices.filter((role) => !!role.value),
    ];
  }
  get roleActionTargetChoices(): SelectChoice[] {
    return this.roleActionChoices.filter(
      (role) =>
        !role.value ||
        (role.value !== this.roleActionEditor?.trigger_role_id &&
          !this.roleActionEditor?.remove_role_ids.includes(role.value)),
    );
  }
  roleName(id: string) {
    return this.data?.roles.find((role: any) => role.id === id)?.name || id;
  }
  editRoleAction(action?: any) {
    this.roleActionEditor = action
      ? {
          ...action,
          remove_role_ids: [...action.remove_role_ids],
          version: action.updated_at,
        }
      : { trigger_role_id: '', remove_role_ids: [], version: null };
    this.roleActionEditor.existing = !!action;
    this.roleActionReview = false;
    this.roleActionTarget = '';
  }
  addRoleActionTarget() {
    if (
      this.roleActionTarget &&
      this.roleActionEditor.remove_role_ids.length < 20
    ) {
      this.roleActionEditor.remove_role_ids.push(this.roleActionTarget);
      this.roleActionTarget = '';
    }
  }
  reviewRoleAction() {
    this.roleActionEditor.request_id = crypto.randomUUID();
    this.roleActionReview = true;
  }
  async saveRoleAction() {
    const draft = this.roleActionEditor;
    await this.run(async () => {
      await this.api(`/servers/${this.selected}/role-actions`, {
        trigger_role_id: draft.trigger_role_id,
        remove_role_ids: draft.remove_role_ids,
        version: draft.version,
        request_id: draft.request_id,
      });
      this.data = await this.api('/servers/' + this.selected);
      this.roleActionEditor = null;
      this.notice =
        'Role action saved. Checks for previously tracked holders are queued.';
    });
  }
  async deleteRoleAction(action: any) {
    if (
      !confirm(
        `Delete the role action for ${this.roleName(action.trigger_role_id)}? Previously earned roles will be rechecked.`,
      )
    )
      return;
    await this.run(async () => {
      await this.api(`/servers/${this.selected}/role-actions`, {
        trigger_role_id: action.trigger_role_id,
        remove_role_ids: null,
        version: action.updated_at,
        request_id: (action.deleteRequestId ||= crypto.randomUUID()),
      });
      this.data = await this.api('/servers/' + this.selected);
      this.roleActionEditor = null;
      this.notice = 'Role action deleted. Earned-role checks queued.';
    });
  }
  async auditWalletHistory(memberId?: string, after?: string) {
    await this.run(async () => {
      const result = await this.api(`/servers/${this.selected}/wallet-audit`, {
        ...(memberId ? { member_id: memberId } : {}),
        ...(after ? { after } : {}),
      });
      this.walletAuditResult = {
        ...result,
        items: after
          ? [...this.walletAuditResult.items, ...result.items]
          : result.items,
      };
    });
  }
  async lookupAuditMember(id: string) {
    this.memberSelection = null;
    this.memberQuery = id;
    await this.lookup();
  }
  async moreWalletAccounts(item: any) {
    await this.run(async () => {
      const result = await this.api(`/servers/${this.selected}/wallet-audit`, {
        member_id: this.walletAuditResult.member_id || undefined,
        address: item.address,
        account_after: item.account_next,
      });
      const next = result.items[0];
      if (!next)
        throw new Error(
          'This wallet’s associations changed. Run the audit again.',
        );
      const accounts = new Map(
        item.accounts.map((account: any) => [account.user_id, account]),
      );
      for (const account of next.accounts)
        accounts.set(account.user_id, account);
      item.accounts = [...accounts.values()];
      item.account_next = next.account_next;
      item.account_count = next.account_count;
      this.walletAuditResult.checked_at = result.checked_at;
    });
  }
  get groupChoices(): SelectChoice[] {
    return [
      { value: '', label: 'All rules' },
      { value: 'combined', label: 'Combined rules only' },
      ...this.combinedGroups.map((group) => ({
        value: group.key,
        label: `${group.roleName} · ${group.minimum} items · #${this.channelName(group.channelId)}`,
      })),
    ];
  }
  async ngOnInit() {
    try {
      await this.session.load();
      if (new URLSearchParams(location.search).get('sign_in') === 'failed')
        this.error =
          'Discord sign-in could not be completed. Please try again.';
      if (this.user) {
        const result = await this.api('/servers');
        const names = new Intl.Collator(undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        this.servers = [...result.servers].sort(
          (a, b) =>
            Number(b.installed) - Number(a.installed) ||
            names.compare(a.name, b.name),
        );
        this.invite = result.invite;
        const remembered = sessionStorage.getItem('bouncer-admin-server');
        const first =
          this.servers.find((s) => s.id === remembered && s.installed) ||
          this.servers.find((s) => s.installed);
        this.ready = true;
        if (first) await this.select(first.id);
      }
    } catch (e) {
      this.failure(e);
    } finally {
      this.ready = true;
    }
  }
  async api(path: string, body?: any, signal?: AbortSignal) {
    const result = await fetch('/api/portal' + path, {
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: any;
    try {
      data = await result.json();
    } catch {
      throw new Error('Could not reach Bouncer. Please try again.');
    }
    if (!result.ok) {
      if (result.status === 401) {
        this.session.clear();
      }
      throw new Error(
        Array.isArray(data.message)
          ? data.message.join(' ')
          : data.message || 'Could not complete this request.',
      );
    }
    return data;
  }
  failure(e: any) {
    this.error = e?.message || 'Something went wrong. Please try again.';
  }
  dismissFeedback() {
    this.error = '';
    this.notice = '';
  }
  get loadingServerName() {
    return (
      this.servers.find((server) => server.id === this.loadingServer)?.name ||
      'community'
    );
  }
  async run(work: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      await work();
    } catch (e) {
      this.failure(e);
    } finally {
      this.busy = false;
    }
  }
  async select(id: string) {
    await this.run(async () => {
      this.rememberNewRule();
      this.cancelActivity();
      this.resetMemberSearch();
      this.suggestionEpoch++;
      this.loadingServer = id;
      try {
        // Keep the current server visible and inert until its replacement is ready.
        // Commit the ID and data together so controls never target another server.
        const data = await this.api('/servers/' + id);
        this.selected = id;
        this.data = data;
        this.memberQuery = '';
        this.groupFilter = '';
        this.editor = null;
        this.member = null;
        this.walletAuditResult = null;
        this.roleActionsOpen = false;
        this.roleActionEditor = null;
        this.walletRestriction = null;
        this.activity = {
          items: [],
          page: 1,
          pages: 1,
          total: 0,
          kind: 'roles',
          sort: 'desc',
          size: '20',
        };
        this.activityKind = 'roles';
        this.activitySort = 'desc';
        this.activitySize = '20';
        this.activityReady = false;
        this.undo = null;
        this.tab = 'rules';
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>('.workspace-tabs')
            ?.scrollTo({ left: 0 });
        });
        this.messageUrl = '';
        this.rebuildGroups();
        this.messageChannel =
          data.settings.verification_channel_id || data.channels[0]?.id || '';
        sessionStorage.setItem('bouncer-admin-server', id);
      } finally {
        this.loadingServer = '';
      }
    });
  }
  async reload() {
    this.data = await this.api('/servers/' + this.selected);
    this.rebuildGroups();
  }
  async logout() {
    await this.run(async () => {
      await this.api('/auth/logout', {});
      this.cancelActivity();
      this.session.clear();
      this.data = null;
      this.servers = [];
      this.newRuleDrafts.clear();
    });
  }
  get rules() {
    const rules = this.activeGroup
      ? [...this.activeGroup.rules]
      : (this.data?.rules || []).filter(
          (r: any) =>
            (this.groupFilter !== 'combined' || !!this.groupFor(r)) &&
            (!this.filter || r.asset_type === this.filter) &&
            (!this.query ||
              this.describe(r)
                .toLowerCase()
                .includes(this.query.toLowerCase()) ||
              r.role_name?.toLowerCase().includes(this.query.toLowerCase())),
        );
    return rules.sort(
      (a: any, b: any) =>
        (Number(a.id) - Number(b.id)) * (this.ruleSort === 'asc' ? 1 : -1),
    );
  }
  describe(r: any) {
    const traits =
      r.attribute_key && r.attribute_key !== 'ALL'
        ? ` · ${r.attribute_key}=${r.attribute_value}`
        : '';
    const selection = r.inscription_criteria;
    const picked = selection
      ? selection.kind === 'ids'
        ? selection.ids.join(', ')
        : selection.ranges
            .map((p: any) => (p[0] === p[1] ? p[0] : p.join('–')))
            .join(', ')
      : '';
    return `${r.rule_label || r.collection_name || r.slug || r.contract_address || r.asset_type}${picked ? ' · ' + picked : ''}${traits}`;
  }
  channelName(id: string) {
    return (
      this.data?.channels.find((c: any) => c.id === id)?.name ||
      'Missing channel'
    );
  }
  minimum(r: any) {
    if (r.asset_type !== 'erc20')
      return `${r.min_items || 1} item${r.min_items === 1 ? '' : 's'}`;
    return r.fields?.[0]?.value + ' ' + (r.token_symbol || 'tokens');
  }
  groupKey(rule: any) {
    return JSON.stringify([rule.channel_id, rule.role_id, rule.min_items || 1]);
  }
  rebuildGroups() {
    const groups = new Map<string, any>();
    for (const rule of this.data?.rules || []) {
      if (rule.asset_type === 'erc20') continue;
      const key = this.groupKey(rule);
      if (!groups.has(key))
        groups.set(key, {
          key,
          roleName: rule.role_name || rule.role_id,
          roleId: rule.role_id,
          channelId: rule.channel_id,
          minimum: rule.min_items || 1,
          rules: [],
        });
      groups.get(key).rules.push(rule);
    }
    this.combinedGroups = [...groups.values()].filter(
      (group) => group.rules.length > 1,
    );
    this.combinedIndex = new Map(
      this.combinedGroups.map((group) => [group.key, group]),
    );
    if (
      this.groupFilter !== 'combined' &&
      !this.combinedIndex.has(this.groupFilter)
    )
      this.groupFilter = '';
  }
  groupFor(rule: any) {
    return rule.asset_type === 'erc20'
      ? null
      : this.combinedIndex.get(this.groupKey(rule));
  }
  get activeGroup() {
    return this.combinedIndex.get(this.groupFilter);
  }
  showGroup(key: string) {
    this.hideEditor();
    this.groupFilter = key;
  }
  jumpToRule(event: Event, id: number) {
    event.preventDefault();
    this.hideEditor();
    requestAnimationFrame(() => {
      const card = document.getElementById('rule-' + id);
      card?.scrollIntoView({
        block: 'center',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
      card?.focus({ preventScroll: true });
    });
  }
  closeEditor() {
    if (!this.busy) {
      if (this.editor?.new) {
        this.newRuleDrafts.delete(this.selected);
        this.draft = {};
        this.mode = 'collection';
      }
      this.editor = null;
      this.review = false;
    }
  }
  private rememberNewRule() {
    if (this.editor?.new)
      this.newRuleDrafts.set(this.selected, {
        draft: { ...this.draft },
        mode: this.mode,
        review: this.review,
      });
  }
  private hideEditor() {
    if (this.busy) return;
    this.rememberNewRule();
    this.editor = null;
    this.review = false;
  }
  create() {
    if (this.busy) return;
    if (this.editor?.new) {
      this.hideEditor();
      return;
    }
    this.suggestions = {};
    this.editor = { new: true };
    const saved = this.newRuleDrafts.get(this.selected);
    this.review = saved?.review || false;
    this.mode = saved?.mode || 'collection';
    this.draft = saved
      ? { ...saved.draft }
      : {
          asset_type: 'ethscription',
          channel_id:
            this.activeGroup?.channelId ||
            this.messageChannel ||
            this.data.channels[0]?.id ||
            '',
          role_id: this.activeGroup?.roleId || '',
          role_name: '',
          min_items: this.activeGroup?.minimum || 1,
          network: 'ethereum',
        };
  }
  edit(rule: any) {
    if (this.busy) return;
    if (this.editor?.id === rule.id) {
      this.closeEditor();
      return;
    }
    this.rememberNewRule();
    this.editor = rule;
    this.editRoleId = rule.role_id;
    this.editRoleName = '';
    this.review = false;
    this.inputs = Object.fromEntries(
      rule.fields.map((f: any) => [f.key, f.value]),
    );
    requestAnimationFrame(() =>
      document
        .getElementById('edit-rule-' + rule.id)
        ?.querySelector<HTMLElement>('select,input,textarea')
        ?.focus({ preventScroll: true }),
    );
  }
  changeAsset() {
    const asset = this.draft.asset_type,
      channel = this.draft.channel_id,
      role = this.draft.role_id,
      name = this.draft.role_name;
    this.draft = {
      asset_type: asset,
      channel_id: channel,
      role_id: role,
      role_name: name,
      min_items: 1,
      network: 'ethereum',
    };
    this.mode = 'collection';
    this.review = false;
    this.suggestions = {};
  }
  suggestions: Record<string, string[]> = {};
  private suggestionEpoch = 0;
  async suggest(field: string) {
    const d = this.draft;
    const epoch = ++this.suggestionEpoch;
    const params = new URLSearchParams({
      asset: d.asset_type,
      field,
      slug: d.slug || '',
      key: d.attribute_key || '',
      contract: d.contract_address || '',
      network: d.network || 'ethereum',
    });
    try {
      const result = await this.api(
        `/servers/${this.selected}/suggestions?${params}`,
      );
      if (epoch === this.suggestionEpoch)
        this.suggestions[field] = result.values;
    } catch {
      if (epoch === this.suggestionEpoch) this.suggestions[field] = [];
    }
  }
  payload() {
    const d = this.draft;
    const result: any = {
      asset_type: d.asset_type,
      channel_id: d.channel_id,
      request_id: crypto.randomUUID(),
    };
    if (d.role_id) result.role_id = d.role_id;
    else result.role_name = d.role_name;
    const fields =
      d.asset_type === 'erc20'
        ? ['contract_address', 'network', 'min_balance']
        : d.asset_type === 'nft'
          ? [
              'contract_address',
              'network',
              'token_ids',
              'collection_name',
              'attribute_key',
              'attribute_value',
              'min_items',
            ]
          : this.mode === 'collection'
            ? ['slug', 'attribute_key', 'attribute_value', 'min_items']
            : [
                this.mode === 'ids' ? 'inscription_ids' : 'inscription_numbers',
                'label',
                'min_items',
              ];
    for (const key of fields)
      if (d[key] !== undefined && d[key] !== null && d[key] !== '')
        result[key] = key === 'min_items' ? Number(d[key]) : d[key];
    return result;
  }
  get changedRole() {
    return !this.editor?.new && this.editRoleId !== this.editor?.role_id;
  }
  get targetRoleName() {
    return this.editRoleId
      ? this.data.roles.find((role: any) => role.id === this.editRoleId)
          ?.name || this.editRoleId
      : this.editRoleName;
  }
  async save() {
    await this.run(async () => {
      const creating = this.editor.new;
      const action = this.editor.new
        ? await this.api(`/servers/${this.selected}/rules`, this.payload())
        : await this.api(
            `/servers/${this.selected}/rules/${this.editor.id}/edit`,
            {
              version: this.editor.version,
              ...(this.editRoleId
                ? { role_id: this.editRoleId }
                : { role_name: this.editRoleName }),
              inputs: this.inputs,
              request_id: crypto.randomUUID(),
            },
          );
      this.undo = action;
      if (creating) this.newRuleDrafts.delete(this.selected);
      this.undoLabel = 'Undo';
      this.editor = null;
      await this.reload();
      this.notice =
        'Rule saved. Previously earned roles are queued for a fresh check.';
    });
  }
  async remove(rule: any) {
    if (
      !confirm(
        `Delete rule ${rule.id} for ${rule.role_name}? Previously earned roles will be checked against the remaining rules and saved wallets.`,
      )
    )
      return;
    await this.run(async () => {
      this.undo = await this.api(
        `/servers/${this.selected}/rules/${rule.id}/delete`,
        { version: rule.version, request_id: crypto.randomUUID() },
      );
      this.undoLabel = 'Undo';
      await this.reload();
      this.notice = 'Rule deleted. Role checks are queued.';
    });
  }
  async reverse(action = this.undo) {
    if (!action) return;
    await this.run(async () => {
      this.undo = await this.api(
        `/servers/${this.selected}/actions/${action.id}/reverse`,
        { request_id: crypto.randomUUID() },
      );
      this.undoLabel = this.undoLabel === 'Undo' ? 'Redo' : 'Undo';
      await this.reload();
      if (this.tab === 'audit') await this.loadActivity();
      this.notice = 'Change reversed. Eligibility will be checked again.';
    });
  }
  async settings() {
    await this.run(async () => {
      await this.api(`/servers/${this.selected}/settings`, this.data.settings);
      this.notice = 'Settings saved.';
    });
  }
  async message() {
    await this.run(async () => {
      const result = await this.api(`/servers/${this.selected}/message`, {
        channel_id: this.messageChannel,
        action: this.messageAction,
      });
      this.notice = 'Verification message ready.';
      this.messageUrl = result.url;
    });
  }
  messageUrl = '';
  async switchTab(tab: string) {
    if (this.busy) return;
    if (tab !== 'rules' && this.editor?.new) this.hideEditor();
    this.tab = tab;
    this.error = '';
    this.notice = '';
    if (tab === 'audit') await this.readActivity(1);
    else this.cancelActivity();
  }
  async pageActivity(direction: number) {
    if (this.activityLoading || !this.activityReady) return;
    const page = Math.max(
      1,
      Math.min(this.activity.pages, this.activity.page + direction),
    );
    if (page !== this.activity.page) await this.readActivity(page);
  }
  async lastActivity() {
    if (
      this.activityLoading ||
      !this.activityReady ||
      this.activity.page >= this.activity.pages
    )
      return;
    await this.readActivity(this.activity.pages);
  }
  private async readActivity(page: number) {
    if (this.busy || !this.selected) return;
    this.error = '';
    this.notice = '';
    try {
      await this.loadActivity(page);
    } catch (error) {
      this.failure(error);
    }
  }
  private cancelActivity() {
    this.activityEpoch++;
    this.activityRequest?.abort();
    this.activityRequest = undefined;
    this.activityLoading = false;
  }
  async loadActivity(page = this.activity.page) {
    this.cancelActivity();
    const epoch = this.activityEpoch;
    const request = (this.activityRequest = new AbortController());
    const server = this.selected;
    const kind = this.activityKind;
    const sort = this.activitySort;
    const size = this.activitySize;
    const moveToStart =
      this.activityReady &&
      (page !== this.activity.page || size !== this.activity.size);
    this.activityLoading = true;
    try {
      const data = await this.api(
        `/servers/${server}/activity?kind=${kind}&page=${page}&sort=${sort}&limit=${size}`,
        undefined,
        request.signal,
      );
      if (epoch !== this.activityEpoch || server !== this.selected) return;
      this.activity = { ...data, kind, sort, size };
      this.activityReady = true;
      requestAnimationFrame(() => {
        if (epoch !== this.activityEpoch || this.tab !== 'audit') return;
        if (moveToStart)
          document
            .querySelector<HTMLElement>('.activity-panel')
            ?.scrollIntoView({ block: 'start' });
      });
    } catch (error: any) {
      if (epoch !== this.activityEpoch || error?.name === 'AbortError') return;
      this.activityKind = this.activity.kind;
      this.activitySort = this.activity.sort;
      this.activitySize = this.activity.size;
      throw error;
    } finally {
      if (epoch === this.activityEpoch) {
        this.activityLoading = false;
        this.activityRequest = undefined;
      }
    }
  }
  private resetMemberSearch() {
    clearTimeout(this.memberSearchTimer);
    this.memberSearchRequest?.abort();
    this.memberSearchEpoch++;
    this.memberMatches = [];
    this.memberMatchesOpen = false;
    this.memberMatchIndex = -1;
    this.memberSelection = null;
    this.memberId = '';
    this.memberSearching = false;
    this.memberSearchError = '';
  }
  ngOnDestroy() {
    this.cancelActivity();
    this.resetMemberSearch();
  }
  queueMemberSearch() {
    this.resetMemberSearch();
    const query = this.memberQuery.trim();
    if (query.length < 2) return;
    const epoch = this.memberSearchEpoch;
    const server = this.selected;
    this.memberSearchTimer = setTimeout(async () => {
      const request = (this.memberSearchRequest = new AbortController());
      this.memberSearching = true;
      try {
        const result = await this.api(
          `/servers/${server}/members?query=${encodeURIComponent(query)}`,
          undefined,
          request.signal,
        );
        if (epoch !== this.memberSearchEpoch || server !== this.selected)
          return;
        this.memberMatches = result.members;
        this.memberMatchesOpen =
          this.memberFocused && result.members.length > 0;
      } catch (error: any) {
        if (epoch === this.memberSearchEpoch && error.name !== 'AbortError')
          this.memberSearchError = error.message;
      } finally {
        if (epoch === this.memberSearchEpoch) this.memberSearching = false;
      }
    }, 300);
  }
  closeMemberMatches() {
    this.memberFocused = false;
    this.memberMatchesOpen = false;
    this.memberMatchIndex = -1;
  }
  memberSearchKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeMemberMatches();
      return;
    }
    if (!this.memberMatches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.memberMatchesOpen = true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.memberMatchIndex =
        (this.memberMatchIndex + step + this.memberMatches.length) %
        this.memberMatches.length;
      requestAnimationFrame(() =>
        document
          .getElementById('member-match-' + this.memberMatchIndex)
          ?.scrollIntoView({ block: 'nearest' }),
      );
    } else if (
      event.key === 'Enter' &&
      this.memberMatchesOpen &&
      this.memberMatchIndex >= 0
    ) {
      event.preventDefault();
      void this.chooseMember(this.memberMatches[this.memberMatchIndex]);
    }
  }
  async chooseMember(member: any) {
    this.resetMemberSearch();
    this.memberSelection = member;
    this.memberId = member.id;
    this.memberQuery =
      member.name === member.username
        ? '@' + member.username
        : `${member.name} (@${member.username})`;
    await this.lookup();
  }
  async lookup(check = false) {
    if (this.busy) return;
    let identifier = check
      ? this.member?.id
      : this.memberSelection?.id || this.memberQuery.trim();
    if (!identifier) return;
    this.memberMatchesOpen = false;
    this.memberSearchRequest?.abort();
    clearTimeout(this.memberSearchTimer);
    this.memberSearchEpoch++;
    this.memberSearching = false;
    await this.run(async () => {
      if (
        !check &&
        !this.memberSelection &&
        identifier.length >= 42 &&
        /^(0x|bc1)/i.test(identifier)
      ) {
        const result = await this.api(
          `/servers/${this.selected}/members?query=${encodeURIComponent(identifier)}`,
        );
        if (result.members.length > 1) {
          this.memberMatches = result.members;
          this.memberMatchIndex = -1;
          this.memberMatchesOpen = true;
          this.memberSearchError =
            'This wallet matches several members. Choose the account to look up.';
          requestAnimationFrame(() =>
            document.getElementById('member-lookup')?.focus(),
          );
          return;
        }
        if (result.members.length === 1) identifier = result.members[0].id;
      }
      const path = `/servers/${this.selected}/members/${encodeURIComponent(identifier)}`;
      this.member = await this.api(
        check ? path + '/check' : path,
        check ? { request_id: crypto.randomUUID() } : undefined,
      );
      this.memberId = this.member.id;
      this.walletAuditResult = null;
      this.walletRestriction = null;
    });
  }
  async retry(item: any) {
    await this.run(async () => {
      await this.api(`/servers/${this.selected}/jobs/${item.id}/retry`, {
        request_id: crypto.randomUUID(),
      });
      await this.loadActivity();
      this.notice = 'Fresh role check queued.';
    });
  }
  reviewWalletRestriction(wallet: any) {
    if (this.busy || !this.member) return;
    this.walletRestriction = {
      address: wallet.address,
      blocked: !wallet.blocked,
      reason: '',
      request_id: crypto.randomUUID(),
      server: this.selected,
      memberId: this.member.id,
    };
  }
  changeWalletBlockReason() {
    if (this.walletRestriction)
      this.walletRestriction.request_id = crypto.randomUUID();
  }
  async saveWalletRestriction() {
    const draft = this.walletRestriction;
    if (!draft || this.busy) return;
    await this.run(async () => {
      if (this.selected !== draft.server || this.member?.id !== draft.memberId)
        throw new Error(
          'Look up this member again before updating wallet restrictions.',
        );
      const result = await this.api(
        `/servers/${draft.server}/members/${draft.memberId}/wallet-block`,
        {
          address: draft.address,
          blocked: draft.blocked,
          reason: draft.reason.trim(),
          request_id: draft.request_id,
        },
      );
      for (const wallet of [
        ...this.member.wallets,
        ...(this.member.removed_wallets || []),
      ])
        if (wallet.address === result.address) {
          wallet.blocked = result.blocked;
          wallet.block = result.blocked
            ? { reason: draft.reason.trim() || null }
            : null;
        }
      this.walletRestriction = null;
      this.notice = `Wallet ${result.blocked ? 'blocked' : 'unblocked'} in ${this.data.server.name}.${result.jobs ? ' Earned-role checks queued. See Audit Log → Role checks.' : ''}`;
    });
  }
  async fix() {
    if (
      !confirm(
        'Recheck and repair this member’s previously earned roles? Never-earned roles require the member to verify.',
      )
    )
      return;
    await this.run(async () => {
      await this.api(
        `/servers/${this.selected}/members/${this.member.id}/fix`,
        { request_id: crypto.randomUUID() },
      );
      this.notice =
        'Member role repair queued. See Audit Log → Role checks for its result.';
    });
  }
}
