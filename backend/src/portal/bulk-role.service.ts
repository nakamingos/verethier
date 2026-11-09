import { BulkRoleReadCache, bulkRoleChecks } from './bulk-role-read-cache';
import { expandRuleRoles } from '@/utils/rule-roles.util';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { Guild, PermissionFlagsBits } from 'discord.js';
import { createHash, randomUUID } from 'crypto';
import { EnvironmentConfig } from '@/config/environment.config';
import { DbService } from '@/services/db.service';
import { DiscordService } from '@/services/discord.service';
import { DiscordVerificationService } from '@/services/discord-verification.service';
import { VerificationEngine } from '@/services/verification-engine.service';
import { WalletBlockService } from '@/services/wallet-block.service';
import { RoleActionService } from '@/services/role-action.service';
import { NftCheckContext } from '@/services/nft-ownership.service';
import { ruleEditVersion } from '@/utils/rule-edit.util';
import { PrivacyService } from './privacy.service';
import { BulkRolePreviewDto } from './bulk-role.dto';

class BulkStopped extends Error {}
export function bulkRunKey(job: any): string {
  const action = [...(job.actions || [])].reverse().find(entry =>
    ['start', 'resume'].includes(entry.action) || entry.action === 'retry' && entry.new_run !== false);
  return action?.request || job.id;
}
const uuid = (id: string) => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id);
export function bulkRulesVersion(rules: any[]) {
  return createHash('sha256').update(JSON.stringify([...rules].sort((a,b)=>a.id-b.id).map(r=>[r.id,ruleEditVersion(r)]))).digest('hex');
}
@Injectable()
export class BulkRoleService {
  private readonly active = new Set<Promise<void>>();
  private idleUntil = 0;
  private readonly reads = new BulkRoleReadCache();
  private readonly states = new Map<string,{expires:number;value:Promise<any>}>();
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly rules: DbService,
    private readonly discord: DiscordService,
    private readonly roles: DiscordVerificationService,
    private readonly engine: VerificationEngine,
    private readonly blocks: WalletBlockService,
    private readonly roleActions: RoleActionService,
    private readonly privacy: PrivacyService,
  ) {}
  private checked(result: any) {
    if (result.error) throw new Error('Bulk role storage unavailable');
    return result.data;
  }
  private async rows(table: string, select: string, apply: (query: any)=>any) {
    const all: any[] = [];
    for(let offset=0;;offset+=1000) {
      const rows=this.checked(await apply(this.db.from(table).select(select)).order('user_id').range(offset,offset+999));
      all.push(...rows); if(rows.length<1000) return all;
    }
  }
  async preview(guild: Guild, actor: string, input: BulkRolePreviewDto) {
    if(input.audience==='role' && !input.source_role_id) throw new BadRequestException('Choose an audience role.');
    const rules=await this.rules.getRoleMappings(guild.id);
    const selected=expandRuleRoles(input.rule_id ? rules.filter(r=>r.id===input.rule_id) : rules);
    if(!selected.length) throw new BadRequestException('Choose an existing rule in this server.');
    await guild.members.fetchMe();
    await guild.roles.fetch();
    const source=input.audience==='role' ? guild.roles.cache.get(input.source_role_id) : null;
    if(input.audience==='role' && (!source || source.id===guild.id)) throw new BadRequestException('Choose an existing audience role.');
    for(const r of selected) {
      const role=guild.roles.cache.get(r.role_id);
      if(!role?.editable || role.managed || role.id===guild.id) throw new BadRequestException('Bouncer must be above every target role and able to manage it.');
    }
    let verified: Set<string> | null=null;
    if(input.audience==='verified') {
      const [earned, proofs, wallets]=await Promise.all([
        this.rows('verifier_user_roles','user_id',q=>q.eq('server_id',guild.id)),
        this.rows('verifier_member_actions','user_id',q=>q.eq('server_id',guild.id).eq('kind','wallet_verify')),
        this.rows('user_wallets','user_id',q=>q),
      ]);
      const saved=new Set(wallets.map(w=>w.user_id));
      verified=new Set([...earned,...proofs].map(r=>r.user_id).filter(id=>saved.has(id)));
    }
    const members: any[]=[]; let after: string | undefined;
    for(;;) {
      const page=await guild.members.list({limit:1000,...(after?{after}:{})});
      for(const member of page.values()) {
        if(member.user.bot || (source ? !member.roles.cache.has(source.id) : !verified.has(member.id))) continue;
        members.push({id:member.id,name:member.displayName || member.user.username});
        if(members.length>10000) throw new BadRequestException('This audience exceeds 10,000 members. Select a role to narrow it.');
      }
      if(page.size<1000) break;
      const next=page.lastKey(); if(!next || next===after) throw new Error('Incomplete member list'); after=next;
    }
    this.checked(await this.db.rpc('verifier_bulk_role_preview',{
      p_job:{id:input.request_id,server_id:guild.id,created_by:actor,audience:input.audience,source_role_id:source?.id || null,
        rule_id:input.rule_id || null,mode:input.mode,rules_version:bulkRulesVersion(rules),
        labels:{server:guild.name,audience:source?.name || 'Verified members in this server',target:input.rule_id?`Rule ${input.rule_id} · ${selected[0].role_name}`:'All server rules',roles:Object.fromEntries(expandRuleRoles(rules).map(r=>[r.role_id,r.role_name || r.role_id]))}},
      p_members:members,
    }));
    return this.info(guild.id,input.request_id);
  }
  async list(server: string) {
    return this.checked(await this.db.from('verifier_bulk_role_jobs').select('id,status,labels,mode,created_at,updated_at')
      .eq('server_id',server).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(20));
  }
  private async job(server: string, id: string) {
    if(!uuid(id)) throw new BadRequestException('Invalid bulk check ID.');
    const job=this.checked(await this.db.from('verifier_bulk_role_jobs').select('*').eq('server_id',server).eq('id',id).gt('expires_at',new Date().toISOString()).maybeSingle());
    if(!job) throw new NotFoundException('Bulk check not found.'); return job;
  }
  async info(server: string,id: string,page=1) {
    if(!Number.isSafeInteger(page) || page<1 || page>500) throw new BadRequestException('Invalid page.');
    const job=await this.job(server,id);
    const [summary, members]=await Promise.all([
      this.db.rpc('verifier_bulk_role_summary',{p_server:server,p_job:id}),
      this.db.from('verifier_bulk_role_members').select('user_id,member_name,status,result,updated_at').eq('job_id',id).order('user_id').range((page-1)*20,page*20-1),
    ]);
    return {job,summary:this.checked(summary),members:this.checked(members),page};
  }
  async action(server: string,id: string,actor: string,action: string,request: string) {
    if(action==='delete') {
      if(!uuid(id)) throw new BadRequestException('Invalid bulk check ID.');
      const result=await this.db.rpc('verifier_delete_bulk_role_check',{p_server:server,p_job:id});
      if(result.error?.code==='55000') throw new ConflictException('Cancel the check and wait for any member currently being processed to finish before deleting it.');
      this.checked(result);
      this.reads.clear(id);this.states.delete(id);
      return {deleted:true};
    }
    const job=await this.job(server,id);
    if(action!=='cancel' && bulkRulesVersion(await this.rules.getRoleMappings(server))!==job.rules_version)
      throw new ConflictException('Rules changed. Create a new preview.');
    const result=await this.db.rpc('verifier_bulk_role_transition',{p_job:id,p_server:server,p_actor:actor,p_action:action,p_request:request});
    if(result.error) throw new ConflictException('The check changed, expired, or has no work for this action. Refresh and try again.');
    this.reads.clear(id);this.states.delete(id);
    if(action!=='cancel'){this.idleUntil=0;this.run();}
    return this.info(server,id);
  }
  @Interval(1000)
  run() {
    if(EnvironmentConfig.IS_TEST || !this.discord.getBotClient() || Date.now()<this.idleUntil) return;
    while(this.active.size < 3) {
      const lane = this.drain().catch(() => Logger.warn('Bulk role checks are waiting for retry.'))
        .finally(() => this.active.delete(lane));
      this.active.add(lane);
    }
  }
  private async drain() {
    // Refill a worker immediately; the timer only wakes idle workers.
    for(let i=0;i<50;i++) if(!await this.workOnce()){this.idleUntil=Date.now()+5000;return;}
  }
  async workOnce(): Promise<boolean> {
    const worker = randomUUID();
    const item=this.checked(await this.db.rpc('verifier_claim_bulk_role_member',{p_worker:worker}))?.[0];
    if(!item) return false;
    const started=Date.now();
    const heartbeat=setInterval(()=>{
      void this.db.from('verifier_bulk_role_members').update({locked_until:new Date(Date.now()+900000).toISOString()})
        .eq('job_id',item.job_id).eq('user_id',item.user_id).eq('locked_by',worker).eq('status','running')
        .then(r=>{if(r.error) Logger.warn('Bulk role lease renewal unavailable.');},()=>Logger.warn('Bulk role lease renewal unavailable.'));
    },30000);
    try {
      const job=this.checked(await this.db.from('verifier_bulk_role_jobs').select('*').eq('id',item.job_id).single());
      let result:any;
      try { result=await this.checkMember(job,item); }
      catch(error) { result=error instanceof BulkStopped ? {...item.result,interrupted:true}
        : {...item.result,interrupted:false,errors:['Check unavailable; no unconfirmed failure was used to remove a role.']}; }
      result.timing={...result.timing,elapsed_ms:Date.now()-started};
      const retry=!!result.errors?.length || !!result.unavailable?.length;
      this.checked(await this.db.rpc('verifier_finish_bulk_role_member',{p_job:item.job_id,p_user:item.user_id,p_worker:worker,p_result:result,p_retry:retry}));
      Logger.log(`Bulk role member: job=${item.job_id}; elapsed_ms=${result.timing.elapsed_ms}; eligibility_work_ms=${result.timing.eligibility_work_ms || 0}; guard_work_ms=${result.timing.guard_work_ms || 0}; mutation_work_ms=${result.timing.mutation_work_ms || 0}; interrupted=${!!result.interrupted}`);
    } finally { clearInterval(heartbeat); }
    return true;
  }
  private async assertRunning(job: any) {
    let state=this.states.get(job.id);
    if(!state || state.expires<=Date.now()) {
      if(this.states.size>=50)this.states.delete(this.states.keys().next().value);
      state={expires:Date.now()+1000,value:this.job(job.server_id,job.id)};
      this.states.set(job.id,state);
      const entry=state;
      void state.value.catch(()=>{if(this.states.get(job.id)===entry)this.states.delete(job.id);});
    }
    const current=await state.value;
    if(!['pending','running'].includes(current.status) || bulkRunKey(current)!==bulkRunKey(job))
      throw new BulkStopped('Check stopped or resumed');
  }
  private async stop(job: any,status: string,message: string) {
    this.checked(await this.db.from('verifier_bulk_role_jobs').update({status,message,updated_at:new Date().toISOString()}).eq('id',job.id).in('status',['pending','running']));
  }
  private async guard(job: any,item: any,guild: Guild) {
    const [current,leaseResult,rules]=await Promise.all([
      this.job(job.server_id,job.id),
      this.db.from('verifier_bulk_role_members').select('user_id').eq('job_id',job.id).eq('user_id',item.user_id)
        .eq('locked_by',item.locked_by).eq('status','running').gt('locked_until',new Date().toISOString()).maybeSingle(),
      this.rules.getRoleMappings(job.server_id),
    ]);
    if(!['pending','running'].includes(current.status) || bulkRunKey(current)!==bulkRunKey(job)) throw new BulkStopped('Check stopped or resumed');
    if(!this.checked(leaseResult)) throw new Error('Check lease lost');
    if(bulkRulesVersion(rules)!==job.rules_version) {
      await this.stop(job,'stale','Rules changed. Create a new preview for the remaining members.'); throw new BulkStopped('Rules changed');
    }
    let actor;
    try { [actor]=await Promise.all([guild.members.fetch({user:current.started_by,force:true}),this.privacy.assertActive(item.user_id)]); }
    catch(error) {
      if(error?.code===10007) {await this.stop(job,'failed','The administrator is no longer in this server.');throw new BulkStopped('Permission changed');}
      throw error;
    }
    if(actor.id!==guild.ownerId && !actor.permissions.has(PermissionFlagsBits.Administrator)) {
      await this.stop(job,'failed','The administrator no longer has permission to run this check.'); throw new BulkStopped('Permission changed');
    }
    return rules;
  }
  private async walletSnapshot(user: string) {
    const rows=this.checked(await this.db.from('user_wallets').select('address,wallet_type,evm_chain_ids').eq('user_id',user).order('address'));
    return {rows,key:JSON.stringify(rows)};
  }
  async checkMember(job: any,item: any) {
    const memberStarted=Date.now();
    const priorChanges={granted:[...(item.result?.granted || [])],removed:[...(item.result?.removed || [])]};
    const guild=await this.discord.getBotClient()?.guilds.fetch(job.server_id);
    if(!guild) throw new Error('Server unavailable');
    let rules=await this.guard(job,item,guild);
    let member;
    try { member=await guild.members.fetch({user:item.user_id,force:true}); }
    catch(error) { if(error?.code===10007) return {...priorChanges,skip:'left_audience'}; throw error; }
    if(member.user.bot || (job.audience==='role' && !member.roles.cache.has(job.source_role_id))) return {...priorChanges,skip:'left_audience'};
    const wallets=await this.walletSnapshot(item.user_id);
    if(!wallets.rows.length) return {...priorChanges,skip:'no_wallet'};
    const addresses=wallets.rows.map(w=>w.address);
    const allowed=await this.blocks.allowedAddresses(job.server_id,addresses);
    const result:any={granted:[...(item.result?.granted || [])],removed:[...(item.result?.removed || [])],already_held:[],ineligible:[],unavailable:[],excluded:[],errors:[]};
    const targets=expandRuleRoles(job.rule_id ? rules.filter(r=>r.id===Number(job.rule_id)) : rules);
    const targetRoles=[...new Set(targets.map(r=>r.role_id))];
    const cacheKey = `${job.id}:${job.rules_version}:${bulkRunKey(job)}`;
    const initial = this.reads.member(cacheKey);
    const timing={eligibility_work_ms:0,mutation_work_ms:0,guard_work_ms:Date.now()-memberStarted,role_checks:0};
    const skip = (roleId:string) => job.mode==='grant' && member.roles.cache.has(roleId)
      && !(item.result?.granted?.includes(roleId) && item.result?.errors?.includes(roleId));
    const evaluate = async (roleId:string, context:NftCheckContext) => {
      const started=Date.now();timing.role_checks++;
      try {
        await this.assertRunning(job);
        const selected=targets.find(r=>r.role_id===roleId);
        const single=job.rule_id ? await this.engine.verifyUser(item.user_id,selected.id,addresses[0],context,selected) : null;
        let checked=single ? {status:single.status || (single.isValid?'passed':single.error?'unavailable':'failed'),results:[single]}
          : await this.engine.evaluateRole(item.user_id,job.server_id,roleId,context,rules);
        if(checked.status==='failed' && job.mode==='reconcile' && job.rule_id)
          checked=await this.engine.evaluateRole(item.user_id,job.server_id,roleId,context,rules);
        return checked;
      } finally {timing.eligibility_work_ms+=Date.now()-started;}
    };
    const checks=bulkRoleChecks(targetRoles.filter(roleId=>!skip(roleId)),async roleId=>({checked:await evaluate(roleId,initial.context),checkedAt:Date.now()}));
    try { for(const roleId of targetRoles) {
      try {
        if(skip(roleId)) {
          if(!result.granted.includes(roleId)) result.already_held.push(roleId);
          continue;
        }
        const selected=targets.find(r=>r.role_id===roleId);
        const planned=checks.results.get(roleId);
        const outcome=planned ? await planned : {value:{checked:await evaluate(roleId,initial.context),checkedAt:Date.now()},error:undefined,stopped:false};
        if(outcome.error) throw outcome.error;
        if(outcome.stopped) throw new BulkStopped('Check stopped');
        let {checked,checkedAt}=outcome.value;
        if(checked.status==='unavailable') {result.unavailable.push(roleId);continue;}
        let evidence=initial;
        const fresh=()=>evidence.isFresh() && Date.now()-checkedAt<60000;
        if(!fresh()) {
          evidence=this.reads.member(cacheKey);
          checked=await evaluate(roleId,evidence.context);checkedAt=Date.now();
          if(checked.status==='unavailable') {result.unavailable.push(roleId);continue;}
        }
        // No mutation is needed for a failed role the member does not hold.
        if(checked.status==='failed' && (job.mode==='grant' || !member.roles.cache.has(roleId))) {
          result.ineligible.push(roleId);continue;
        }
        const guardStarted=Date.now();
        try {
          const [freshRules,latest]=await Promise.all([this.guard(job,item,guild),this.walletSnapshot(item.user_id)]);
          rules=freshRules;
          const [nowAllowed,currentMember]=await Promise.all([
            this.blocks.allowedAddresses(job.server_id,latest.rows.map(w=>w.address)),
            guild.members.fetch({user:item.user_id,force:true}),
          ]);
          if(latest.key!==wallets.key || JSON.stringify(nowAllowed)!==JSON.stringify(allowed)) throw new Error('Wallet evidence changed');
          member=currentMember;
        } finally {timing.guard_work_ms+=Date.now()-guardStarted;}
        if(job.audience==='role' && !member.roles.cache.has(job.source_role_id)) {result.skip='left_audience';break;}
        if(!fresh()) throw new Error('Ownership response expired before mutation');
        const mutationStarted=Date.now();
        try {
          const held=member.roles.cache.has(roleId);
          if(checked.status==='passed') {
            // The dynamic reconciler removes excluded roles; a grants-only job must not.
            if(await this.roleActions.blockedBy(member,roleId)) {result.excluded.push(roleId);continue;}
            if(!held) {
              if(job.mode==='grant') {
                const policy=this.checked(await this.db.from('verifier_role_actions').select('remove_role_ids').eq('server_id',job.server_id).eq('trigger_role_id',roleId).maybeSingle());
                if(policy?.remove_role_ids.some(id=>member.roles.cache.has(id))) {result.excluded.push(roleId);continue;}
              }
              if(!fresh()) throw new Error('Ownership response expired before grant');
              const granted=await this.roles.addUserRoleDynamic(item.user_id,job.server_id,roleId,undefined,true);
              if(granted==='suppressed') {result.excluded.push(roleId);continue;}
              if(!granted) throw new Error('Discord grant unavailable');
              if(!result.granted.includes(roleId)) result.granted.push(roleId);
            } else if(!result.granted.includes(roleId)) result.already_held.push(roleId);
            const match=checked.results.find(r=>r.isValid);
            await this.rules.trackRoleAssignment({userId:item.user_id,serverId:job.server_id,roleId,ruleId:String(match?.ruleId || selected.id),
              userName:member.displayName,serverName:guild.name,roleName:selected.role_name || roleId,
              verificationData:{bulk_role_job_id:job.id,last_check_status:'passed',matched_rule_ids:checked.results.filter(r=>r.isValid).map(r=>r.ruleId)}});
            // A transfer during the Discord request must not strand a new grant.
            // Tracking precedes this final check so a later transfer also queues
            // the ordinary earned-role reconciliation path.
            if(!held) {
              const finalWallets=await this.walletSnapshot(item.user_id);
              const finalAllowed=await this.blocks.allowedAddresses(job.server_id,finalWallets.rows.map(w=>w.address));
              if(finalWallets.key!==wallets.key || JSON.stringify(finalAllowed)!==JSON.stringify(allowed)) {
                result.granted=result.granted.filter(id=>id!==roleId);
                if(await this.roles.removeUserRole(item.user_id,job.server_id,roleId)) {
                  for(const assignment of await this.rules.getEarnedRoleAssignments({serverId:job.server_id,userId:item.user_id,roleId})) await this.rules.updateRoleAssignmentStatus(assignment.id,'revoked');
                }
                throw new Error('Wallet evidence changed during grant');
              }
            }
          } else {
            result.ineligible.push(roleId);
            if(job.mode==='reconcile' && held) {
              if(!fresh()) throw new Error('Ownership response expired before removal');
              if(!await this.roles.removeUserRole(item.user_id,job.server_id,roleId)) throw new Error('Discord removal unavailable');
              if(!result.removed.includes(roleId)) result.removed.push(roleId);
              for(const assignment of await this.rules.getEarnedRoleAssignments({serverId:job.server_id,userId:item.user_id,roleId})) await this.rules.updateRoleAssignmentStatus(assignment.id,'revoked');
            }
          }
        } finally { timing.mutation_work_ms+=Date.now()-mutationStarted; }
      } catch (error) {
        if(error instanceof BulkStopped) {result.interrupted=true;break;}
        result.errors.push(roleId);
      }
    } } finally {checks.stop();await checks.done;}
    result.timing=timing;
    return result;
  }
  @Interval(3600000)
  async cleanup() {
    if(EnvironmentConfig.IS_TEST) return;
    const result=await this.db.from('verifier_bulk_role_jobs').delete().lt('expires_at',new Date().toISOString());
    if(result.error) Logger.warn('Expired bulk role results will be removed on the next cleanup.');
  }
}
