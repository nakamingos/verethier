import { Component, Input, OnChanges, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PixelSelectComponent } from '../pixel-select/pixel-select.component';
import { PortalSessionService } from '../../services/portal-session.service';
@Component({
  selector:'app-bulk-role-checks',imports:[CommonModule,FormsModule,PixelSelectComponent],
  template:`<section class="panel">
    <h2>Bulk role check</h2>
    <p>Check current holdings using saved proven wallets and grant newly eligible roles. Members do not need to sign again. Grant-only checks leave existing roles as-is.</p>
    <form (ngSubmit)="preview()">
      <div class="toolbar">
        <label>Audience:<app-pixel-select name="audience" label="Bulk audience" [options]="audiences" [(ngModel)]="filters.audience" (ngModelChange)="changed()" [disabled]="busy" /></label>
        @if(filters.audience==='role') { <label>Current role:<app-pixel-select name="source" label="Audience role" [options]="roleChoices" [(ngModel)]="filters.source_role_id" (ngModelChange)="changed()" [disabled]="busy" /></label> }
        <label>Check against:<app-pixel-select name="rule" label="Bulk rule" [options]="ruleChoices" [(ngModel)]="filters.rule_id" (ngModelChange)="changed()" [disabled]="busy" /></label>
        <label>Action:<app-pixel-select name="mode" label="Bulk action" [options]="modes" [(ngModel)]="filters.mode" (ngModelChange)="changed()" [disabled]="busy" /></label>
        <button type="submit" [disabled]="busy || (filters.audience==='role' && !filters.source_role_id)">Preview audience</button>
      </div>
    </form>
    <p class="muted">Verified members means current server members with a saved wallet and verification or earned-role history in this server. A role audience includes current holders; members without saved wallets are reported and skipped. One rule checks that rule’s requirements. All server rules includes combined groups and alternative ways to earn roles.</p>
    @if(error) { <p class="error" role="alert">{{error}}</p> }
  </section>
  @if(view; as v) {
    <section class="panel" aria-label="Bulk check results">
      <div class="section-heading"><h2>{{v.job.labels.audience}} → {{v.job.labels.target}}</h2><span class="badge">{{v.job.status}}</span></div>
      <p>{{v.job.mode==='grant'?'Grant eligible roles only':'Grant eligible roles and remove proven failures'}} · {{v.summary.total}} members</p>
      @if(v.job.status==='preview') {
        <p>Audience preview only; holdings have not been checked yet. Run checks fresh ownership before granting roles. This preview expires {{v.job.preview_expires_at | date:'short'}}.</p>
        @if(v.job.mode==='reconcile') { <p>Role removals are enabled. Provider uncertainty retains existing roles, and alternative qualifying rules protect the role.</p> }
      } @else {
        <p role="status">{{v.summary.processed}} / {{v.summary.total}} members checked · {{v.summary.granted}} roles granted · {{v.summary.removed}} removed · {{v.summary.already_held}} already held</p>
        <p class="muted">{{v.summary.ineligible}} ineligible · {{v.summary.no_wallet}} without saved wallets · {{v.summary.unavailable}} unavailable · {{v.summary.excluded}} excluded by role actions · {{v.summary.left_audience}} left audience · {{v.summary.errors}} need retry</p>
      }
      @if(['pending','running'].includes(v.job.status) && v.summary.unavailable>0) {
        <p class="muted" role="status">Provider retries are in progress. The checked count advances when a member finishes or reaches the retry limit; individual attempts can take several minutes.</p>
      }
      @if(v.job.message) { <p role="status">{{v.job.message}}</p> }
      <div class="actions">
        @if(v.job.status==='preview') { <button (click)="act('start')" [disabled]="busy || !v.summary.total">Run bulk check</button> }
        @if(v.job.started_by && ['cancelled','failed'].includes(v.job.status) && v.summary.processed < v.summary.total) { <button (click)="act('resume')" [disabled]="busy">Resume check</button> }
        @if(v.summary.errors>0 && ['failed','cancelled','pending','running'].includes(v.job.status)) { <button (click)="act('retry')" [disabled]="busy">{{v.job.status==='cancelled' && v.summary.processed < v.summary.total ? 'Resume and retry failed' : 'Retry failed'}}</button> }
        @if(['preview','pending','running','failed'].includes(v.job.status)) { <button (click)="act('cancel')" [disabled]="busy">Cancel remaining checks</button> }
        <button (click)="refresh()" [disabled]="busy">Refresh results</button>
      </div>
      <p class="muted">Cancelling keeps completed results and role changes. Resume continues unfinished members. Retry failed rechecks failed members; on a cancelled check, it also resumes unfinished work.</p>
      <table class="history-table" aria-label="Bulk role members">
        <thead><tr><th scope="col">Member</th><th scope="col">Result</th><th scope="col">Updated</th></tr></thead>
        <tbody>@for(member of v.members; track member.user_id) {
          <tr><td data-label="Member">{{member.member_name}}<p class="history-note">{{member.user_id}}</p></td>
          <td data-label="Result"><span class="badge">{{member.status}}</span>@for(line of describe(member.result,v.job.labels.roles); track $index) { <p class="history-note">{{line}}</p> }</td>
          <td data-label="Updated">{{member.updated_at | date:'short'}}</td></tr>
        }</tbody>
      </table>
      <div class="pagination"><span>Page {{v.page}} / {{pages}}</span><div class="pagination-actions">
        <button (click)="refresh(v.page-1)" [disabled]="busy || v.page<=1">← Previous</button>
        <button (click)="refresh(v.page+1)" [disabled]="busy || v.page>=pages">Next →</button>
      </div></div>
    </section>
  }
  <section class="panel"><div class="section-heading"><h2>Recent bulk checks</h2><button (click)="history()" [disabled]="busy">Refresh history</button></div>
    <p class="muted">Delete removes a saved check and its member results. Granted roles stay in place. Cancel active checks before deleting them.</p>
    @for(job of jobs;track job.id) {
      <div class="actions" role="group" [attr.aria-label]="'Recent bulk check: '+job.labels.audience+' → '+job.labels.target">
        <button (click)="open(job.id)" [disabled]="busy">{{job.labels.audience}} → {{job.labels.target}} · {{job.status}}</button>
        <time>{{job.created_at | date:'short'}}</time>
        <button (click)="remove(job)" [disabled]="busy || !canDelete(job)" [title]="canDelete(job)?'Delete this saved check':'Cancel this check before deleting it'">Delete</button>
      </div>
    }
    @if(!jobs.length) { <p>No recent bulk checks.</p> }
  </section>`
})
export class BulkRoleChecksComponent implements OnChanges,OnDestroy {
  @Input() server=''; @Input() rules:any[]=[]; @Input() roles:any[]=[];
  private session=inject(PortalSessionService);
  private actionRequest?:{job:string;action:string;id:string};
  private generation=0; private historyEpoch=0; private timer?:ReturnType<typeof setTimeout>;
  busy=false;error='';view:any=null;jobs:any[]=[];
  filters:any={audience:'verified',source_role_id:null,rule_id:null,mode:'grant'};
  audiences=[{value:'verified',label:'All verified members'},{value:'role',label:'Current role holders'}];
  modes=[{value:'grant',label:'Grant eligible roles only'},{value:'reconcile',label:'Grant and remove proven failures'}];
  get roleChoices(){return [{value:null,label:'Choose a role'},...this.roles.map(r=>({value:r.id,label:r.name}))];}
  get ruleChoices(){return [{value:null,label:'All server rules'},...this.rules.map(r=>({value:r.id,label:`Rule ${r.id} · ${r.role_name}`}))];}
  get pages(){return Math.max(1,Math.ceil((this.view?.summary.total || 0)/20));}
  ngOnChanges(){this.actionRequest=undefined;this.generation++;clearTimeout(this.timer);this.view=null;this.jobs=[];this.error='';this.busy=false;this.filters={audience:'verified',source_role_id:null,rule_id:null,mode:'grant'};void this.history();}
  ngOnDestroy(){this.generation++;clearTimeout(this.timer);}
  changed(){if(this.view?.job.status==='preview') this.view=null;}
  private async request(path='',body?:any){
    const response=await fetch(`/api/portal/servers/${this.server}/bulk-role-checks${path}`,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.session.csrf},body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok) {if(response.status===401)this.session.clear();throw new Error(typeof data.message==='string'?data.message:'Could not load this bulk check.');}return data;
  }
  private async perform(work:()=>Promise<void>){if(this.busy)return;const generation=this.generation;this.busy=true;this.error='';try{await work();}catch(e){if(generation===this.generation)this.error=(e as Error).message;}finally{if(generation===this.generation)this.busy=false;}}
  async history(){const generation=this.generation,epoch=++this.historyEpoch;try{const jobs=await this.request();if(generation===this.generation && epoch===this.historyEpoch)this.jobs=jobs;}catch(e){if(generation===this.generation && epoch===this.historyEpoch)this.error=(e as Error).message;}}
  canDelete(job:any){return ['preview','completed','failed','stale','cancelled'].includes(job.status);}
  async remove(job:any){
    if(this.busy || !this.canDelete(job) || !confirm('Delete this saved bulk check and its member results? Roles already granted or removed will stay as they are.'))return;
    await this.perform(async()=>{
      const generation=this.generation;
      await this.request('/'+job.id,{action:'delete',request_id:crypto.randomUUID()});
      if(generation!==this.generation)return;
      this.historyEpoch++;this.jobs=this.jobs.filter(entry=>entry.id!==job.id);
      if(this.view?.job.id===job.id){clearTimeout(this.timer);this.view=null;this.actionRequest=undefined;}
      await this.history();
    });
  }
  async preview(){await this.perform(async()=>{const generation=this.generation;const view=await this.request('/preview',{audience:this.filters.audience,...(this.filters.audience==='role'?{source_role_id:this.filters.source_role_id}:{}),...(this.filters.rule_id?{rule_id:Number(this.filters.rule_id)}:{}),mode:this.filters.mode,request_id:crypto.randomUUID()});if(generation===this.generation){this.view=view;await this.history();}});}
  async open(id:string){await this.perform(async()=>{const generation=this.generation;const view=await this.request('/'+id);if(generation===this.generation){this.view=view;this.poll();}});}
  async refresh(page=this.view?.page || 1){if(!this.view)return;const id=this.view.job.id,generation=this.generation;try{const view=await this.request(`/${id}?page=${page}`);if(generation===this.generation && this.view?.job.id===id){this.view=view;this.poll();}}catch(e){if(generation===this.generation && this.view?.job.id===id)this.error=(e as Error).message;}}
  async act(action:string) {
    if(!this.view)return;
    if(['start','resume','retry'].includes(action) && this.view.job.mode==='reconcile'
      && !confirm('Run with role removals enabled? Only proven failures are removed; provider uncertainty retains roles.'))return;
    await this.perform(async()=>{
      const id=this.view.job.id,generation=this.generation;
      let receipt=this.actionRequest;
      if(!receipt || receipt.job!==id || receipt.action!==action) {
        receipt={job:id,action,id:crypto.randomUUID()};this.actionRequest=receipt;
      }
      const view=await this.request('/'+id,{action,request_id:receipt.id});
      if(generation===this.generation && this.view?.job.id===id) {
        this.actionRequest=undefined;this.view=view;this.poll();await this.history();
      }
    });
  }
  private poll(){clearTimeout(this.timer);if(['pending','running'].includes(this.view?.job.status))this.timer=setTimeout(()=>void this.refresh(),3000);}
  describe(result:any,roles:any):string[]{
    if(result?.skip)return [result.skip==='no_wallet'?'No saved wallet':'No longer in this audience'];
    const labels:Record<string,string>={granted:'Granted',removed:'Removed',already_held:'Already held',ineligible:'Ineligible',unavailable:'Unavailable',excluded:'Excluded by role actions'};
    const lines=Object.entries(labels).flatMap(([key,label])=>result?.[key]?.length
      ? [`${label}: ${result[key].map((id:string)=>roles?.[id] || id).join(', ')}`] : []);
    if(result?.errors?.length)lines.push('Check unavailable; retry needed');
    return lines.length?lines:['Waiting for check'];
  }
}
