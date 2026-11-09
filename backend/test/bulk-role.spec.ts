import { BulkRoleService, bulkRulesVersion } from '../src/portal/bulk-role.service';
import { BulkRoleController } from '../src/portal/bulk-role.controller';
const server='111111111111111111', user='222222222222222222', role='333333333333333333', source='444444444444444444';
const job={id:'00000000-0000-4000-8000-000000000001',server_id:server,rule_id:204,audience:'role',source_role_id:source,mode:'grant'};
function fixture() {
 const rule:any={id:204,server_id:server,channel_id:'channel',role_id:role,role_name:'Comrade',asset_type:'ordinal',slug:'pizza-comrades',min_items:1};
 const member:any={id:user,user:{bot:false},displayName:'Member',roles:{cache:new Map([[source,{}]])}};
 const guild:any={id:server,name:'Server',members:{fetch:jest.fn().mockResolvedValue(member)}};
 const query:any={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),gt:jest.fn().mockReturnThis(),maybeSingle:jest.fn().mockResolvedValue({data:null,error:null})};
 const db:any={from:jest.fn(()=>query)};
 const rules:any={getRoleMappings:jest.fn().mockResolvedValue([rule]),trackRoleAssignment:jest.fn().mockResolvedValue({}),getEarnedRoleAssignments:jest.fn().mockResolvedValue([{id:'assignment'}]),updateRoleAssignmentStatus:jest.fn()};
 const discord:any={getBotClient:()=>({guilds:{fetch:async()=>guild}})};
 const roles:any={addUserRoleDynamic:jest.fn().mockResolvedValue(true),removeUserRole:jest.fn().mockResolvedValue(true)};
 const passed={status:'passed',isValid:true,ruleId:204,results:[{isValid:true,ruleId:204}]};
 const engine:any={verifyUser:jest.fn().mockResolvedValue(passed),evaluateRole:jest.fn().mockResolvedValue(passed)};
 const blocks:any={allowedAddresses:jest.fn().mockResolvedValue(['wallet'])},actions:any={blockedBy:jest.fn().mockResolvedValue(false)},privacy:any={assertActive:jest.fn()};
 const service:any=new BulkRoleService(db,rules,discord,roles,engine,blocks,actions,privacy);
 jest.spyOn(service,'assertRunning').mockResolvedValue(undefined);
 jest.spyOn(service,'guard').mockResolvedValue([rule]);jest.spyOn(service,'walletSnapshot').mockResolvedValue({rows:[{address:'wallet'}],key:'original'});
 return {service,rule,member,guild,db,query,rules,roles,engine,blocks,actions};
}
describe('Bulk role eligibility and grants',()=>{
 it('grants a newly eligible role and tracks it without removing source roles',async()=>{
  const f=fixture();const result=await f.service.checkMember(job,{user_id:user,result:{}});
  expect(result.granted).toEqual([role]);expect(f.engine.verifyUser).toHaveBeenCalledWith(user,204,'wallet',expect.any(Object),f.rule);expect(f.engine.evaluateRole).not.toHaveBeenCalled();expect(f.roles.addUserRoleDynamic).toHaveBeenCalledWith(user,server,role,undefined,true);
  expect(f.rules.trackRoleAssignment).toHaveBeenCalledWith(expect.objectContaining({userId:user,roleId:role,ruleId:'204'}));expect(f.roles.removeUserRole).not.toHaveBeenCalled();
 });
 it('records an already-held role without repeating the grant',async()=>{
  const f=fixture();f.member.roles.cache.set(role,{});expect((await f.service.checkMember(job,{user_id:user,result:{}})).already_held).toEqual([role]);expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();expect(f.engine.verifyUser).not.toHaveBeenCalled();
 });
 it.each(['grant','reconcile'])('retains roles during provider uncertainty in %s mode',async mode=>{
  const f=fixture();if(mode==='reconcile')f.member.roles.cache.set(role,{});f.engine.verifyUser.mockResolvedValue({status:'unavailable',results:[]});
  expect((await f.service.checkMember({...job,mode},{user_id:user,result:{}})).unavailable).toEqual([role]);expect(f.roles.removeUserRole).not.toHaveBeenCalled();
 });
 it('never removes a proven failure in grants-only mode',async()=>{
  const f=fixture();f.member.roles.cache.set(role,{});f.engine.verifyUser.mockResolvedValue({status:'failed',results:[]});await f.service.checkMember(job,{user_id:user,result:{}});expect(f.roles.removeUserRole).not.toHaveBeenCalled();
 });
 it('removes proven failures only with reconciliation selected',async()=>{
  const f=fixture();f.member.roles.cache.set(role,{});f.engine.verifyUser.mockResolvedValue({status:'failed',results:[]});f.engine.evaluateRole.mockResolvedValue({status:'failed',results:[]});
  expect((await f.service.checkMember({...job,mode:'reconcile'},{user_id:user,result:{}})).removed).toEqual([role]);expect(f.rules.updateRoleAssignmentStatus).toHaveBeenCalledWith('assignment','revoked');
 });
 it('retains alternative qualifying roles after the selected rule fails',async()=>{
  const f=fixture();f.member.roles.cache.set(role,{});f.engine.verifyUser.mockResolvedValue({status:'failed',results:[]});await f.service.checkMember({...job,mode:'reconcile'},{user_id:user,result:{}});expect(f.roles.removeUserRole).not.toHaveBeenCalled();
 });
 it('skips members who leave the audience or have no saved wallet',async()=>{
  const f=fixture();f.member.roles.cache.delete(source);expect((await f.service.checkMember(job,{user_id:user})).skip).toBe('left_audience');
  f.member.roles.cache.set(source,{});f.service.walletSnapshot.mockResolvedValue({rows:[],key:'empty'});expect((await f.service.checkMember(job,{user_id:user})).skip).toBe('no_wallet');expect(f.engine.verifyUser).not.toHaveBeenCalled();
 });
 it('refuses stale wallet links and changed restrictions before mutation',async()=>{
  const f=fixture();f.service.walletSnapshot.mockResolvedValueOnce({rows:[{address:'wallet'}],key:'original'}).mockResolvedValueOnce({rows:[{address:'wallet'}],key:'changed'});
  expect((await f.service.checkMember(job,{user_id:user,result:{}})).errors).toEqual([role]);expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
  f.service.walletSnapshot.mockResolvedValue({rows:[{address:'wallet'}],key:'original'});f.blocks.allowedAddresses.mockResolvedValueOnce(['wallet']).mockResolvedValueOnce([]);await f.service.checkMember(job,{user_id:user,result:{}});expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('does not grant excluded roles or trigger automatic removals in grants-only mode',async()=>{
  const f=fixture();f.actions.blockedBy.mockResolvedValue(true);expect((await f.service.checkMember(job,{user_id:user,result:{}})).excluded).toEqual([role]);
  f.actions.blockedBy.mockResolvedValue(false);f.query.maybeSingle.mockResolvedValue({data:{remove_role_ids:[source]},error:null});expect((await f.service.checkMember(job,{user_id:user,result:{}})).excluded).toEqual([role]);expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('preserves grants during retries and never counts a failed Discord grant',async()=>{
  const f=fixture();f.member.roles.cache.set(role,{});const result=await f.service.checkMember(job,{user_id:user,result:{granted:[role]}});expect(result.granted).toEqual([role]);expect(result.already_held).toEqual([]);
  f.member.roles.cache.delete(role);f.roles.addUserRoleDynamic.mockResolvedValue(false);expect((await f.service.checkMember(job,{user_id:user,result:{}})).errors).toEqual([role]);
 });
 it('evaluates all alternatives in all-rules mode',async()=>{
  const f=fixture();await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});expect(f.engine.evaluateRole).toHaveBeenCalled();expect(f.engine.verifyUser).not.toHaveBeenCalled();
 });
 it('checks for cancellation and rule edits again after provider responses',async()=>{
  const f=fixture();f.service.guard.mockResolvedValueOnce([f.rule]).mockRejectedValueOnce(new Error('Rules changed'));await f.service.checkMember(job,{user_id:user,result:{}});expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('detects rule edits but ignores provider snapshot refreshes',()=>{
  const f=fixture();expect(bulkRulesVersion([f.rule])).toBe(bulkRulesVersion([{...f.rule,ordinal_trait_snapshot:{updated:true}}]));expect(bulkRulesVersion([f.rule])).not.toBe(bulkRulesVersion([{...f.rule,min_items:2}]));
 });
});
describe('Bulk role authorization',()=>{
 it('requires CSRF and normal administrator access for preview and execution',async()=>{
  const auth:any={session:jest.fn().mockResolvedValue({user:{id:user}}),assertMutation:jest.fn(()=>{throw new Error('CSRF')})},portal:any={access:jest.fn()},checks:any={preview:jest.fn(),action:jest.fn()};const c=new BulkRoleController(auth,portal,checks);
  await expect(c.preview({} as any,server,{} as any)).rejects.toThrow('CSRF');await expect(c.action({} as any,server,job.id,{} as any)).rejects.toThrow('CSRF');expect(checks.action).not.toHaveBeenCalled();
  auth.assertMutation.mockImplementation(()=>{});portal.access.mockRejectedValue(new Error('Administrator required'));await expect(c.preview({} as any,server,{} as any)).rejects.toThrow('Administrator required');expect(checks.preview).not.toHaveBeenCalled();
 });
});

describe('Bulk previews and worker guards',()=>{
 it('saves a role audience without performing holdings checks or role changes',async()=>{
  const f=fixture();f.guild.members.fetchMe=jest.fn();f.guild.roles={fetch:jest.fn(),cache:new Map([[source,{id:source,name:'Pizza Comrade'}],[role,{id:role,name:'Comrade',editable:true}]])};
  f.guild.members.list=jest.fn().mockResolvedValue(new Map([[user,f.member]]));f.db.rpc=jest.fn().mockResolvedValue({data:job.id,error:null});jest.spyOn(f.service,'info').mockResolvedValue({});
  await f.service.preview(f.guild,user,{audience:'role',source_role_id:source,rule_id:204,mode:'grant',request_id:job.id});
  expect(f.db.rpc).toHaveBeenCalledWith('verifier_bulk_role_preview',expect.objectContaining({p_members:[{id:user,name:'Member'}]}));
  expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();expect(f.engine.verifyUser).not.toHaveBeenCalled();
 });
 it('rejects a rule from another server before preview creation',async()=>{
  const f=fixture();await expect(f.service.preview(f.guild,user,{audience:'role',source_role_id:source,rule_id:999,mode:'grant',request_id:job.id})).rejects.toThrow('existing rule');
 });
 it('stops cancelled jobs before checking ownership',async()=>{
  const f=fixture();f.service.guard.mockRestore();jest.spyOn(f.service,'job').mockResolvedValue({...job,status:'cancelled'});
  await expect(f.service.checkMember(job,{user_id:user})).rejects.toThrow('stopped');expect(f.engine.verifyUser).not.toHaveBeenCalled();
 });
 it('marks changed definitions stale before any mutation',async()=>{
  const f=fixture();f.service.guard.mockRestore();jest.spyOn(f.service,'job').mockResolvedValue({...job,status:'running',started_by:user});jest.spyOn(f.service,'stop').mockResolvedValue(undefined);
  f.query.maybeSingle.mockResolvedValue({data:{user_id:user},error:null});f.member.permissions={has:()=>true};
  await expect(f.service.checkMember({...job,rules_version:'old'},{user_id:user})).rejects.toThrow('Rules changed');expect(f.service.stop).toHaveBeenCalledWith(expect.anything(),'stale',expect.any(String));expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('keeps the dynamic helper from removing an excluded existing role in grant-only mode',async()=>{
  const {DiscordVerificationService}=require('../src/services/discord-verification.service');const s:any=Object.create(DiscordVerificationService.prototype);
  const member={roles:{cache:new Map([[role,{}]]),remove:jest.fn()}};
  const guild={members:{fetch:async()=>member},roles:{fetch:async()=>({id:role})}};
  s.client={guilds:{fetch:async()=>guild}};s.roleActions={blockedBy:async()=>true};
  expect(await s.addUserRoleDynamic(user,server,role,undefined,true)).toBe('suppressed');expect(member.roles.remove).not.toHaveBeenCalled();
 });
});


describe('Bulk grant recovery',()=>{
 it('retries assignment bookkeeping after an earlier successful Discord grant',async()=>{
  const f=fixture();f.member.roles.cache.set(role,{});
  await f.service.checkMember(job,{user_id:user,result:{granted:[role],errors:[role]}});
  expect(f.rules.trackRoleAssignment).toHaveBeenCalled();expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('rolls back a new grant if wallet ownership changes during the Discord request',async()=>{
  const f=fixture();f.service.walletSnapshot.mockResolvedValueOnce({rows:[{address:'wallet'}],key:'original'}).mockResolvedValueOnce({rows:[{address:'wallet'}],key:'original'}).mockResolvedValueOnce({rows:[],key:'changed'});
  const result=await f.service.checkMember(job,{user_id:user,result:{}});
  expect(result.granted).toEqual([]);expect(result.errors).toEqual([role]);expect(f.roles.removeUserRole).toHaveBeenCalledWith(user,server,role);expect(f.rules.updateRoleAssignmentStatus).toHaveBeenCalledWith('assignment','revoked');
 });
});


it('retains actual grants in the report if a member removes their wallet before retry',async()=>{
 const f=fixture();f.service.walletSnapshot.mockResolvedValue({rows:[],key:'empty'});
 const result=await f.service.checkMember(job,{user_id:user,result:{granted:[role]}});
 expect(result.skip).toBe('no_wallet');expect(result.granted).toEqual([role]);expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
});

describe('Bulk worker throughput and fresh evidence',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('runs at most twelve member readers and refills a freed reader immediately',async()=>{
  const {EnvironmentConfig}=require('../src/config/environment.config');
  jest.replaceProperty(EnvironmentConfig,'IS_TEST',false);
  const f=fixture();let active=0,max=0,next=0;const releases:Array<()=>void>=[];
  jest.spyOn(f.service,'workOnce').mockImplementation(async()=>{
   if(next++>=24)return false;
   active++;max=Math.max(max,active);
   await new Promise<void>(resolve=>releases.push(()=>{active--;resolve();}));return true;
  });
  f.service.run();f.service.run();expect(releases).toHaveLength(12);expect(max).toBe(12);
  releases[0]();await new Promise(resolve=>setImmediate(resolve));expect(releases).toHaveLength(13);
  for(let i=1;i<24;i++){releases[i]();await new Promise(resolve=>setImmediate(resolve));}
  await Promise.all([...f.service.active]);expect(max).toBe(12);
  const calls=f.service.workOnce.mock.calls.length;f.service.run();expect(f.service.workOnce).toHaveBeenCalledTimes(calls);
 });
 it('prefetches role eligibility concurrently but applies role changes one at a time in rule order',async()=>{
  const f=fixture();const rules=Array.from({length:5},(_,i)=>({...f.rule,id:204+i,role_id:role+i}));
  f.service.guard.mockResolvedValue(rules);
  let active=0,max=0;const resolve:Array<()=>void>=[];
  f.engine.evaluateRole.mockImplementation(async(_user,_server,roleId,_context,loaded)=>{
   expect(loaded).toBe(rules);active++;max=Math.max(max,active);
   await new Promise<void>(done=>resolve.push(done));active--;
   return {status:'passed',results:[{isValid:true,ruleId:rules.find(r=>r.role_id===roleId).id}]};
  });
  const changes:string[]=[];let writes=0,maxWrites=0;
  f.roles.addUserRoleDynamic.mockImplementation(async(_user,_server,roleId)=>{writes++;maxWrites=Math.max(maxWrites,writes);changes.push(roleId);await Promise.resolve();writes--;return true;});
  const done=f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  await new Promise(resolve=>setImmediate(resolve));expect(resolve).toHaveLength(3);
  resolve[1]();await new Promise(done=>setImmediate(done));expect(resolve).toHaveLength(4);expect(changes).toEqual([]);
  resolve[0]();resolve[2]();resolve[3]();await new Promise(done=>setImmediate(done));resolve[4]();
  const result=await done;expect(max).toBe(3);expect(maxWrites).toBe(1);expect(changes).toEqual(rules.map(r=>r.role_id));expect(result.granted).toEqual(changes);
 });
 it('refreshes expired shared collection evidence before a later role mutation',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture();const rules=[f.rule,{...f.rule,id:205,role_id:role+'other'}];f.service.guard.mockResolvedValue(rules);
  const read=jest.fn(async()=>({slug:'sample',items:new Map(),fetched_at:new Date().toISOString()}));
  f.engine.evaluateRole.mockImplementation(async(_user,_server,_role,context)=>{
   await context.ordinalCollectionRead('sample',read);return {status:'passed',results:[{isValid:true,ruleId:204}]};
  });
  f.roles.addUserRoleDynamic.mockImplementation(async()=>{clock+=61000;return true;});
  const result=await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(result.granted).toHaveLength(2);expect(read).toHaveBeenCalledTimes(2);expect(f.engine.evaluateRole).toHaveBeenCalledTimes(3);
 });
 it('refreshes non-collection ownership that expired while earlier role changes were being applied',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture();const rules=[f.rule,{...f.rule,id:205,role_id:role+'other'}];f.service.guard.mockResolvedValue(rules);
  f.roles.addUserRoleDynamic.mockImplementation(async()=>{clock+=61000;return true;});
  const result=await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(result.granted).toHaveLength(2);expect(f.engine.evaluateRole).toHaveBeenCalledTimes(3);
  expect(f.engine.evaluateRole.mock.calls[2][3]).not.toBe(f.engine.evaluateRole.mock.calls[0][3]);
 });
 it('does not repeat a stale ineligible result when no role mutation is needed',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture(),other=role+'other';f.service.guard.mockResolvedValue([f.rule,{...f.rule,id:205,role_id:other}]);
  f.engine.evaluateRole.mockImplementation(async(_user,_server,roleId)=>({status:roleId===role?'passed':'failed',results:[{isValid:roleId===role,ruleId:204}]}));
  f.roles.addUserRoleDynamic.mockImplementation(async()=>{clock+=61000;return true;});
  const result=await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(result.ineligible).toEqual([other]);expect(result.granted).toEqual([role]);expect(f.engine.evaluateRole).toHaveBeenCalledTimes(2);
 });
 it('still refreshes a stale failure before removing a held role',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture(),other=role+'other';f.member.roles.cache.set(other,{});f.service.guard.mockResolvedValue([f.rule,{...f.rule,id:205,role_id:other}]);
  f.engine.evaluateRole.mockImplementation(async(_user,_server,roleId)=>({status:roleId===role?'passed':'failed',results:[{isValid:roleId===role,ruleId:204}]}));
  f.roles.addUserRoleDynamic.mockImplementation(async()=>{clock+=61000;return true;});
  const result=await f.service.checkMember({...job,rule_id:null,mode:'reconcile'},{user_id:user,result:{}});
  expect(result.removed).toEqual([other]);expect(f.engine.evaluateRole).toHaveBeenCalledTimes(3);
 });
 it('does not refresh a current unrelated role because another collection expired',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture(),other=role+'other';f.service.guard.mockResolvedValue([f.rule,{...f.rule,id:205,role_id:other,asset_type:'ethscription'}]);
  let release:()=>void;const delayed=new Promise<void>(resolve=>release=resolve);
  f.engine.evaluateRole.mockImplementation(async(_user,_server,roleId,context)=>{
   if(roleId===role) await context.ordinalCollectionRead('pizza-comrades',async()=>({slug:'pizza-comrades',items:new Map(),fetched_at:new Date().toISOString()}));
   else await delayed;
   return {status:'passed',results:[{isValid:true,ruleId:204}]};
  });
  f.roles.addUserRoleDynamic.mockImplementation(async(_user,_server,roleId)=>{if(roleId===role){clock+=61000;release();}return true;});
  const result=await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(result.granted).toHaveLength(2);expect(f.engine.evaluateRole).toHaveBeenCalledTimes(2);
 });
 it('does not schedule provider checks from a cancelled or resumed run',async()=>{
  const f=fixture();f.service.assertRunning.mockRestore();
  const start={action:'start',request:'original'};const current={...job,status:'running',actions:[start,{action:'resume',request:'new-run'}]};
  jest.spyOn(f.service,'job').mockResolvedValue(current);
  const result=await f.service.checkMember({...job,actions:[start]},{user_id:user,result:{granted:[role+'old']}});
  expect(result.interrupted).toBe(true);expect(result.granted).toEqual([role+'old']);expect(result.errors).toEqual([]);
  expect(f.engine.verifyUser).not.toHaveBeenCalled();expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('requires unchanged rule definitions before resuming and allows retrying failures in a running check',async()=>{
  const f=fixture();jest.spyOn(f.service,'job').mockResolvedValue({...job,rules_version:'changed'});f.db.rpc=jest.fn();
  await expect(f.service.action(server,job.id,user,'resume','request')).rejects.toThrow('Rules changed');expect(f.db.rpc).not.toHaveBeenCalled();
  f.service.job.mockResolvedValue({...job,status:'running',rules_version:bulkRulesVersion([f.rule])});
  f.db.rpc.mockResolvedValue({data:null,error:null});jest.spyOn(f.service,'info').mockResolvedValue({});
  await f.service.action(server,job.id,user,'retry','request');expect(f.db.rpc).toHaveBeenCalledWith('verifier_bulk_role_transition',expect.objectContaining({p_action:'retry'}));
 });
});


describe('Deleting saved bulk-check reports',()=>{
 it('deletes only the scoped report without checking ownership or changing roles',async()=>{
  const f=fixture();f.db.rpc=jest.fn().mockResolvedValue({data:null,error:null});
  expect(await f.service.action(server,job.id,user,'delete',job.id)).toEqual({deleted:true});
  expect(f.db.rpc).toHaveBeenCalledWith('verifier_delete_bulk_role_check',{p_server:server,p_job:job.id});
  expect(f.rules.getRoleMappings).not.toHaveBeenCalled();expect(f.engine.verifyUser).not.toHaveBeenCalled();expect(f.roles.removeUserRole).not.toHaveBeenCalled();
 });
 it('rejects an invalid check ID before storage access',async()=>{
  const f=fixture();f.db.rpc=jest.fn();await expect(f.service.action(server,'invalid',user,'delete',job.id)).rejects.toThrow('Invalid bulk check ID');expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('explains active-job or live-lease conflicts and retains the report',async()=>{
  const f=fixture();f.db.rpc=jest.fn().mockResolvedValue({error:{code:'55000'}});
  await expect(f.service.action(server,job.id,user,'delete',job.id)).rejects.toThrow('wait for any member');
 });
 it('does not return private database errors when deleting fails',async()=>{
  const f=fixture();f.db.rpc=jest.fn().mockResolvedValue({error:{code:'08006',message:'https://private.example/secret'}});
  await expect(f.service.action(server,job.id,user,'delete',job.id)).rejects.toThrow('Bulk role storage unavailable');
 });
 it('requires CSRF and live administrator permission for deletion',async()=>{
  const auth:any={session:async()=>({user:{id:user}}),assertMutation:jest.fn(()=>{throw new Error('CSRF')})};
  const portal:any={access:jest.fn().mockRejectedValue(new Error('Administrator required'))},checks:any={action:jest.fn()};
  const c=new BulkRoleController(auth,portal,checks);
  await expect(c.action({} as any,server,job.id,{action:'delete',request_id:job.id})).rejects.toThrow('CSRF');
  auth.assertMutation.mockImplementation(()=>{});
  await expect(c.action({} as any,server,job.id,{action:'delete',request_id:job.id})).rejects.toThrow('Administrator required');
  expect(checks.action).not.toHaveBeenCalled();
 });
});


describe('Bulk member read/write pipeline',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('lets eight members read while at most three apply role changes',async()=>{
  const f=fixture();let active=0,max=0;const releases:Array<()=>void>=[];
  f.roles.addUserRoleDynamic.mockImplementation(async()=>{active++;max=Math.max(max,active);await new Promise<void>(done=>releases.push(()=>{active--;done();}));return true;});
  const work=Array.from({length:8},(_,index)=>f.service.checkMember(job,{user_id:user+index,result:{}}));
  await new Promise(done=>setImmediate(done));expect(f.engine.verifyUser).toHaveBeenCalledTimes(8);expect(releases).toHaveLength(3);
  for(let i=0;i<8;i++){releases[i]();await new Promise(done=>setImmediate(done));}
  const result=await Promise.all(work);expect(max).toBe(3);expect(result.every(r=>r.granted.length===1)).toBe(true);
 });
 it('refreshes evidence outside the mutation slots after a long mutation queue wait',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture(),held=await Promise.all(Array.from({length:3},()=>f.service.mutations.acquire()));
  const work=f.service.checkMember(job,{user_id:user,result:{}});await new Promise(done=>setImmediate(done));
  expect(f.engine.verifyUser).toHaveBeenCalledTimes(1);clock=61000;held[0]();
  const result=await work;held[1]();held[2]();
  expect(result.granted).toEqual([role]);expect(f.engine.verifyUser).toHaveBeenCalledTimes(2);
 });
 it('observes cancellation again after waiting for a mutation slot',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture();f.service.assertRunning.mockRestore();let status='running';
  jest.spyOn(f.service,'job').mockImplementation(async()=>({...job,status}));
  f.service.guard.mockImplementation(async()=>{await f.service.assertRunning(job);return [f.rule];});
  const held=await Promise.all(Array.from({length:3},()=>f.service.mutations.acquire()));
  const work=f.service.checkMember(job,{user_id:user,result:{}});await new Promise(done=>setImmediate(done));
  status='cancelled';clock=2000;held[0]();const result=await work;held[1]();held[2]();
  expect(result.interrupted).toBe(true);expect(f.roles.addUserRoleDynamic).not.toHaveBeenCalled();
 });
 it('plans one numbered inventory only when an unchecked rule needs one',async()=>{
  const f=fixture(),numberRole=role+'number',selection={...f.rule,id:205,role_id:numberRole,slug:null,inscription_criteria:{kind:'numbers',ranges:[[1,2]]}};
  f.service.guard.mockResolvedValue([f.rule,selection]);
  await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(f.engine.evaluateRole.mock.calls.every(call=>call[3].ordinalNeedsNumbers && call[3].bulkGrantOnly)).toBe(true);
  f.member.roles.cache.set(numberRole,{});f.engine.evaluateRole.mockClear();
  await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(f.engine.evaluateRole.mock.calls.every(call=>!call[3].ordinalNeedsNumbers)).toBe(true);
 });
 it('keeps fresh database proof independent of an expired Ordinals alternative',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const f=fixture(),other=role+'other';f.service.guard.mockResolvedValue([f.rule,{...f.rule,id:205,role_id:other},
   {...f.rule,id:206,role_id:other,asset_type:'ethscription',slug:'nakamingos'}]);
  let release:()=>void;const delayed=new Promise<void>(done=>release=done);
  f.engine.evaluateRole.mockImplementation(async(_user,_server,roleId,context)=>{
   if(roleId===role){await context.ordinalCollectionRead('pizza-comrades',async()=>({slug:'pizza-comrades',items:new Map(),fetched_at:new Date().toISOString()}));return {status:'passed',results:[{isValid:true,ruleId:204}]};}
   await delayed;return {status:'passed',results:[{isValid:true,ruleId:206,rule:{asset_type:'ethscription',slug:'nakamingos'}}]};
  });
  f.roles.addUserRoleDynamic.mockImplementation(async(_user,_server,roleId)=>{if(roleId===role){clock=61000;release();}return true;});
  const result=await f.service.checkMember({...job,rule_id:null},{user_id:user,result:{}});
  expect(result.granted).toHaveLength(2);expect(f.engine.evaluateRole).toHaveBeenCalledTimes(2);
 });
 it('does not force an unrelated numeric alternative into an exact selected-rule check',async()=>{
  const f=fixture();f.service.guard.mockResolvedValue([f.rule,{...f.rule,id:205,slug:null,inscription_criteria:{kind:'numbers',ranges:[[1,2]]}}]);
  await f.service.checkMember(job,{user_id:user,result:{}});
  expect(f.engine.verifyUser.mock.calls[0][3].ordinalNeedsNumbers).toBe(false);
 });
});
