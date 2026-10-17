import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin',
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit, OnDestroy {
  user: any = null;
  csrf = '';
  configured = true;
  ready = false;
  busy = false;
  error = '';
  notice = '';
  servers: any[] = [];
  invite = '';
  selected = '';
  data: any = null;
  tab = 'rules';
  filter = '';
  query = '';
  editor: any = null;
  inputs: Record<string, string> = {};
  draft: any = {};
  mode = 'collection';
  review = false;
  activity: any = { items: [], page: 1, pages: 1, total: 0 };
  activityKind = 'roles';
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
  messageChannel = '';
  messageAction = 'refresh';
  undo: any = null;
  undoLabel = 'Undo';
  async ngOnInit() {
    try {
      const session = await this.api('/session');
      this.user = session.user;
      this.csrf = session.csrf;
      this.configured = session.configured;
      if (new URLSearchParams(location.search).get('sign_in') === 'failed')
        this.error =
          'Discord sign-in could not be completed. Please try again.';
      if (this.user) {
        const result = await this.api('/servers');
        this.servers = result.servers;
        this.invite = result.invite;
        const remembered = sessionStorage.getItem('bouncer-admin-server');
        const first =
          this.servers.find((s) => s.id === remembered && s.installed) ||
          this.servers.find((s) => s.installed);
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
      if (result.status === 401) this.user = null;
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
      this.resetMemberSearch();
      this.memberQuery = '';
      this.groupFilter = '';
      this.selected = id;
      this.data = null;
      this.editor = null;
      this.member = null;
      this.undo = null;
      this.tab = 'rules';
      this.data = await this.api('/servers/' + id);
      this.rebuildGroups();
      this.messageChannel =
        this.data.settings.verification_channel_id ||
        this.data.channels[0]?.id ||
        '';
      sessionStorage.setItem('bouncer-admin-server', id);
    });
  }
  async reload() {
    this.data = await this.api('/servers/' + this.selected);
    this.rebuildGroups();
  }
  async logout() {
    await this.run(async () => {
      await this.api('/auth/logout', {});
      this.user = null;
      this.data = null;
      this.servers = [];
      this.csrf = '';
    });
  }
  get rules() {
    if (this.activeGroup) return this.activeGroup.rules;
    return (this.data?.rules || []).filter(
      (r: any) =>
        (this.groupFilter !== 'combined' || !!this.groupFor(r)) &&
        (!this.filter || r.asset_type === this.filter) &&
        (!this.query ||
          this.describe(r).toLowerCase().includes(this.query.toLowerCase()) ||
          r.role_name?.toLowerCase().includes(this.query.toLowerCase())),
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
    this.closeEditor();
    this.groupFilter = key;
  }
  jumpToRule(event: Event, id: number) {
    event.preventDefault();
    this.closeEditor();
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
      this.editor = null;
      this.review = false;
    }
  }
  create() {
    this.suggestions = {};
    this.editor = { new: true };
    this.review = false;
    this.mode = 'collection';
    this.draft = {
      asset_type: 'ordinal',
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
    this.tab = tab;
    this.error = '';
    this.notice = '';
    if (tab === 'audit') await this.run(() => this.loadActivity(1));
  }
  async pageActivity(direction: number) {
    await this.run(() => this.loadActivity(this.activity.page + direction));
  }
  async loadActivity(page = this.activity.page) {
    this.activity = await this.api(
      `/servers/${this.selected}/activity?kind=${this.activityKind}&page=${page}`,
    );
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
    const identifier = check
      ? this.member?.id
      : this.memberSelection?.id || this.memberQuery.trim();
    if (!identifier) return;
    this.memberMatchesOpen = false;
    this.memberSearchRequest?.abort();
    clearTimeout(this.memberSearchTimer);
    this.memberSearchEpoch++;
    this.memberSearching = false;
    await this.run(async () => {
      const path = `/servers/${this.selected}/members/${encodeURIComponent(identifier)}`;
      this.member = await this.api(
        check ? path + '/check' : path,
        check ? { request_id: crypto.randomUUID() } : undefined,
      );
      this.memberId = this.member.id;
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
