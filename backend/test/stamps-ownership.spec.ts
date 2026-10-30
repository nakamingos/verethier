import { StampsOwnershipService } from '../src/services/stamps-ownership.service';
import { stampCriteria } from '../src/utils/stamp-rule.util';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { prepareRuleCriteria } from '../src/services/rule-create.util';
import { ruleCriteriaKey, ruleEditFields, ruleEditVersion } from '../src/utils/rule-edit.util';
import { RuleEditService } from '../src/services/rule-edit.service';
import { portalRule } from '../src/portal/portal.service';
import { planRuleConsolidation } from '../src/utils/rule-consolidation.util';

const wallet = '1GotRejB6XsGgMsM79TvcypeanDJRJbMtg';
const other = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const asset = 'A6360128538192758000';
const stamp = (id=1, overrides={}) => ({stamp:id,cpid:asset,creator:wallet,divisible:false,...overrides});
const balance = (quantity:number|string=3, overrides={}) => ({address:wallet,asset,quantity,utxo:null,utxo_address:null,asset_info:{divisible:false},...overrides});
const rule = (criteria:any={stamp_ids:['1']}) => ({id:1,asset_type:'stamp',stamp_criteria:criteria,min_items:2,slug:null,server_id:'s',channel_id:'c',role_id:'r'} as any);
const run = () => ({checks:new Map()});

describe('Bitcoin Stamps ownership',()=>{
 let service:StampsOwnershipService, request:jest.SpyInstance, rows:any[], catalog:any[];
 beforeEach(()=>{
  service=new StampsOwnershipService(); rows=[balance()];catalog=[stamp(1,{address:wallet})];
  request=jest.spyOn(service as any,'request').mockImplementation(async (provider:string,path:string)=>{
   if (provider==='xcp' && path==='/') return {result:{server_ready:true,network:'mainnet'}};
   if (path==='/health') return {status:'OK',services:{indexer:true,database:true,blockSync:{isSynced:true}}};
   if(provider==='xcp') return {result:rows,next_cursor:null,bouncer_height:973830,result_count:rows.length};
   if(path.includes('/stamps/balance/')) return {page:1,limit:100,total:catalog.length,totalPages:catalog.length?1:0,data:catalog};
   return {data:{stamp:stamp()}};
  });
 });
 afterEach(()=>jest.restoreAllMocks());
 it('counts owned editions rather than distinct stamp numbers',async()=>{
  expect(await service.count(rule(),[wallet,wallet])).toBe(3n);
  expect(await service.matchingAssets(rule(),[wallet],run())).toEqual(new Map([[asset,3n]]));
 });
 it('matches creator alone or creator AND explicit stamp numbers',async()=>{
  expect(await service.count(rule({creator:wallet}),[wallet])).toBe(3n);
  expect(await service.count(rule({creator:wallet,stamp_ids:['1']}),[wallet])).toBe(3n);
  expect(await service.count(rule({creator:other}),[wallet])).toBe(0n);
  await expect(service.count(rule({creator:other,stamp_ids:['1']}),[wallet])).rejects.toThrow();
 });
 it('counts zero only after a complete current inventory',async()=>{
  rows=[];
  expect(await service.count(rule(),[wallet])).toBe(0n);
  expect(await service.count(rule({creator:wallet}),[wallet])).toBe(0n);
  expect(await service.count(rule(),[])).toBe(0n);
 });
 it('does not count creator holdings, transaction history or catalog quantities as ownership',async()=>{
  rows=[balance(0)];catalog=[stamp(1,{address:wallet,balance:999999999})];
  expect(await service.count(rule({creator:wallet}),[wallet])).toBe(0n);
 });
 it('shares one inventory, health check and stamp lookup across overlapping rules in a run',async()=>{
  const context=run();
  await Promise.all([service.count(rule(),[wallet],context),service.count(rule(),[wallet],context)]);
  expect(request.mock.calls.filter(c=>c[0]==='xcp' && c[1]!=='/')).toHaveLength(1);
  expect(request.mock.calls.filter(c=>c[1]==='/stamps/1')).toHaveLength(1);
 });
 it('rechecks ownership on the next run instead of serving cached holdings',async()=>{
  expect(await service.count(rule(),[wallet])).toBe(3n);rows=[];
  expect(await service.count(rule(),[wallet])).toBe(0n);
 });
 it('sums stacked wallets and deduplicates overlapping stamp identities',async()=>{
  request.mockImplementation(async(provider,path)=>{
   if(provider==='xcp' && path!=='/') return {result:[balance(path.includes(other)?2:3,{address:path.includes(other)?other:wallet})],bouncer_height:973830,result_count:1,next_cursor:null};
   if(provider==='xcp') return {result:{server_ready:true,network:'mainnet'}};
   if(path==='/health') return {status:'OK',services:{indexer:true,database:true,blockSync:{isSynced:true}}};
   return {data:{stamp:stamp(path.endsWith('/2')?2:1)}};
  });
  expect(await service.count(rule({stamp_ids:['1','2']}),[wallet,other])).toBe(5n);
 });
 it('includes UTXO-bound and unbound copies exactly once',async()=>{
  rows=[balance(2),balance(5,{address:null,utxo:'a'.repeat(64)+':0',utxo_address:wallet})];
  expect(await service.count(rule(),[wallet])).toBe(7n);
 });
 it.each([
  balance(3,{address:other}),balance(3,{utxo:'bad',utxo_address:wallet}),balance(-1),balance(0.1),
  balance(Number.MAX_SAFE_INTEGER+1),balance('01'),balance('1e3'),balance(3,{asset_info:{}}),
 ])('rejects malformed, imprecise or foreign balances',async bad=>{
  rows=[bad];await expect(service.count(rule(),[wallet])).rejects.toThrow();
 });
 it('preserves exact integer quantities above the JS integer limit when supplied as strings',async()=>{
  rows=[balance('9007199254740993')];expect(await service.count(rule(),[wallet])).toBe(9007199254740993n);
 });
 it('rejects repeated balance rows, rather than double counting',async()=>{
  rows=[balance(),balance()];await expect(service.count(rule(),[wallet])).rejects.toThrow();
 });
 it.each([{}, {result:[],bouncer_height:973830,result_count:1,next_cursor:null},{result:[balance()],bouncer_height:973830,result_count:1,next_cursor:undefined}])('rejects incomplete balance envelopes',async envelope=>{
  const previous=request.getMockImplementation();request.mockImplementation((provider,path)=>provider==='xcp'&&path!=='/'?envelope:previous(provider,path));
  await expect(service.count(rule(),[wallet])).rejects.toThrow();
 });
 it('follows Counterparty cursors to the end and rejects repeated cursors',async()=>{
  const previous=request.getMockImplementation();request.mockImplementation((provider,path)=>{
   if(provider==='xcp'&&path!=='/')return path.includes('cursor=2')?{result:[balance(2,{asset:'A2'})],bouncer_height:973830,result_count:2,next_cursor:null}:{result:[balance()],bouncer_height:973830,result_count:2,next_cursor:2};
   return previous(provider,path);
  });
  expect(await service.count(rule(),[wallet])).toBe(3n);
  request.mockImplementation((provider,path)=>provider==='xcp'&&path!=='/'?{result:[balance()],bouncer_height:973830,result_count:2,next_cursor:2}:previous(provider,path));
  await expect(service.count(rule(),[wallet])).rejects.toThrow();
 });
 it('requires complete catalog pagination and rejects duplicates',async()=>{
  catalog=[stamp(1,{address:wallet}),stamp(1,{address:wallet})];
  await expect(service.count(rule({creator:wallet}),[wallet])).rejects.toThrow();
 });
 it('confirms suspicious empty catalogs against explicit asset records',async()=>{
  catalog=[];expect(await service.count(rule({creator:wallet}),[wallet])).toBe(3n);
 });
 it.each([{divisible:true},{creator:other},{cpid:null}])('rejects invalid explicit scopes during setup',async fields=>{
  const previous=request.getMockImplementation();request.mockImplementation((provider,path)=>path==='/stamps/1'?{data:{stamp:stamp(1,fields)}}:previous(provider,path));
  await expect(service.prepareRule({creator:wallet,stamp_ids:['1']})).rejects.toThrow();
 });
 it('excludes cursed stamps in an otherwise valid mixed inventory',async()=>{
  catalog=[stamp(-1,{address:wallet,cpid:'CURSED'}),stamp(1,{address:wallet})];
  rows=[balance(3),balance(99,{asset:'CURSED'})];
  expect(await service.count(rule({creator:wallet}),[wallet])).toBe(3n);
 });
 it('rejects inventory pages from different confirmed blocks',async()=>{
  const previous=request.getMockImplementation();
  request.mockImplementation((provider,path)=>provider==='xcp'&&path!=='/'?(path.includes('cursor=2')?
   {result:[balance(1,{asset:'A2'})],bouncer_height:973831,result_count:2,next_cursor:null}:
   {result:[balance()],bouncer_height:973830,result_count:2,next_cursor:2}):previous(provider,path));
  await expect(service.count(rule(),[wallet])).rejects.toThrow();
 });
 it('validates provider health instead of granting or revoking on unavailable responses',async()=>{
  request.mockRejectedValue(new Error('offline'));await expect(service.count(rule(),[wallet])).rejects.toThrow();
 });
});

describe('Stamps rule creation and editing',()=>{
 it('normalizes deduplicated IDs and preserves case-sensitive creator addresses',()=>{
  expect(stampCriteria({creator:wallet,stamp_ids:['2','0','1','2']})).toEqual({creator:wallet,stamp_ids:['0','1','2']});
 });
 it.each([{},null,[],{stamp_ids:[]},{stamp_ids:[1]},{stamp_ids:['-1']},{stamp_ids:['01']},{stamp_ids:['9007199254740992']},{creator:wallet.toLowerCase()},{creator:'x'},{creator:wallet,unknown:true}])('rejects invalid or empty criteria',criteria=>expect(()=>stampCriteria(criteria)).toThrow());
 it('uses the same prepared criteria for dashboard and slash command creation',async()=>{
  const stamps={prepareRule:jest.fn().mockResolvedValue({asset_type:'stamp',chain_id:null,stamp_criteria:{creator:wallet}})};
  const prepared=await prepareRuleCriteria({asset_type:'stamp',stamp_criteria:{creator:wallet},min_items:5},{stamps} as any);
  expect(prepared).toEqual({slug:null,attributeKey:'ALL',attributeValue:'ALL',minItems:5,assetFields:{asset_type:'stamp',chain_id:null,stamp_criteria:{creator:wallet}}});
 });
 it.each([{slug:'all'},{network:'ethereum'},{trait_filter:{operator:'AND',conditions:[{key:'x',value:'y'}]}},{min_balance:'1'},{solana_criteria:{}},{inscription_ids:'x'}])('rejects unrelated rule options',async options=>{
  await expect(prepareRuleCriteria({asset_type:'stamp',stamp_criteria:{creator:wallet},...options} as any,{stamps:{prepareRule:jest.fn()}} as any)).rejects.toThrow();
 });
 it('allows minimum edits without exposing unsupported trait or collection editors',async()=>{
  const before=rule();expect(ruleEditFields(before).map(f=>f.key)).toEqual(['min_items']);
  expect(portalRule(before).fields.map(f=>f.key)).toEqual(['min_items']);
  const editor=new RuleEditService(null,null,null,null);
  expect((await editor.prepare(before,{min_items:'7'})).min_items).toBe(7);
  await expect(editor.prepare(before,{min_items:'7',trait_filter:'null'})).rejects.toThrow();
 });
 it('guards stamp scope in edit versions and duplicate criteria',()=>{
  expect(ruleEditVersion(rule())).not.toBe(ruleEditVersion(rule({stamp_ids:['2']})));
  expect(ruleCriteriaKey(rule())).not.toBe(ruleCriteriaKey(rule({stamp_ids:['2']})));
  expect(planRuleConsolidation([rule(),{...rule({stamp_ids:['2']}),id:2}])).toEqual([]);
 });
 it('routes Stamps away from EVM ownership',async()=>{
  const stamps={count:jest.fn().mockResolvedValue(3n),matchingAssets:jest.fn().mockResolvedValue(new Map([[asset,3n]]))};
  const ownership=new AssetOwnershipService(null,null,null,null,null,null,stamps as any);
  expect(await ownership.count(rule(),[wallet,'0x'+'1'.repeat(40)])).toBe(3n);
  expect(stamps.count.mock.calls[0][1]).toEqual([wallet]);
 });
});


describe('Stamps upstream transport',()=>{
 afterEach(()=>jest.restoreAllMocks());
 const headers=(extra:Record<string,string>={})=>new Headers({'x-counterparty-ready':'True','x-counterparty-height':'973830','x-bitcoin-height':'973830',...extra});
 it.each([
  {status:429,headers:headers()}, {status:503,headers:headers()},
  {status:200,headers:headers({'x-counterparty-ready':'False'})},
  {status:200,headers:headers({'x-bitcoin-height':'973834'})},
  {status:200,headers:headers({age:'121'})},
 ])('fails unavailable on rate limits, outages and stale/not-ready node replies',async response=>{
  jest.spyOn(global,'fetch').mockResolvedValue(new Response('{}',response));
  await expect((new StampsOwnershipService() as any).request('xcp','/')).rejects.toThrow('temporarily unavailable');
 });
 it('uses the confirmed node height from headers and does not follow redirects',async()=>{
  const fetch=jest.spyOn(global,'fetch').mockResolvedValue(new Response('{"result":[]}',{status:200,headers:headers()}));
  expect(await (new StampsOwnershipService() as any).request('xcp','/')).toMatchObject({result:[],bouncer_height:973830});
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
 });
 it('does not expose upstream errors or treat failures as empty holdings',async()=>{
  jest.spyOn(global,'fetch').mockRejectedValue(new Error('sensitive upstream details'));
  await expect((new StampsOwnershipService() as any).request('xcp','/')).rejects.toThrow('Bitcoin Stamps ownership is temporarily unavailable. Please try again.');
 });
});
