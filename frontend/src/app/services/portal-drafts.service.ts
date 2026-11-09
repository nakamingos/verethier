import { Injectable } from '@angular/core';

/** Unsaved rule configuration stays in memory, scoped to the signed-in account. */
@Injectable({ providedIn: 'root' })
export class PortalDraftsService {
  private account = '';
  readonly newRules = new Map<string, {draft:any; mode:string; review:boolean}>();
  readonly edits = new Map<string, {editor:any; inputs:Record<string,string>; traits:any; roles:any[]; review:boolean}>();
  readonly visible = new Map<string, string>();

  forUser(account: string) {
    if (account !== this.account) { this.clear(); this.account = account; }
    return this;
  }
  clear() {
    this.account = '';
    this.newRules.clear(); this.edits.clear(); this.visible.clear();
  }
}
