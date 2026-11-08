import { BulkRoleService, bulkRulesVersion } from '../src/portal/bulk-role.service';
import { BulkRoleController } from '../src/portal/bulk-role.controller';
const server='111111111111111111', user='222222222222222222', role='333333333333333333', source='444444444444444444';
const job={id:'00000000-0000-4000-8000-000000000001',server_id:server,rule_id:204,audience:'role',source_role_id:source,mode:'grant'};
function fixture() {
 const rule:any={id:204,server_id:server,channel_id:'channel',role_id:role,role_name:'Comrade',asset_type:'ordinal',slug:'pizza-comrades',min_items:1};
 const member:any={id:user,user:{bot:false},displayName:'Member',roles:{cache:new Map([[source,{}]])}};
 const guild:any={id:server,name:'Server',members:{fetch:jest.fn().mockResolvedValue(member)}};
 const query:any={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),maybeSingle:jest.fn().mockResolvedValue({data:null,error:null})};
 const db:any={from:jest.fn(()=>query)};
 const rules:any={getRoleMappings:jest.fn().mockResolvedValue([rule]),trackRoleAssignment:jest.fn().mockResolvedValue({}),getEarnedRoleAssignments:jest.fn().mockResolvedValue([{id:'assignment'}]),updateRoleAssignmentStatus:jest.fn()};
 const discord:any={getBotClient:()=>({guilds:{fetch:async()=>guild}})};
 const roles:any={addUserRoleDynamic:jest.fn().mockResolvedValue(true),removeUserRole:jest.fn().mockResolvedValue(true)};
 const passed={status:'passed',isValid:true,ruleId:204,results:[{isValid:true,ruleId:204}]};
 const engine:any={verifyUser:jest.fn().mockResolvedValue(passed),evaluateRole:jest.fn().mockResolvedValue(passed)};
 const blocks:any={allowedAddresses:jest.fn().mockResolvedValue(['wallet'])},actions:any={blockedBy:jest.fn().mockResolvedValue(false)},privacy:any={assertActive:jest.fn()};
 const service:any=new BulkRoleService(db,rules,discord,roles,engine,blocks,actions,privacy);
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
