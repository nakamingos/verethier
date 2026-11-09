import { VerificationEngine } from '../src/services/verification-engine.service';
import { PortalService, portalRule } from '../src/portal/portal.service';
import { RuleEditService } from '../src/services/rule-edit.service';
import { ruleEditVersion } from '../src/utils/rule-edit.util';
import { expandRuleRoles } from '../src/utils/rule-roles.util';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { Collection } from 'discord.js';

const primary = '111111111111111111', extra = '222222222222222222', third = '333333333333333333';
const rule: any = { id: 204, server_id: 'server', channel_id: 'channel', role_id: primary, role_name: 'Primary',
  asset_type: 'ordinal', min_items: 1, slug: null, inscription_criteria: {kind:'numbers',ranges:[[1,10],[20,20]]},
  additional_roles: [{id:extra,name:'Extra'}] };

describe('Shared requirements with independent role outputs', () => {
  let rules: any[], db: any, ownership: any, engine: VerificationEngine;
  beforeEach(() => {
    rules = [structuredClone(rule)];
    db = {getRuleById: jest.fn(async id => rules.find(r=>String(r.id)===String(id))), getRoleMappings: jest.fn(async()=>rules)};
    ownership = {count: jest.fn().mockResolvedValue(1n)};
    engine = new VerificationEngine(db,ownership,{getUserAddresses:async()=>['wallet']} as any,{allowedAddresses:async(_s,w)=>w} as any);
  });
  it('returns every output with the same rule ID and criteria without mutating the rule', async () => {
    const before=JSON.stringify(rules);
    const result=await engine.verifyUserBulk('member',[204],'wallet',rules);
    expect(result.validRules.map(r=>r.role_id)).toEqual([primary,extra]);
    expect(result.results.map(r=>r.ruleId)).toEqual([204,204]);
    expect(ownership.count.mock.calls.every(([r])=>JSON.stringify(r.inscription_criteria)===JSON.stringify(rule.inscription_criteria))).toBe(true);
    expect(JSON.stringify(rules)).toBe(before);
    expect(ownership.count).toHaveBeenCalledTimes(1);
  });
  it('checks additional roles on scheduled reconciliation and stops managing removed outputs', async () => {
    expect((await engine.evaluateRole('member','server',extra)).status).toBe('passed');
    expect((await engine.evaluateRole('member','server',extra)).results.map(r=>r.rule.role_id)).toEqual([extra]);
    rules[0].additional_roles=[];
    expect((await engine.evaluateRole('member','server',extra)).status).toBe('failed');
    rules.push({...rule,id:205,role_id:extra,additional_roles:[]});
    expect((await engine.evaluateRole('member','server',extra)).status).toBe('passed');
  });
  it('retains uncertainty for an unavailable provider on every output', async () => {
    ownership.count.mockRejectedValue(new Error('Provider unavailable'));
    const result=await engine.verifyUserBulk('member',[204],'wallet',rules);
    expect(result.validRules).toEqual([]); expect(result.invalidRules).toEqual([]);
    expect(result.results.map(r=>r.status)).toEqual(['unavailable','unavailable']);
  });
  it('does not let a combined threshold for one output qualify another output', async () => {
    rules=[{...rule,inscription_criteria:null,slug:'a',min_items:2},
      {...rule,id:205,inscription_criteria:null,slug:'b',min_items:2,additional_roles:[]}];
    ownership.count.mockResolvedValue(1n);
    ownership.matchingAssets=jest.fn(async r=>new Map([[r.slug,1n]]));
    const result=await engine.verifyUserBulk('member',[204,205],'wallet',rules);
    expect(result.results.filter(r=>r.rule.role_id===primary).every(r=>r.isValid)).toBe(true);
    expect(result.results.filter(r=>r.rule.role_id===extra).every(r=>!r.isValid)).toBe(true);
  });
  it('guards role membership changes while ignoring renamed display labels',()=>{
    expect(ruleEditVersion({...rule,additional_roles:[{id:extra,name:'Renamed'}]})).toBe(ruleEditVersion(rule));
    expect(ruleEditVersion({...rule,additional_roles:[]})).not.toBe(ruleEditVersion(rule));
    const {additional_roles, ...legacy} = rule;
    expect(ruleEditVersion({...legacy,additional_roles:[]})).toBe(ruleEditVersion(legacy));
    expect(expandRuleRoles([rule]).map(r=>r.id)).toEqual([204,204]);
  });
  it('rejects identical requirements for an overlapping additional output',()=>{
    const editor:any=Object.create(RuleEditService.prototype);
    const candidate={...rule,id:205,role_id:extra,additional_roles:[]};
    expect(editor.duplicates(candidate,[rule]).exact).toBe(rule);
    expect(editor.duplicates({...candidate,role_id:third},[rule]).exact).toBeUndefined();
  });
  it('freshly grants a newly attached output to the previous earned audience',async()=>{
    db.getRuleForServer=jest.fn().mockResolvedValue(rule);
    db.getEarnedRoleAssignments=jest.fn().mockResolvedValue([]);
    db.trackRoleAssignment=jest.fn();
    const discord:any={addUserRoleDynamic:jest.fn().mockResolvedValue(true)};
    const service=new DynamicRoleService(db,engine,discord);
    expect(await service.reverifyRoleChangeInServer('server',extra,'204',['member'])).toEqual({verified:1,revoked:0,errors:0});
    expect(discord.addUserRoleDynamic).toHaveBeenCalledWith('member','server',extra,expect.any(Map));
    expect(db.trackRoleAssignment).toHaveBeenCalledWith(expect.objectContaining({roleId:extra,ruleId:'204'}));
  });
});

describe('Independent portal duplicates and role selection',()=>{
  let service:any, source:any, mutate:jest.Mock, guild:any;
  beforeEach(()=>{
    source=structuredClone(rule); service=Object.create(PortalService.prototype);
    guild={id:'server',roles:{fetch:jest.fn(),cache:new Collection([
      [primary,{id:primary,name:'Primary',editable:true}], [extra,{id:extra,name:'Extra',editable:true}],
      [third,{id:third,name:'New target',editable:true}]
    ]),create:jest.fn()}};
    service.access=jest.fn().mockResolvedValue(guild);service.replay=jest.fn().mockResolvedValue(null);
    service.rules={getRuleForServer:async()=>source,getRoleMappings:async()=>[source]};
    service.edits=Object.create(RuleEditService.prototype);
    mutate=jest.fn(async(_s,_v,_r,before,after)=>({before,after}));service.mutate=mutate;
  });
  const session:any={user:{id:'admin'}};
  const input=()=>({version:ruleEditVersion(rule),inputs:Object.fromEntries(portalRule(rule).fields.map(f=>[f.key,f.value])),role_id:third,request_id:'request'});
  it('copies full ranges into a new rule without copying output roles or changing the source',async()=>{
    const before=JSON.stringify(source);
    const result=await service.duplicate(session,'server','204',input());
    expect(result.before).toBeNull();expect(result.after.id).toBeUndefined();
    expect(result.after.inscription_criteria).toEqual(rule.inscription_criteria);
    expect(result.after.role_id).toBe(third);expect(result.after.additional_roles).toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('rejects stale duplicate drafts and overlapping exact duplicates',async()=>{
    await expect(service.duplicate(session,'server','204',{...input(),version:'stale'})).rejects.toThrow('changed');
    await expect(service.duplicate(session,'server','204',{...input(),role_id:extra})).rejects.toThrow('already exists');
    expect(mutate).not.toHaveBeenCalled();
  });
  it('checks access before reading or writing a duplicate',async()=>{
    service.access.mockRejectedValue(new Error('Forbidden'));
    await expect(service.duplicate(session,'server','204',input())).rejects.toThrow('Forbidden');
    expect(mutate).not.toHaveBeenCalled();
  });
  it('rejects duplicate output roles and unmanageable extra roles',async()=>{
    await expect(service.additionalRoles(guild,primary,[{id:primary}],'admin')).rejects.toThrow('only once');
    guild.roles.cache.get(extra).editable=false;
    await expect(service.additionalRoles(guild,primary,[{id:extra}],'admin')).rejects.toThrow('above');
  });
  it('adds and removes outputs through the normal guarded edit',async()=>{
    const result=await service.edit(session,'server','204',{...input(),role_id:primary,additional_roles:[{id:third}]});
    expect(result.after.additional_roles).toEqual([{id:third,name:'New target'}]);
    expect(result.before.additional_roles).toEqual([{id:extra,name:'Extra'}]);
  });
  it('replays a completed duplicate without another role or database mutation',async()=>{
    service.replay.mockResolvedValue({id:'action'});
    expect(await service.duplicate(session,'server','204',input())).toEqual({id:'action'});
    expect(mutate).not.toHaveBeenCalled();expect(guild.roles.fetch).not.toHaveBeenCalled();
  });
});
